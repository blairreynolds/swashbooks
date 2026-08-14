import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/AppContext'
import { money, fmtDate, todayISO } from '../lib/format'
import { printAckLetter } from '../lib/ackLetter'

const METHODS = ['check', 'card', 'cash', 'transfer', 'other']

function GiveForm({ contacts, onSaved, onCancel }) {
  const { activeYear, categories, session } = useApp()
  const [form, setForm] = useState({ contact_id: '', date: todayISO(), amount: '', payment_method: 'check', reference_no: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const givingCat = categories.find((c) => c.type === 'expense' && c.name === 'Charitable Giving')
        ?? categories.find((c) => c.type === 'expense' && c.name === 'Misc')
      if (!givingCat) throw new Error('No "Charitable Giving" (or "Misc") expense category exists — add one in Settings.')
      const charity = contacts.find((c) => c.id === form.contact_id)
      const { data: txn, error: e1 } = await supabase.from('transactions').insert({
        event_year_id: activeYear.id,
        date: form.date,
        category_id: givingCat.id,
        contact_id: form.contact_id,
        description: `Donation to ${charity?.name ?? 'charity'}`,
        amount: Number(form.amount),
        direction: 'expense',
        payment_method: form.payment_method,
        reference_no: form.reference_no || null,
        notes: form.notes || null,
        created_by: session.user.id,
      }).select().single()
      if (e1) throw e1
      const { error: e2 } = await supabase.from('outbound_donations').insert({
        event_year_id: activeYear.id,
        contact_id: form.contact_id,
        date: form.date,
        amount: Number(form.amount),
        transaction_id: txn.id,
        notes: form.notes || null,
      })
      if (e2) throw e2
      onSaved()
    } catch (e3) {
      setErr(e3.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="card flex flex-col gap-3">
      <div className="section-title">Record a donation to charity</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-xs text-faint">Charity
          <select className="input" value={form.contact_id} onChange={set('contact_id')} required>
            <option value="">— pick contact —</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.type !== 'charity' ? ` (${c.type})` : ''}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Date
          <input className="input" type="date" value={form.date} onChange={set('date')} required />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Amount ($)
          <input className="input" type="number" step="0.01" min="0.01" value={form.amount} onChange={set('amount')} required />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Method
          <select className="input" value={form.payment_method} onChange={set('payment_method')}>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Reference # (check no.)
          <input className="input" value={form.reference_no} onChange={set('reference_no')} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Notes
          <input className="input" value={form.notes} onChange={set('notes')} />
        </label>
      </div>
      {err && <div className="text-coral text-sm">{err}</div>}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy}>Record donation</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
      <p className="text-faint text-xs">Creates the linked expense transaction (Charitable Giving) automatically.</p>
    </form>
  )
}

function GivenTab() {
  const { activeYear, isAdmin } = useApp()
  const [rows, setRows] = useState([])
  const [contacts, setContacts] = useState([])
  const [showForm, setShowForm] = useState(false)

  async function load() {
    const [don, cts] = await Promise.all([
      supabase.from('outbound_donations')
        .select('*, contacts(name)')
        .eq('event_year_id', activeYear.id)
        .order('date', { ascending: false }),
      supabase.from('contacts').select('id, name, type').order('name'),
    ])
    setRows(don.data ?? [])
    setContacts(cts.data ?? [])
  }
  useEffect(() => { load() }, [activeYear]) // eslint-disable-line react-hooks/exhaustive-deps

  async function remove(d) {
    if (!confirm(`Delete this ${money(d.amount)} donation record to ${d.contacts?.name}? (Its expense transaction is kept — delete that separately in Transactions if needed.)`)) return
    const { error } = await supabase.from('outbound_donations').delete().eq('id', d.id)
    if (error) alert(error.message)
    else load()
  }

  const total = rows.reduce((s, d) => s + Number(d.amount), 0)
  const sortedCharityFirst = [...contacts].sort((a, b) => (a.type === 'charity' ? 0 : 1) - (b.type === 'charity' ? 0 : 1))

  return (
    <>
      <div className="card" style={{ borderColor: 'rgba(201,162,39,0.45)' }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-faint text-xs uppercase tracking-[0.08em] font-semibold">Total given to charity — {activeYear.label}</div>
            <div className="font-mono text-3xl mt-1 text-gold">{money(total)}</div>
          </div>
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Close' : '+ Record donation'}
          </button>
        </div>
      </div>

      {showForm && <GiveForm contacts={sortedCharityFirst} onSaved={() => { setShowForm(false); load() }} onCancel={() => setShowForm(false)} />}

      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr><th>Date</th><th>Charity</th><th>Notes</th><th className="td-num">Amount</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td className="font-mono text-xs">{fmtDate(d.date)}</td>
                <td>{d.contacts?.name}</td>
                <td className="text-muted">{d.notes || '—'}</td>
                <td className="td-num text-gold">{money(d.amount)}</td>
                <td className="text-right">
                  {isAdmin && <button className="btn btn-sm btn-danger" onClick={() => remove(d)}>del</button>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="text-faint text-center py-6">Nothing given yet this year.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

const INKIND_EMPTY = { contact_id: '', date_received: '', item_description: '', estimated_value: '', category_id: '', notes: '' }

function InKindForm({ initial, contacts, onSaved, onCancel }) {
  const { activeYear, categories, settings } = useApp()
  const [form, setForm] = useState({ ...INKIND_EMPTY, date_received: todayISO(), ...initial })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const isEdit = Boolean(initial?.id)

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const row = {
        event_year_id: activeYear.id,
        contact_id: form.contact_id,
        date_received: form.date_received,
        item_description: form.item_description,
        estimated_value: form.estimated_value === '' || form.estimated_value == null ? null : Number(form.estimated_value),
        category_id: form.category_id || null,
        notes: form.notes || null,
      }
      const q = isEdit
        ? supabase.from('in_kind_donations').update(row).eq('id', initial.id)
        : supabase.from('in_kind_donations').insert(row)
      const { error } = await q
      if (error) throw error
      onSaved()
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="card flex flex-col gap-3">
      <div className="section-title">{isEdit ? 'Edit in-kind donation' : 'Log in-kind donation'}</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-xs text-faint">Donor
          <select className="input" value={form.contact_id} onChange={set('contact_id')} required>
            <option value="">— pick contact —</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.type !== 'donor' ? ` (${c.type})` : ''}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Date received
          <input className="input" type="date" value={form.date_received} onChange={set('date_received')} required />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Estimated value ($, optional)
          <input className="input" type="number" step="0.01" min="0" value={form.estimated_value ?? ''} onChange={set('estimated_value')} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint col-span-2">What was donated
          <input className="input" value={form.item_description} onChange={set('item_description')} required placeholder="e.g. 4 cases of spiced rum for the grog station" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Category (optional)
          <select className="input" value={form.category_id ?? ''} onChange={set('category_id')}>
            <option value="">— none —</option>
            {categories.filter((c) => c.type === 'expense' && !c.archived).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint col-span-2 md:col-span-3">Notes
          <input className="input" value={form.notes ?? ''} onChange={set('notes')} />
        </label>
      </div>
      {settings?.entity_status === '501c3' && (
        <p className="text-faint text-xs">
          Estimated value is for internal tracking only — it is never printed on acknowledgment
          letters (IRS rules: valuation is the donor's responsibility).
        </p>
      )}
      {err && <div className="text-coral text-sm">{err}</div>}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy}>{isEdit ? 'Save changes' : 'Log donation'}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function InKindTab() {
  const { activeYear, settings, isAdmin } = useApp()
  const [rows, setRows] = useState([])
  const [contacts, setContacts] = useState([])
  const [editing, setEditing] = useState(null) // null | 'new' | row

  async function load() {
    const [don, cts] = await Promise.all([
      supabase.from('in_kind_donations')
        .select('*, contacts(name, address), categories(name)')
        .eq('event_year_id', activeYear.id)
        .order('date_received', { ascending: false }),
      supabase.from('contacts').select('id, name, type').order('name'),
    ])
    setRows(don.data ?? [])
    setContacts(cts.data ?? [])
  }
  useEffect(() => { load() }, [activeYear]) // eslint-disable-line react-hooks/exhaustive-deps

  async function letter(d) {
    const ok = await printAckLetter(d, settings)
    if (ok && !d.acknowledgment_generated) {
      await supabase.from('in_kind_donations')
        .update({ acknowledgment_generated: true, acknowledgment_date: todayISO() })
        .eq('id', d.id)
      load()
    }
  }

  async function remove(d) {
    if (!confirm(`Delete the in-kind donation from ${d.contacts?.name}?`)) return
    const { error } = await supabase.from('in_kind_donations').delete().eq('id', d.id)
    if (error) alert(error.message)
    else load()
  }

  const donorsFirst = [...contacts].sort((a, b) => (a.type === 'donor' ? 0 : 1) - (b.type === 'donor' ? 0 : 1))

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="section-title">In-kind received — {activeYear.label}</div>
        <button className="btn btn-primary" onClick={() => setEditing(editing ? null : 'new')}>
          {editing ? 'Close' : '+ Log in-kind donation'}
        </button>
      </div>

      {settings?.entity_status === 'unconfirmed' && (
        <div className="chip chip-amber self-start">
          Entity status unconfirmed — letters use the plain thank-you wording (no tax language) until an admin sets it in Settings.
        </div>
      )}

      {editing && (
        <InKindForm
          initial={editing === 'new' ? null : editing}
          contacts={donorsFirst}
          onSaved={() => { setEditing(null); load() }}
          onCancel={() => setEditing(null)}
        />
      )}

      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr><th>Received</th><th>Donor</th><th>Item</th><th className="td-num">Est. value</th><th>Letter</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td className="font-mono text-xs">{fmtDate(d.date_received)}</td>
                <td>{d.contacts?.name}</td>
                <td className="text-muted max-w-72 truncate" title={d.item_description}>{d.item_description}</td>
                <td className="td-num">{d.estimated_value != null ? money(d.estimated_value) : '—'}</td>
                <td>
                  {d.acknowledgment_generated
                    ? <span className="chip chip-green" title={`Generated ${fmtDate(d.acknowledgment_date)}`}>sent {fmtDate(d.acknowledgment_date)}</span>
                    : <span className="chip chip-amber">not sent</span>}
                </td>
                <td className="whitespace-nowrap text-right">
                  <button className="btn btn-sm btn-primary" onClick={() => letter(d)}>
                    {d.acknowledgment_generated ? 'Reprint letter' : 'Acknowledgment letter'}
                  </button>{' '}
                  <button className="btn btn-sm" onClick={() => setEditing(d)}>edit</button>
                  {isAdmin && <>{' '}<button className="btn btn-sm btn-danger" onClick={() => remove(d)}>del</button></>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="text-faint text-center py-6">No in-kind donations logged.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

export default function Donations() {
  const { activeYear } = useApp()
  const [tab, setTab] = useState('given') // 'given' | 'inkind'

  if (!activeYear) return <div className="card text-faint text-sm">Create an event year first (Settings).</div>

  return (
    <>
      <div className="flex gap-1">
        <button className={`btn ${tab === 'given' ? 'btn-primary' : ''}`} onClick={() => setTab('given')}>Given to Charity</button>
        <button className={`btn ${tab === 'inkind' ? 'btn-primary' : ''}`} onClick={() => setTab('inkind')}>In-Kind Received</button>
      </div>
      {tab === 'given' ? <GivenTab /> : <InKindTab />}
    </>
  )
}
