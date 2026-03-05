-- Backfill de entitlements para compras antiguas ya completadas.
-- Esto corrige usuarios que compraron antes de desplegar el trigger.

insert into public.community_asset_entitlements (
  user_id,
  asset_id,
  listing_id,
  purchase_id,
  granted_by_user_id
)
select distinct
  p.buyer_id,
  candidate.asset_id::uuid,
  p.listing_id,
  p.id as purchase_id,
  p.seller_id as granted_by_user_id
from public.community_purchases p
join public.community_listing_recipes clr
  on clr.listing_id = p.listing_id
cross join lateral (
  select nullif(clr.recipe_snapshot #>> '{sourceAsset,id}', '') as asset_id

  union all

  select jsonb_array_elements_text(
    coalesce(clr.recipe_snapshot #> '{sourceAsset,meta,characterAssetIds}', '[]'::jsonb)
  ) as asset_id

  union all

  select nullif(clr.recipe_snapshot #>> '{sourceAsset,meta,backgroundAssetId}', '') as asset_id

  union all

  select nullif(clr.recipe_snapshot #>> '{sourceAsset,meta,styleAssetId}', '') as asset_id

  union all

  select coalesce(
    nullif(ref.value ->> 'assetId', ''),
    nullif(ref.value ->> 'id', '')
  ) as asset_id
  from jsonb_array_elements(
    coalesce(clr.recipe_snapshot #> '{sourceAsset,meta,promptReferences}', '[]'::jsonb)
  ) as ref(value)
) as candidate
where p.status = 'completed'
  and candidate.asset_id is not null
  and candidate.asset_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
on conflict (user_id, asset_id, listing_id)
do update
  set purchase_id = excluded.purchase_id,
      granted_by_user_id = excluded.granted_by_user_id;