begin;

-- Ajuste solicitado: al comprar el plan Básico solo se otorga 1 crédito.
update public.billing_plans
set plan_credits = 1
where slug = 'basic_week';

commit;