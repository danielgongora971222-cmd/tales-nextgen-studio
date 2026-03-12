-- 2026-03-11_art_deco_store_orders.sql
-- Extiende Community Store para soportar listings físicos Art Deco en USD
-- y crea la tabla store_orders usada por 1NationUp para registrar pedidos físicos.

begin;

-- =====================================================
-- COMMUNITY LISTINGS: Art Deco físico en USD
-- =====================================================
alter table public.community_listings
  add column if not exists price_usd numeric(12,2),
  add column if not exists currency text,
  add column if not exists art_deco_payload jsonb;

update public.community_listings
set currency = 'USD'
where currency is null;

alter table public.community_listings
  alter column currency set default 'USD',
  alter column currency set not null;

alter table public.community_listings
  drop constraint if exists community_listings_listing_kind_check;

alter table public.community_listings
  add constraint community_listings_listing_kind_check
  check (listing_kind in ('single', 'workflow', 'art_deco'));

alter table public.community_listings
  drop constraint if exists community_listings_price_credits_check;

alter table public.community_listings
  add constraint community_listings_price_credits_check
  check (
    (
      listing_kind = 'art_deco'
      and price_credits = 0
      and coalesce(price_usd, 0) > 0
    )
    or
    (
      listing_kind <> 'art_deco'
      and price_credits > 0
      and price_credits <= 1000000
    )
  );

alter table public.community_listings
  drop constraint if exists community_listings_currency_check;

alter table public.community_listings
  add constraint community_listings_currency_check
  check (currency = 'USD');

create index if not exists community_listings_kind_status_created_at_idx
  on public.community_listings(listing_kind, status, created_at desc);

create index if not exists community_listings_price_usd_idx
  on public.community_listings(price_usd)
  where listing_kind = 'art_deco';

-- =====================================================
-- STORE ORDERS: pedidos físicos 1NationUp / Art Deco
-- =====================================================
create table if not exists public.store_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  buyer_id uuid references auth.users(id) on delete set null,
  seller_id uuid references auth.users(id) on delete set null,
  art_deco_listing_id uuid references public.community_listings(id) on delete set null,
  preview_asset_id uuid references public.assets(id) on delete set null,
  order_kind text not null default 'standard' check (order_kind in ('standard', 'art_deco')),
  sale_price_usd numeric(12,2) not null default 0 check (sale_price_usd >= 0),
  base_service_price_usd numeric(12,2) not null default 0 check (base_service_price_usd >= 0),
  seller_profit_usd numeric(12,2) not null default 0 check (seller_profit_usd >= 0),
  currency text not null default 'USD' check (currency = 'USD'),
  customer_name text,
  buyer_email text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'created' check (status in ('created', 'confirmed', 'processing', 'completed', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.store_orders
  add column if not exists owner_id uuid references auth.users(id) on delete set null,
  add column if not exists buyer_id uuid references auth.users(id) on delete set null,
  add column if not exists seller_id uuid references auth.users(id) on delete set null,
  add column if not exists art_deco_listing_id uuid references public.community_listings(id) on delete set null,
  add column if not exists preview_asset_id uuid references public.assets(id) on delete set null,
  add column if not exists order_kind text,
  add column if not exists sale_price_usd numeric(12,2),
  add column if not exists base_service_price_usd numeric(12,2),
  add column if not exists seller_profit_usd numeric(12,2),
  add column if not exists currency text,
  add column if not exists customer_name text,
  add column if not exists buyer_email text,
  add column if not exists payload jsonb,
  add column if not exists status text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

update public.store_orders
set
  order_kind = coalesce(order_kind, 'standard'),
  sale_price_usd = coalesce(sale_price_usd, 0),
  base_service_price_usd = coalesce(base_service_price_usd, 0),
  seller_profit_usd = coalesce(seller_profit_usd, 0),
  currency = coalesce(currency, 'USD'),
  payload = coalesce(payload, '{}'::jsonb),
  status = coalesce(status, 'created'),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.store_orders
  alter column order_kind set default 'standard',
  alter column sale_price_usd set default 0,
  alter column base_service_price_usd set default 0,
  alter column seller_profit_usd set default 0,
  alter column currency set default 'USD',
  alter column payload set default '{}'::jsonb,
  alter column status set default 'created',
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table public.store_orders
  alter column order_kind set not null,
  alter column sale_price_usd set not null,
  alter column base_service_price_usd set not null,
  alter column seller_profit_usd set not null,
  alter column currency set not null,
  alter column payload set not null,
  alter column status set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

alter table public.store_orders
  drop constraint if exists store_orders_order_kind_check;

alter table public.store_orders
  add constraint store_orders_order_kind_check
  check (order_kind in ('standard', 'art_deco'));

alter table public.store_orders
  drop constraint if exists store_orders_currency_check;

alter table public.store_orders
  add constraint store_orders_currency_check
  check (currency = 'USD');

alter table public.store_orders
  drop constraint if exists store_orders_status_check;

alter table public.store_orders
  add constraint store_orders_status_check
  check (status in ('created', 'confirmed', 'processing', 'completed', 'failed', 'cancelled'));

alter table public.store_orders
  drop constraint if exists store_orders_sale_price_usd_check;

alter table public.store_orders
  add constraint store_orders_sale_price_usd_check
  check (sale_price_usd >= 0);

alter table public.store_orders
  drop constraint if exists store_orders_base_service_price_usd_check;

alter table public.store_orders
  add constraint store_orders_base_service_price_usd_check
  check (base_service_price_usd >= 0);

alter table public.store_orders
  drop constraint if exists store_orders_seller_profit_usd_check;

alter table public.store_orders
  add constraint store_orders_seller_profit_usd_check
  check (seller_profit_usd >= 0);

create index if not exists store_orders_buyer_created_at_idx
  on public.store_orders(buyer_id, created_at desc);

create index if not exists store_orders_seller_created_at_idx
  on public.store_orders(seller_id, created_at desc);

create index if not exists store_orders_listing_created_at_idx
  on public.store_orders(art_deco_listing_id, created_at desc);

create index if not exists store_orders_order_kind_created_at_idx
  on public.store_orders(order_kind, created_at desc);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_store_orders_updated_at on public.store_orders;
create trigger set_store_orders_updated_at
  before update on public.store_orders
  for each row execute procedure public.set_updated_at();

-- =====================================================
-- REFRESH PUBLIC CATALOG VIEW
-- select * en vistas fija las columnas al momento de crearla,
-- así que al añadir price_usd/currency/art_deco_payload debemos recrearla.
-- =====================================================
drop view if exists public.community_listings_public_catalog;

create view public.community_listings_public_catalog as
select l.*
from public.community_listings l
where l.status = 'active'
  and public.billing_user_can_sell_now(l.seller_id);

revoke all on table public.community_listings_public_catalog from PUBLIC, anon, authenticated;
grant select on table public.community_listings_public_catalog to service_role;

commit;
