-- infra/supabase/patches/2026-03-04_billing_referrals_plan_purchase.sql
-- Referidos/Afiliados en compra de planes + can_referrals en billing_plans
-- - Buyer recibe bonus de créditos (gen_bonus_credits)
-- - Referrer recibe reward en earnings_pending_credits (matura a earnings_matured_credits)
-- - Snapshot de username del buyer para My Trades

begin;

alter table public.billing_plans
  add column if not exists can_referrals boolean not null default false;

update public.billing_plans
  set can_referrals = true
where slug in ('partner_month', 'business_month');

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
  plan_credits integer,
  bonus_credits integer,
  can_sell boolean,
  can_referrals boolean
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
    p.can_sell,
    p.can_referrals
  from public.billing_subscriptions s
  join public.billing_plans p on p.id = s.plan_id
  where s.user_id = p_user_id
    and s.status = 'active'
    and s.current_period_end > now()
  order by s.current_period_end desc
  limit 1;
$$;

create table if not exists public.billing_referrals (
  id uuid primary key default gen_random_uuid(),

  referral_code_id uuid references public.community_referral_codes(id) on delete set null,
  referral_code_snapshot text,

  referrer_id uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid not null references auth.users(id) on delete cascade,
  referred_username_snapshot text,

  plan_slug_snapshot text,

  buyer_bonus_credits integer not null default 0 check (buyer_bonus_credits >= 0),
  referrer_reward_credits integer not null default 0 check (referrer_reward_credits >= 0),

  created_at timestamptz not null default now(),
  matures_at timestamptz not null,
  is_matured boolean not null default false,

  idempotency_key text unique
);

create index if not exists billing_referrals_referrer_created_idx
  on public.billing_referrals(referrer_id, created_at desc);

create index if not exists billing_referrals_mature_due_idx
  on public.billing_referrals(is_matured, matures_at)
  where is_matured = false;

alter table public.billing_referrals enable row level security;

drop policy if exists "billing_referrals_select_visible" on public.billing_referrals;
create policy "billing_referrals_select_visible" on public.billing_referrals
  for select using (
    auth.uid() = referrer_id
    or auth.uid() = referred_user_id
  );

revoke all on table public.billing_referrals from anon, authenticated;

create or replace function public.billing_apply_referral_on_subscribe(
  p_buyer_id uuid,
  p_referral_code text,
  p_plan_id uuid,
  p_idempotency_key text default null
)
returns table (
  referral_id uuid,
  buyer_bonus_credits integer,
  referrer_reward_credits integer,
  referrer_id uuid
)
language plpgsql
security definer
as $$
declare
  v_code public.community_referral_codes%rowtype;
  v_plan record;
  v_username text;

  v_buyer_bonus integer := 0;
  v_ref_reward integer := 0;

  v_now timestamptz := now();
  v_matures timestamptz := now() + interval '30 days';

  v_existing public.billing_referrals%rowtype;
begin
  if p_idempotency_key is not null and length(trim(p_idempotency_key)) > 0 then
    select * into v_existing
    from public.billing_referrals
    where idempotency_key = p_idempotency_key
    limit 1;

    if v_existing.id is not null then
      referral_id := v_existing.id;
      buyer_bonus_credits := v_existing.buyer_bonus_credits;
      referrer_reward_credits := v_existing.referrer_reward_credits;
      referrer_id := v_existing.referrer_id;
      return next;
      return;
    end if;
  end if;

  select * into v_code
  from public.community_referral_codes
  where code = upper(trim(p_referral_code))
    and is_active = true
  limit 1;

  if v_code.id is null then
    raise exception 'INVALID_REFERRAL_CODE';
  end if;

  if v_code.owner_id = p_buyer_id then
    raise exception 'INVALID_REFERRAL_CODE_SELF';
  end if;

  select slug, plan_credits
    into v_plan
  from public.billing_plans
  where id = p_plan_id;

  if v_plan.slug is null then
    raise exception 'PLAN_NOT_FOUND';
  end if;

  select username into v_username
  from public.profiles
  where id = p_buyer_id;

  if coalesce(v_code.buyer_discount_pct, 0) > 0 then
    v_buyer_bonus := floor((v_plan.plan_credits * v_code.buyer_discount_pct) / 100.0)::int;
    if v_buyer_bonus < 0 then v_buyer_bonus := 0; end if;
  end if;

  if coalesce(v_code.ref_reward_pct, 0) > 0 then
    v_ref_reward := floor((v_plan.plan_credits * v_code.ref_reward_pct) / 100.0)::int;
    if v_ref_reward < 0 then v_ref_reward := 0; end if;
  end if;

  perform public.wallet_ensure_row(p_buyer_id);
  perform public.wallet_ensure_row(v_code.owner_id);

  insert into public.billing_referrals(
    referral_code_id,
    referral_code_snapshot,
    referrer_id,
    referred_user_id,
    referred_username_snapshot,
    plan_slug_snapshot,
    buyer_bonus_credits,
    referrer_reward_credits,
    created_at,
    matures_at,
    is_matured,
    idempotency_key
  )
  values (
    v_code.id,
    v_code.code,
    v_code.owner_id,
    p_buyer_id,
    v_username,
    v_plan.slug,
    v_buyer_bonus,
    v_ref_reward,
    v_now,
    v_matures,
    false,
    p_idempotency_key
  )
  returning id into referral_id;

  if v_buyer_bonus > 0 then
    update public.wallet_balances
      set gen_bonus_credits = gen_bonus_credits + v_buyer_bonus,
          updated_at = now()
    where user_id = p_buyer_id;

    insert into public.wallet_ledger(user_id, entry_type, amount_credits, ref_type, ref_id, idempotency_key)
    values (p_buyer_id, 'referral_buyer_bonus', v_buyer_bonus, 'billing_referral', referral_id, 'subref-buyer:' || coalesce(p_idempotency_key, referral_id::text));
  end if;

  if v_ref_reward > 0 then
    update public.wallet_balances
      set earnings_pending_credits = earnings_pending_credits + v_ref_reward,
          updated_at = now()
    where user_id = v_code.owner_id;

    insert into public.wallet_ledger(user_id, entry_type, amount_credits, ref_type, ref_id, idempotency_key)
    values (v_code.owner_id, 'referral_reward_pending', v_ref_reward, 'billing_referral', referral_id, 'subref-ref:' || coalesce(p_idempotency_key, referral_id::text));
  end if;

  buyer_bonus_credits := v_buyer_bonus;
  referrer_reward_credits := v_ref_reward;
  referrer_id := v_code.owner_id;

  return next;
end;
$$;

revoke all on function public.billing_apply_referral_on_subscribe(uuid, text, uuid, text) from anon, authenticated;

create or replace function public.billing_mature_due_referrals()
returns table (
  matured_count integer
)
language plpgsql
security definer
as $$
declare
  v_count integer := 0;
begin
  with due as (
    select id, referrer_id, referrer_reward_credits
    from public.billing_referrals
    where is_matured = false
      and matures_at <= now()
      and referrer_reward_credits > 0
    for update
  ),
  upd as (
    update public.billing_referrals
      set is_matured = true
    where id in (select id from due)
    returning id, referrer_id, referrer_reward_credits
  ),
  agg as (
    select referrer_id, sum(referrer_reward_credits)::int as total
    from upd
    group by referrer_id
  )
  update public.wallet_balances wb
    set earnings_pending_credits = greatest(0, wb.earnings_pending_credits - agg.total),
        earnings_matured_credits = wb.earnings_matured_credits + agg.total,
        updated_at = now()
  from agg
  where wb.user_id = agg.referrer_id;

  insert into public.wallet_ledger(user_id, entry_type, amount_credits, ref_type, ref_id)
  select referrer_id, 'referral_reward_matured', referrer_reward_credits, 'billing_referral', id
  from upd;

  select count(*) into v_count from upd;

  matured_count := v_count;
  return next;
end;
$$;

revoke all on function public.billing_mature_due_referrals() from anon, authenticated;

commit;