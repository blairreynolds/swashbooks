import { useEffect, useState } from 'react'
import { supabase, uploadFile, signedUrl } from '../lib/supabase'
import { useApp } from '../lib/AppContext'
import { todayISO } from '../lib/format'
import { TAB_ACCESS } from '../lib/tabs'

function OrgSettings() {
  const { settings, refreshCore } = useApp()
  const [form, setForm] = useState(null)
  const [msg, setMsg] = useState(null)
  const [logoPreview, setLogoPreview] = useState(null)

  useEffect(() => {
    setForm(settings ?? {
      org_name: "The Swashbuckler's Ball", org_address: '', entity_status: 'unconfirmed',
      ein: '', invoice_payment_instructions: '', ack_signature_block: '', logo_url: null,
    })
  }, [settings])

  useEffect(() => {
    if (settings?.logo_url) signedUrl(settings.logo_url).then(setLogoPreview).catch(() => {})
  }, [settings?.logo_url])

  if (!form) return null
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function save(e) {
    e.preventDefault()
    setMsg(null)
    const row = { ...form }
    delete row.id
    delete row.created_at
    const q = settings?.id
      ? supabase.from('settings').update(row).eq('id', settings.id)
      : supabase.from('settings').insert(row)
    const { error } = await q
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: 'Saved.' })
    if (!error) refreshCore()
  }

  async function onLogo(e) {
    const file = e.target.files[0]
    if (!file) return
    try {
      const path = await uploadFile(file, 'logo')
      setForm({ ...form, logo_url: path })
      setMsg({ ok: true, text: 'Logo uploaded — click Save to keep it.' })
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    }
  }

  return (
    <form onSubmit={save} className="card flex flex-col gap-3">
      <div className="section-title">Organization</div>
      {form.entity_status === 'unconfirmed' && (
        <div className="chip chip-amber self-start">
          Entity status unconfirmed — acknowledgment letters will use the non-exempt wording until this is set.
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-faint">Org name
          <input className="input" value={form.org_name ?? ''} onChange={set('org_name')} required />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Entity status
          <select className="input" value={form.entity_status} onChange={set('entity_status')}>
            <option value="unconfirmed">Unconfirmed</option>
            <option value="501c3">501(c)(3) tax-exempt</option>
            <option value="nonprofit_non_exempt">Nonprofit, not tax-exempt</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint md:col-span-2">Address
          <input className="input" value={form.org_address ?? ''} onChange={set('org_address')} />
        </label>
        {form.entity_status === '501c3' && (
          <label className="flex flex-col gap-1 text-xs text-faint">EIN
            <input className="input font-mono" value={form.ein ?? ''} onChange={set('ein')} placeholder="XX-XXXXXXX" />
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-faint md:col-span-2">Invoice payment instructions (printed on invoice PDFs)
          <textarea className="input" rows={3} value={form.invoice_payment_instructions ?? ''} onChange={set('invoice_payment_instructions')} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint md:col-span-2">Acknowledgment letter signature block
          <textarea className="input" rows={3} value={form.ack_signature_block ?? ''} onChange={set('ack_signature_block')} placeholder={'With gratitude,\nThe Swashbuckler\'s Ball Crew'} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Logo
          <input className="input" type="file" accept="image/*" onChange={onLogo} />
        </label>
        {logoPreview && <img src={logoPreview} alt="logo" className="max-h-16 self-end justify-self-start rounded" />}
      </div>
      <div className="flex items-center gap-3">
        <button className="btn btn-primary">Save organization</button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-grn' : 'text-coral'}`}>{msg.text}</span>}
      </div>
    </form>
  )
}

function EventYears() {
  const { eventYears, refreshCore } = useApp()
  const [label, setLabel] = useState('')
  const [date, setDate] = useState(todayISO())
  const [err, setErr] = useState(null)

  async function add(e) {
    e.preventDefault()
    setErr(null)
    const { error } = await supabase.from('event_years').insert({ label, event_date: date, is_active: eventYears.length === 0 })
    if (error) setErr(error.message)
    else { setLabel(''); refreshCore() }
  }

  async function makeActive(y) {
    await supabase.from('event_years').update({ is_active: false }).neq('id', y.id)
    await supabase.from('event_years').update({ is_active: true }).eq('id', y.id)
    refreshCore()
  }

  async function remove(y) {
    if (!confirm(`Delete event year "${y.label}"? Only possible if it has no transactions, bills, invoices, or donations.`)) return
    const { error } = await supabase.from('event_years').delete().eq('id', y.id)
    if (error) {
      alert(error.message.includes('violates') || error.message.includes('foreign key')
        ? `"${y.label}" still has records — delete or move them first (a bar plan can be cleared in Planner → Setup).`
        : error.message)
    } else refreshCore()
  }

  return (
    <div className="card flex flex-col gap-3">
      <div className="section-title">Event years</div>
      <table className="tbl">
        <thead><tr><th>Label</th><th>Event date</th><th>Default</th><th></th></tr></thead>
        <tbody>
          {eventYears.map((y) => (
            <tr key={y.id}>
              <td>{y.label}</td>
              <td className="font-mono text-xs">{y.event_date}</td>
              <td>{y.is_active ? <span className="chip chip-gold">active</span> : ''}</td>
              <td className="text-right whitespace-nowrap">
                {!y.is_active && (
                  <>
                    <button className="btn btn-sm" onClick={() => makeActive(y)}>make default</button>{' '}
                    <button className="btn btn-sm btn-danger" onClick={() => remove(y)}>del</button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {!eventYears.length && <tr><td colSpan={4} className="text-faint text-center py-4">No event years yet — add the first one below.</td></tr>}
        </tbody>
      </table>
      <form onSubmit={add} className="flex gap-2 flex-wrap items-end">
        <label className="flex flex-col gap-1 text-xs text-faint">Label
          <input className="input !w-44" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ball 2026" required />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Event date
          <input className="input !w-44" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <button className="btn btn-primary">Add year</button>
        {err && <span className="text-coral text-sm">{err}</span>}
      </form>
    </div>
  )
}

function Categories() {
  const { categories, refreshCore } = useApp()
  const [name, setName] = useState('')
  const [type, setType] = useState('expense')

  async function add(e) {
    e.preventDefault()
    const maxSort = Math.max(0, ...categories.filter((c) => c.type === type).map((c) => c.sort_order ?? 0))
    const { error } = await supabase.from('categories').insert({ name, type, sort_order: maxSort + 1 })
    if (error) alert(error.message)
    else { setName(''); refreshCore() }
  }

  async function toggleArchived(c) {
    await supabase.from('categories').update({ archived: !c.archived }).eq('id', c.id)
    refreshCore()
  }

  async function rename(c) {
    const newName = prompt('Rename category:', c.name)
    if (!newName || newName === c.name) return
    await supabase.from('categories').update({ name: newName }).eq('id', c.id)
    refreshCore()
  }

  const list = (t) => (
    <div>
      <div className="text-faint text-xs uppercase tracking-wider font-semibold mb-2">{t === 'expense' ? 'Expenses' : 'Income'}</div>
      <div className="flex flex-col gap-1">
        {categories.filter((c) => c.type === t).map((c) => (
          <div key={c.id} className={`flex items-center gap-2 text-sm ${c.archived ? 'opacity-40' : ''}`}>
            <span className="flex-1">{c.name}</span>
            <button className="btn btn-sm" onClick={() => rename(c)}>rename</button>
            <button className="btn btn-sm" onClick={() => toggleArchived(c)}>{c.archived ? 'restore' : 'archive'}</button>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="card flex flex-col gap-4">
      <div className="section-title">Categories</div>
      <div className="grid md:grid-cols-2 gap-6">{list('expense')}{list('income')}</div>
      <form onSubmit={add} className="flex gap-2 items-end flex-wrap">
        <label className="flex flex-col gap-1 text-xs text-faint">New category
          <input className="input !w-52" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <select className="input !w-32" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="expense">expense</option>
          <option value="income">income</option>
        </select>
        <button className="btn btn-primary">Add</button>
      </form>
    </div>
  )
}

function Crew() {
  const { profile, tabsEnforced } = useApp()
  const [rows, setRows] = useState([])
  const [msg, setMsg] = useState(null)

  async function load() {
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setRows(data ?? [])
  }
  useEffect(() => { load() }, [])

  async function update(u, patch, okText) {
    setMsg(null)
    const { error } = await supabase.from('profiles').update(patch).eq('id', u.id)
    if (error) setMsg({ ok: false, text: error.message })
    else { setMsg({ ok: true, text: okText }); load() }
  }

  const who = (u) => u.display_name || u.email
  const toggle = (u, key) => {
    const has = u.tabs.includes(key)
    const tabs = has ? u.tabs.filter((t) => t !== key) : [...u.tabs, key]
    update(u, { tabs }, `${who(u)}: ${has ? 'removed' : 'added'} ${TAB_ACCESS.find((t) => t.key === key).label}.`)
  }

  const waiting = rows.filter((u) => u.role !== 'admin' && tabsEnforced && !u.tabs?.length)

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="section-title">Crew &amp; access</div>
        {msg && <span className={`text-sm ${msg.ok ? 'text-grn' : 'text-coral'}`}>{msg.text}</span>}
      </div>
      {!tabsEnforced && (
        <div className="chip chip-amber self-start">
          Tab access isn't switched on yet — run migration 006 in the Supabase SQL editor. Until then every crew member can use every tab.
        </div>
      )}
      {waiting.length > 0 && (
        <div className="chip chip-amber self-start">
          {waiting.length} new {waiting.length === 1 ? 'person is' : 'people are'} waiting for access: {waiting.map(who).join(', ')}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {rows.map((u) => {
          const me = u.id === profile?.id
          const admin = u.role === 'admin'
          return (
            <div key={u.id} className="rounded bg-card2 p-3 flex flex-col gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{u.display_name || '—'}{me && <span className="text-faint font-normal"> (you)</span>}</div>
                  <div className="text-faint text-xs">{u.email}</div>
                </div>
                {me ? (
                  <span className="chip chip-gold">{u.role}</span>
                ) : (
                  <select
                    className="input !w-32"
                    value={u.role}
                    onChange={(e) => update(u, { role: e.target.value }, `${who(u)} is now ${e.target.value === 'admin' ? 'an admin' : 'a member'}.`)}
                  >
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                  </select>
                )}
              </div>
              {admin ? (
                <div className="text-faint text-xs">Admins can use every tab, including Settings.</div>
              ) : tabsEnforced && (
                <div className="flex gap-1.5 flex-wrap items-center">
                  {TAB_ACCESS.map((t) => {
                    const on = u.tabs.includes(t.key)
                    return (
                      <button
                        key={t.key}
                        type="button"
                        aria-pressed={on}
                        className={`chip cursor-pointer border ${on ? 'chip-gold border-gold/40' : 'chip-muted border-transparent'}`}
                        onClick={() => toggle(u, t.key)}
                      >
                        {on ? '✓ ' : ''}{t.label}
                      </button>
                    )
                  })}
                  <span className="flex gap-1 ml-1">
                    <button type="button" className="btn btn-sm" onClick={() => update(u, { tabs: TAB_ACCESS.map((t) => t.key) }, `${who(u)} can use every tab.`)}>All</button>
                    <button type="button" className="btn btn-sm" onClick={() => update(u, { tabs: [] }, `${who(u)} has no access.`)}>None</button>
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p className="text-faint text-xs">
        New crew members create their own account on the sign-in page and start with no access until you
        pick their tabs here. Access is enforced by the database, not just hidden in the menu.
      </p>
    </div>
  )
}

export default function Settings() {
  return (
    <>
      <OrgSettings />
      <Crew />
      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <EventYears />
        <Categories />
      </div>
    </>
  )
}
