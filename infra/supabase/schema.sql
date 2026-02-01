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
-- Assets (images/videos)
-- =========================
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('image','video')),
  tool text not null,
  title text,
  prompt text,
  model text,
  storage_key text not null,
  public_url text not null,
  bytes bigint,
  width integer,
  height integer,
  created_at timestamptz not null default now()
);

create index if not exists assets_owner_id_idx on public.assets(owner_id);

alter table public.assets enable row level security;

create policy if not exists "assets_select_own" on public.assets
  for select using (auth.uid() = owner_id);

create policy if not exists "assets_insert_own" on public.assets
  for insert with check (auth.uid() = owner_id);

create policy if not exists "assets_update_own" on public.assets
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy if not exists "assets_delete_own" on public.assets
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_owner_id_idx on public.jobs(owner_id);
create index if not exists jobs_status_idx on public.jobs(status);

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
