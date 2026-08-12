import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/AppContext'
import { money } from '../lib/format'

export default function Budget() {
  const { activeYear, eventYears, categories } = useApp()
  const [amounts, setAmounts] = useState({}) // category_id -> string
  const [saved, setSaved] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  async function load() {
    if (!activeYear) return
    const { data } = await supabase.from('budgets').select('category_id, amount').eq('event_year_id', activeYear.id)
    const map = Object.fromEntries((data ?? []).map((b) => [b.category_id, String(b.amount)]))
    setAmounts(map)
    setSaved(map)
    setMsg(null)
  }
  useEffect(() => { load() }, [activeYear]) // eslint-disable-line react-hooks/exhaustive-deps

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

  if (!activeYear) return <div className="card text-faint text-sm">Create an event year first (Settings).</div>

  const dirty = JSON.stringify(amounts) !== JSON.stringify(saved)
  const section = (type, title) => {
    const cats = categories.filter((c) => c.type === type && !c.archived)
    const total = cats.reduce((s, c) => s + (Number(amounts[c.id]) || 0), 0)
    return (
      <div className="card">
        <div className="section-title mb-3">{title}</div>
        <table className="tbl">
          <tbody>
            {cats.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="td-num w-44">
                  <input
                    className="input !w-36 text-right font-mono"
                    type="number" step="0.01" min="0" placeholder="—"
                    value={amounts[c.id] ?? ''}
                    onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })}
                  />
                </td>
              </tr>
            ))}
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
        <div className="flex gap-2 items-center">
          {msg && <span className={`text-sm ${msg.ok ? 'text-grn' : 'text-coral'}`}>{msg.text}</span>}
          <button className="btn" onClick={copyPrevious}>Copy from previous year</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>Save budget</button>
        </div>
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        {section('expense', 'Expense budgets')}
        {section('income', 'Income targets')}
      </div>
    </>
  )
}
