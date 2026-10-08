import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/AppContext'
import { usePlannerStore } from '../lib/usePlannerStore'
import { PLANNER_DEFAULTS, rowsToState } from '../lib/plannerModel'
import { fetchPlan, replacePlan } from '../lib/plannerData'
import SetupTab from './planner/SetupTab'
import BarsTab from './planner/BarsTab'
import DrinksTab from './planner/DrinksTab'
import InventoryTab from './planner/InventoryTab'
import OutputsTab from './planner/OutputsTab'

const TABS = [
  { key: 'setup', label: 'Setup', Component: SetupTab },
  { key: 'bars', label: 'Bars', Component: BarsTab },
  { key: 'drinks', label: 'Drinks', Component: DrinksTab },
  { key: 'inventory', label: 'Inventory', Component: InventoryTab },
  { key: 'outputs', label: 'Outputs', Component: OutputsTab },
]

function StartPlan({ onCreated }) {
  const { activeYear, eventYears } = useApp()
  const [sources, setSources] = useState([]) // other years that have a plan
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const fileRef = useRef(null)

  useEffect(() => {
    supabase.from('planner_settings').select('event_year_id').then(({ data }) => {
      const ids = new Set((data ?? []).map((r) => r.event_year_id))
      setSources(eventYears.filter((y) => y.id !== activeYear.id && ids.has(y.id)))
    })
  }, [activeYear, eventYears])

  async function create(getState) {
    setBusy(true)
    setErr(null)
    try {
      await replacePlan(activeYear.id, await getState())
      onCreated()
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  async function fromYear(y) {
    const { plan } = await fetchPlan(y.id)
    if (!plan) throw new Error(`${y.label} has no plan.`)
    return rowsToState(plan, y)
  }

  function onFile(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (file) create(async () => JSON.parse(await file.text()))
  }

  return (
    <div className="card flex flex-col gap-4 max-w-2xl">
      <div>
        <div className="section-title mb-1">No bar plan for {activeYear.label} yet</div>
        <p className="text-muted text-sm">Pick a starting point — everything is editable afterward, and the whole crew sees the same plan.</p>
      </div>
      <div className="flex flex-col gap-2">
        <button className="btn btn-primary text-left" disabled={busy} onClick={() => create(() => PLANNER_DEFAULTS)}>
          Start from the default template
          <span className="block text-xs opacity-80 font-normal">11 bars, 11 drinks, and 16 inventory items from the crew's planning spreadsheet</span>
        </button>
        {sources.map((y) => (
          <button key={y.id} className="btn text-left" disabled={busy} onClick={() => create(() => fromYear(y))}>
            Copy the {y.label} plan
            <span className="block text-xs text-faint font-normal">Bars, drinks, assignments, inventory, and settings</span>
          </button>
        ))}
        <button className="btn text-left" disabled={busy} onClick={() => fileRef.current?.click()}>
          Import a JSON export…
          <span className="block text-xs text-faint font-normal">From the standalone planner's "Export JSON" button, or a backup exported here</span>
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
      </div>
      {busy && <div className="text-faint text-sm">Creating plan…</div>}
      {err && <div className="text-coral text-sm">{err}</div>}
    </div>
  )
}

function SaveIndicator({ save, onReload }) {
  const text = {
    idle: null,
    pending: 'Unsaved…',
    saving: 'Saving…',
    saved: 'All changes saved',
    error: null,
  }[save.kind]
  return (
    <div className="flex items-center gap-3 text-sm print:hidden">
      {save.kind === 'error' ? (
        <span className="text-coral" title={save.message}>Save failed: {save.message}</span>
      ) : (
        text && <span className={save.kind === 'saved' ? 'text-grn' : 'text-amber'}>{text}</span>
      )}
      <button className="btn btn-sm" onClick={onReload} title="Load the crew's latest changes">Reload</button>
    </div>
  )
}

export default function Planner() {
  const { activeYear } = useApp()
  const store = usePlannerStore(activeYear?.id)
  const [tab, setTab] = useState('setup')
  const state = useMemo(
    () => (store.plan ? rowsToState(store.plan, activeYear) : null),
    [store.plan, activeYear],
  )

  if (!activeYear) return <div className="card text-faint text-sm">Create an event year first (Settings).</div>

  if (store.status === 'missing') {
    return (
      <div className="card text-sm">
        <div className="section-title mb-2">Planner tables not set up</div>
        <p className="text-muted">
          Run <code className="font-mono">supabase/migrations/003_planner.sql</code> in the Supabase SQL editor, then reload this page.
        </p>
      </div>
    )
  }
  if (store.status === 'error') {
    return (
      <div className="card text-sm flex flex-col gap-2 items-start">
        <div className="text-coral">Couldn't load the plan: {store.loadError}</div>
        <button className="btn" onClick={() => store.load()}>Try again</button>
      </div>
    )
  }
  if (store.status === 'loading' || (store.status === 'ready' && !state)) {
    return <div className="text-faint text-sm">Loading plan…</div>
  }
  if (store.status === 'empty') return <StartPlan onCreated={() => store.load()} />

  const Active = TABS.find((t) => t.key === tab).Component

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="section-title">Bar planner — {activeYear.label}</div>
        <SaveIndicator save={store.save} onReload={async () => { await store.flushAll(); store.load({ quiet: true }) }} />
      </div>
      <div className="flex gap-1 flex-wrap print:hidden">
        {TABS.map((t) => (
          <button key={t.key} className={`btn ${tab === t.key ? 'btn-primary' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <Active store={store} state={state} />
    </>
  )
}
