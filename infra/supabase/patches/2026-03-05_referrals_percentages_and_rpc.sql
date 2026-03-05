-- infra/supabase/patches/2026-03-05_referrals_percentages_and_rpc.sql
-- Ajustes:
-- 1) Referral codes con % 15/5, 5/15, 10/10 (A/B/C) + constraints
-- 2) get_active_subscription() alineado con backend/UI (incluye can_referrals + max_concurrency + billing_period)

begin;

-- =========================
-- 1) community_referral_codes: permitir 5/10/15 y normalizar A/B/C
-- =========================

alter table public.community_referral_codes
  drop constraint if exists community_referral_codes_buyer_discount_pct_check,
  drop constraint if exists community_referral_codes_ref_reward_pct_check;

alter table public.community_referral_codes
  add constraint community_referral_codes_buyer_discount_pct_check
    check (buyer_discount_pct in (0,5,10,15,20)),
  add constraint community_referral_codes_ref_reward_pct_check
    check (ref_reward_pct in (0,5,10,15,20));

update public.community_referral_codes
  set buyer_discount_pct = case
        when variant = 'A' then 15
        when variant = 'B' then 5
        when variant = 'C' then 10
        else buyer_discount_pct
      end,
      ref_reward_pct = case
        when variant = 'A' then 5
        when variant = 'B' then 15
        when variant = 'C' then 10
        else ref_reward_pct
      end
where variant in ('A','B','C');

-- =========================
-- 2) billing_plans: can_referrals (safe) + backfill
-- =========================
alter table public.billing_plans
  add column if not exists can_referrals boolean not null default false;

update public.billing_plans
  set can_referrals = true
where slug in ('partner_month', 'business_month');

-- =========================
-- 3) RPC: get_active_subscription (alineado a backend)
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
    s.current_period_start,
    s.current_period_end,
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
  order by s.current_period_end desc
  limit 1;
$$;

commit;