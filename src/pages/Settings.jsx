import { useEffect, useState } from 'react'
import { supabase, uploadFile, signedUrl } from '../lib/supabase'
import { useApp } from '../lib/AppContext'
import { todayISO } from '../lib/format'

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
        ? `"${y.label}" still has records — delete or move them first.`
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

function Users() {
  const { profile } = useApp()
  const [rows, setRows] = useState([])

  async function load() {
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setRows(data ?? [])
  }
  useEffect(() => { load() }, [])

  async function setRole(u, role) {
    const { error } = await supabase.from('profiles').update({ role }).eq('id', u.id)
    if (error) alert(error.message)
    else load()
  }

  return (
    <div className="card flex flex-col gap-3">
      <div className="section-title">Crew</div>
      <table className="tbl">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id}>
              <td>{u.display_name || '—'}</td>
              <td className="text-muted">{u.email}</td>
              <td>
                {u.id === profile?.id ? (
                  <span className="chip chip-gold">{u.role} (you)</span>
                ) : (
                  <select className="input !w-32" value={u.role} onChange={(e) => setRole(u, e.target.value)}>
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                  </select>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-faint text-xs">
        New crew members create their own account on the sign-in page; the first account automatically
        becomes admin, everyone after starts as member.
      </p>
    </div>
  )
}

export default function Settings() {
  return (
    <>
      <OrgSettings />
      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <EventYears />
        <Users />
      </div>
      <Categories />
    </>
  )
}
