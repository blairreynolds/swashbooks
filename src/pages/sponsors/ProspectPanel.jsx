import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/AppContext'
import { STAGES, CATEGORIES, TIERS, PRIORITIES, stageOf } from '../../lib/sponsors'
import { Field, ConfirmButton } from '../planner/widgets'
import Receipts from './Receipts'

const FIELDS = [
  'name', 'category', 'priority', 'status', 'tier', 'contact_name', 'contact_title', 'email', 'phone',
  'website', 'ask', 'cash_committed', 'cases_committed', 'next_step', 'follow_up', 'owner_id',
]
const REQUIRED = new Set(['name', 'category', 'priority', 'status'])
const DRAFT = { category: 'Rum', priority: 'medium', status: 'research' }

const toForm = (p) => Object.fromEntries(FIELDS.map((f) => [f, p?.[f] == null ? '' : String(p[f])]))

function toValue(field, text) {
  const t = text.trim()
  if (field === 'cash_committed') return t === '' ? null : Math.max(0, Number(t) || 0)
  if (field === 'cases_committed') return t === '' ? null : Math.max(0, Math.round(Number(t) || 0))
  if (REQUIRED.has(field)) return t
  return t === '' ? null : t
}

const when = (iso) => {
  try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
  catch { return iso }
}

export default function ProspectPanel({ prospect, activity, profiles, contacts, onClose, onSaved }) {
  const { activeYear, isAdmin, session } = useApp()
  const isNew = !prospect
  const [base, setBase] = useState(() => toForm(prospect ?? DRAFT))
  const [form, setForm] = useState(base)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [note, setNote] = useState('')
  const dirty = FIELDS.some((f) => form[f] !== base[f])

  // Pick up crew members' edits on refresh, but never over unsaved typing.
  useEffect(() => {
    if (!prospect || dirty) return
    const fresh = toForm(prospect)
    setBase(fresh)
    setForm(fresh)
  }, [prospect?.updated_at]) // eslint-disable-line react-hooks/exhaustive-deps

  function close() {
    if (dirty && !confirm('Discard your unsaved changes?')) return
    onClose()
  }

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const people = Object.fromEntries(profiles.map((p) => [p.id, p.display_name || p.email || 'Crew member']))

  async function save(e) {
    e.preventDefault()
    if (!form.name.trim()) { setMsg({ ok: false, text: 'Add a brand or organization name first.' }); return }
    setBusy(true)
    setMsg(null)
    try {
      if (isNew) {
        const row = Object.fromEntries(FIELDS.map((f) => [f, toValue(f, form[f])]))
        const { data, error } = await supabase.from('sponsor_prospects')
          .insert({ ...row, event_year_id: activeYear.id }).select('id').single()
        if (error) throw error
        setBase(form)
        onSaved(data.id)
      } else {
        // Only send what this person changed, so a crew member editing other
        // fields of the same prospect isn't overwritten.
        const patch = Object.fromEntries(FIELDS.filter((f) => form[f] !== base[f]).map((f) => [f, toValue(f, form[f])]))
        const { data, error } = await supabase.from('sponsor_prospects').update(patch).eq('id', prospect.id).select('id')
        if (error) throw error
        if (!data?.length) throw new Error('This prospect was deleted by someone else.')
        setBase(form)
        setMsg({ ok: true, text: 'Saved.' })
        onSaved(prospect.id)
      }
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    } finally {
      setBusy(false)
    }
  }

  async function addNote() {
    const body = note.trim()
    if (!body) return
    const { error } = await supabase.from('sponsor_activity').insert({ prospect_id: prospect.id, body })
    if (error) { setMsg({ ok: false, text: error.message }); return }
    setNote('')
    onSaved(prospect.id)
  }

  async function deleteNote(id) {
    const { error } = await supabase.from('sponsor_activity').delete().eq('id', id)
    if (error) setMsg({ ok: false, text: error.message })
    else onSaved(prospect.id)
  }

  async function deleteProspect() {
    const { data, error } = await supabase.from('sponsor_prospects').delete().eq('id', prospect.id).select('id')
    if (error || !data?.length) { setMsg({ ok: false, text: error?.message ?? 'Only admins can delete prospects.' }); return }
    onSaved(null)
    onClose()
  }

  const history = [...activity].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const website = /^https?:\/\//.test(form.website) ? form.website : null

  return (
    <div className="fixed inset-0 z-50 flex justify-end print:hidden">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={close} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="prospect-title"
        className="relative w-full md:w-[560px] h-full overflow-y-auto flex flex-col"
        style={{ background: 'var(--card)', borderLeft: '1px solid var(--border)' }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-3 border-b border-bdr" style={{ background: 'var(--card)' }}>
          <div className="min-w-0">
            <h2 id="prospect-title" className="font-display text-xl text-gold truncate">{isNew ? 'New prospect' : prospect.name}</h2>
            {!isNew && <span className={`chip ${stageOf(prospect.status).chip}`}>{stageOf(prospect.status).label}</span>}
          </div>
          <button type="button" className="btn btn-sm" onClick={close} aria-label="Close">×</button>
        </div>

        <form onSubmit={save} className="flex flex-col gap-4 p-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Brand or organization" className="col-span-2">
              <input className="input" value={form.name} onChange={set('name')} autoFocus={isNew} required />
            </Field>
            <Field label="Category">
              <select className="input" value={form.category} onChange={set('category')}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className="input" value={form.priority} onChange={set('priority')}>
                {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Stage">
              <select className="input" value={form.status} onChange={set('status')}>
                {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Target tier">
              <select className="input" value={form.tier} onChange={set('tier')}>
                <option value="">—</option>
                {TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </Field>
          </div>

          <div className="section-title !text-sm">Contact</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name"><input className="input" value={form.contact_name} onChange={set('contact_name')} /></Field>
            <Field label="Title"><input className="input" value={form.contact_title} onChange={set('contact_title')} /></Field>
            <Field label="Email"><input className="input" type="email" value={form.email} onChange={set('email')} /></Field>
            <Field label="Phone"><input className="input" type="tel" value={form.phone} onChange={set('phone')} /></Field>
            <Field label="Website or contact page" className="col-span-2">
              <input className="input" value={form.website} onChange={set('website')} />
            </Field>
            {website && <a className="text-sm -mt-2" href={website} target="_blank" rel="noopener noreferrer">Open website ↗</a>}
          </div>

          <div className="section-title !text-sm">The ask</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="What we're asking for" className="col-span-2">
              <textarea className="input" rows={2} value={form.ask} onChange={set('ask')} />
            </Field>
            <Field label="Cash committed ($)">
              <input className="input font-mono" type="number" min="0" step="50" value={form.cash_committed} onChange={set('cash_committed')} />
            </Field>
            <Field label="Cases committed">
              <input className="input font-mono" type="number" min="0" step="1" value={form.cases_committed} onChange={set('cases_committed')} />
            </Field>
          </div>

          <div className="section-title !text-sm">Next move</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Next step" className="col-span-2">
              <input className="input" value={form.next_step} onChange={set('next_step')} />
            </Field>
            <Field label="Follow up on">
              <input className="input" type="date" value={form.follow_up} onChange={set('follow_up')} />
            </Field>
            <Field label="Who's on it">
              <select className="input" value={form.owner_id} onChange={set('owner_id')}>
                <option value="">— nobody yet —</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{people[p.id]}</option>)}
              </select>
            </Field>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn btn-primary" disabled={busy || (!isNew && !dirty)}>{isNew ? 'Add prospect' : 'Save changes'}</button>
            <button type="button" className="btn" onClick={close}>{dirty ? 'Cancel' : 'Close'}</button>
            {msg && <span className={`text-sm ${msg.ok ? 'text-grn' : 'text-coral'}`}>{msg.text}</span>}
            {!isNew && isAdmin && (
              <span className="ml-auto"><ConfirmButton onConfirm={deleteProspect} prompt="Delete prospect?">Delete</ConfirmButton></span>
            )}
          </div>
        </form>

        {!isNew && (
          <div className="flex flex-col gap-4 px-5 pb-6">
            <Receipts prospect={prospect} contacts={contacts} blocked={dirty} onChanged={() => onSaved(prospect.id)} />

            <div className="section-title !text-sm">Notes &amp; history</div>
            <div className="flex flex-col gap-2">
              <textarea
                className="input"
                rows={3}
                placeholder="Log a call, email, or anything worth remembering"
                aria-label="New note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div><button type="button" className="btn btn-sm" onClick={addNote} disabled={!note.trim()}>Add note</button></div>
            </div>
            <div className="flex flex-col gap-2">
              {history.map((a) => {
                const mine = a.kind === 'note' && a.created_by === session.user.id
                return (
                  <div key={a.id} className={`rounded p-2.5 ${a.kind === 'status' ? '' : 'bg-card2'}`} style={a.kind === 'status' ? { borderLeft: '2px solid var(--border)' } : undefined}>
                    <div className="flex justify-between gap-2 text-xs text-faint">
                      <span>{when(a.created_at)} · {a.created_by ? (people[a.created_by] ?? 'Crew member') : (a.author_label ?? 'Unknown')}</span>
                      {(mine || (isAdmin && a.kind === 'note')) && (
                        <ConfirmButton onConfirm={() => deleteNote(a.id)} prompt="Delete note?">×</ConfirmButton>
                      )}
                    </div>
                    <div className={`text-sm whitespace-pre-wrap ${a.kind === 'status' ? 'text-muted italic' : ''}`}>{a.body}</div>
                  </div>
                )
              })}
              {!history.length && <div className="text-faint text-sm">No notes yet.</div>}
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
