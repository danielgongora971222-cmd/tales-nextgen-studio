-- infra/supabase/patches/2026-03-03_community_purchase_spend_buckets.sql
-- Ajusta la compra del marketplace para gastar de gen_plan/gen_topup/gen_bonus
begin;

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
as $$
declare
  v_listing record;
  v_buyer_wallet record;
  v_seller_wallet record;
  v_existing_purchase uuid;

  v_price integer;
  v_paid integer;

  v_ref_type text := null;
  v_ref_user uuid := null;
  v_discount integer := 0;
  v_reward integer := 0;

  v_plan_spend integer := 0;
  v_topup_spend integer := 0;
  v_bonus_spend integer := 0;
  v_remaining integer;

  v_purchase_id uuid;
begin
  if p_idempotency_key is not null then
    select id into v_existing_purchase
    from public.community_purchases
    where buyer_id = p_buyer_id and idempotency_key = p_idempotency_key
    limit 1;

    if v_existing_purchase is not null then
      select v_existing_purchase as purchase_id, 0 as paid_credits;
      return;
    end if;
  end if;

  select *
  into v_listing
  from public.community_listings
  where id = p_listing_id
  for update;

  if not found then
    raise exception 'LISTING_NOT_FOUND';
  end if;

  if v_listing.is_active is distinct from true then
    raise exception 'LISTING_INACTIVE';
  end if;

  if v_listing.seller_id = p_buyer_id then
    raise exception 'CANNOT_BUY_OWN_LISTING';
  end if;

  -- lock buyer wallet
  select *
  into v_buyer_wallet
  from public.wallet_balances
  where user_id = p_buyer_id
  for update;

  if not found then
    insert into public.wallet_balances(user_id) values (p_buyer_id);
    select * into v_buyer_wallet from public.wallet_balances where user_id = p_buyer_id for update;
  end if;

  -- lock seller wallet
  select *
  into v_seller_wallet
  from public.wallet_balances
  where user_id = v_listing.seller_id
  for update;

  if not found then
    insert into public.wallet_balances(user_id) values (v_listing.seller_id);
    select * into v_seller_wallet from public.wallet_balances where user_id = v_listing.seller_id for update;
  end if;

  -- verify not already owned
  if exists (
    select 1 from public.community_purchases
    where listing_id = p_listing_id and buyer_id = p_buyer_id
  ) then
    raise exception 'ALREADY_OWNED';
  end if;

  v_price := v_listing.price_credits;
  v_paid := v_price;

  -- referral rules (reusa la lógica existente del patch original)
  if p_referral_code is not null then
    select referral_type, referrer_user_id
    into v_ref_type, v_ref_user
    from public.referral_codes
    where code = p_referral_code;

    -- A: buyer discount 10%
    if v_ref_type = 'A' then
      v_discount := floor(v_price * 0.10);
      v_reward := 0;
    end if;

    -- B: buyer discount 5%, referrer reward 5%
    if v_ref_type = 'B' then
      v_discount := floor(v_price * 0.05);
      v_reward := floor(v_price * 0.05);
    end if;

    -- C: no discount, referrer reward 10%
    if v_ref_type = 'C' then
      v_discount := 0;
      v_reward := floor(v_price * 0.10);
    end if;

    if v_discount > 0 then
      v_paid := greatest(0, v_paid - v_discount);
    end if;
  end if;

  -- check credits: gen_plan + gen_topup + gen_bonus
  if (v_buyer_wallet.gen_plan_credits + v_buyer_wallet.gen_topup_credits + v_buyer_wallet.gen_bonus_credits) < v_paid then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  -- spend buckets: plan -> topup -> bonus
  v_remaining := v_paid;

  v_plan_spend := least(v_buyer_wallet.gen_plan_credits, v_remaining);
  v_buyer_wallet.gen_plan_credits := v_buyer_wallet.gen_plan_credits - v_plan_spend;
  v_remaining := v_remaining - v_plan_spend;

  if v_remaining > 0 then
    v_topup_spend := least(v_buyer_wallet.gen_topup_credits, v_remaining);
    v_buyer_wallet.gen_topup_credits := v_buyer_wallet.gen_topup_credits - v_topup_spend;
    v_remaining := v_remaining - v_topup_spend;
  end if;

  if v_remaining > 0 then
    v_bonus_spend := least(v_buyer_wallet.gen_bonus_credits, v_remaining);
    v_buyer_wallet.gen_bonus_credits := v_buyer_wallet.gen_bonus_credits - v_bonus_spend;
    v_remaining := v_remaining - v_bonus_spend;
  end if;

  update public.wallet_balances
    set gen_plan_credits = v_buyer_wallet.gen_plan_credits,
        gen_topup_credits = v_buyer_wallet.gen_topup_credits,
        gen_bonus_credits = v_buyer_wallet.gen_bonus_credits
  where user_id = p_buyer_id;

  -- seller earnings pending gets paid_credits
  update public.wallet_balances
    set earnings_pending_credits = earnings_pending_credits + v_paid
  where user_id = v_listing.seller_id;

  insert into public.community_purchases(listing_id, buyer_id, seller_id, price_credits, paid_credits, referral_code_used, idempotency_key)
  values (p_listing_id, p_buyer_id, v_listing.seller_id, v_price, v_paid, p_referral_code, p_idempotency_key)
  returning id into v_purchase_id;

  insert into public.wallet_ledger(
    user_id, entry_type,
    delta_generation_credits, delta_earnings_pending_credits, delta_earnings_matured_credits,
    referral_code_used, related_purchase_id, idempotency_key,
    meta
  ) values (
    p_buyer_id, 'community_purchase',
    -v_paid, 0, 0,
    p_referral_code, v_purchase_id, p_idempotency_key,
    jsonb_build_object(
      'listing_id', p_listing_id,
      'spend_plan', v_plan_spend,
      'spend_topup', v_topup_spend,
      'spend_bonus', v_bonus_spend,
      'discount', v_discount
    )
  );

  insert into public.wallet_ledger(
    user_id, entry_type,
    delta_generation_credits, delta_earnings_pending_credits, delta_earnings_matured_credits,
    referral_code_used, related_purchase_id, idempotency_key,
    meta
  ) values (
    v_listing.seller_id, 'community_sale_pending',
    0, v_paid, 0,
    p_referral_code, v_purchase_id, null,
    jsonb_build_object('listing_id', p_listing_id)
  );

  -- referrer reward (C or B)
  if v_ref_user is not null and v_reward > 0 then
    insert into public.wallet_balances(user_id) values (v_ref_user)
    on conflict (user_id) do nothing;

    update public.wallet_balances
      set earnings_pending_credits = earnings_pending_credits + v_reward
    where user_id = v_ref_user;

    insert into public.wallet_ledger(
      user_id, entry_type,
      delta_generation_credits, delta_earnings_pending_credits, delta_earnings_matured_credits,
      referral_code_used, related_purchase_id, idempotency_key,
      meta
    ) values (
      v_ref_user, 'referral_reward_pending',
      0, v_reward, 0,
      p_referral_code, v_purchase_id, null,
      jsonb_build_object('listing_id', p_listing_id, 'reward', v_reward)
    );
  end if;

  return query select v_purchase_id as purchase_id, v_paid as paid_credits;
end;
$$;

commit;