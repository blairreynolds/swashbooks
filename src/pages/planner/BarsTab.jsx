import { EQUIPMENT_OPTIONS, VESSELS, calcServingsAtBar } from '../../lib/plannerCalc'
import { Field, NumField, ConfirmButton, JumpChips } from './widgets'

const VOLUMES = [
  { weight: 1.5, label: 'Heavy', hint: '1.5×', color: '#e8a020', active: (w) => w >= 1.4 },
  { weight: 1.0, label: 'Standard', hint: '1×', color: '#3d8c5e', active: (w) => w >= 0.9 && w < 1.4 },
  { weight: 0.75, label: 'Light', hint: '0.75×', color: '#5ba0d0', active: (w) => w < 0.9 },
]

function AssignmentRow({ a, bar, drinks, state, store }) {
  const set = (patch) => store.update('planner_assignments', a.id, patch)
  const calc = a.drink_id ? Math.round(calcServingsAtBar(state, a.drink_id, bar.id)) : 0
  const overridden = Number(a.override_servings) > 0
  return (
    <div className="grid grid-cols-[1fr_84px_120px_90px_32px] gap-2 items-center">
      <select className="input" value={a.drink_id ?? ''} onChange={(e) => set({ drink_id: e.target.value || null })}>
        <option value="">— Select drink —</option>
        {drinks.map((d) => (
          <option key={d.id} value={d.id}>{d.name || '(unnamed)'}{d.active ? '' : ' (inactive)'}</option>
        ))}
      </select>
      <div className="font-mono text-xs text-muted text-right" title={overridden ? 'Overridden' : 'Auto-calculated'}>
        {a.drink_id ? `${overridden ? '✏️ ' : '≈'}${overridden ? Number(a.override_servings) : calc} srv` : '—'}
      </div>
      <select className="input" value={a.vessel} onChange={(e) => set({ vessel: e.target.value })}>
        {Object.entries(VESSELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <NumField
        value={a.override_servings}
        blankZero
        min="0"
        placeholder="override"
        title="Override servings (leave blank for auto)"
        className="text-right"
        onChange={(v) => set({ override_servings: Math.max(0, v) })}
      />
      <button type="button" className="btn btn-sm btn-danger" title="Remove assignment" onClick={() => store.remove('planner_assignments', a.id)}>×</button>
    </div>
  )
}

function BarCard({ bar, assignments, drinks, state, store }) {
  const set = (patch) => store.update('planner_bars', bar.id, patch)
  const weight = Number(bar.volume_weight) || 1
  const equipment = bar.equipment ?? []
  const allEquipment = [...EQUIPMENT_OPTIONS, ...equipment.filter((e) => !EQUIPMENT_OPTIONS.includes(e))]

  function toggleEquipment(eq) {
    set({ equipment: equipment.includes(eq) ? equipment.filter((e) => e !== eq) : [...equipment, eq] })
  }

  function addAssignment() {
    const sort = Math.max(-1, ...assignments.map((a) => a.sort_order ?? 0)) + 1
    store.insert('planner_assignments', { bar_id: bar.id, drink_id: null, vessel: 'snp', override_servings: 0, sort_order: sort })
  }

  return (
    <div id={`bar-${bar.id}`} className="card flex flex-col gap-3 scroll-mt-20">
      <div className="flex items-center gap-3 flex-wrap">
        <input
          className="input font-display !text-lg !w-auto flex-1 min-w-48"
          value={bar.name}
          placeholder="Bar name"
          onChange={(e) => set({ name: e.target.value })}
        />
        <button type="button" className="btn btn-sm" onClick={addAssignment}>+ Assign drink</button>
        <ConfirmButton onConfirm={() => store.remove('planner_bars', bar.id)}>Remove bar</ConfirmButton>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <Field label="Location">
          <input className="input" value={bar.location ?? ''} placeholder="Room / area" onChange={(e) => set({ location: e.target.value })} />
        </Field>
        <Field label="Shift 1 (4–9pm)">
          <input className="input" value={bar.shift1 ?? ''} onChange={(e) => set({ shift1: e.target.value })} />
        </Field>
        <Field label="Shift 2 (9pm–1am)">
          <input className="input" value={bar.shift2 ?? ''} onChange={(e) => set({ shift2: e.target.value })} />
        </Field>
      </div>

      <div>
        <div className="text-faint text-xs mb-1">Bar volume</div>
        <div className="flex gap-1">
          {VOLUMES.map((v) => {
            const on = v.active(weight)
            return (
              <button
                key={v.label}
                type="button"
                className="btn btn-sm"
                style={on ? { background: `${v.color}26`, borderColor: `${v.color}66`, color: v.color } : undefined}
                onClick={() => set({ volume_weight: v.weight })}
              >
                {v.label} <span className="opacity-70 text-xs">{v.hint}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <div className="text-faint text-xs mb-1">Equipment</div>
        <div className="flex gap-1.5 flex-wrap">
          {allEquipment.map((eq) => {
            const on = equipment.includes(eq)
            return (
              <button
                key={eq}
                type="button"
                className={`chip cursor-pointer border ${on ? 'chip-gold border-gold/40' : 'chip-muted border-transparent'}`}
                onClick={() => toggleEquipment(eq)}
              >
                {on ? '✓ ' : ''}{eq}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-faint text-xs">Drink assignments</div>
        {assignments.length > 0 && (
          <div className="grid grid-cols-[1fr_84px_120px_90px_32px] gap-2 text-[10px] uppercase tracking-wider text-faint">
            <span>Drink</span><span className="text-right">Auto-calc</span><span>Vessel</span><span>Override</span><span />
          </div>
        )}
        {assignments.map((a) => (
          <AssignmentRow key={a.id} a={a} bar={bar} drinks={drinks} state={state} store={store} />
        ))}
        {!assignments.length && <div className="text-faint text-sm">No drinks assigned yet.</div>}
      </div>

      <Field label="Notes">
        <input className="input" value={bar.notes ?? ''} placeholder="Setup notes, special instructions…" onChange={(e) => set({ notes: e.target.value })} />
      </Field>
    </div>
  )
}

export default function BarsTab({ store, state }) {
  const { plan } = store
  const bySort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  const bars = [...plan.bars].sort(bySort)
  const drinks = [...plan.drinks].sort(bySort)

  async function addBar() {
    const sort = Math.max(-1, ...plan.bars.map((b) => b.sort_order ?? 0)) + 1
    const row = await store.insert('planner_bars', {
      event_year_id: plan.settings.event_year_id, name: 'New Bar', location: '', shift1: '', shift2: '',
      equipment: [], notes: '', volume_weight: 1, sort_order: sort,
    })
    setTimeout(() => document.getElementById(`bar-${row.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-faint text-sm">Each bar's equipment, staff, volume, and drink assignments. Servings split across bars by volume weight.</p>
        <button className="btn btn-primary print:hidden" onClick={addBar}>+ Add bar</button>
      </div>
      <JumpChips items={bars} prefix="bar" />
      {bars.map((bar) => (
        <BarCard
          key={bar.id}
          bar={bar}
          assignments={plan.assignments.filter((a) => a.bar_id === bar.id).sort(bySort)}
          drinks={drinks}
          state={state}
          store={store}
        />
      ))}
      {!bars.length && <div className="card text-faint text-sm text-center py-8">No bars yet.</div>}
    </>
  )
}
