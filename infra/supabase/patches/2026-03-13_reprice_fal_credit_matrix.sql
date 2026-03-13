-- Reprice plans + topups to the new global rule:
-- 1 USD = 222 credits
-- NOTE: generation pricing markup (+35%) is applied in app code, not here.

begin;

update public.billing_plans
set
  plan_credits = case slug
    when 'basic_week' then 1774
    when 'standard_month' then 3994
    when 'pro_month' then 6214
    when 'partner_month' then 10654
    when 'business_month' then 19534
    else round(price_cents * 222.0 / 100.0)::integer
  end,
  bonus_credits = 0
where slug in ('basic_week', 'standard_month', 'pro_month', 'partner_month', 'business_month');

update public.credit_topup_products
set
  credits = case price_cents
    when 499 then 1108
    when 999 then 2218
    when 1999 then 4438
    when 3499 then 7768
    when 4999 then 11098
    else round(price_cents * 222.0 / 100.0)::integer
  end,
  name = case price_cents
    when 499 then '$4.99 / 1,108 créditos'
    when 999 then '$9.99 / 2,218 créditos'
    when 1999 then '$19.99 / 4,438 créditos'
    when 3499 then '$34.99 / 7,768 créditos'
    when 4999 then '$49.99 / 11,098 créditos'
    else name
  end
where price_cents in (499, 999, 1999, 3499, 4999);

commit;
