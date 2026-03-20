begin;

-- ========================================
-- Stripe customers + webhook audit
-- ========================================
create table if not exists public.billing_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  object_id text,
  livemode boolean not null default false,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text
);

create index if not exists stripe_webhook_events_received_at_idx
  on public.stripe_webhook_events(received_at desc);

create index if not exists stripe_webhook_events_processed_at_idx
  on public.stripe_webhook_events(processed_at);

alter table public.billing_customers enable row level security;
alter table public.stripe_webhook_events enable row level security;

revoke all on table public.billing_customers from anon, authenticated;
revoke all on table public.stripe_webhook_events from anon, authenticated;

drop trigger if exists trg_billing_customers_updated_at on public.billing_customers;
create trigger trg_billing_customers_updated_at
before update on public.billing_customers
for each row execute function public.set_updated_at();

-- ========================================
-- billing_subscriptions hardening for Stripe
-- ========================================
alter table public.billing_subscriptions
  add column if not exists stripe_customer_id text,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists canceled_at timestamptz,
  add column if not exists ended_at timestamptz;

create unique index if not exists billing_subscriptions_stripe_subscription_id_uq
  on public.billing_subscriptions(stripe_subscription_id)
  where stripe_subscription_id is not null;

create index if not exists billing_subscriptions_stripe_customer_id_idx
  on public.billing_subscriptions(stripe_customer_id)
  where stripe_customer_id is not null;

-- ========================================
-- Topups fulfilled from Stripe Checkout
-- ========================================
alter table public.credit_topup_purchases
  add column if not exists stripe_checkout_session_id text;

create unique index if not exists credit_topup_purchases_stripe_checkout_session_id_uq
  on public.credit_topup_purchases(stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create index if not exists credit_topup_purchases_stripe_payment_intent_id_idx
  on public.credit_topup_purchases(stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- Asegura que el valor canónico de créditos siga alineado con el catálogo visible.
update public.credit_topup_products
set
  credits_amount = credits,
  updated_at = now()
where credits is not null
  and credits_amount is distinct from credits;

-- ========================================
-- RPC: get_active_subscription (Stripe-aware)
-- ========================================
drop function if exists public.get_active_subscription(uuid);

create or replace function public.get_active_subscription(p_user_id uuid)
returns table (
  subscription_id uuid,
  status text,
  provider text,
  stripe_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  plan_id uuid,
  plan_slug text,
  plan_name text,
  billing_period text,
  price_cents integer,
  plan_credits integer,
  bonus_credits integer,
  can_sell boolean,
  can_referrals boolean,
  max_concurrency integer
) language sql stable as $$
  select
    s.id as subscription_id,
    s.status,
    s.provider,
    s.stripe_subscription_id,
    s.current_period_start,
    s.current_period_end,
    coalesce(s.cancel_at_period_end, false) as cancel_at_period_end,
    p.id as plan_id,
    p.slug as plan_slug,
    p.name as plan_name,
    p.billing_period,
    p.price_cents,
    p.plan_credits,
    p.bonus_credits,
    p.can_sell,
    p.can_referrals,
    p.max_concurrency
  from public.billing_subscriptions s
  join public.billing_plans p on p.id = s.plan_id
  where s.user_id = p_user_id
    and s.status = 'active'
    and s.current_period_end > now()
  order by s.current_period_end desc, s.updated_at desc
  limit 1;
$$;

-- ========================================
-- RPC: topups fulfilled from Stripe
-- ========================================
create or replace function public.wallet_add_topup_credits_from_stripe(
  p_user_id uuid,
  p_product_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text default null,
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
  v_existing_purchase public.credit_topup_purchases%rowtype;
  v_existing_ledger uuid;
  v_purchase_id uuid;
  v_ledger_id uuid;
  v_added integer := 0;
  v_bal public.wallet_balances%rowtype;
begin
  if p_checkout_session_id is null or length(trim(p_checkout_session_id)) = 0 then
    raise exception 'CHECKOUT_SESSION_REQUIRED';
  end if;

  if p_idempotency_key is not null and length(trim(p_idempotency_key)) > 0 then
    select id into v_existing_ledger
    from public.wallet_ledger
    where user_id = p_user_id
      and idempotency_key = p_idempotency_key
    limit 1;

    if v_existing_ledger is not null then
      select * into v_bal
      from public.wallet_balances
      where user_id = p_user_id;

      select * into v_existing_purchase
      from public.credit_topup_purchases
      where user_id = p_user_id
        and idempotency_key = p_idempotency_key
      limit 1;

      return query
      select
        v_existing_purchase.id,
        v_existing_ledger,
        coalesce(v_existing_purchase.credits_amount, 0),
        coalesce(v_bal.gen_plan_credits, 0),
        coalesce(v_bal.gen_topup_credits, 0),
        coalesce(v_bal.gen_bonus_credits, 0);
      return;
    end if;
  end if;

  select * into v_existing_purchase
  from public.credit_topup_purchases
  where stripe_checkout_session_id = p_checkout_session_id
  limit 1;

  if v_existing_purchase.id is not null then
    select * into v_bal
    from public.wallet_balances
    where user_id = p_user_id;

    select id into v_existing_ledger
    from public.wallet_ledger
    where user_id = p_user_id
      and idempotency_key = p_idempotency_key
    limit 1;

    return query
    select
      v_existing_purchase.id,
      v_existing_ledger,
      coalesce(v_existing_purchase.credits_amount, 0),
      coalesce(v_bal.gen_plan_credits, 0),
      coalesce(v_bal.gen_topup_credits, 0),
      coalesce(v_bal.gen_bonus_credits, 0);
    return;
  end if;

  select credits_amount into v_added
  from public.credit_topup_products
  where id = p_product_id
  limit 1;

  if v_added is null or v_added <= 0 then
    raise exception 'TOPUP_PRODUCT_NOT_FOUND';
  end if;

  perform public.wallet_ensure_row(p_user_id);

  select * into v_bal
  from public.wallet_balances
  where user_id = p_user_id
  for update;

  update public.wallet_balances
    set gen_topup_credits = coalesce(gen_topup_credits, 0) + v_added,
        updated_at = now()
  where user_id = p_user_id
  returning * into v_bal;

  insert into public.credit_topup_purchases(
    user_id,
    product_id,
    credits,
    credits_amount,
    provider,
    idempotency_key,
    stripe_payment_intent_id,
    stripe_checkout_session_id
  )
  values (
    p_user_id,
    p_product_id,
    v_added,
    v_added,
    'stripe',
    p_idempotency_key,
    p_payment_intent_id,
    p_checkout_session_id
  )
  returning id into v_purchase_id;

  insert into public.wallet_ledger(
    user_id,
    entry_type,
    amount_credits,
    ref_type,
    ref_id,
    idempotency_key,
    meta
  )
  values (
    p_user_id,
    'topup_purchase',
    v_added,
    'credit_topup_product',
    p_product_id,
    p_idempotency_key,
    jsonb_build_object(
      'provider', 'stripe',
      'checkout_session_id', p_checkout_session_id,
      'payment_intent_id', p_payment_intent_id
    )
  )
  returning id into v_ledger_id;

  return query
  select
    v_purchase_id,
    v_ledger_id,
    v_added,
    coalesce(v_bal.gen_plan_credits, 0),
    coalesce(v_bal.gen_topup_credits, 0),
    coalesce(v_bal.gen_bonus_credits, 0);
end;
$$;

revoke all on function public.wallet_add_topup_credits_from_stripe(uuid, uuid, text, text, text) from PUBLIC, anon, authenticated;
grant execute on function public.wallet_add_topup_credits_from_stripe(uuid, uuid, text, text, text) to service_role;

commit;
