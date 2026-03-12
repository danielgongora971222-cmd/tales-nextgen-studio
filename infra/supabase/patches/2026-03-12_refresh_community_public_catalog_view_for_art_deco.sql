-- 2026-03-12_refresh_community_public_catalog_view_for_art_deco.sql
-- Recrea la vista pública del Community Store para incluir columnas añadidas
-- después de su creación inicial (price_usd, currency, art_deco_payload).

begin;

drop view if exists public.community_listings_public_catalog;

create view public.community_listings_public_catalog as
select l.*
from public.community_listings l
where l.status = 'active'
  and public.billing_user_can_sell_now(l.seller_id);

revoke all on table public.community_listings_public_catalog from PUBLIC, anon, authenticated;
grant select on table public.community_listings_public_catalog to service_role;

commit;
