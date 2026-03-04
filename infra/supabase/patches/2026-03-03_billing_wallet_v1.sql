-- infra/supabase/patches/2026-03-03_billing_wallet_v1.sql
-- Billing + Wallet v1 (alineado con backend actual)
-- Objetivo: que DB ↔ API ↔ UI coincidan y deje de fallar por columnas/RPCs.

begin;

-- =========================
-- Helpers
-- =========================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- =========================
-- billing_plans: completar contrato
-- =========================
alter table public.billing_plans
  add column if not exists is_active boolean not null default true,
  add column if not exists max_concurrency integer not null default 2 check (max_concurrency >= 1),
  add column if not exists currency text not null default 'usd',
  add column if not exists stripe_price_id text,
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_billing_plans_updated_at on public.billing_plans;
create trigger trg_billing_plans_updated_at
before update on public.billing_plans
for each row execute function public.set_updated_at();

-- =========================
-- billing_subscriptions: futuro Stripe sin romper mock
-- =========================
alter table public.billing_subscriptions
  add column if not exists stripe_subscription_id text;

-- =========================
-- credit_topup_products: usar credits_amount + sku
-- =========================
alter table public.credit_topup_products
  add column if not exists sku text,
  add column if not exists credits_amount integer,
  add column if not exists currency text not null default 'usd',
  add column if not exists stripe_price_id text,
  add column if not exists updated_at timestamptz not null default now();

-- Backfill: si venías usando "credits", migramos a credits_amount
update public.credit_topup_products
  set credits_amount = credits
where credits_amount is null;

-- Garantizar que credits_amount sea válido
alter table public.credit_topup_products
  alter column credits_amount set not null;

alter table public.credit_topup_products
  add constraint credit_topup_products_credits_amount_chk
  check (credits_amount > 0);

-- sku recomendado (no obligatorio). Si se repite, lo dejas null y lo manejas después.
create unique index if not exists credit_topup_products_sku_uq
  on public.credit_topup_products(sku)
  where sku is not null;

drop trigger if exists trg_credit_topup_products_updated_at on public.credit_topup_products;
create trigger trg_credit_topup_products_updated_at
before update on public.credit_topup_products
for each row execute function public.set_updated_at();

-- =========================
-- credit_topup_purchases: compatibilidad + campo futuro
-- =========================
alter table public.credit_topup_purchases
  add column if not exists credits_amount integer,
  add column if not exists stripe_payment_intent_id text;

update public.credit_topup_purchases
  set credits_amount = credits
where credits_amount is null;

-- =========================
-- legal_acceptances (obligatoria por requisito)
-- =========================
create table if not exists public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  autopay_version text not null,
  accepted_at timestamptz not null default now(),
  ip text,
  user_agent text
);

create index if not exists legal_acceptances_user_id_idx
  on public.legal_acceptances(user_id);

create unique index if not exists legal_acceptances_user_versions_uq
  on public.legal_acceptances(user_id, terms_version, privacy_version, autopay_version);

alter table public.legal_acceptances enable row level security;

drop policy if exists "legal_acceptances_select_own" on public.legal_acceptances;
create policy "legal_acceptances_select_own" on public.legal_acceptances
  for select using (auth.uid() = user_id);

drop policy if exists "legal_acceptances_insert_own" on public.legal_acceptances;
create policy "legal_acceptances_insert_own" on public.legal_acceptances
  for insert with check (auth.uid() = user_id);

-- =========================
-- RPC: get_active_subscription (alineado a backend)
-- =========================
drop function if exists public.get_active_subscription(uuid);

create or replace function public.get_active_subscription(p_user_id uuid)
returns table (
  subscription_id uuid,
  status text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  plan_id uuid,
  plan_slug text,
  plan_name text,
  billing_period text,
  can_sell boolean,
  max_concurrency integer
) language sql stable as $$
  select
    s.id as subscription_id,
    s.status,
    s.current_period_start,
    s.current_period_end,
    p.id as plan_id,
    p.slug as plan_slug,
    p.name as plan_name,
    p.billing_period,
    p.can_sell,
    p.max_concurrency
  from public.billing_subscriptions s
  join public.billing_plans p on p.id = s.plan_id
  where
    s.user_id = p_user_id
    and s.status = 'active'
  order by s.created_at desc
  limit 1;
$$;

-- =========================
-- RPC: wallet_grant_plan_credits (backend signature)
-- Resetea bucket plan y suma bonus (si hay) desde billing_plans
-- =========================
create or replace function public.wallet_grant_plan_credits(
  p_user_id uuid,
  p_plan_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
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
  v_existing uuid;
  v_plan_credits integer;
  v_bonus_credits integer;
  v_bal public.wallet_balances%rowtype;
begin
  -- idempotencia por ledger
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

  -- validar que exista subscripción activa y que el plan coincida
  if not exists (
    select 1 from public.billing_subscriptions
    where user_id = p_user_id and status = 'active' and plan_id = p_plan_id
  ) then
    raise exception 'NO_ACTIVE_SUBSCRIPTION';
  end if;

  select plan_credits, bonus_credits
    into v_plan_credits, v_bonus_credits
  from public.billing_plans
  where id = p_plan_id;

  if v_plan_credits is null then
    raise exception 'PLAN_NOT_FOUND';
  end if;

  -- lock wallet row
  select * into v_bal
  from public.wallet_balances
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.wallet_balances(user_id) values (p_user_id);
    select * into v_bal from public.wallet_balances where user_id = p_user_id for update;
  end if;

  -- reset del bucket plan y suma bonus
  update public.wallet_balances as wb
    set gen_plan_credits = v_plan_credits,
        gen_bonus_credits = wb.gen_bonus_credits + coalesce(v_bonus_credits, 0),
        updated_at = now()
  where wb.user_id = p_user_id;

  insert into public.wallet_ledger(user_id, entry_type, amount_credits, ref_type, ref_id, idempotency_key)
  values (p_user_id, 'plan_grant', 0, 'plan', p_plan_id, p_idempotency_key)
  returning id into v_existing;

  select * into v_bal from public.wallet_balances where user_id = p_user_id;

  return query select v_existing, v_bal.gen_plan_credits, v_bal.gen_topup_credits, v_bal.gen_bonus_credits;
end;
$$;

-- =========================
-- RPC: wallet_add_topup_credits (backend signature)
-- Lee credits_amount desde credit_topup_products. Requiere plan activo.
-- =========================
create or replace function public.wallet_add_topup_credits(
  p_user_id uuid,
  p_product_id uuid,
  p_idempotency_key text default null
) returns table (
  purchase_id uuid,
  ledger_id uuid,
  credits_added integer,
  gen_plan_credits integer,
  gen_topup_credits integer,
  gen_bonus_credits integer
)
language plpgsql
as $$
declare
  v_purchase uuid;
  v_ledger uuid;
  v_existing uuid;
  v_added integer;
  v_bal public.wallet_balances%rowtype;
begin
  -- Requiere subscripción activa
  if not exists (
    select 1 from public.billing_subscriptions
    where user_id = p_user_id and status = 'active'
  ) then
    raise exception 'TOPUP_REQUIRES_ACTIVE_PLAN';
  end if;

  -- Idempotencia: si ya existe compra con idem, devolvemos estado actual
  if p_idempotency_key is not null then
    select id into v_existing
    from public.credit_topup_purchases
    where user_id = p_user_id and idempotency_key = p_idempotency_key
    limit 1;

    if v_existing is not null then
      select * into v_bal from public.wallet_balances where user_id = p_user_id;
      return query select v_existing, null::uuid, 0, v_bal.gen_plan_credits, v_bal.gen_topup_credits, v_bal.gen_bonus_credits;
      return;
    end if;
  end if;

  select credits_amount into v_added
  from public.credit_topup_products
  where id = p_product_id and is_active = true;

  if v_added is null then
    raise exception 'TOPUP_PRODUCT_NOT_FOUND';
  end if;

  -- lock wallet
  select * into v_bal
  from public.wallet_balances
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.wallet_balances(user_id) values (p_user_id);
    select * into v_bal from public.wallet_balances where user_id = p_user_id for update;
  end if;

  insert into public.credit_topup_purchases(user_id, product_id, credits, credits_amount, provider, idempotency_key)
  values (p_user_id, p_product_id, v_added, v_added, 'mock', p_idempotency_key)
  returning id into v_purchase;

  update public.wallet_balances as wb
    set gen_topup_credits = wb.gen_topup_credits + v_added,
        updated_at = now()
  where wb.user_id = p_user_id;

  insert into public.wallet_ledger(user_id, entry_type, amount_credits, ref_type, ref_id, idempotency_key)
  values (p_user_id, 'topup_grant', v_added, 'topup', v_purchase, p_idempotency_key)
  returning id into v_ledger;

  select * into v_bal from public.wallet_balances where user_id = p_user_id;

  return query select v_purchase, v_ledger, v_added, v_bal.gen_plan_credits, v_bal.gen_topup_credits, v_bal.gen_bonus_credits;
end;
$$;

-- =========================
-- RPC: billing_cancel_and_wipe_generation_credits (backend signature + retorno)
-- =========================
create or replace function public.billing_cancel_and_wipe_generation_credits(
  p_user_id uuid,
  p_idempotency_key text default null
) returns table (
  wiped_plan integer,
  wiped_topup integer,
  wiped_bonus integer
)
language plpgsql
as $$
declare
  v_existing uuid;
  v_bal public.wallet_balances%rowtype;
begin
  if not exists (select 1 from public.billing_subscriptions where user_id = p_user_id and status = 'active') then
    raise exception 'NO_ACTIVE_SUBSCRIPTION';
  end if;

  if p_idempotency_key is not null then
    select id into v_existing
    from public.wallet_ledger
    where user_id = p_user_id and idempotency_key = p_idempotency_key
    limit 1;

    if v_existing is not null then
      select * into v_bal from public.wallet_balances where user_id = p_user_id;
      return query select v_bal.gen_plan_credits, v_bal.gen_topup_credits, v_bal.gen_bonus_credits;
      return;
    end if;
  end if;

  -- lock wallet
  select * into v_bal
  from public.wallet_balances
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.wallet_balances(user_id) values (p_user_id);
    select * into v_bal from public.wallet_balances where user_id = p_user_id for update;
  end if;

  -- cancelar subscripción
  update public.billing_subscriptions
    set status = 'canceled',
        updated_at = now()
  where user_id = p_user_id and status = 'active';

  -- wipe
  update public.wallet_balances
    set gen_plan_credits = 0,
        gen_topup_credits = 0,
        gen_bonus_credits = 0,
        updated_at = now()
  where user_id = p_user_id;

  insert into public.wallet_ledger(user_id, entry_type, amount_credits, ref_type, ref_id, idempotency_key)
  values (p_user_id, 'cancel_wipe', 0, null, null, p_idempotency_key);

  return query select v_bal.gen_plan_credits, v_bal.gen_topup_credits, v_bal.gen_bonus_credits;
end;
$$;

commit;
