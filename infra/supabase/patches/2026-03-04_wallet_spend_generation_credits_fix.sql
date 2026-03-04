-- infra/supabase/patches/2026-03-04_wallet_spend_generation_credits_fix.sql
-- FIX: wallet_spend_generation_credits alineada con wallet_ledger (amount_credits/ref_type/ref_id)
-- + hardening: asegurar buckets gen_* en wallet_balances, default para amount_credits, y meta jsonb en ledger.

begin;

-- 1) Asegurar buckets de generación (si faltan)
alter table public.wallet_balances
  add column if not exists gen_plan_credits integer not null default 0 check (gen_plan_credits >= 0),
  add column if not exists gen_topup_credits integer not null default 0 check (gen_topup_credits >= 0),
  add column if not exists gen_bonus_credits integer not null default 0 check (gen_bonus_credits >= 0);

-- 2) Migración segura: si existe generation_credits, lo movemos a gen_topup_credits y lo ponemos en 0
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'wallet_balances'
      and column_name = 'generation_credits'
  ) then
    execute $m$
      update public.wallet_balances
        set gen_topup_credits = gen_topup_credits + generation_credits,
            generation_credits = 0
      where generation_credits > 0
    $m$;
  end if;
end
$$;

-- 3) wallet_ledger: default para no romper inserts legacy + meta para auditoría
alter table public.wallet_ledger
  alter column amount_credits set default 0;

alter table public.wallet_ledger
  add column if not exists meta jsonb not null default '{}'::jsonb;

-- 4) Eliminar versiones conflictivas (por si ya existen)
drop function if exists public.wallet_spend_generation_credits(uuid, integer, text, text, text, text);
drop function if exists public.wallet_spend_generation_credits(uuid, integer, text, text, uuid, text);

-- 5) Crear función correcta (la que usa tu backend: 6 args)
create or replace function public.wallet_spend_generation_credits(
  p_user_id uuid,
  p_amount integer,
  p_entry_type text,
  p_ref_type text default null,
  p_ref_id uuid default null,
  p_idempotency_key text default null
)
returns table (
  ledger_id uuid,
  gen_plan_credits integer,
  gen_topup_credits integer,
  gen_bonus_credits integer
)
language plpgsql
as $$
declare
  v_bal public.wallet_balances%rowtype;
  v_plan_spend integer := 0;
  v_topup_spend integer := 0;
  v_bonus_spend integer := 0;
  v_remaining integer := p_amount;
  v_existing uuid;
begin
  if p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  -- Idempotencia
  if p_idempotency_key is not null then
    select id into v_existing
    from public.wallet_ledger
    where user_id = p_user_id and idempotency_key = p_idempotency_key
    limit 1;

    if v_existing is not null then
      select * into v_bal from public.wallet_balances where user_id = p_user_id;
      return query select v_existing, v_bal.gen_plan_credits, v_bal.gen_topup_credits, v_bal.gen_bonus_credits;
      return;
    end if;
  end if;

  -- Lock wallet
  select * into v_bal
  from public.wallet_balances
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.wallet_balances(user_id) values (p_user_id);
    select * into v_bal from public.wallet_balances where user_id = p_user_id for update;
  end if;

  if (v_bal.gen_plan_credits + v_bal.gen_topup_credits + v_bal.gen_bonus_credits) < p_amount then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  -- Spend order: plan -> topup -> bonus
  v_plan_spend := least(v_bal.gen_plan_credits, v_remaining);
  v_bal.gen_plan_credits := v_bal.gen_plan_credits - v_plan_spend;
  v_remaining := v_remaining - v_plan_spend;

  if v_remaining > 0 then
    v_topup_spend := least(v_bal.gen_topup_credits, v_remaining);
    v_bal.gen_topup_credits := v_bal.gen_topup_credits - v_topup_spend;
    v_remaining := v_remaining - v_topup_spend;
  end if;

  if v_remaining > 0 then
    v_bonus_spend := least(v_bal.gen_bonus_credits, v_remaining);
    v_bal.gen_bonus_credits := v_bal.gen_bonus_credits - v_bonus_spend;
    v_remaining := v_remaining - v_bonus_spend;
  end if;

  update public.wallet_balances
    set gen_plan_credits = v_bal.gen_plan_credits,
        gen_topup_credits = v_bal.gen_topup_credits,
        gen_bonus_credits = v_bal.gen_bonus_credits
  where user_id = p_user_id;

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
    p_entry_type,
    -p_amount,
    p_ref_type,
    p_ref_id,
    p_idempotency_key,
    jsonb_build_object(
      'spend_plan', v_plan_spend,
      'spend_topup', v_topup_spend,
      'spend_bonus', v_bonus_spend
    )
  )
  returning id into v_existing;

  return query select v_existing, v_bal.gen_plan_credits, v_bal.gen_topup_credits, v_bal.gen_bonus_credits;
end;
$$;

commit;