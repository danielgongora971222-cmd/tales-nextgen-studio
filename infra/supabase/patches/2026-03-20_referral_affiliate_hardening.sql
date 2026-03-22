-- infra/supabase/patches/2026-03-20_referral_affiliate_hardening.sql
-- Referral / affiliate hardening for plan purchases:
-- - buyer gets checkout discount only (no bonus credits)
-- - partner reward is tracked with immutable snapshots
-- - reward can only be granted once at a time per referred buyer
-- - reward can be reversed on refund / dispute using the originating Stripe invoice
-- - matured/pending/reversed state is explicit for safer UI and reporting

begin;

alter table public.billing_referrals
  add column if not exists buyer_discount_pct_snapshot integer not null default 0,
  add column if not exists ref_reward_pct_snapshot integer not null default 0,
  add column if not exists status text not null default 'pending',
  add column if not exists reversed_at timestamptz,
  add column if not exists reverse_reason text,
  add column if not exists reversed_event_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_invoice_id text,
  add column if not exists stripe_customer_id text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.billing_referrals
  drop constraint if exists billing_referrals_status_check;

alter table public.billing_referrals
  add constraint billing_referrals_status_check
  check (status in ('pending', 'matured', 'reversed'));

alter table public.billing_referrals
  drop constraint if exists billing_referrals_buyer_discount_pct_snapshot_check;

alter table public.billing_referrals
  add constraint billing_referrals_buyer_discount_pct_snapshot_check
  check (buyer_discount_pct_snapshot >= 0 and buyer_discount_pct_snapshot <= 100);

alter table public.billing_referrals
  drop constraint if exists billing_referrals_ref_reward_pct_snapshot_check;

alter table public.billing_referrals
  add constraint billing_referrals_ref_reward_pct_snapshot_check
  check (ref_reward_pct_snapshot >= 0 and ref_reward_pct_snapshot <= 100);

create index if not exists billing_referrals_status_created_idx
  on public.billing_referrals(status, created_at desc);

create index if not exists billing_referrals_invoice_idx
  on public.billing_referrals(stripe_invoice_id)
  where stripe_invoice_id is not null and length(trim(stripe_invoice_id)) > 0;

create index if not exists billing_referrals_referred_active_idx
  on public.billing_referrals(referred_user_id, created_at desc)
  where status in ('pending', 'matured');

update public.billing_referrals br
set
  buyer_discount_pct_snapshot = coalesce(cr.buyer_discount_pct, br.buyer_discount_pct_snapshot, 0),
  ref_reward_pct_snapshot = coalesce(cr.ref_reward_pct, br.ref_reward_pct_snapshot, 0),
  status = case
    when br.reversed_at is not null then 'reversed'
    when coalesce(br.is_matured, false) = true then 'matured'
    else 'pending'
  end
from public.community_referral_codes cr
where br.referral_code_id = cr.id;

update public.billing_referrals
set status = case
  when reversed_at is not null then 'reversed'
  when coalesce(is_matured, false) = true then 'matured'
  else 'pending'
end
where status is null
   or status not in ('pending', 'matured', 'reversed');

drop function if exists public.billing_apply_referral_on_subscribe(uuid, text, uuid, text);
drop function if exists public.billing_apply_referral_on_subscribe(uuid, text, uuid, text, text, text, text);

create or replace function public.billing_apply_referral_on_subscribe(
  p_buyer_id uuid,
  p_referral_code text,
  p_plan_id uuid,
  p_idempotency_key text default null,
  p_stripe_subscription_id text default null,
  p_stripe_invoice_id text default null,
  p_stripe_customer_id text default null
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
  v_existing_active public.billing_referrals%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('billing_referral:' || coalesce(p_buyer_id::text, '')));

  if p_idempotency_key is not null and length(trim(p_idempotency_key)) > 0 then
    select * into v_existing
    from public.billing_referrals
    where idempotency_key = p_idempotency_key
    limit 1;

    if v_existing.id is not null then
      update public.billing_referrals
      set
        stripe_subscription_id = coalesce(nullif(trim(stripe_subscription_id), ''), nullif(trim(p_stripe_subscription_id), '')),
        stripe_invoice_id = coalesce(nullif(trim(stripe_invoice_id), ''), nullif(trim(p_stripe_invoice_id), '')),
        stripe_customer_id = coalesce(nullif(trim(stripe_customer_id), ''), nullif(trim(p_stripe_customer_id), '')),
        updated_at = now()
      where id = v_existing.id;

      select * into v_existing
      from public.billing_referrals
      where id = v_existing.id;

      referral_id := v_existing.id;
      buyer_bonus_credits := v_existing.buyer_bonus_credits;
      referrer_reward_credits := v_existing.referrer_reward_credits;
      referrer_id := v_existing.referrer_id;
      return next;
      return;
    end if;
  end if;

  select * into v_existing_active
  from public.billing_referrals
  where referred_user_id = p_buyer_id
    and status in ('pending', 'matured')
  order by created_at desc
  limit 1
  for update;

  if v_existing_active.id is not null then
    raise exception 'REFERRAL_ALREADY_GRANTED';
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

  -- El descuento del comprador vive en Checkout / precio final.
  -- No regalamos créditos extra al comprador para no romper la economía.
  v_buyer_bonus := 0;

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
    buyer_discount_pct_snapshot,
    ref_reward_pct_snapshot,
    status,
    stripe_subscription_id,
    stripe_invoice_id,
    stripe_customer_id,
    created_at,
    matures_at,
    is_matured,
    idempotency_key,
    updated_at
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
    greatest(0, least(100, coalesce(v_code.buyer_discount_pct, 0))),
    greatest(0, least(100, coalesce(v_code.ref_reward_pct, 0))),
    'pending',
    nullif(trim(p_stripe_subscription_id), ''),
    nullif(trim(p_stripe_invoice_id), ''),
    nullif(trim(p_stripe_customer_id), ''),
    v_now,
    v_matures,
    false,
    p_idempotency_key,
    now()
  )
  returning id into referral_id;

  if v_ref_reward > 0 then
    update public.wallet_balances
      set earnings_pending_credits = earnings_pending_credits + v_ref_reward,
          updated_at = now()
    where user_id = v_code.owner_id;

    insert into public.wallet_ledger(user_id, entry_type, amount_credits, ref_type, ref_id, idempotency_key, meta)
    values (
      v_code.owner_id,
      'referral_reward_pending',
      v_ref_reward,
      'billing_referral',
      referral_id,
      'subref-ref:' || coalesce(p_idempotency_key, referral_id::text),
      jsonb_build_object(
        'buyer_discount_pct', greatest(0, least(100, coalesce(v_code.buyer_discount_pct, 0))),
        'ref_reward_pct', greatest(0, least(100, coalesce(v_code.ref_reward_pct, 0))),
        'source', 'plan_subscription'
      )
    );
  end if;

  buyer_bonus_credits := v_buyer_bonus;
  referrer_reward_credits := v_ref_reward;
  referrer_id := v_code.owner_id;

  return next;
end;
$$;

revoke all on function public.billing_apply_referral_on_subscribe(uuid, text, uuid, text, text, text, text) from anon, authenticated;

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
    where status = 'pending'
      and matures_at <= now()
      and referrer_reward_credits > 0
    for update
  ),
  upd as (
    update public.billing_referrals
      set is_matured = true,
          status = 'matured',
          updated_at = now()
    where id in (select id from due)
    returning id, referrer_id, referrer_reward_credits
  ),
  agg as (
    select referrer_id, sum(referrer_reward_credits)::int as total
    from upd
    group by referrer_id
  ),
  wallet_upd as (
    update public.wallet_balances wb
      set earnings_pending_credits = greatest(0, wb.earnings_pending_credits - agg.total),
          earnings_matured_credits = wb.earnings_matured_credits + agg.total,
          updated_at = now()
    from agg
    where wb.user_id = agg.referrer_id
    returning wb.user_id
  ),
  ledger_ins as (
    insert into public.wallet_ledger(user_id, entry_type, amount_credits, ref_type, ref_id, meta)
    select referrer_id, 'referral_reward_matured', referrer_reward_credits, 'billing_referral', id, jsonb_build_object('source', 'billing_referral')
    from upd
    returning id
  )
  select count(*) into v_count from upd;

  matured_count := v_count;
  return next;
end;
$$;

revoke all on function public.billing_mature_due_referrals() from anon, authenticated;

drop function if exists public.billing_reverse_referral_reward(text, text, text, text);

create or replace function public.billing_reverse_referral_reward(
  p_stripe_invoice_id text,
  p_reason text default null,
  p_event_id text default null,
  p_idempotency_key text default null
)
returns table (
  referral_id uuid,
  status text,
  was_matured boolean,
  referrer_id uuid,
  reversed_credits integer,
  unrecovered_credits integer
)
language plpgsql
security definer
as $$
declare
  v_ref public.billing_referrals%rowtype;
  v_bal public.wallet_balances%rowtype;
  v_effective_status text;
  v_requested integer := 0;
  v_applied integer := 0;
  v_unrecovered integer := 0;
begin
  if p_stripe_invoice_id is null or length(trim(p_stripe_invoice_id)) = 0 then
    return;
  end if;

  select * into v_ref
  from public.billing_referrals
  where stripe_invoice_id = trim(p_stripe_invoice_id)
  order by created_at desc
  limit 1
  for update;

  if v_ref.id is null then
    return;
  end if;

  v_effective_status := case
    when v_ref.status in ('pending', 'matured', 'reversed') then v_ref.status
    when coalesce(v_ref.is_matured, false) = true then 'matured'
    else 'pending'
  end;

  if v_effective_status = 'reversed' then
    referral_id := v_ref.id;
    status := 'reversed';
    was_matured := coalesce(v_ref.is_matured, false);
    referrer_id := v_ref.referrer_id;
    reversed_credits := 0;
    unrecovered_credits := 0;
    return next;
    return;
  end if;

  v_requested := greatest(0, coalesce(v_ref.referrer_reward_credits, 0));
  perform public.wallet_ensure_row(v_ref.referrer_id);

  select * into v_bal
  from public.wallet_balances
  where user_id = v_ref.referrer_id
  for update;

  if v_effective_status = 'matured' then
    v_applied := least(coalesce(v_bal.earnings_matured_credits, 0), v_requested);
  else
    v_applied := least(coalesce(v_bal.earnings_pending_credits, 0), v_requested);
  end if;

  v_unrecovered := greatest(0, v_requested - v_applied);

  update public.wallet_balances
    set earnings_pending_credits = case
          when v_effective_status = 'pending' then greatest(0, earnings_pending_credits - v_applied)
          else earnings_pending_credits
        end,
        earnings_matured_credits = case
          when v_effective_status = 'matured' then greatest(0, earnings_matured_credits - v_applied)
          else earnings_matured_credits
        end,
        updated_at = now()
  where user_id = v_ref.referrer_id;

  if v_applied > 0 then
    insert into public.wallet_ledger(user_id, entry_type, amount_credits, ref_type, ref_id, idempotency_key, meta)
    values (
      v_ref.referrer_id,
      'referral_reward_reversed',
      -v_applied,
      'billing_referral',
      v_ref.id,
      coalesce(nullif(trim(p_idempotency_key), ''), 'referral-reverse:' || v_ref.id::text || ':' || coalesce(trim(p_event_id), 'manual')),
      jsonb_build_object(
        'reason', coalesce(nullif(trim(p_reason), ''), 'reversed'),
        'event_id', nullif(trim(p_event_id), ''),
        'requested_credits', v_requested,
        'applied_credits', v_applied,
        'unrecovered_credits', v_unrecovered,
        'bucket', v_effective_status
      )
    );
  end if;

  update public.billing_referrals
    set status = 'reversed',
        reversed_at = now(),
        reverse_reason = coalesce(nullif(trim(p_reason), ''), 'reversed'),
        reversed_event_id = coalesce(nullif(trim(p_event_id), ''), reversed_event_id),
        updated_at = now()
  where id = v_ref.id;

  referral_id := v_ref.id;
  status := 'reversed';
  was_matured := (v_effective_status = 'matured');
  referrer_id := v_ref.referrer_id;
  reversed_credits := v_applied;
  unrecovered_credits := v_unrecovered;
  return next;
end;
$$;

revoke all on function public.billing_reverse_referral_reward(text, text, text, text) from anon, authenticated;

commit;
