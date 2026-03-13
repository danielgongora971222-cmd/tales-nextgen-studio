-- Hotfix: observabilidad de workers + refresh de schema cache de PostgREST

create table if not exists public.worker_heartbeats (
  worker_id text primary key,
  kind text not null,
  updated_at timestamptz not null default now()
);

create index if not exists worker_heartbeats_kind_updated_idx
  on public.worker_heartbeats(kind, updated_at desc);

alter table public.worker_heartbeats enable row level security;

-- service_role bypassa RLS; no agregamos policies públicas

NOTIFY pgrst, 'reload schema';
