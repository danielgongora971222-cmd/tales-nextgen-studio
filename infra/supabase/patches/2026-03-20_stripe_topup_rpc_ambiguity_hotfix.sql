begin;

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

  update public.wallet_balances as wb
    set gen_topup_credits = coalesce(wb.gen_topup_credits, 0) + v_added,
        updated_at = now()
  where wb.user_id = p_user_id
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
