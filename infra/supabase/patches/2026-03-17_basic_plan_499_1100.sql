-- Ajuste puntual solicitado:
-- Plan básico = 4.99 USD por 1,100 créditos.
-- El resto de planes mantiene su pricing actual.

begin;

update public.billing_plans
set
  price_cents = 499,
  plan_credits = 1100,
  bonus_credits = coalesce(bonus_credits, 0)
where slug = 'basic_week';

commit;
