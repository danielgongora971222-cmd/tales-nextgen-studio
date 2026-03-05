begin;

-- =========================================================
-- Helpers de elegibilidad en tiempo real
-- =========================================================

create or replace function public.billing_user_has_active_plan_now(p_user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.get_active_subscription(p_user_id) s
    where s.subscription_id is not null
  );
$$;

create or replace function public.billing_user_can_sell_now(p_user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.get_active_subscription(p_user_id) s
    where s.subscription_id is not null
      and coalesce(s.can_sell, false) = true
  );
$$;

create or replace function public.billing_user_can_refer_now(p_user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.get_active_subscription(p_user_id) s
    where s.subscription_id is not null
      and coalesce(s.can_referrals, false) = true
  );
$$;

revoke all on function public.billing_user_has_active_plan_now(uuid) from PUBLIC, anon, authenticated;
revoke all on function public.billing_user_can_sell_now(uuid) from PUBLIC, anon, authenticated;
revoke all on function public.billing_user_can_refer_now(uuid) from PUBLIC, anon, authenticated;

grant execute on function public.billing_user_has_active_plan_now(uuid) to service_role;
grant execute on function public.billing_user_can_sell_now(uuid) to service_role;
grant execute on function public.billing_user_can_refer_now(uuid) to service_role;

-- =========================================================
-- Vista pública: solo listings activos de sellers elegibles
-- =========================================================

drop view if exists public.community_listings_public_catalog;

create view public.community_listings_public_catalog as
select l.*
from public.community_listings l
where l.status = 'active'
  and public.billing_user_can_sell_now(l.seller_id);

revoke all on table public.community_listings_public_catalog from PUBLIC, anon, authenticated;
grant select on table public.community_listings_public_catalog to service_role;

-- =========================================================
-- Gasto de créditos de generación: requiere plan activo
-- =========================================================

create or replace function public.wallet_spend_generation_credits(
  p_user_id uuid,
  p_amount integer,
  p_entry_type text,
  p_ref_type text default null,
  p_ref_id uuid default null,
  p_idempotency_key text default null
)
returns table (
  ledger_id uuid,
  gen_plan_credits integer,
  gen_topup_credits integer,
  gen_bonus_credits integer
)
language plpgsql
as $$
declare
  v_bal public.wallet_balances%rowtype;
  v_plan_spend integer := 0;
  v_topup_spend integer := 0;
  v_bonus_spend integer := 0;
  v_remaining integer := p_amount;
  v_existing uuid;
begin
  if p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  if p_idempotency_key is not null then
    select id into v_existing
    from public.wallet_ledger
    where user_id = p_user_id and idempotency_key = p_idempotency_key
    limit 1;

    if v_existing is not null then
      select * into v_bal from public.wallet_balances where user_id = p_user_id;
      return query
      select
        v_existing,
        v_bal.gen_plan_credits,
        v_bal.gen_topup_credits,
        v_bal.gen_bonus_credits;
      return;
    end if;
  end if;

  if not public.billing_user_has_active_plan_now(p_user_id) then
    raise exception 'NO_ACTIVE_PLAN';
  end if;

  select * into v_bal
  from public.wallet_balances
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.wallet_balances(user_id) values (p_user_id);
    select * into v_bal
    from public.wallet_balances
    where user_id = p_user_id
    for update;
  end if;

  if (v_bal.gen_plan_credits + v_bal.gen_topup_credits + v_bal.gen_bonus_credits) < p_amount then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  v_plan_spend := least(v_bal.gen_plan_credits, v_remaining);
  v_bal.gen_plan_credits := v_bal.gen_plan_credits - v_plan_spend;
  v_remaining := v_remaining - v_plan_spend;

  if v_remaining > 0 then
    v_topup_spend := least(v_bal.gen_topup_credits, v_remaining);
    v_bal.gen_topup_credits := v_bal.gen_topup_credits - v_topup_spend;
    v_remaining := v_remaining - v_topup_spend;
  end if;

  if v_remaining > 0 then
    v_bonus_spend := least(v_bal.gen_bonus_credits, v_remaining);
    v_bal.gen_bonus_credits := v_bal.gen_bonus_credits - v_bonus_spend;
    v_remaining := v_remaining - v_bonus_spend;
  end if;

  update public.wallet_balances
    set gen_plan_credits = v_bal.gen_plan_credits,
        gen_topup_credits = v_bal.gen_topup_credits,
        gen_bonus_credits = v_bal.gen_bonus_credits,
        updated_at = now()
  where user_id = p_user_id;

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
    p_entry_type,
    -p_amount,
    p_ref_type,
    p_ref_id,
    p_idempotency_key,
    jsonb_build_object(
      'spend_plan', v_plan_spend,
      'spend_topup', v_topup_spend,
      'spend_bonus', v_bonus_spend
    )
  )
  returning id into v_existing;

  return query
  select
    v_existing,
    v_bal.gen_plan_credits,
    v_bal.gen_topup_credits,
    v_bal.gen_bonus_credits;
end;
$$;

-- =========================================================
-- Cancelación sin wipe: conserva créditos, pero bloqueados
-- =========================================================

create or replace function public.billing_cancel_subscription_only(
  p_user_id uuid,
  p_idempotency_key text default null
)
returns table (
  retained_plan integer,
  retained_topup integer,
  retained_bonus integer
)
language plpgsql
as $$
declare
  v_existing uuid;
  v_bal public.wallet_balances%rowtype;
begin
  if not exists (
    select 1
    from public.billing_subscriptions
    where user_id = p_user_id
      and status = 'active'
  ) then
    raise exception 'NO_ACTIVE_SUBSCRIPTION';
  end if;

  if p_idempotency_key is not null then
    select id into v_existing
    from public.wallet_ledger
    where user_id = p_user_id and idempotency_key = p_idempotency_key
    limit 1;

    if v_existing is not null then
      select * into v_bal from public.wallet_balances where user_id = p_user_id;
      return query
      select
        v_bal.gen_plan_credits,
        v_bal.gen_topup_credits,
        v_bal.gen_bonus_credits;
      return;
    end if;
  end if;

  select * into v_bal
  from public.wallet_balances
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.wallet_balances(user_id) values (p_user_id);
    select * into v_bal
    from public.wallet_balances
    where user_id = p_user_id
    for update;
  end if;

  update public.billing_subscriptions
    set status = 'canceled',
        current_period_end = least(current_period_end, now()),
        updated_at = now()
  where user_id = p_user_id
    and status = 'active';

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
    'cancel_subscription_only',
    0,
    'billing_subscription',
    null,
    p_idempotency_key,
    jsonb_build_object(
      'retained_plan', v_bal.gen_plan_credits,
      'retained_topup', v_bal.gen_topup_credits,
      'retained_bonus', v_bal.gen_bonus_credits
    )
  );

  return query
  select
    v_bal.gen_plan_credits,
    v_bal.gen_topup_credits,
    v_bal.gen_bonus_credits;
end;
$$;

revoke all on function public.billing_cancel_subscription_only(uuid, text) from PUBLIC, anon, authenticated;
grant execute on function public.billing_cancel_subscription_only(uuid, text) to service_role;

-- =========================================================
-- Earnings -> generación: requiere Pro+ activo
-- =========================================================

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

  if p_idempotency_key is not null and length(trim(p_idempotency_key)) > 0 then
    select id into v_existing
    from public.wallet_ledger
    where user_id = p_user_id and idempotency_key = p_idempotency_key
    limit 1;

    if v_existing is not null then
      select * into v_bal from public.wallet_balances where user_id = p_user_id;
      return query
      select
        v_existing,
        v_bal.gen_plan_credits,
        v_bal.gen_topup_credits,
        v_bal.gen_bonus_credits,
        v_bal.earnings_pending_credits,
        v_bal.earnings_matured_credits;
      return;
    end if;
  end if;

  if not public.billing_user_can_sell_now(p_user_id) then
    raise exception 'PLAN_REQUIRED_PRO';
  end if;

  select * into v_bal
  from public.wallet_balances
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.wallet_balances(user_id) values (p_user_id)
    on conflict (user_id) do nothing;

    select * into v_bal
    from public.wallet_balances
    where user_id = p_user_id
    for update;
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

  return query
  select
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

-- =========================================================
-- Cashout: requiere Pro+ activo
-- =========================================================

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

  if p_idempotency_key is not null and length(trim(p_idempotency_key)) > 0 then
    select * into v_existing
    from public.wallet_cashout_requests
    where user_id = p_user_id and idempotency_key = p_idempotency_key
    limit 1;

    if v_existing.id is not null then
      select * into v_bal from public.wallet_balances where user_id = p_user_id;
      return query
      select
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

  if not public.billing_user_can_sell_now(p_user_id) then
    raise exception 'PLAN_REQUIRED_PRO';
  end if;

  select * into v_bal
  from public.wallet_balances
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.wallet_balances(user_id) values (p_user_id)
    on conflict (user_id) do nothing;

    select * into v_bal
    from public.wallet_balances
    where user_id = p_user_id
    for update;
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

  return query
  select
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

-- =========================================================
-- Compra marketplace: seller debe seguir elegible y
-- referral owner debe seguir con Partner+ si usa código
-- =========================================================

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

  if not public.billing_user_can_sell_now(v_listing.seller_id) then
    raise exception 'SELLER_PLAN_REQUIRED';
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

  v_ref_reward := 0;
  v_referrer_id := null;

  if p_referral_code is not null and length(trim(p_referral_code)) > 0 then
    select * into v_ref
    from public.community_referral_codes
    where code = upper(trim(p_referral_code))
      and is_active = true
    limit 1;

    if v_ref.id is null then
      raise exception 'INVALID_REFERRAL_CODE';
    end if;

    if v_ref.owner_id = p_buyer_id then
      raise exception 'INVALID_REFERRAL_CODE';
    end if;

    if not public.billing_user_can_refer_now(v_ref.owner_id) then
      raise exception 'REFERRAL_OWNER_NOT_ELIGIBLE';
    end if;

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

  v_fee_cap := floor(v_paid * 0.37)::int;
  if v_fee_cap < 0 then v_fee_cap := 0; end if;
  if v_ref_reward > v_fee_cap then
    v_ref_reward := v_fee_cap;
  end if;

  v_seller_gross := v_paid;

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

  perform public.wallet_spend_generation_credits(
    p_buyer_id,
    v_paid,
    'gen_spend_marketplace',
    'community_purchase',
    purchase_id,
    case when p_idempotency_key is null then null else 'buy:' || p_idempotency_key end
  );

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

commit;