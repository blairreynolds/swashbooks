-- Event planner (bar program): settings, bars, drinks, per-bar drink
-- assignments, and inventory, all scoped to an event year.
-- Run in the Supabase SQL editor.

create table public.planner_settings (
  event_year_id uuid primary key references public.event_years (id) on delete restrict,
  attendees int not null default 700,
  drinks_per numeric(6,2) not null default 2,
  snp_oz numeric(8,2) not null default 128,
  gal_oz numeric(8,2) not null default 128,
  bucket_oz numeric(8,2) not null default 512,
  bottle_oz numeric(8,2) not null default 25.4,
  overage_spirits numeric(5,2) not null default 10,
  overage_mix numeric(5,2) not null default 15,
  overage_garnish numeric(5,2) not null default 20
);

create table public.planner_bars (
  id uuid primary key default gen_random_uuid(),
  event_year_id uuid not null references public.event_years (id) on delete restrict,
  name text not null default '',
  location text,
  shift1 text,
  shift2 text,
  equipment text[] not null default '{}',
  notes text,
  volume_weight numeric(4,2) not null default 1,
  sort_order int not null default 0
);
create index on public.planner_bars (event_year_id);

create table public.planner_drinks (
  id uuid primary key default gen_random_uuid(),
  event_year_id uuid not null references public.event_years (id) on delete restrict,
  type text not null default 'cocktail' check (type in ('cocktail', 'beer', 'na')),
  name text not null default '',
  active boolean not null default true,
  serving_oz numeric(6,2) not null default 5,
  description text,
  garnish text,
  notes text,
  -- [{ name, oz, source }] — always edited together with the drink
  ingredients jsonb not null default '[]',
  sort_order int not null default 0
);
create index on public.planner_drinks (event_year_id);

create table public.planner_assignments (
  id uuid primary key default gen_random_uuid(),
  bar_id uuid not null references public.planner_bars (id) on delete cascade,
  -- null while the crew member is still picking a drink
  drink_id uuid references public.planner_drinks (id) on delete cascade,
  vessel text not null default 'snp',
  override_servings numeric(8,2) not null default 0,
  sort_order int not null default 0
);
create index on public.planner_assignments (bar_id);

create table public.planner_inventory (
  id uuid primary key default gen_random_uuid(),
  event_year_id uuid not null references public.event_years (id) on delete restrict,
  name text not null default '',
  source text not null default 'you',
  in_hand numeric(10,2) not null default 0,
  unit text not null default 'bottles',
  notes text,
  sort_order int not null default 0
);
create index on public.planner_inventory (event_year_id);

-- Planning data, not financial records: all crew may create, edit, and delete.
alter table public.planner_settings enable row level security;
alter table public.planner_bars enable row level security;
alter table public.planner_drinks enable row level security;
alter table public.planner_assignments enable row level security;
alter table public.planner_inventory enable row level security;

do $$
declare t text;
begin
  foreach t in array array['planner_settings', 'planner_bars', 'planner_drinks', 'planner_assignments', 'planner_inventory'] loop
    execute format('create policy "%1$s all" on public.%1$I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Replace an event year's whole plan in one transaction (seed, copy from a
-- previous year, or import the standalone planner's JSON export). The client
-- supplies fresh UUIDs with assignments already remapped to them.
create or replace function public.planner_replace(p_event_year_id uuid, p_plan jsonb)
returns void
language plpgsql security invoker set search_path = public
as $$
begin
  delete from planner_bars where event_year_id = p_event_year_id;
  delete from planner_drinks where event_year_id = p_event_year_id;
  delete from planner_inventory where event_year_id = p_event_year_id;
  delete from planner_settings where event_year_id = p_event_year_id;

  insert into planner_settings (event_year_id, attendees, drinks_per, snp_oz, gal_oz, bucket_oz,
                                bottle_oz, overage_spirits, overage_mix, overage_garnish)
  select p_event_year_id, coalesce(s.attendees, 700), coalesce(s.drinks_per, 2), coalesce(s.snp_oz, 128),
         coalesce(s.gal_oz, 128), coalesce(s.bucket_oz, 512), coalesce(s.bottle_oz, 25.4),
         coalesce(s.overage_spirits, 10), coalesce(s.overage_mix, 15), coalesce(s.overage_garnish, 20)
  from jsonb_populate_record(null::planner_settings, coalesce(p_plan -> 'settings', '{}')) s;

  insert into planner_bars (id, event_year_id, name, location, shift1, shift2, equipment, notes, volume_weight, sort_order)
  select b.id, p_event_year_id, coalesce(b.name, ''), b.location, b.shift1, b.shift2,
         coalesce(b.equipment, '{}'), b.notes, coalesce(b.volume_weight, 1), coalesce(b.sort_order, 0)
  from jsonb_populate_recordset(null::planner_bars, coalesce(p_plan -> 'bars', '[]')) b;

  insert into planner_drinks (id, event_year_id, type, name, active, serving_oz, description, garnish, notes, ingredients, sort_order)
  select d.id, p_event_year_id, coalesce(d.type, 'cocktail'), coalesce(d.name, ''), coalesce(d.active, true),
         coalesce(d.serving_oz, 5), d.description, d.garnish, d.notes, coalesce(d.ingredients, '[]'), coalesce(d.sort_order, 0)
  from jsonb_populate_recordset(null::planner_drinks, coalesce(p_plan -> 'drinks', '[]')) d;

  insert into planner_assignments (id, bar_id, drink_id, vessel, override_servings, sort_order)
  select a.id, a.bar_id, a.drink_id, coalesce(a.vessel, 'snp'), coalesce(a.override_servings, 0), coalesce(a.sort_order, 0)
  from jsonb_populate_recordset(null::planner_assignments, coalesce(p_plan -> 'assignments', '[]')) a;

  insert into planner_inventory (id, event_year_id, name, source, in_hand, unit, notes, sort_order)
  select i.id, p_event_year_id, coalesce(i.name, ''), coalesce(i.source, 'you'), coalesce(i.in_hand, 0),
         coalesce(i.unit, 'bottles'), i.notes, coalesce(i.sort_order, 0)
  from jsonb_populate_recordset(null::planner_inventory, coalesce(p_plan -> 'inventory', '[]')) i;
end
$$;

-- Clear an event year's plan (used before deleting the year).
create or replace function public.planner_clear(p_event_year_id uuid)
returns void
language sql security invoker set search_path = public
as $$
  delete from planner_bars where event_year_id = p_event_year_id;
  delete from planner_drinks where event_year_id = p_event_year_id;
  delete from planner_inventory where event_year_id = p_event_year_id;
  delete from planner_settings where event_year_id = p_event_year_id;
$$;
