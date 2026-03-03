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
  v_buyer_balance record;

  v_price integer;
  v_paid integer;
  v_platform_fee integer;
  v_seller_net integer;

  v_ref_code record;
  v_ref_reward integer;
  v_referrer_id uuid;

  v_now timestamptz;
  v_recipe_hash text;

  v_spend record;
begin
  v_now := now();

  -- Idempotencia: si ya existe, regresa lo mismo
  if (p_idempotency_key is not null) then
    select id, paid_credits into purchase_id, paid_credits
    from public.community_purchases
    where idempotency_key = p_idempotency_key
    limit 1;

    if (purchase_id is not null) then
      return next;
      return;
    end if;
  end if;

  -- Listing (lock)
  select * into v_listing
  from public.community_listings
  where id = p_listing_id
  for update;

  if not found then
    raise exception 'LISTING_NOT_FOUND';
  end if;

  if v_listing.status <> 'active' then
    raise exception 'LISTING_NOT_ACTIVE';
  end if;

  if p_buyer_id = v_listing.seller_id then
    raise exception 'CANNOT_BUY_OWN_LISTING';
  end if;

  if exists (
    select 1 from public.community_purchases p
    where p.listing_id = p_listing_id
      and p.buyer_id = p_buyer_id
      and p.status = 'completed'
  ) then
    raise exception 'ALREADY_OWNED';
  end if;

  v_price := v_listing.price_credits;

  perform public.wallet_ensure_row(p_buyer_id);
  perform public.wallet_ensure_row(v_listing.seller_id);

  -- Referral opcional
  v_ref_reward := 0;
  v_referrer_id := null;

  if p_referral_code is not null and length(trim(p_referral_code)) > 0 then
    select * into v_ref_code
    from public.community_referral_codes
    where code = trim(p_referral_code)
      and is_active = true
    limit 1;

    if v_ref_code.id is not null and v_ref_code.owner_id <> p_buyer_id then
      v_referrer_id := v_ref_code.owner_id;
      perform public.wallet_ensure_row(v_referrer_id);
    end if;
  end if;

  v_paid := v_price;

  if v_ref_code.id is not null and v_ref_code.owner_id <> p_buyer_id then
    -- descuento buyer
    v_paid := greatest(0, floor(v_price * (1 - v_ref_code.buyer_discount_pct)));
    -- reward referrer
    v_ref_reward := floor(v_price * v_ref_code.referrer_reward_pct);
  end if;

  v_platform_fee := floor(v_paid * 0.10);
  v_seller_net := greatest(0, v_paid - v_platform_fee);

  -- Inserta compra (pending) y calcula recipe hash (sin cambios de tu patch original)
  select encode(digest(coalesce(v_listing.recipe_json::text, ''), 'sha256'), 'hex') into v_recipe_hash;

  insert into public.community_purchases(
    listing_id,
    buyer_id,
    seller_id,
    paid_credits,
    platform_fee_credits,
    seller_net_credits,
    referral_code_used,
    referrer_id,
    referrer_reward_credits,
    status,
    recipe_hash,
    matures_at,
    idempotency_key,
    created_at
  ) values (
    p_listing_id,
    p_buyer_id,
    v_listing.seller_id,
    v_paid,
    v_platform_fee,
    v_seller_net,
    case when v_ref_code.id is not null then v_ref_code.code else null end,
    v_referrer_id,
    v_ref_reward,
    'completed',
    v_recipe_hash,
    (v_now + interval '30 days'),
    p_idempotency_key,
    v_now
  ) returning id into purchase_id;

  paid_credits := v_paid;

  -- ✅ Debit buyer con buckets nuevos (plan->topup->bonus)
  select * into v_spend
  from public.wallet_spend_generation_credits(
    p_buyer_id,
    v_paid,
    'community_purchase',
    'community_purchase',
    purchase_id,
    p_idempotency_key
  );

  -- Credit seller pending
  update public.wallet_balances
  set earnings_pending_credits = earnings_pending_credits + v_seller_net
  where user_id = v_listing.seller_id;

  insert into public.wallet_ledger(user_id, entry_type, amount_credits, ref_type, ref_id)
  values (v_listing.seller_id, 'sale_pending', v_seller_net, 'community_purchase', purchase_id);

  -- Referral reward (si aplica)
  if v_referrer_id is not null and v_ref_reward > 0 then
    update public.wallet_balances
    set earnings_pending_credits = earnings_pending_credits + v_ref_reward
    where user_id = v_referrer_id;

    insert into public.wallet_ledger(user_id, entry_type, amount_credits, ref_type, ref_id)
    values (v_referrer_id, 'referral_reward_pending', v_ref_reward, 'community_purchase', purchase_id);
  end if;

  return next;
end;
$$;

commit;
