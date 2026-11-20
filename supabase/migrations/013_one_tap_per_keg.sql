-- A keg goes on one tap. Each keg Inventory row is one keg, so it can be on at
-- most one tap across all bars. Safe to run more than once.

-- Keep the first tap (bar order, then tap number) if any keg is on several.
delete from public.planner_taps t
using (
  select t2.id, row_number() over (partition by t2.inventory_id order by b.sort_order, b.id, t2.tap_number) as rn
  from public.planner_taps t2 join public.planner_bars b on b.id = t2.bar_id
  where t2.inventory_id is not null
) d
where d.id = t.id and d.rn > 1;

create unique index if not exists planner_taps_one_tap_per_keg
  on public.planner_taps (inventory_id) where inventory_id is not null;

-- planner_replace: same as 012, but a keg listed on several taps (an old JSON
-- export, say) keeps only its first tap instead of failing the whole save.
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
  select id, bar_id, tap_number, inventory_id from (
    select t.id, t.bar_id, t.tap_number, t.inventory_id,
           row_number() over (partition by t.inventory_id order by b.sort_order, b.id, t.tap_number) as rn
    from jsonb_populate_recordset(null::planner_taps, coalesce(p_plan -> 'taps', '[]')) t
    join planner_bars b on b.id = t.bar_id and t.tap_number between 1 and b.tap_count
  ) x
  where inventory_id is null or rn = 1;
end
$$;
