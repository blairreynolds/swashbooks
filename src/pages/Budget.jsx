import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/AppContext'
import { money } from '../lib/format'
import { ConfirmButton } from './planner/widgets'

const NOT_ALLOWED = 'Only admins can change budget lines until the database update (migration 004) has been applied.'
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase()

export default function Budget() {
  const { activeYear, eventYears, categories, isAdmin, refreshCore } = useApp()
  const [amounts, setAmounts] = useState({}) // category_id -> string
  const [saved, setSaved] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [adding, setAdding] = useState(null) // { type, name }
  const [editing, setEditing] = useState(null) // { id, name }

  async function load() {
    if (!activeYear) return
    const { data } = await supabase.from('budgets').select('category_id, amount').eq('event_year_id', activeYear.id)
    const map = Object.fromEntries((data ?? []).map((b) => [b.category_id, String(b.amount)]))
    setAmounts(map)
    setSaved(map)
    setMsg(null)
  }
  // Keyed on the id, not the object: adding or renaming a line refreshes the
  // year list, and reloading then would discard amounts typed but not yet saved.
  useEffect(() => { load() }, [activeYear?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      const rows = Object.entries(amounts)
        .filter(([, v]) => v !== '' && Number(v) >= 0)
        .map(([category_id, v]) => ({ event_year_id: activeYear.id, category_id, amount: Number(v) }))
      const { error } = await supabase.from('budgets').upsert(rows, { onConflict: 'event_year_id,category_id' })
      if (error) throw error
      const cleared = Object.keys(saved).filter((cid) => !amounts[cid] || amounts[cid] === '')
      if (cleared.length) {
        await supabase.from('budgets').delete().eq('event_year_id', activeYear.id).in('category_id', cleared)
      }
      setMsg({ ok: true, text: 'Budget saved.' })
      load()
    } catch (e) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  async function copyPrevious() {
    const idx = eventYears.findIndex((y) => y.id === activeYear.id)
    const prev = eventYears[idx + 1] // sorted newest-first
    if (!prev) { setMsg({ ok: false, text: 'No earlier event year to copy from.' }); return }
    const { data } = await supabase.from('budgets').select('category_id, amount').eq('event_year_id', prev.id)
    if (!data?.length) { setMsg({ ok: false, text: `${prev.label} has no budget lines.` }); return }
    setAmounts({ ...amounts, ...Object.fromEntries(data.map((b) => [b.category_id, String(b.amount)])) })
    setMsg({ ok: true, text: `Copied ${data.length} lines from ${prev.label} — review and Save.` })
  }

  // Line names are unique per type in the database (case-sensitive, and hidden
  // lines still count); catch clashes here with a clearer message.
  function nameProblem(name, type, exceptId) {
    if (!name.trim()) return 'Give the line a name.'
    const clash = categories.find((c) => c.type === type && c.id !== exceptId && sameName(c.name, name))
    if (!clash) return null
    if (!clash.archived) return `There's already a line called "${clash.name}".`
    return `"${clash.name}" already exists but is hidden — ${isAdmin ? 'restore it in Settings → Categories.' : 'ask an admin to restore it.'}`
  }

  async function addLine(e) {
    e.preventDefault()
    const { type } = adding
    const name = adding.name.trim()
    const problem = nameProblem(name, type)
    if (problem) { setMsg({ ok: false, text: problem }); return }
    const sort = Math.max(0, ...categories.filter((c) => c.type === type).map((c) => c.sort_order ?? 0)) + 1
    const { data, error } = await supabase.from('categories').insert({ name, type, sort_order: sort }).select('id').single()
    if (error) {
      setMsg({ ok: false, text: /row-level security/i.test(error.message) ? NOT_ALLOWED : error.message })
      return
    }
    setAdding(null)
    await refreshCore()
    setMsg({ ok: true, text: `Added "${name}" — enter an amount, then Save budget.` })
    setTimeout(() => document.getElementById(`budget-amt-${data.id}`)?.focus(), 50)
  }

  async function renameLine(e) {
    e.preventDefault()
    const cat = categories.find((c) => c.id === editing.id)
    const name = editing.name.trim()
    if (!cat || name === cat.name) { setEditing(null); return }
    const problem = nameProblem(name, cat.type, cat.id)
    if (problem) { setMsg({ ok: false, text: problem }); return }
    const { data, error } = await supabase.from('categories').update({ name }).eq('id', cat.id).select('id')
    if (error) { setMsg({ ok: false, text: error.message }); return }
    // Without permission the update matches no rows rather than erroring.
    if (!data?.length) { setMsg({ ok: false, text: NOT_ALLOWED }); return }
    setEditing(null)
    await refreshCore()
    setMsg({ ok: true, text: `Renamed "${cat.name}" to "${name}" everywhere it's used.` })
  }

  async function hideLine(cat) {
    const { data, error } = await supabase.from('categories').update({ archived: true }).eq('id', cat.id).select('id')
    if (error || !data?.length) { setMsg({ ok: false, text: error?.message ?? NOT_ALLOWED }); return }
    await refreshCore()
    setMsg({ ok: true, text: `"${cat.name}" hidden — restore it any time in Settings → Categories.` })
  }

  if (!activeYear) return <div className="card text-faint text-sm">Create an event year first (Settings).</div>

  const dirty = JSON.stringify(amounts) !== JSON.stringify(saved)
  const section = (type, title) => {
    const cats = categories.filter((c) => c.type === type && !c.archived)
    const total = cats.reduce((s, c) => s + (Number(amounts[c.id]) || 0), 0)
    const isAdding = adding?.type === type
    return (
      <div className="card">
        <div className="section-title mb-3">{title}</div>
        <table className="tbl">
          <tbody>
            {cats.map((c) => (
              <tr key={c.id}>
                <td>
                  {editing?.id === c.id ? (
                    <form onSubmit={renameLine} className="flex gap-2 items-center">
                      <input
                        className="input"
                        autoFocus
                        value={editing.name}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null) }}
                      />
                      <button className="btn btn-sm btn-primary">Save</button>
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                    </form>
                  ) : (
                    <div className="flex gap-2 items-center justify-between">
                      <span>{c.name}</span>
                      <span className="flex gap-1 whitespace-nowrap">
                        <button
                          type="button"
                          className="btn btn-sm"
                          title="Rename this line everywhere it's used (transactions, bills, all years)"
                          onClick={() => { setEditing({ id: c.id, name: c.name }); setAdding(null) }}
                        >rename</button>
                        {isAdmin && <ConfirmButton onConfirm={() => hideLine(c)} prompt="Hide this line?">hide</ConfirmButton>}
                      </span>
                    </div>
                  )}
                </td>
                <td className="td-num w-44">
                  <input
                    id={`budget-amt-${c.id}`}
                    className="input !w-36 text-right font-mono"
                    type="number" step="0.01" min="0" placeholder="—"
                    value={amounts[c.id] ?? ''}
                    onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })}
                  />
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={2}>
                {isAdding ? (
                  <form onSubmit={addLine} className="flex gap-2 items-center">
                    <input
                      className="input"
                      autoFocus
                      placeholder={type === 'expense' ? 'New expense line, e.g. Photo Booth' : 'New income line, e.g. Raffle'}
                      value={adding.name}
                      onChange={(e) => setAdding({ ...adding, name: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Escape') setAdding(null) }}
                    />
                    <button className="btn btn-sm btn-primary">Add</button>
                    <button type="button" className="btn btn-sm" onClick={() => setAdding(null)}>Cancel</button>
                  </form>
                ) : (
                  <button type="button" className="btn btn-sm" onClick={() => { setAdding({ type, name: '' }); setEditing(null) }}>
                    + Add line
                  </button>
                )}
              </td>
            </tr>
            <tr>
              <td className="font-semibold text-muted">Total</td>
              <td className="td-num font-semibold">{money(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="section-title">Budget — {activeYear.label}</div>
        <div className="flex gap-2 items-center flex-wrap">
          {msg && <span className={`text-sm ${msg.ok ? 'text-grn' : 'text-coral'}`}>{msg.text}</span>}
          <button className="btn" onClick={copyPrevious}>Copy from previous year</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>Save budget</button>
        </div>
      </div>
      <p className="text-faint text-xs -mt-2">
        Lines are the same categories used by Transactions and Bills, shared across every event year.
        Adding or renaming a line takes effect right away; amounts are saved with Save budget.
      </p>
      <div className="grid lg:grid-cols-2 gap-5">
        {section('expense', 'Expense budgets')}
        {section('income', 'Income targets')}
      </div>
    </>
  )
}
