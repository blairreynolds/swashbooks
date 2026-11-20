-- Bar taps: how many taps a bar has, and which keg (a Planner Inventory item,
-- usually a donated one) is on each. Inventory items can name the sponsor who
-- donated them. Safe to run more than once.

alter table public.planner_bars add column if not exists tap_count int not null default 0;
do $$ begin
  alter table public.planner_bars add constraint planner_bars_tap_count check (tap_count between 0 and 30);
exception when duplicate_object then null;
end $$;

alter table public.planner_inventory add column if not exists sponsor_prospect_id uuid
  references public.sponsor_prospects (id) on delete set null;

-- One row per tap that has a keg on it; empty taps have no row.
create table if not exists public.planner_taps (
  id uuid primary key default gen_random_uuid(),
  bar_id uuid not null references public.planner_bars (id) on delete cascade,
  tap_number int not null check (tap_number >= 1),
  inventory_id uuid references public.planner_inventory (id) on delete set null,
  unique (bar_id, tap_number)
);
create index if not exists planner_taps_inventory on public.planner_taps (inventory_id);

alter table public.planner_taps enable row level security;
drop policy if exists "planner_taps all" on public.planner_taps;
create policy "planner_taps all" on public.planner_taps for all to authenticated
  using (public.has_tab('planner')) with check (public.has_tab('planner'));

-- planner_replace now carries tap counts, taps, and sponsor links (a link to a
-- prospect from another year is dropped, since copied prospects get new ids).
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

  insert into planner_bars (id, event_year_id, name, location, shift1, shift2, equipment, notes, volume_weight, sort_order, tap_count)
  select b.id, p_event_year_id, coalesce(b.name, ''), b.location, b.shift1, b.shift2,
         coalesce(b.equipment, '{}'), b.notes, coalesce(b.volume_weight, 1), coalesce(b.sort_order, 0),
         least(greatest(coalesce(b.tap_count, 0), 0), 30)
  from jsonb_populate_recordset(null::planner_bars, coalesce(p_plan -> 'bars', '[]')) b;

  insert into planner_drinks (id, event_year_id, type, name, active, serving_oz, description, garnish, notes, ingredients, sort_order)
  select d.id, p_event_year_id, coalesce(d.type, 'cocktail'), coalesce(d.name, ''), coalesce(d.active, true),
         coalesce(d.serving_oz, 5), d.description, d.garnish, d.notes, coalesce(d.ingredients, '[]'), coalesce(d.sort_order, 0)
  from jsonb_populate_recordset(null::planner_drinks, coalesce(p_plan -> 'drinks', '[]')) d;

  insert into planner_assignments (id, bar_id, drink_id, vessel, override_servings, sort_order)
  select a.id, a.bar_id, a.drink_id, coalesce(a.vessel, 'snp'), coalesce(a.override_servings, 0), coalesce(a.sort_order, 0)
  from jsonb_populate_recordset(null::planner_assignments, coalesce(p_plan -> 'assignments', '[]')) a;

  insert into planner_inventory (id, event_year_id, name, source, in_hand, unit, notes, sort_order, sponsor_prospect_id)
  select i.id, p_event_year_id, coalesce(i.name, ''), coalesce(i.source, 'you'), coalesce(i.in_hand, 0),
         coalesce(i.unit, 'bottles'), i.notes, coalesce(i.sort_order, 0),
         (select sp.id from sponsor_prospects sp where sp.id = i.sponsor_prospect_id and sp.event_year_id = p_event_year_id)
  from jsonb_populate_recordset(null::planner_inventory, coalesce(p_plan -> 'inventory', '[]')) i;

  insert into planner_taps (id, bar_id, tap_number, inventory_id)
  select t.id, t.bar_id, t.tap_number, t.inventory_id
  from jsonb_populate_recordset(null::planner_taps, coalesce(p_plan -> 'taps', '[]')) t
  join planner_bars b on b.id = t.bar_id and t.tap_number between 1 and b.tap_count;
end
$$;
