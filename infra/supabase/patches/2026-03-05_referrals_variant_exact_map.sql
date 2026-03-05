-- infra/supabase/patches/2026-03-05_referrals_variant_exact_map.sql
-- Blindaje total:
-- Obliga que variant A/B/C solo pueda tener estas combinaciones:
-- A = 15/5, B = 5/15, C = 10/10

begin;

-- 1) Saneamiento (por si alguien tocó valores a mano antes de aplicar el constraint)
update public.community_referral_codes
set buyer_discount_pct = 15,
    ref_reward_pct = 5
where variant = 'A'
  and (buyer_discount_pct <> 15 or ref_reward_pct <> 5);

update public.community_referral_codes
set buyer_discount_pct = 5,
    ref_reward_pct = 15
where variant = 'B'
  and (buyer_discount_pct <> 5 or ref_reward_pct <> 15);

update public.community_referral_codes
set buyer_discount_pct = 10,
    ref_reward_pct = 10
where variant = 'C'
  and (buyer_discount_pct <> 10 or ref_reward_pct <> 10);

-- 2) Constraint estricto (impide que A/B/C se rompa por cambios manuales o scripts)
alter table public.community_referral_codes
  drop constraint if exists community_referral_codes_variant_exact_map_check;

alter table public.community_referral_codes
  add constraint community_referral_codes_variant_exact_map_check
  check (
    (variant = 'A' and buyer_discount_pct = 15 and ref_reward_pct = 5)
    or
    (variant = 'B' and buyer_discount_pct = 5 and ref_reward_pct = 15)
    or
    (variant = 'C' and buyer_discount_pct = 10 and ref_reward_pct = 10)
  );

commit;