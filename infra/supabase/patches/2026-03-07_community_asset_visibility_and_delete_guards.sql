-- Ocultado por usuario para assets comprados
-- + guardas duras para impedir borrar assets vendidos o aún ligados a listings/recetas

create table if not exists public.community_hidden_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  listing_id uuid references public.community_listings(id) on delete set null,
  hidden_at timestamptz not null default now(),
  unique (user_id, asset_id)
);

create index if not exists community_hidden_assets_user_asset_idx
  on public.community_hidden_assets(user_id, asset_id);

create index if not exists community_hidden_assets_hidden_at_idx
  on public.community_hidden_assets(user_id, hidden_at desc);

alter table public.community_hidden_assets enable row level security;

drop policy if exists "community_hidden_assets_select_own" on public.community_hidden_assets;
create policy "community_hidden_assets_select_own" on public.community_hidden_assets
  for select using (auth.uid() = user_id);

drop policy if exists "community_hidden_assets_insert_own" on public.community_hidden_assets;
create policy "community_hidden_assets_insert_own" on public.community_hidden_assets
  for insert with check (auth.uid() = user_id);

drop policy if exists "community_hidden_assets_delete_own" on public.community_hidden_assets;
create policy "community_hidden_assets_delete_own" on public.community_hidden_assets
  for delete using (auth.uid() = user_id);

-- Endurece el FK de entitlements:
-- si un asset ya fue entregado a compradores, no debe poder borrarse físicamente por accidente.
alter table public.community_asset_entitlements
  drop constraint if exists community_asset_entitlements_asset_id_fkey;

alter table public.community_asset_entitlements
  add constraint community_asset_entitlements_asset_id_fkey
  foreign key (asset_id)
  references public.assets(id)
  on delete restrict;

create or replace function public.community_find_protected_asset_usage(p_asset_id uuid)
returns table (
  listing_id uuid,
  listing_name text,
  listing_status text,
  usage_kind text,
  has_completed_purchases boolean
)
language sql
security definer
set search_path = public
as $$
  with sold as (
    select exists (
      select 1
      from public.community_asset_entitlements cae
      where cae.asset_id = p_asset_id
      limit 1
    ) as has_completed_purchases
  ),
  linked as (
    select
      cl.id as listing_id,
      cl.name as listing_name,
      cl.status as listing_status,
      'preview_asset'::text as usage_kind
    from public.community_listings cl
    where cl.preview_asset_id = p_asset_id
      and cl.status <> 'deleted'

    union all

    select
      clr.listing_id,
      cl.name as listing_name,
      cl.status as listing_status,
      'recipe_source_asset'::text as usage_kind
    from public.community_listing_recipes clr
    join public.community_listings cl on cl.id = clr.listing_id
    where cl.status <> 'deleted'
      and coalesce(clr.recipe_snapshot #>> '{sourceAsset,id}', '') = p_asset_id::text

    union all

    select
      clr.listing_id,
      cl.name as listing_name,
      cl.status as listing_status,
      'recipe_character_asset'::text as usage_kind
    from public.community_listing_recipes clr
    join public.community_listings cl on cl.id = clr.listing_id
    where cl.status <> 'deleted'
      and exists (
        select 1
        from jsonb_array_elements_text(
          coalesce(clr.recipe_snapshot #> '{sourceAsset,meta,characterAssetIds}', '[]'::jsonb)
        ) as char_id
        where char_id = p_asset_id::text
      )

    union all

    select
      clr.listing_id,
      cl.name as listing_name,
      cl.status as listing_status,
      'recipe_background_asset'::text as usage_kind
    from public.community_listing_recipes clr
    join public.community_listings cl on cl.id = clr.listing_id
    where cl.status <> 'deleted'
      and coalesce(clr.recipe_snapshot #>> '{sourceAsset,meta,backgroundAssetId}', '') = p_asset_id::text

    union all

    select
      clr.listing_id,
      cl.name as listing_name,
      cl.status as listing_status,
      'recipe_style_asset'::text as usage_kind
    from public.community_listing_recipes clr
    join public.community_listings cl on cl.id = clr.listing_id
    where cl.status <> 'deleted'
      and coalesce(clr.recipe_snapshot #>> '{sourceAsset,meta,styleAssetId}', '') = p_asset_id::text

    union all

    select
      clr.listing_id,
      cl.name as listing_name,
      cl.status as listing_status,
      'recipe_prompt_reference'::text as usage_kind
    from public.community_listing_recipes clr
    join public.community_listings cl on cl.id = clr.listing_id
    where cl.status <> 'deleted'
      and exists (
        select 1
        from jsonb_array_elements(
          coalesce(clr.recipe_snapshot #> '{sourceAsset,meta,promptReferences}', '[]'::jsonb)
        ) as ref(value)
        where coalesce(
          nullif(ref.value ->> 'assetId', ''),
          nullif(ref.value ->> 'id', '')
        ) = p_asset_id::text
      )
  )
  select
    linked_pick.listing_id,
    linked_pick.listing_name,
    linked_pick.listing_status,
    linked_pick.usage_kind,
    sold.has_completed_purchases
  from sold
  left join lateral (
    select *
    from linked
    order by
      case when listing_status = 'active' then 0 else 1 end,
      listing_id
    limit 1
  ) as linked_pick on true;
$$;

grant execute on function public.community_find_protected_asset_usage(uuid) to authenticated;
grant execute on function public.community_find_protected_asset_usage(uuid) to service_role;