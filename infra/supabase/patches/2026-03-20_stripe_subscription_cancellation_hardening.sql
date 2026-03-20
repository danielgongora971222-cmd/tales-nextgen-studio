begin;

create or replace function public.billing_wipe_generation_credits_if_no_active_plan(
  p_user_id uuid,
  p_reason text default 'subscription_end',
  p_idempotency_key text default null
) returns table (
  wipe_applied boolean,
  plan_credits integer,
  topup_credits integer,
  bonus_credits integer
)
language plpgsql
as $$
declare
  v_ledger public.wallet_ledger%rowtype;
  v_bal public.wallet_balances%rowtype;
  v_before_plan integer := 0;
  v_before_topup integer := 0;
  v_before_bonus integer := 0;
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'subscription_end');
begin
  if p_idempotency_key is not null and length(trim(p_idempotency_key)) > 0 then
    select * into v_ledger
    from public.wallet_ledger
    where user_id = p_user_id
      and idempotency_key = p_idempotency_key
    limit 1;

    if v_ledger.id is not null then
      select * into v_bal
      from public.wallet_balances
      where user_id = p_user_id;

      if not found then
        insert into public.wallet_balances(user_id) values (p_user_id);
        select * into v_bal
        from public.wallet_balances
        where user_id = p_user_id;
      end if;

      return query
      select
        coalesce((v_ledger.meta ->> 'wipe_applied')::boolean, false),
        coalesce(v_bal.gen_plan_credits, 0),
        coalesce(v_bal.gen_topup_credits, 0),
        coalesce(v_bal.gen_bonus_credits, 0);
      return;
    end if;
  end if;

  if exists (
    select 1
    from public.billing_subscriptions
    where user_id = p_user_id
      and status = 'active'
      and current_period_end > now()
  ) then
    select * into v_bal
    from public.wallet_balances
    where user_id = p_user_id;

    if not found then
      insert into public.wallet_balances(user_id) values (p_user_id);
      select * into v_bal
      from public.wallet_balances
      where user_id = p_user_id;
    end if;

    return query
    select
      false,
      coalesce(v_bal.gen_plan_credits, 0),
      coalesce(v_bal.gen_topup_credits, 0),
      coalesce(v_bal.gen_bonus_credits, 0);
    return;
  end if;

  select * into v_bal
  from public.wallet_balances
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.wallet_balances(user_id) values (p_user_id);
    select * into v_bal
    from public.wallet_balances
    where user_id = p_user_id
    for update;
  end if;

  v_before_plan := coalesce(v_bal.gen_plan_credits, 0);
  v_before_topup := coalesce(v_bal.gen_topup_credits, 0);
  v_before_bonus := coalesce(v_bal.gen_bonus_credits, 0);

  update public.wallet_balances
    set gen_plan_credits = 0,
        gen_topup_credits = 0,
        gen_bonus_credits = 0,
        updated_at = now()
  where user_id = p_user_id
  returning * into v_bal;

  insert into public.wallet_ledger(
    user_id,
    entry_type,
    amount_credits,
    ref_type,
    ref_id,
    idempotency_key,
    meta
  ) values (
    p_user_id,
    'subscription_end_wipe_generation',
    0,
    'billing_subscription',
    null,
    p_idempotency_key,
    jsonb_build_object(
      'reason', v_reason,
      'wipe_applied', true,
      'before_plan_credits', v_before_plan,
      'before_topup_credits', v_before_topup,
      'before_bonus_credits', v_before_bonus,
      'after_plan_credits', coalesce(v_bal.gen_plan_credits, 0),
      'after_topup_credits', coalesce(v_bal.gen_topup_credits, 0),
      'after_bonus_credits', coalesce(v_bal.gen_bonus_credits, 0)
    )
  );

  return query
  select
    true,
    coalesce(v_bal.gen_plan_credits, 0),
    coalesce(v_bal.gen_topup_credits, 0),
    coalesce(v_bal.gen_bonus_credits, 0);
end;
$$;

revoke all on function public.billing_wipe_generation_credits_if_no_active_plan(uuid, text, text) from PUBLIC, anon, authenticated;
grant execute on function public.billing_wipe_generation_credits_if_no_active_plan(uuid, text, text) to service_role;

commit;
