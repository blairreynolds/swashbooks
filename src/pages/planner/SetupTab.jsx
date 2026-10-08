import { useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/AppContext'
import { fmtDate, fmtInt } from '../../lib/format'
import { SOURCES, getTotalServings, getActiveCocktails, getServingsPerCocktail, calcTotalMixOz } from '../../lib/plannerCalc'
import { replacePlan } from '../../lib/plannerData'
import { Field, NumField, ConfirmButton, SourceBadge } from './widgets'

const SOURCE_NOTES = {
  beam: 'Sponsored spirits — order list sent ahead',
  rd: 'Juices, mixers, supplies, garnish',
  you: 'BG Reynolds syrups, specialty items',
  nick: 'Nick supplies — non-Beam liquor, grocery',
  sponsor: 'Ginger Cult, Just Rum, etc.',
}

function Stat({ label, value, sub }) {
  return (
    <div className="card">
      <div className="text-faint text-xs uppercase tracking-[0.08em] font-semibold">{label}</div>
      <div className="font-mono text-2xl mt-1 text-gold">{value}</div>
      {sub && <div className="text-faint text-xs">{sub}</div>}
    </div>
  )
}

function exportPlanJSON(state, yearLabel) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `swashball-plan-${yearLabel.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export default function SetupTab({ store, state }) {
  const { activeYear, isAdmin } = useApp()
  const fileRef = useRef(null)
  const s = store.plan.settings
  const set = (patch) => store.update('planner_settings', s.event_year_id, patch)

  const cocktails = getActiveCocktails(state)

  async function onReplace(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      if (!confirm(`Replace the entire ${activeYear.label} plan with "${file.name}"? Every crew member's current bars, drinks, and inventory for this year will be overwritten.`)) return
      await store.flushAll()
      await replacePlan(activeYear.id, parsed)
      await store.load()
    } catch (err) {
      alert(`Import failed: ${err.message}`)
    }
  }

  async function clearPlan() {
    await store.flushAll()
    const { error } = await supabase.rpc('planner_clear', { p_event_year_id: activeYear.id })
    if (error) alert(error.message)
    else store.load()
  }

  return (
    <>
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card flex flex-col gap-3">
          <div className="section-title">Event</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-faint text-xs">Event year</div>
              <div>{activeYear.label}</div>
            </div>
            <div>
              <div className="text-faint text-xs">Event date</div>
              <div className="font-mono text-sm">{fmtDate(activeYear.event_date)}</div>
            </div>
            <Field label="Expected attendees">
              <NumField value={s.attendees} min="1" step="1" onChange={(v) => set({ attendees: Math.round(v) })} />
            </Field>
            <Field label="Avg drinks per person">
              <NumField value={s.drinks_per} min="0" step="0.5" onChange={(v) => set({ drinks_per: v })} />
            </Field>
          </div>
          <p className="text-faint text-xs">Name and date come from the event year{isAdmin ? ' (Settings → Event years)' : ''}.</p>
        </div>

        <div className="card flex flex-col gap-2">
          <div className="section-title mb-1">Supply source key</div>
          {Object.keys(SOURCES).map((k) => (
            <div key={k} className="flex items-center gap-2 text-sm">
              <SourceBadge source={k} />
              <span className="text-muted">{SOURCE_NOTES[k]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card flex flex-col gap-3">
          <div className="section-title">Container sizes (oz)</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Stor'n Pour"><NumField value={s.snp_oz} min="1" onChange={(v) => v > 0 && set({ snp_oz: v })} /></Field>
            <Field label="Backup gallon"><NumField value={s.gal_oz} min="1" onChange={(v) => v > 0 && set({ gal_oz: v })} /></Field>
            <Field label="Bucket"><NumField value={s.bucket_oz} min="1" onChange={(v) => v > 0 && set({ bucket_oz: v })} /></Field>
            <Field label="Std bottle"><NumField value={s.bottle_oz} min="1" step="0.1" onChange={(v) => v > 0 && set({ bottle_oz: v })} /></Field>
          </div>
        </div>
        <div className="card flex flex-col gap-3">
          <div className="section-title">Overage buffer (%)</div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Spirits"><NumField value={s.overage_spirits} min="0" max="50" onChange={(v) => set({ overage_spirits: v })} /></Field>
            <Field label="Mixer / juice"><NumField value={s.overage_mix} min="0" max="50" onChange={(v) => set({ overage_mix: v })} /></Field>
            <Field label="Garnish"><NumField value={s.overage_garnish} min="0" max="50" onChange={(v) => set({ overage_garnish: v })} /></Field>
          </div>
          <p className="text-faint text-xs">Spirits % applies to Beam-Suntory and Bar Manager items; mixer % to everything else.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Stat label="Total servings" value={fmtInt(getTotalServings(state))} />
        <Stat label="Active cocktails" value={cocktails.length} />
        <Stat label="Bars" value={state.bars.length} />
        <Stat label="Per cocktail" value={fmtInt(getServingsPerCocktail(state))} sub="servings each" />
        <Stat label="Total mix volume" value={fmtInt(calcTotalMixOz(state))} sub="oz pre-batch" />
      </div>

      <div className="card flex flex-col gap-3 print:hidden">
        <div className="section-title">Plan data</div>
        <div className="flex gap-2 flex-wrap items-center">
          <button className="btn" onClick={() => exportPlanJSON(state, activeYear.label)}>Export JSON backup</button>
          {isAdmin && (
            <>
              <button className="btn" onClick={() => fileRef.current?.click()}>Replace from JSON…</button>
              <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onReplace} />
              <ConfirmButton onConfirm={clearPlan} prompt={`Delete the whole ${activeYear.label} plan?`}>Clear plan</ConfirmButton>
            </>
          )}
        </div>
        <p className="text-faint text-xs">
          The export uses the standalone planner's format, so it works as a backup and can be re-imported here.
          {isAdmin && ' Replacing or clearing affects every crew member — export a backup first.'}
        </p>
      </div>
    </>
  )
}
