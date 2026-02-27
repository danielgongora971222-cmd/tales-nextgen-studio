-- 2026-02-23_kling_elements_preview_path_nullable.sql
-- Alinear staging/prod con el schema del repo: preview_path debe permitir NULL
-- (video_refer no necesita preview_path y el worker puede setearlo a NULL en cleanup).

alter table public.kling_elements
  alter column preview_path drop not null;

-- Verificación rápida (opcional)
-- select column_name, is_nullable
-- from information_schema.columns
-- where table_schema='public' and table_name='kling_elements' and column_name='preview_path';