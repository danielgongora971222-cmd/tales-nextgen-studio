-- infra/supabase/patches/2026-03-05_billing_referral_apply_no_bonus.sql
-- Ajuste: el código de referido aplica descuento en precio (UI/pagos),
-- pero NO regala créditos extra al comprador.

begin;

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

  -- buyer_discount_pct se usa como % de descuento en el precio del plan (capa de pago/UI).
  -- Aquí NO regalamos créditos extra al comprador (v_buyer_bonus = 0) para no romper la economía.
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

commit;