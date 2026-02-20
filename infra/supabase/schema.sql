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

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
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
drop policy if exists "assets_select_owner_or_public" on public.assets;
create policy "assets_select_owner_or_public" on public.assets
  for select using (auth.uid() = owner_id OR is_public = true);

-- Insertar: solo dueño
drop policy if exists "assets_insert_own" on public.assets;
create policy "assets_insert_own" on public.assets
  for insert with check (auth.uid() = owner_id);

-- Update/Delete: solo dueño
drop policy if exists "assets_update_own" on public.assets;
create policy "assets_update_own" on public.assets
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "assets_delete_own" on public.assets;
create policy "assets_delete_own" on public.assets
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

drop policy if exists "kling_elements_select_own" on public.kling_elements;
create policy "kling_elements_select_own" on public.kling_elements
  for select using (auth.uid() = owner_id);

drop policy if exists "kling_elements_insert_own" on public.kling_elements;
create policy "kling_elements_insert_own" on public.kling_elements
  for insert with check (auth.uid() = owner_id);

drop policy if exists "kling_elements_update_own" on public.kling_elements;
create policy "kling_elements_update_own" on public.kling_elements
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "kling_elements_delete_own" on public.kling_elements;
create policy "kling_elements_delete_own" on public.kling_elements
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

drop policy if exists "jobs_select_own" on public.jobs;
create policy "jobs_select_own" on public.jobs
  for select using (auth.uid() = owner_id);

drop policy if exists "jobs_insert_own" on public.jobs;
create policy "jobs_insert_own" on public.jobs
  for insert with check (auth.uid() = owner_id);

drop policy if exists "jobs_update_own" on public.jobs;
create policy "jobs_update_own" on public.jobs
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

drop trigger if exists set_jobs_updated_at on public.jobs;
create trigger set_jobs_updated_at
  before update on public.jobs
  for each row execute procedure public.set_updated_at();

-- =========================
-- Social: Likes + Comments ✅ (robusto para launch)
-- =========================

-- 1) Counters en assets (para feed rápido)
alter table public.assets
  add column if not exists likes_count integer not null default 0;

alter table public.assets
  add column if not exists comments_count integer not null default 0;

-- 2) Likes (unique por usuario+asset)
create table if not exists public.asset_likes (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(asset_id, user_id)
);

create index if not exists asset_likes_asset_id_idx on public.asset_likes(asset_id);
create index if not exists asset_likes_user_id_idx on public.asset_likes(user_id);

alter table public.asset_likes enable row level security;

drop policy if exists "asset_likes_select_asset_visible" on public.asset_likes;
create policy "asset_likes_select_asset_visible" on public.asset_likes
  for select using (
    exists (
      select 1 from public.assets a
      where a.id = asset_id and (a.is_public = true or a.owner_id = auth.uid())
    )
  );

drop policy if exists "asset_likes_insert_own" on public.asset_likes;
create policy "asset_likes_insert_own" on public.asset_likes
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.assets a
      where a.id = asset_id and (a.is_public = true or a.owner_id = auth.uid())
    )
  );

drop policy if exists "asset_likes_delete_own" on public.asset_likes;
create policy "asset_likes_delete_own" on public.asset_likes
  for delete using (auth.uid() = user_id);

-- 3) Comments (texto limitado, index por asset+fecha)
create table if not exists public.asset_comments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.asset_comments
  add column if not exists is_shadowed boolean not null default false;

create index if not exists asset_comments_asset_id_created_at_idx
  on public.asset_comments(asset_id, created_at desc);

create index if not exists asset_comments_visible_asset_id_created_at_idx
  on public.asset_comments(asset_id, created_at desc)
  where is_shadowed = false;

create index if not exists asset_comments_user_id_idx
  on public.asset_comments(user_id);

alter table public.asset_comments enable row level security;

drop policy if exists "asset_comments_select_asset_visible" on public.asset_comments;
create policy "asset_comments_select_asset_visible" on public.asset_comments
  for select using (
    exists (
      select 1 from public.assets a
      where a.id = asset_id and (a.is_public = true or a.owner_id = auth.uid())
    )
    and (is_shadowed = false or user_id = auth.uid())
  );
drop policy if exists "asset_comments_insert_own" on public.asset_comments;
create policy "asset_comments_insert_own" on public.asset_comments
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.assets a
      where a.id = asset_id and (a.is_public = true or a.owner_id = auth.uid())
    )
  );
drop policy if exists "asset_comments_delete_own" on public.asset_comments;
create policy "asset_comments_delete_own" on public.asset_comments
  for delete using (auth.uid() = user_id);

-- 4) Triggers: mantener likes_count / comments_count (sin recalcular en cada feed)
create or replace function public.assets_likes_count_inc()
returns trigger as $$
begin
  update public.assets
  set likes_count = likes_count + 1
  where id = new.asset_id;
  return new;
end;
$$ language plpgsql;

create or replace function public.assets_likes_count_dec()
returns trigger as $$
begin
  update public.assets
  set likes_count = greatest(likes_count - 1, 0)
  where id = old.asset_id;
  return old;
end;
$$ language plpgsql;

drop trigger if exists trg_assets_likes_inc on public.asset_likes;
create trigger trg_assets_likes_inc
  after insert on public.asset_likes
  for each row execute procedure public.assets_likes_count_inc();

drop trigger if exists trg_assets_likes_dec on public.asset_likes;
create trigger trg_assets_likes_dec
  after delete on public.asset_likes
  for each row execute procedure public.assets_likes_count_dec();

create or replace function public.assets_comments_count_inc()
returns trigger as $$
begin
  update public.assets
  set comments_count = comments_count + 1
  where id = new.asset_id;
  return new;
end;
$$ language plpgsql;

create or replace function public.assets_comments_count_dec()
returns trigger as $$
begin
  update public.assets
  set comments_count = greatest(comments_count - 1, 0)
  where id = old.asset_id;
  return old;
end;
$$ language plpgsql;

drop trigger if exists trg_assets_comments_inc on public.asset_comments;
create trigger trg_assets_comments_inc
  after insert on public.asset_comments
  for each row execute procedure public.assets_comments_count_inc();

drop trigger if exists trg_assets_comments_dec on public.asset_comments;
create trigger trg_assets_comments_dec
  after delete on public.asset_comments
  for each row execute procedure public.assets_comments_count_dec();

-- 5) Función: preview de comments para varios assets (solo server_role)
create or replace function public.get_asset_comments_preview(
  asset_ids uuid[],
  viewer_id uuid default null,
  per_asset int default 3
)
returns table (
  asset_id uuid,
  id uuid,
  user_id uuid,
  username text,
  text text,
  created_at timestamptz
)
language sql
stable
as $$
  select
    c.asset_id,
    c.id,
    c.user_id,
    coalesce(p.username, 'User_' || substr(c.user_id::text, 1, 4)) as username,
    c.text,
    c.created_at
  from (
    select
      ac.*,
      row_number() over (partition by ac.asset_id order by ac.created_at desc) as rn
    from public.asset_comments ac
    where ac.asset_id = any(asset_ids)
      and (
        ac.is_shadowed = false
        or (viewer_id is not null and ac.user_id = viewer_id)
      )
  ) c
  left join public.profiles p on p.id = c.user_id
  where c.rn <= greatest(per_asset, 1)
  order by c.asset_id, c.created_at desc;
$$;

grant execute on function public.get_asset_comments_preview(uuid[], uuid, int) to service_role;

-- =========================
-- Moderación básica (Shadow ban + Reportes)
-- =========================

create table if not exists public.user_moderation (
  user_id uuid primary key references auth.users(id) on delete cascade,
  shadow_banned boolean not null default false,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_moderation enable row level security;

drop trigger if exists set_user_moderation_updated_at on public.user_moderation;
create trigger set_user_moderation_updated_at
  before update on public.user_moderation
  for each row execute procedure public.set_updated_at();


create table if not exists public.comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.asset_comments(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now(),
  unique(comment_id, reporter_id)
);

create index if not exists comment_reports_comment_id_idx on public.comment_reports(comment_id);
create index if not exists comment_reports_reporter_id_idx on public.comment_reports(reporter_id);

alter table public.comment_reports enable row level security;

drop policy if exists "comment_reports_insert_own" on public.comment_reports;
create policy "comment_reports_insert_own" on public.comment_reports
  for insert with check (auth.uid() = reporter_id);

drop policy if exists "comment_reports_select_own" on public.comment_reports;
create policy "comment_reports_select_own" on public.comment_reports
  for select using (auth.uid() = reporter_id);
