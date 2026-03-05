-- Entitlements de assets comprados en Community Store
-- Da acceso durable al buyer sobre todos los assets incluidos en la receta comprada.

create table if not exists public.community_asset_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  listing_id uuid not null references public.community_listings(id) on delete cascade,
  purchase_id uuid not null references public.community_purchases(id) on delete cascade,
  granted_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, asset_id, listing_id)
);

create index if not exists community_asset_entitlements_user_asset_idx
  on public.community_asset_entitlements(user_id, asset_id);

create index if not exists community_asset_entitlements_purchase_idx
  on public.community_asset_entitlements(purchase_id);

alter table public.community_asset_entitlements enable row level security;

drop policy if exists "community_asset_entitlements_select_own" on public.community_asset_entitlements;
create policy "community_asset_entitlements_select_own" on public.community_asset_entitlements
  for select using (auth.uid() = user_id);

create or replace function public.community_sync_purchase_asset_entitlements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipe jsonb;
begin
  -- Si una compra deja de estar completed, revoca los grants de esa compra.
  if tg_op = 'UPDATE' and old.status = 'completed' and new.status <> 'completed' then
    delete from public.community_asset_entitlements
    where purchase_id = old.id;
  end if;

  -- Solo otorgamos acceso cuando la compra está completed.
  if new.status <> 'completed' then
    return new;
  end if;

  select recipe_snapshot
    into v_recipe
  from public.community_listing_recipes
  where listing_id = new.listing_id
  limit 1;

  if v_recipe is null then
    return new;
  end if;

  insert into public.community_asset_entitlements (
    user_id,
    asset_id,
    listing_id,
    purchase_id,
    granted_by_user_id
  )
  select distinct
    new.buyer_id,
    candidate.asset_id::uuid,
    new.listing_id,
    new.id,
    new.seller_id
  from (
    -- asset principal / sourceAsset
    select nullif(v_recipe #>> '{sourceAsset,id}', '') as asset_id

    union all

    -- refs legacy: characterAssetIds (incluye chars y algunos elements viejos)
    select jsonb_array_elements_text(
      coalesce(v_recipe #> '{sourceAsset,meta,characterAssetIds}', '[]'::jsonb)
    ) as asset_id

    union all

    -- background
    select nullif(v_recipe #>> '{sourceAsset,meta,backgroundAssetId}', '') as asset_id

    union all

    -- style asset
    select nullif(v_recipe #>> '{sourceAsset,meta,styleAssetId}', '') as asset_id

    union all

    -- promptReferences modernos
    select coalesce(
      nullif(ref.value ->> 'assetId', ''),
      nullif(ref.value ->> 'id', '')
    ) as asset_id
    from jsonb_array_elements(
      coalesce(v_recipe #> '{sourceAsset,meta,promptReferences}', '[]'::jsonb)
    ) as ref(value)
  ) as candidate
  where candidate.asset_id is not null
    and candidate.asset_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  on conflict (user_id, asset_id, listing_id)
  do update
    set purchase_id = excluded.purchase_id,
        granted_by_user_id = excluded.granted_by_user_id;

  return new;
end;
$$;

drop trigger if exists trg_community_sync_purchase_asset_entitlements on public.community_purchases;
create trigger trg_community_sync_purchase_asset_entitlements
  after insert or update of status on public.community_purchases
  for each row execute procedure public.community_sync_purchase_asset_entitlements();