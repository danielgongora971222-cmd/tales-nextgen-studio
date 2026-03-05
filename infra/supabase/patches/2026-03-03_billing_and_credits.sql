-- infra/supabase/patches/2026-03-03_billing_and_credits.sql
-- Planes + subscripciones (MOCK) + créditos (plan/topup/bonus) + hardening de RLS para wallet
-- NOTA: Este patch NO elimina datos existentes; migra desde wallet_balances.generation_credits a gen_topup_credits.

begin;

-- =========================
-- 1) HARDEN WALLET RLS (P0)
-- =========================
-- wallet_balances: el cliente SOLO puede leer su fila. Mutaciones: SOLO backend/service_role via supabaseAdmin.
drop policy if exists "wallet_balances_insert_own" on public.wallet_balances;
drop policy if exists "wallet_balances_update_own" on public.wallet_balances;

-- wallet_ledger: el cliente SOLO puede leer su ledger. Mutaciones: SOLO backend/service_role.
drop policy if exists "wallet_ledger_insert_own" on public.wallet_ledger;

-- =========================
-- 2) MIGRACION DE COLUMNAS DE CREDITOS
-- =========================
alter table public.wallet_balances
  add column if not exists gen_plan_credits integer not null default 0 check (gen_plan_credits >= 0),
  add column if not exists gen_topup_credits integer not null default 0 check (gen_topup_credits >= 0),
  add column if not exists gen_bonus_credits integer not null default 0 check (gen_bonus_credits >= 0);

-- migrar generation_credits existentes -> gen_topup_credits (solo si gen_topup_credits esta en 0 para no duplicar)
update public.wallet_balances
  set gen_topup_credits = gen_topup_credits + generation_credits,
      generation_credits = 0
where generation_credits > 0;

-- =========================
-- 3) PLANES + SUBSCRIPCIONES
-- =========================
create table if not exists public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  billing_period text not null check (billing_period in ('week','month')),
  price_cents integer not null check (price_cents > 0),
  plan_credits integer not null check (plan_credits >= 0),
  bonus_credits integer not null default 0 check (bonus_credits >= 0),
  can_sell boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.billing_plans(id),
  status text not null check (status in ('active','canceled','expired')),
  provider text not null default 'mock' check (provider in ('mock','stripe')),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_subscriptions_user_id_idx on public.billing_subscriptions(user_id);
create index if not exists billing_subscriptions_status_idx on public.billing_subscriptions(status);

-- update trigger
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists billing_subscriptions_set_updated_at on public.billing_subscriptions;
create trigger billing_subscriptions_set_updated_at
before update on public.billing_subscriptions
for each row execute function public.set_updated_at();

-- =========================
-- 4) TOPUPS (packs de créditos)
-- =========================
create table if not exists public.credit_topup_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_cents integer not null check (price_cents > 0),
  credits integer not null check (credits > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.credit_topup_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.credit_topup_products(id),
  credits integer not null check (credits > 0),
  provider text not null default 'mock' check (provider in ('mock','stripe')),
  idempotency_key text,
  created_at timestamptz not null default now()
);

create unique index if not exists credit_topup_purchases_user_id_idem_uniq
  on public.credit_topup_purchases(user_id, idempotency_key)
  where idempotency_key is not null;

-- =========================
-- 5) RPCs / Helpers
-- =========================

-- devuelve subscripción activa (si existe) + plan
create or replace function public.get_active_subscription(p_user_id uuid)
returns table (
  subscription_id uuid,
  status text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  plan_id uuid,
  plan_slug text,
  plan_name text,
  plan_credits integer,
  bonus_credits integer,
  can_sell boolean
) language sql stable as $$
  select
    s.id as subscription_id,
    s.status,
    s.current_period_start,
    s.current_period_end,
    p.id as plan_id,
    p.slug as plan_slug,
    p.name as plan_name,
    p.plan_credits,
    p.bonus_credits,
    p.can_sell
  from public.billing_subscriptions s
  join public.billing_plans p on p.id = s.plan_id
  where s.user_id = p_user_id
    and s.status = 'active'
    and s.current_period_end > now()
  order by s.current_period_end desc
  limit 1;
$$;

-- spend de créditos de generación (plan -> topup -> bonus), con idempotencia en wallet_ledger
create or replace function public.wallet_spend_generation_credits(
  p_user_id uuid,
  p_amount integer,
  p_entry_type text,
  p_ref_type text default null,
  p_ref_id text default null,
  p_idempotency_key text default null
) returns table (
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

  -- idempotency: si ya existe un ledger con esta key, devolver el estado actual
  if p_idempotency_key is not null then
    select id into v_existing
    from public.wallet_ledger
    where user_id = p_user_id and idempotency_key = p_idempotency_key
    limit 1;

    if v_existing is not null then
      select * into v_bal from public.wallet_balances where user_id = p_user_id;
      return query select v_existing, v_bal.gen_plan_credits, v_bal.gen_topup_credits, v_bal.gen_bonus_credits;
      return;
    end if;
  end if;

  -- lock wallet
  select * into v_bal
  from public.wallet_balances
  where user_id = p_user_id
  for update;

  if not found then
    -- asegurar row si no existe
    insert into public.wallet_balances(user_id) values (p_user_id);
    select * into v_bal from public.wallet_balances where user_id = p_user_id for update;
  end if;

  if (v_bal.gen_plan_credits + v_bal.gen_topup_credits + v_bal.gen_bonus_credits) < p_amount then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  -- gastar plan
  if v_remaining > 0 then
    v_plan_spend := least(v_bal.gen_plan_credits, v_remaining);
    v_bal.gen_plan_credits := v_bal.gen_plan_credits - v_plan_spend;
    v_remaining := v_remaining - v_plan_spend;
  end if;

  -- gastar topup
  if v_remaining > 0 then
    v_topup_spend := least(v_bal.gen_topup_credits, v_remaining);
    v_bal.gen_topup_credits := v_bal.gen_topup_credits - v_topup_spend;
    v_remaining := v_remaining - v_topup_spend;
  end if;

  -- gastar bonus
  if v_remaining > 0 then
    v_bonus_spend := least(v_bal.gen_bonus_credits, v_remaining);
    v_bal.gen_bonus_credits := v_bal.gen_bonus_credits - v_bonus_spend;
    v_remaining := v_remaining - v_bonus_spend;
  end if;

  update public.wallet_balances
    set gen_plan_credits = v_bal.gen_plan_credits,
        gen_topup_credits = v_bal.gen_topup_credits,
        gen_bonus_credits = v_bal.gen_bonus_credits
  where user_id = p_user_id;

  insert into public.wallet_ledger(
    user_id,
    entry_type,
    delta_generation_credits,
    delta_earnings_pending_credits,
    delta_earnings_matured_credits,
    referral_code_used,
    related_purchase_id,
    idempotency_key,
    meta
  ) values (
    p_user_id,
    p_entry_type,
    -p_amount,
    0,
    0,
    null,
    null,
    p_idempotency_key,
    jsonb_build_object(
      'ref_type', p_ref_type,
      'ref_id', p_ref_id,
      'spend_plan', v_plan_spend,
      'spend_topup', v_topup_spend,
      'spend_bonus', v_bonus_spend
    )
  )
  returning id into v_existing;

  return query select v_existing, v_bal.gen_plan_credits, v_bal.gen_topup_credits, v_bal.gen_bonus_credits;
end;
$$;

-- otorga créditos del plan (resetea gen_plan, suma bonus), con idempotencia por ledger
create or replace function public.wallet_grant_plan_credits(
  p_user_id uuid,
  p_plan_credits integer,
  p_bonus_credits integer default 0,
  p_entry_type text default 'plan_grant',
  p_idempotency_key text default null
) returns table (
  ledger_id uuid,
  gen_plan_credits integer,
  gen_topup_credits integer,
  gen_bonus_credits integer
)
language plpgsql
as $$
declare
  v_bal public.wallet_balances%rowtype;
  v_existing uuid;
begin
  if p_plan_credits < 0 or p_bonus_credits < 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  if p_idempotency_key is not null then
    select id into v_existing
    from public.wallet_ledger
    where user_id = p_user_id and idempotency_key = p_idempotency_key
    limit 1;

    if v_existing is not null then
      select * into v_bal from public.wallet_balances where user_id = p_user_id;
      return query select v_existing, v_bal.gen_plan_credits, v_bal.gen_topup_credits, v_bal.gen_bonus_credits;
      return;
    end if;
  end if;

  select * into v_bal
  from public.wallet_balances
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.wallet_balances(user_id) values (p_user_id);
    select * into v_bal from public.wallet_balances where user_id = p_user_id for update;
  end if;

  v_bal.gen_plan_credits := p_plan_credits;
  v_bal.gen_bonus_credits := v_bal.gen_bonus_credits + p_bonus_credits;

  update public.wallet_balances
    set gen_plan_credits = v_bal.gen_plan_credits,
        gen_bonus_credits = v_bal.gen_bonus_credits
  where user_id = p_user_id;

  insert into public.wallet_ledger(
    user_id,
    entry_type,
    delta_generation_credits,
    delta_earnings_pending_credits,
    delta_earnings_matured_credits,
    referral_code_used,
    related_purchase_id,
    idempotency_key,
    meta
  ) values (
    p_user_id,
    p_entry_type,
    (p_plan_credits + p_bonus_credits),
    0,
    0,
    null,
    null,
    p_idempotency_key,
    jsonb_build_object(
      'plan_credits', p_plan_credits,
      'bonus_credits', p_bonus_credits
    )
  )
  returning id into v_existing;

  return query select v_existing, v_bal.gen_plan_credits, v_bal.gen_topup_credits, v_bal.gen_bonus_credits;
end;
$$;

-- añade topup credits (suma a gen_topup), con idempotencia por purchases y ledger
create or replace function public.wallet_add_topup_credits(
  p_user_id uuid,
  p_product_id uuid,
  p_credits integer,
  p_entry_type text default 'topup_grant',
  p_idempotency_key text default null
) returns table (
  purchase_id uuid,
  ledger_id uuid,
  gen_plan_credits integer,
  gen_topup_credits integer,
  gen_bonus_credits integer
)
language plpgsql
as $$
declare
  v_bal public.wallet_balances%rowtype;
  v_purchase uuid;
  v_ledger uuid;
begin
  if p_credits <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  if p_idempotency_key is not null then
    select id into v_purchase
    from public.credit_topup_purchases
    where user_id = p_user_id and idempotency_key = p_idempotency_key
    limit 1;

    if v_purchase is not null then
      select id into v_ledger from public.wallet_ledger where user_id = p_user_id and idempotency_key = p_idempotency_key limit 1;
      select * into v_bal from public.wallet_balances where user_id = p_user_id;
      return query select v_purchase, v_ledger, v_bal.gen_plan_credits, v_bal.gen_topup_credits, v_bal.gen_bonus_credits;
      return;
    end if;
  end if;

  select * into v_bal
  from public.wallet_balances
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.wallet_balances(user_id) values (p_user_id);
    select * into v_bal from public.wallet_balances where user_id = p_user_id for update;
  end if;

  insert into public.credit_topup_purchases(user_id, product_id, credits, provider, idempotency_key)
  values (p_user_id, p_product_id, p_credits, 'mock', p_idempotency_key)
  returning id into v_purchase;

  v_bal.gen_topup_credits := v_bal.gen_topup_credits + p_credits;

  update public.wallet_balances
    set gen_topup_credits = v_bal.gen_topup_credits
  where user_id = p_user_id;

  insert into public.wallet_ledger(
    user_id,
    entry_type,
    delta_generation_credits,
    delta_earnings_pending_credits,
    delta_earnings_matured_credits,
    referral_code_used,
    related_purchase_id,
    idempotency_key,
    meta
  ) values (
    p_user_id,
    p_entry_type,
    p_credits,
    0,
    0,
    null,
    null,
    p_idempotency_key,
    jsonb_build_object(
      'product_id', p_product_id,
      'credits', p_credits,
      'purchase_id', v_purchase
    )
  )
  returning id into v_ledger;

  return query select v_purchase, v_ledger, v_bal.gen_plan_credits, v_bal.gen_topup_credits, v_bal.gen_bonus_credits;
end;
$$;

-- cancela subscripción y borra TODOS los créditos de generación (plan+topup+bonus).
create or replace function public.billing_cancel_and_wipe_generation_credits(
  p_user_id uuid
) returns void
language plpgsql
as $$
begin
  update public.billing_subscriptions
    set status = 'canceled'
  where user_id = p_user_id and status = 'active';

  update public.wallet_balances
    set gen_plan_credits = 0,
        gen_topup_credits = 0,
        gen_bonus_credits = 0
  where user_id = p_user_id;

  insert into public.wallet_ledger(
    user_id,
    entry_type,
    delta_generation_credits,
    delta_earnings_pending_credits,
    delta_earnings_matured_credits,
    idempotency_key,
    meta
  ) values (
    p_user_id,
    'billing_cancel_wipe',
    0,
    0,
    0,
    null,
    jsonb_build_object('note','Wipe generation buckets (plan/topup/bonus)')
  );
end;
$$;

-- seed planes si no existen
insert into public.billing_plans(slug, name, billing_period, price_cents, plan_credits, bonus_credits, can_sell)
values
  ('basic_week', 'Básico', 'week', 799, 1, 0, false),
  ('standard_month', 'Standard', 'month', 1799, 4000, 0, false),
  ('pro_month', 'Pro', 'month', 2799, 7000, 0, true),
  ('partner_month', 'Partner', 'month', 4799, 12000, 0, true),
  ('business_month', 'Business', 'month', 8799, 25000, 5000, true)
on conflict (slug) do nothing;

-- seed topups si no existen
insert into public.credit_topup_products(name, price_cents, credits)
values
  ('$4.99 / 1,000 créditos', 499, 1000),
  ('$9.99 / 2,200 créditos', 999, 2200),
  ('$19.99 / 4,800 créditos', 1999, 4800),
  ('$34.99 / 9,000 créditos', 3499, 9000),
  ('$49.99 / 13,500 créditos', 4999, 13500)
on conflict do nothing;

commit;