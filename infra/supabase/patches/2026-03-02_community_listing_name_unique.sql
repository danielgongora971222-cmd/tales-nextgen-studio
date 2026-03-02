-- Add mandatory unique name to community_listings
alter table public.community_listings
  add column if not exists name text;

-- Backfill unique names for existing rows
update public.community_listings
set name = coalesce(nullif(btrim(name), ''), 'listing_' || substring(id::text, 1, 8))
where name is null or btrim(name) = '';

-- Enforce not-null and reasonable length
alter table public.community_listings
  alter column name set not null;

alter table public.community_listings
  drop constraint if exists community_listings_name_len;

alter table public.community_listings
  add constraint community_listings_name_len
  check (char_length(name) >= 3 and char_length(name) <= 80);

-- Case-insensitive uniqueness
create unique index if not exists community_listings_name_ci_uq
  on public.community_listings (lower(name));
