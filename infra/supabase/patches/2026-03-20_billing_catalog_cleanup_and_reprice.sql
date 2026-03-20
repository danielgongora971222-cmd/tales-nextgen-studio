begin;

-- =========================================================
-- Catálogo billing 2026-03-20
-- 1) Corrige Pro y Partner con el nuevo pricing solicitado.
-- 2) Sincroniza topups a los créditos canónicos actuales.
-- 3) Canonicaliza el catálogo de topups y desactiva duplicados.
--
-- Motivo:
-- - Se detectaron filas duplicadas en credit_topup_products.
-- - En algunos entornos credits_amount quedó desalineado de credits/name.
-- - Stripe debe mapearse sobre un catálogo limpio antes de crear price_ids.
-- =========================================================

-- -------------------------
-- 1) Reprice Pro / Partner
-- -------------------------
update public.billing_plans
set
  price_cents = case slug
    when 'pro_month' then 3799
    when 'partner_month' then 6799
    else price_cents
  end,
  plan_credits = case slug
    when 'pro_month' then 8434
    when 'partner_month' then 15094
    else plan_credits
  end,
  bonus_credits = case
    when slug in ('pro_month', 'partner_month') then 0
    else bonus_credits
  end,
  updated_at = now()
where slug in ('pro_month', 'partner_month');

-- ------------------------------------------------------
-- 2) Topups canónicos (sincroniza credits + credits_amount)
-- ------------------------------------------------------
with target_catalog as (
  select *
  from (
    values
      (499,  1108, '$4.99 / 1,108 créditos',  'topup_499_1108'),
      (999,  2218, '$9.99 / 2,218 créditos',  'topup_999_2218'),
      (1999, 4438, '$19.99 / 4,438 créditos', 'topup_1999_4438'),
      (3499, 7768, '$34.99 / 7,768 créditos', 'topup_3499_7768'),
      (4999, 11098,'$49.99 / 11,098 créditos','topup_4999_11098')
  ) as t(price_cents, credits_value, display_name, canonical_sku)
),
ranked as (
  select
    p.id,
    p.price_cents,
    t.credits_value,
    t.display_name,
    t.canonical_sku,
    row_number() over (
      partition by p.price_cents
      order by
        case when p.stripe_price_id is not null and length(trim(p.stripe_price_id)) > 0 then 0 else 1 end,
        case when p.is_active then 0 else 1 end,
        p.created_at asc,
        p.id asc
    ) as rn
  from public.credit_topup_products p
  join target_catalog t
    on t.price_cents = p.price_cents
)
update public.credit_topup_products p
set
  credits = r.credits_value,
  credits_amount = r.credits_value,
  name = r.display_name,
  sku = case when r.rn = 1 then r.canonical_sku else null end,
  is_active = case when r.rn = 1 then true else false end,
  updated_at = now()
from ranked r
where p.id = r.id;

-- ------------------------------------------------------
-- 3) Si faltara algún SKU en una fila única, complétalo.
-- ------------------------------------------------------
update public.credit_topup_products
set sku = case price_cents
    when 499 then 'topup_499_1108'
    when 999 then 'topup_999_2218'
    when 1999 then 'topup_1999_4438'
    when 3499 then 'topup_3499_7768'
    when 4999 then 'topup_4999_11098'
    else sku
  end,
  updated_at = now()
where is_active = true
  and (sku is null or length(trim(sku)) = 0)
  and price_cents in (499, 999, 1999, 3499, 4999);

commit;
