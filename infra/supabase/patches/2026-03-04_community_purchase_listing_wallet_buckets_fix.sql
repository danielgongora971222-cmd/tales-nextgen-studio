-- infra/supabase/patches/2026-03-04_community_purchase_listing_wallet_buckets_fix.sql
-- FIX: community_purchase_listing alineada con el schema actual (community_purchases) y con buckets gen_plan/gen_topup/gen_bonus
-- Este patch la deja consistente con:
--  - public.community_purchases (price_credits, paid_credits, platform_fee_credits, seller_net_credits, referral_code_id, referral_reward_credits, referrer_id, recipe_hash_at_purchase, idempotency_key)
--  - public.wallet_spend_generation_credits (plan->topup->bonus)
--  - Plataforma fee 37% (y el reward del referrer sale de la fee)

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
security definer
as $$
declare
  v_listing public.community_listings%rowtype;
  v_ref public.community_referral_codes%rowtype;

  v_price integer := 0;
  v_paid integer := 0;

  v_platform_fee integer := 0;
  v_seller_net integer := 0;

  v_ref_reward integer := 0;
  v_referrer_id uuid := null;

  v_recipe_hash text := null;
  v_now timestamptz := now();

  v_existing public.community_purchases%rowtype;
begin
  -- Idempotencia: si ya existe una compra con este idempotency_key, devolverla
  if p_idempotency_key is not null and length(trim(p_idempotency_key)) > 0 then
    select *
    into v_existing
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
  select *
  into v_listing
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

  select recipe_hash
  into v_recipe_hash
  from public.community_listing_recipes
  where listing_id = p_listing_id
  limit 1;

  if v_recipe_hash is null then
    raise exception 'LISTING_RECIPE_MISSING';
  end if;

  v_price := v_listing.price_credits;
  v_paid := v_price;

  -- Referral opcional (descuento buyer + reward referrer)
  v_ref_reward := 0;
  v_referrer_id := null;

  if p_referral_code is not null and length(trim(p_referral_code)) > 0 then
    select *
    into v_ref
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

  -- Fee plataforma 37%
  v_platform_fee := floor(v_paid * 0.37)::int;
  if v_platform_fee < 0 then v_platform_fee := 0; end if;

  -- Reward sale de la fee
  if v_ref_reward > v_platform_fee then
    v_ref_reward := v_platform_fee;
  end if;

  v_seller_net := v_paid - v_platform_fee;
  if v_seller_net < 0 then v_seller_net := 0; end if;

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
    v_platform_fee,
    v_seller_net,
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

  -- Credit seller pending
  update public.wallet_balances
    set earnings_pending_credits = earnings_pending_credits + v_seller_net,
        updated_at = now()
  where user_id = v_listing.seller_id;

  insert into public.wallet_ledger(user_id, entry_type, amount_credits, ref_type, ref_id, idempotency_key)
  values (
    v_listing.seller_id,
    'sale_pending',
    v_seller_net,
    'community_purchase',
    purchase_id,
    case when p_idempotency_key is null then null else 'sale:' || p_idempotency_key end
  );

  -- Referral reward pending
  if v_referrer_id is not null and v_ref_reward > 0 then
    update public.wallet_balances
      set earnings_pending_credits = earnings_pending_credits + v_ref_reward,
          updated_at = now()
    where user_id = v_referrer_id;

    insert into public.wallet_ledger(user_id, entry_type, amount_credits, ref_type, ref_id, idempotency_key)
    values (
      v_referrer_id,
      'referral_reward_pending',
      v_ref_reward,
      'community_purchase',
      purchase_id,
      case when p_idempotency_key is null then null else 'ref:' || p_idempotency_key end
    );
  end if;

  return next;
end;
$$;

revoke all on function public.community_purchase_listing(uuid, uuid, text, text) from anon, authenticated;

commit;