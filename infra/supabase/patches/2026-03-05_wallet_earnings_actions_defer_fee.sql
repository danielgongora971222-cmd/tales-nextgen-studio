-- infra/supabase/patches/2026-03-05_wallet_earnings_actions_defer_fee.sql
--
-- OBJETIVO (P0):
-- 1) NO descontar el fee de plataforma (37%) al momento de la compra.
--    El seller debe ver el 100% como earnings (pending->matured).
-- 2) Aplicar el fee SOLO cuando el seller solicita CASH OUT.
-- 3) Implementar 2 acciones sobre earnings disponibles (matured):
--    - Transferir a créditos de generación (SIN fee)
--    - Solicitar Cash out (con fee) -> queda en estado "requested" hasta integrar payout.
-- 4) Fix idempotente para compras existentes donde se descontó el fee por error.

begin;

-- =========================
-- 0) Hardening: asegurar columna meta en wallet_ledger
-- =========================
alter table public.wallet_ledger
  add column if not exists meta jsonb not null default '{}'::jsonb;

-- =========================
-- 0.1) Helper: asegurar fila en wallet_balances
-- =========================
create or replace function public.wallet_ensure_row(p_user_id uuid)
returns void as $$
begin
  insert into public.wallet_balances(user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
end;
$$ language plpgsql;

revoke all on function public.wallet_ensure_row(uuid) from PUBLIC, anon, authenticated;
grant execute on function public.wallet_ensure_row(uuid) to service_role;

-- =========================
-- 1) Tabla: wallet_cashout_requests
-- =========================
create table if not exists public.wallet_cashout_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_credits integer not null check (amount_credits > 0),

  -- Valor usado para este request (USD micros = 1e-6 USD)
  usd_micros_per_credit bigint not null check (usd_micros_per_credit > 0),
  gross_usd_micros bigint not null check (gross_usd_micros >= 0),
  fee_bps integer not null check (fee_bps >= 0 and fee_bps <= 10000),
  fee_usd_micros bigint not null check (fee_usd_micros >= 0),
  net_usd_micros bigint not null check (net_usd_micros >= 0),

  payout_method jsonb not null default '{}'::jsonb,

  status text not null default 'requested'
    check (status in ('requested','processing','paid','rejected','cancelled')),

  provider text,
  provider_ref text,

  idempotency_key text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists wallet_cashout_requests_user_created_at_idx
  on public.wallet_cashout_requests(user_id, created_at desc);

create unique index if not exists wallet_cashout_requests_user_idempotency_uq
  on public.wallet_cashout_requests(user_id, idempotency_key)
  where idempotency_key is not null;

alter table public.wallet_cashout_requests enable row level security;

drop policy if exists "wallet_cashout_requests_select_own" on public.wallet_cashout_requests;
create policy "wallet_cashout_requests_select_own" on public.wallet_cashout_requests
  for select using (auth.uid() = user_id);

revoke all on table public.wallet_cashout_requests from PUBLIC, anon, authenticated;

-- =========================
-- 2) RPC: earnings matured -> gen_topup (SIN fee)
-- =========================
create or replace function public.wallet_transfer_earnings_to_generation(
  p_user_id uuid,
  p_amount integer,
  p_idempotency_key text default null
)
returns table (
  ledger_id uuid,
  gen_plan_credits integer,
  gen_topup_credits integer,
  gen_bonus_credits integer,
  earnings_pending_credits integer,
  earnings_matured_credits integer
)
language plpgsql
security definer
as $$
declare
  v_bal public.wallet_balances%rowtype;
  v_existing uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  -- Idempotencia (wallet_ledger)
  if p_idempotency_key is not null and length(trim(p_idempotency_key)) > 0 then
    select id into v_existing
    from public.wallet_ledger
    where user_id = p_user_id and idempotency_key = p_idempotency_key
    limit 1;

    if v_existing is not null then
      select * into v_bal from public.wallet_balances where user_id = p_user_id;
      return query select
        v_existing,
        v_bal.gen_plan_credits,
        v_bal.gen_topup_credits,
        v_bal.gen_bonus_credits,
        v_bal.earnings_pending_credits,
        v_bal.earnings_matured_credits;
      return;
    end if;
  end if;

  -- Lock wallet
  select * into v_bal
  from public.wallet_balances
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.wallet_balances(user_id) values (p_user_id)
    on conflict (user_id) do nothing;
    select * into v_bal from public.wallet_balances where user_id = p_user_id for update;
  end if;

  if v_bal.earnings_matured_credits < p_amount then
    raise exception 'INSUFFICIENT_EARNINGS';
  end if;

  update public.wallet_balances
    set earnings_matured_credits = earnings_matured_credits - p_amount,
        gen_topup_credits = gen_topup_credits + p_amount,
        updated_at = now()
  where user_id = p_user_id
  returning * into v_bal;

  insert into public.wallet_ledger(
    user_id,
    entry_type,
    amount_credits,
    ref_type,
    ref_id,
    idempotency_key,
    meta
  ) values (
    p_user_id,
    'earnings_to_generation',
    0,
    'wallet',
    null,
    p_idempotency_key,
    jsonb_build_object(
      'delta_earnings_matured_credits', -p_amount,
      'delta_gen_topup_credits', p_amount
    )
  )
  returning id into v_existing;

  return query select
    v_existing,
    v_bal.gen_plan_credits,
    v_bal.gen_topup_credits,
    v_bal.gen_bonus_credits,
    v_bal.earnings_pending_credits,
    v_bal.earnings_matured_credits;
end;
$$;

revoke all on function public.wallet_transfer_earnings_to_generation(uuid, integer, text) from PUBLIC, anon, authenticated;
grant execute on function public.wallet_transfer_earnings_to_generation(uuid, integer, text) to service_role;

-- =========================
-- 3) RPC: solicitar cashout (fee se aplica aquí)
-- =========================
create or replace function public.wallet_request_cashout(
  p_user_id uuid,
  p_amount_credits integer,
  p_payout_method jsonb default '{}'::jsonb,
  p_usd_micros_per_credit bigint default 4990,
  p_fee_bps integer default 3700,
  p_idempotency_key text default null
)
returns table (
  cashout_id uuid,
  status text,
  amount_credits integer,
  usd_micros_per_credit bigint,
  fee_bps integer,
  gross_usd_micros bigint,
  fee_usd_micros bigint,
  net_usd_micros bigint,
  earnings_matured_credits integer,
  earnings_pending_credits integer,
  gen_plan_credits integer,
  gen_topup_credits integer,
  gen_bonus_credits integer
)
language plpgsql
security definer
as $$
declare
  v_bal public.wallet_balances%rowtype;
  v_existing public.wallet_cashout_requests%rowtype;
  v_gross bigint;
  v_fee bigint;
  v_net bigint;
  v_id uuid;
begin
  if p_amount_credits is null or p_amount_credits <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  if p_usd_micros_per_credit is null or p_usd_micros_per_credit <= 0 then
    raise exception 'INVALID_RATE';
  end if;

  if p_fee_bps is null or p_fee_bps < 0 or p_fee_bps > 10000 then
    raise exception 'INVALID_FEE';
  end if;

  -- Idempotencia (tabla de cashouts)
  if p_idempotency_key is not null and length(trim(p_idempotency_key)) > 0 then
    select * into v_existing
    from public.wallet_cashout_requests
    where user_id = p_user_id and idempotency_key = p_idempotency_key
    limit 1;

    if v_existing.id is not null then
      select * into v_bal from public.wallet_balances where user_id = p_user_id;
      return query select
        v_existing.id,
        v_existing.status,
        v_existing.amount_credits,
        v_existing.usd_micros_per_credit,
        v_existing.fee_bps,
        v_existing.gross_usd_micros,
        v_existing.fee_usd_micros,
        v_existing.net_usd_micros,
        v_bal.earnings_matured_credits,
        v_bal.earnings_pending_credits,
        v_bal.gen_plan_credits,
        v_bal.gen_topup_credits,
        v_bal.gen_bonus_credits;
      return;
    end if;
  end if;

  -- Lock wallet
  select * into v_bal
  from public.wallet_balances
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.wallet_balances(user_id) values (p_user_id)
    on conflict (user_id) do nothing;
    select * into v_bal from public.wallet_balances where user_id = p_user_id for update;
  end if;

  if v_bal.earnings_matured_credits < p_amount_credits then
    raise exception 'INSUFFICIENT_EARNINGS';
  end if;

  v_gross := (p_amount_credits::bigint) * (p_usd_micros_per_credit::bigint);
  v_fee := (v_gross * p_fee_bps::bigint) / 10000;
  if v_fee < 0 then v_fee := 0; end if;
  if v_fee > v_gross then v_fee := v_gross; end if;
  v_net := v_gross - v_fee;

  update public.wallet_balances
    set earnings_matured_credits = earnings_matured_credits - p_amount_credits,
        updated_at = now()
  where user_id = p_user_id
  returning * into v_bal;

  insert into public.wallet_cashout_requests(
    user_id,
    amount_credits,
    usd_micros_per_credit,
    gross_usd_micros,
    fee_bps,
    fee_usd_micros,
    net_usd_micros,
    payout_method,
    status,
    idempotency_key
  ) values (
    p_user_id,
    p_amount_credits,
    p_usd_micros_per_credit,
    v_gross,
    p_fee_bps,
    v_fee,
    v_net,
    coalesce(p_payout_method, '{}'::jsonb),
    'requested',
    p_idempotency_key
  )
  returning id into v_id;

  insert into public.wallet_ledger(
    user_id,
    entry_type,
    amount_credits,
    ref_type,
    ref_id,
    idempotency_key,
    meta
  ) values (
    p_user_id,
    'cashout_requested',
    -p_amount_credits,
    'wallet_cashout',
    v_id,
    p_idempotency_key,
    jsonb_build_object(
      'usd_micros_per_credit', p_usd_micros_per_credit,
      'fee_bps', p_fee_bps,
      'gross_usd_micros', v_gross,
      'fee_usd_micros', v_fee,
      'net_usd_micros', v_net
    )
  );

  return query select
    v_id,
    'requested',
    p_amount_credits,
    p_usd_micros_per_credit,
    p_fee_bps,
    v_gross,
    v_fee,
    v_net,
    v_bal.earnings_matured_credits,
    v_bal.earnings_pending_credits,
    v_bal.gen_plan_credits,
    v_bal.gen_topup_credits,
    v_bal.gen_bonus_credits;
end;
$$;

revoke all on function public.wallet_request_cashout(uuid, integer, jsonb, bigint, integer, text) from PUBLIC, anon, authenticated;
grant execute on function public.wallet_request_cashout(uuid, integer, jsonb, bigint, integer, text) to service_role;

-- =========================
-- 4) FIX: community_purchase_listing (fee diferido)
-- =========================
create or replace function public.community_purchase_listing(
  p_listing_id uuid,
  p_buyer_id uuid,
  p_referral_code text default null,
  p_idempotency_key text default null
)
returns table (
  purchase_id uuid,
  paid_credits integer
)
language plpgsql
security definer
as $$
declare
  v_listing public.community_listings%rowtype;
  v_ref public.community_referral_codes%rowtype;

  v_price integer := 0;
  v_paid integer := 0;

  v_seller_gross integer := 0;

  v_ref_reward integer := 0;
  v_referrer_id uuid := null;

  v_recipe_hash text := null;
  v_now timestamptz := now();

  v_existing public.community_purchases%rowtype;
  v_fee_cap integer := 0;
begin
  -- Idempotencia
  if p_idempotency_key is not null and length(trim(p_idempotency_key)) > 0 then
    select * into v_existing
    from public.community_purchases
    where idempotency_key = p_idempotency_key
    limit 1;

    if v_existing.id is not null then
      purchase_id := v_existing.id;
      paid_credits := v_existing.paid_credits;
      return next;
      return;
    end if;
  end if;

  -- Lock listing
  select * into v_listing
  from public.community_listings
  where id = p_listing_id
  for update;

  if v_listing.id is null then
    raise exception 'LISTING_NOT_FOUND';
  end if;

  if v_listing.status <> 'active' then
    raise exception 'LISTING_NOT_ACTIVE';
  end if;

  if p_buyer_id = v_listing.seller_id then
    raise exception 'CANNOT_BUY_OWN_LISTING';
  end if;

  if exists (
    select 1
    from public.community_purchases p
    where p.listing_id = p_listing_id
      and p.buyer_id = p_buyer_id
      and p.status = 'completed'
  ) then
    raise exception 'ALREADY_OWNED';
  end if;

  select recipe_hash into v_recipe_hash
  from public.community_listing_recipes
  where listing_id = p_listing_id
  limit 1;

  if v_recipe_hash is null then
    raise exception 'LISTING_RECIPE_MISSING';
  end if;

  v_price := v_listing.price_credits;
  v_paid := v_price;

  -- Referral opcional
  v_ref_reward := 0;
  v_referrer_id := null;

  if p_referral_code is not null and length(trim(p_referral_code)) > 0 then
    select * into v_ref
    from public.community_referral_codes
    where code = upper(trim(p_referral_code))
      and is_active = true
    limit 1;

    if v_ref.id is not null and v_ref.owner_id <> p_buyer_id then
      v_referrer_id := v_ref.owner_id;

      if coalesce(v_ref.buyer_discount_pct, 0) > 0 then
        v_paid := floor((v_price * (100 - v_ref.buyer_discount_pct)) / 100.0)::int;
        if v_paid < 1 then v_paid := 1; end if;
      end if;

      if coalesce(v_ref.ref_reward_pct, 0) > 0 then
        v_ref_reward := floor((v_paid * v_ref.ref_reward_pct) / 100.0)::int;
        if v_ref_reward < 0 then v_ref_reward := 0; end if;
      end if;
    end if;
  end if;

  -- Cap reward a futuro fee (37%)
  v_fee_cap := floor(v_paid * 0.37)::int;
  if v_fee_cap < 0 then v_fee_cap := 0; end if;
  if v_ref_reward > v_fee_cap then
    v_ref_reward := v_fee_cap;
  end if;

  -- Seller recibe 100% del paid
  v_seller_gross := v_paid;

  -- asegurar wallet rows
  perform public.wallet_ensure_row(p_buyer_id);
  perform public.wallet_ensure_row(v_listing.seller_id);
  if v_referrer_id is not null then
    perform public.wallet_ensure_row(v_referrer_id);
  end if;

  insert into public.community_purchases (
    listing_id,
    buyer_id,
    seller_id,
    price_credits,
    paid_credits,
    platform_fee_credits,
    seller_net_credits,
    referral_code_id,
    referral_reward_credits,
    referrer_id,
    status,
    created_at,
    matures_at,
    is_matured,
    recipe_hash_at_purchase,
    idempotency_key
  ) values (
    p_listing_id,
    p_buyer_id,
    v_listing.seller_id,
    v_price,
    v_paid,
    0,
    v_seller_gross,
    v_ref.id,
    v_ref_reward,
    v_referrer_id,
    'completed',
    v_now,
    v_now + interval '30 days',
    false,
    v_recipe_hash,
    p_idempotency_key
  )
  returning id into purchase_id;

  paid_credits := v_paid;

  -- Debit buyer (buckets)
  perform public.wallet_spend_generation_credits(
    p_buyer_id,
    v_paid,
    'gen_spend_marketplace',
    'community_purchase',
    purchase_id,
    case when p_idempotency_key is null then null else 'buy:' || p_idempotency_key end
  );

  -- Credit seller pending (GROSS)
  update public.wallet_balances
    set earnings_pending_credits = earnings_pending_credits + v_seller_gross,
        updated_at = now()
  where user_id = v_listing.seller_id;

  insert into public.wallet_ledger(user_id, entry_type, amount_credits, ref_type, ref_id, idempotency_key, meta)
  values (
    v_listing.seller_id,
    'sale_pending',
    v_seller_gross,
    'community_purchase',
    purchase_id,
    case when p_idempotency_key is null then null else 'sale:' || p_idempotency_key end,
    jsonb_build_object('gross', true)
  );

  -- Referral reward pending
  if v_referrer_id is not null and v_ref_reward > 0 then
    update public.wallet_balances
      set earnings_pending_credits = earnings_pending_credits + v_ref_reward,
          updated_at = now()
    where user_id = v_referrer_id;

    insert into public.wallet_ledger(user_id, entry_type, amount_credits, ref_type, ref_id, idempotency_key, meta)
    values (
      v_referrer_id,
      'referral_reward_pending',
      v_ref_reward,
      'community_purchase',
      purchase_id,
      case when p_idempotency_key is null then null else 'ref:' || p_idempotency_key end,
      jsonb_build_object('source', 'fee_future')
    );
  end if;

  return next;
end;
$$;

revoke all on function public.community_purchase_listing(uuid, uuid, text, text) from PUBLIC, anon, authenticated;
grant execute on function public.community_purchase_listing(uuid, uuid, text, text) to service_role;

-- =========================
-- 5) Maturation: pending -> matured (compras)
-- =========================
create or replace function public.community_mature_due_purchases()
returns integer
language sql
security definer
as $$
  with due as (
    update public.community_purchases
    set is_matured = true
    where is_matured = false
      and status = 'completed'
      and matures_at <= now()
    returning id, seller_id, seller_net_credits, referrer_id, referral_reward_credits
  ),
  sellers as (
    select seller_id as user_id, sum(seller_net_credits)::int as amt
    from due
    group by seller_id
  ),
  referrers as (
    select referrer_id as user_id, sum(referral_reward_credits)::int as amt
    from due
    where referrer_id is not null and referral_reward_credits > 0
    group by referrer_id
  ),
  upd_sellers as (
    update public.wallet_balances wb
    set earnings_pending_credits = greatest(wb.earnings_pending_credits - s.amt, 0),
        earnings_matured_credits = wb.earnings_matured_credits + s.amt,
        updated_at = now()
    from sellers s
    where wb.user_id = s.user_id
    returning wb.user_id
  ),
  upd_referrers as (
    update public.wallet_balances wb
    set earnings_pending_credits = greatest(wb.earnings_pending_credits - r.amt, 0),
        earnings_matured_credits = wb.earnings_matured_credits + r.amt,
        updated_at = now()
    from referrers r
    where wb.user_id = r.user_id
    returning wb.user_id
  ),
  ins_ledger as (
    insert into public.wallet_ledger(user_id, entry_type, amount_credits, ref_type, ref_id, meta)
    select seller_id, 'sale_matured', seller_net_credits, 'community_purchase', id, jsonb_build_object('gross', true)
    from due
    union all
    select referrer_id, 'referral_reward_matured', referral_reward_credits, 'community_purchase', id, jsonb_build_object('source', 'fee_future')
    from due
    where referrer_id is not null and referral_reward_credits > 0
    returning id
  )
  select count(*)::int from due;
$$;

revoke all on function public.community_mature_due_purchases() from PUBLIC, anon, authenticated;
grant execute on function public.community_mature_due_purchases() to service_role;

-- =========================
-- 6) DATA FIX (idempotente): compras neteadas (seller_net_credits < paid_credits)
-- =========================
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'community_purchases'
  ) then
    insert into public.wallet_balances(user_id)
    select distinct seller_id
    from public.community_purchases
    where status = 'completed'
      and paid_credits > seller_net_credits
    on conflict (user_id) do nothing;

    with affected as (
      select
        id,
        seller_id,
        paid_credits,
        seller_net_credits,
        (paid_credits - seller_net_credits) as delta,
        is_matured
      from public.community_purchases
      where status = 'completed'
        and paid_credits > seller_net_credits
    ),
    upd_p as (
      update public.community_purchases p
      set seller_net_credits = p.paid_credits,
          platform_fee_credits = 0
      from affected a
      where p.id = a.id
      returning p.id, a.seller_id, a.delta, a.is_matured
    ),
    agg_pending as (
      select seller_id, sum(delta)::int as total
      from upd_p
      where is_matured = false
      group by seller_id
    ),
    agg_matured as (
      select seller_id, sum(delta)::int as total
      from upd_p
      where is_matured = true
      group by seller_id
    ),
    upd_pending as (
      update public.wallet_balances wb
      set earnings_pending_credits = wb.earnings_pending_credits + a.total,
          updated_at = now()
      from agg_pending a
      where wb.user_id = a.seller_id
      returning wb.user_id
    ),
    upd_matured as (
      update public.wallet_balances wb
      set earnings_matured_credits = wb.earnings_matured_credits + a.total,
          updated_at = now()
      from agg_matured a
      where wb.user_id = a.seller_id
      returning wb.user_id
    )
    insert into public.wallet_ledger(user_id, entry_type, amount_credits, ref_type, ref_id, idempotency_key, meta)
    select
      u.seller_id,
      case when u.is_matured then 'sale_gross_adjustment_matured' else 'sale_gross_adjustment_pending' end,
      u.delta,
      'community_purchase',
      u.id,
      'fix:sale_gross:' || u.id::text,
      jsonb_build_object(
        'note', 'Ajuste por fee diferido (antes se descontaba en la compra)',
        'delta', u.delta
      )
    from upd_p u
    where not exists (
      select 1
      from public.wallet_ledger wl
      where wl.user_id = u.seller_id
        and wl.idempotency_key = 'fix:sale_gross:' || u.id::text
    );
  end if;
end $$;

commit;