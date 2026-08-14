-- Import mapping presets for the CSV importer (Phase 3).
-- Run in the Supabase SQL editor. The importer works without this table;
-- only the "save preset" feature needs it.

create table public.import_presets (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  target text not null check (target in ('transactions', 'contacts', 'in_kind_donations')),
  mapping jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.import_presets enable row level security;

create policy "import_presets all" on public.import_presets
  for all to authenticated using (true) with check (true);
