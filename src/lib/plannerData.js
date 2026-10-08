import { supabase } from './supabase'
import { stateToPayload } from './plannerModel'

export async function replacePlan(eventYearId, state) {
  const { error } = await supabase.rpc('planner_replace', {
    p_event_year_id: eventYearId,
    p_plan: stateToPayload(state),
  })
  if (error) throw error
}

// Returns { plan, missing } — missing=true when migration 003 hasn't been run.
export async function fetchPlan(eventYearId) {
  const [s, bars, drinks, inv] = await Promise.all([
    supabase.from('planner_settings').select('*').eq('event_year_id', eventYearId).maybeSingle(),
    supabase.from('planner_bars').select('*, planner_assignments(*)').eq('event_year_id', eventYearId),
    supabase.from('planner_drinks').select('*').eq('event_year_id', eventYearId),
    supabase.from('planner_inventory').select('*').eq('event_year_id', eventYearId),
  ])
  const err = s.error || bars.error || drinks.error || inv.error
  if (err) {
    if (/planner_|does not exist|schema cache/i.test(err.message)) return { plan: null, missing: true }
    throw err
  }
  if (!s.data) return { plan: null, missing: false }
  const assignments = []
  const barRows = (bars.data ?? []).map(({ planner_assignments: as, ...b }) => {
    assignments.push(...(as ?? []))
    return b
  })
  return {
    plan: { settings: s.data, bars: barRows, drinks: drinks.data ?? [], assignments, inventory: inv.data ?? [] },
    missing: false,
  }
}
