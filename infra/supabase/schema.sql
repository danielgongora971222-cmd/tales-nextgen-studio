-- Tales NextGen Studio - Supabase starter schema
-- Run in Supabase SQL Editor.

-- =========================
-- Profiles (optional)
-- =========================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy if not exists "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy if not exists "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

create policy if not exists "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Auto-create a profile when a new user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username)
  values (new.id, null)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =========================
-- Assets (images/videos)  ✅ ALINEADO con el backend actual
-- =========================
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,

  -- backend usa "type"
  type text not null check (type in ('image','video')),

  tool text,
  name text,
  prompt text,

  -- storage (backend usa "storage_path")
  storage_path text not null unique,

  -- privacidad (backend usa "is_public")
  is_public boolean not null default false,

  -- opcional: cache de URL (backend la lee como "url", puede ser null)
  url text,

  -- metadatos libres (backend usa "meta")
  meta jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists assets_owner_created_at_idx
  on public.assets(owner_id, created_at desc);

create index if not exists assets_public_created_at_idx
  on public.assets(created_at desc)
  where is_public = true;

alter table public.assets enable row level security;

-- Leer: dueño o público
create policy if not exists "assets_select_owner_or_public" on public.assets
  for select using (auth.uid() = owner_id OR is_public = true);

-- Insertar: solo dueño
create policy if not exists "assets_insert_own" on public.assets
  for insert with check (auth.uid() = owner_id);

-- Update/Delete: solo dueño
create policy if not exists "assets_update_own" on public.assets
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy if not exists "assets_delete_own" on public.assets
  for delete using (auth.uid() = owner_id);

-- =========================
-- Kling Elements (Element Library) ✅ requerido por /api/kling/elements
-- =========================
create table if not exists public.kling_elements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,

  name text not null,
  kling_element_id text not null,

  preview_path text,
  image_paths text[] not null default '{}'::text[],

  created_at timestamptz not null default now()
);

create index if not exists kling_elements_owner_created_at_idx
  on public.kling_elements(owner_id, created_at desc);

alter table public.kling_elements enable row level security;

create policy if not exists "kling_elements_select_own" on public.kling_elements
  for select using (auth.uid() = owner_id);

create policy if not exists "kling_elements_insert_own" on public.kling_elements
  for insert with check (auth.uid() = owner_id);

create policy if not exists "kling_elements_update_own" on public.kling_elements
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy if not exists "kling_elements_delete_own" on public.kling_elements
  for delete using (auth.uid() = owner_id);

-- =========================
-- Jobs (async generation)
-- =========================
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('image','restyle','faceswap','upscale','video')),
  status text not null check (status in ('queued','running','succeeded','failed')),
  params jsonb not null default '{}'::jsonb,
  result_asset_id uuid references public.assets(id) on delete set null,
  error text,
  locked_at timestamptz,
  locked_by text,
  next_check_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Worker-safe defaults / backfill (no rompe si ya existe)
alter table public.jobs alter column next_check_at set default now();
update public.jobs set next_check_at = now() where next_check_at is null;

create index if not exists jobs_owner_id_idx on public.jobs(owner_id);
create index if not exists jobs_status_idx on public.jobs(status);
create index if not exists jobs_kind_status_next_check_idx on public.jobs(kind, status, next_check_at);

-- Evita duplicados por requestId (Fal) a nivel DB
create unique index if not exists jobs_fal_request_unique
  on public.jobs((params->>'requestId'))
  where (params->>'provider') = 'fal';

-- Claim atomico para Background Workers (FOR UPDATE SKIP LOCKED)
create or replace function public.claim_jobs(
  p_kind text,
  p_limit int,
  p_worker_id text,
  p_lock_minutes int default 15
)
returns setof public.jobs
language sql
security definer
set search_path = public
as $$
  with cte as (
    select id
    from public.jobs
    where kind = p_kind
      and status = 'running'
      and result_asset_id is null
      and (next_check_at is null or next_check_at <= now())
      and (locked_at is null or locked_at < now() - (p_lock_minutes || ' minutes')::interval)
    order by created_at asc
    limit p_limit
    for update skip locked
  )
  update public.jobs j
  set locked_at = now(),
      locked_by = p_worker_id
  from cte
  where j.id = cte.id
  returning j.*;
$$;

grant execute on function public.claim_jobs(text, int, text, int) to service_role;


alter table public.jobs enable row level security;

create policy if not exists "jobs_select_own" on public.jobs
  for select using (auth.uid() = owner_id);

create policy if not exists "jobs_insert_own" on public.jobs
  for insert with check (auth.uid() = owner_id);

create policy if not exists "jobs_update_own" on public.jobs
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Convenience: keep updated_at current
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_jobs_updated_at on public.jobs;
create trigger set_jobs_updated_at
  before update on public.jobs
  for each row execute procedure public.set_updated_at();
