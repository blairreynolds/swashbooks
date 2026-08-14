import { useEffect, useState } from 'react'
import { supabase, uploadFile, signedUrl } from '../lib/supabase'
import { useApp } from '../lib/AppContext'
import { money, fmtDate, todayISO } from '../lib/format'

const METHODS = ['check', 'card', 'cash', 'transfer', 'other']
const EMPTY = { contact_id: '', date_received: '', due_date: '', amount: '', category_id: '', description: '' }

const STATUS_CHIP = { unpaid: 'chip-amber', paid: 'chip-green', void: 'chip-muted' }

function BillForm({ contacts, onSaved, onCancel }) {
  const { activeYear, categories } = useApp()
  const [form, setForm] = useState({ ...EMPTY, date_received: todayISO() })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      let bill_file_url = null
      if (file) bill_file_url = await uploadFile(file, 'bills')
      const { error } = await supabase.from('bills').insert({
        event_year_id: activeYear.id,
        contact_id: form.contact_id,
        date_received: form.date_received,
        due_date: form.due_date || null,
        amount: Number(form.amount),
        category_id: form.category_id,
        description: form.description || null,
        bill_file_url,
      })
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
      <div className="section-title">Enter bill</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-xs text-faint">Vendor
          <select className="input" value={form.contact_id} onChange={set('contact_id')} required>
            <option value="">— pick —</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Category
          <select className="input" value={form.category_id} onChange={set('category_id')} required>
            <option value="">— pick —</option>
            {categories.filter((c) => c.type === 'expense' && !c.archived).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Amount ($)
          <input className="input" type="number" step="0.01" min="0.01" value={form.amount} onChange={set('amount')} required />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Date received
          <input className="input" type="date" value={form.date_received} onChange={set('date_received')} required />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Due date
          <input className="input" type="date" value={form.due_date} onChange={set('due_date')} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Bill file (image/PDF)
          <input className="input" type="file" accept="image/*,.pdf" onChange={(e) => setFile(e.target.files[0] ?? null)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint col-span-2 md:col-span-3">Description
          <input className="input" value={form.description} onChange={set('description')} placeholder="What is this bill for?" />
        </label>
      </div>
      {err && <div className="text-coral text-sm">{err}</div>}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy}>Save bill</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function PayModal({ bill, onDone, onCancel }) {
  const { session } = useApp()
  const [date, setDate] = useState(todayISO())
  const [method, setMethod] = useState('check')
  const [refNo, setRefNo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function pay(e) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const { data: txn, error: e1 } = await supabase.from('transactions').insert({
        event_year_id: bill.event_year_id,
        date,
        category_id: bill.category_id,
        contact_id: bill.contact_id,
        description: `Bill: ${bill.description || bill.contacts?.name || 'payment'}`,
        amount: Number(bill.amount),
        direction: 'expense',
        payment_method: method,
        reference_no: refNo || null,
        created_by: session.user.id,
      }).select().single()
      if (e1) throw e1
      const { error: e2 } = await supabase.from('bills')
        .update({ status: 'paid', paid_transaction_id: txn.id })
        .eq('id', bill.id)
      if (e2) throw e2
      onDone()
    } catch (e3) {
      setErr(e3.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <form onSubmit={pay} className="card w-full max-w-md flex flex-col gap-3">
        <div className="section-title">Pay bill — {bill.contacts?.name}</div>
        <div className="font-mono text-xl">{money(bill.amount)}</div>
        <label className="flex flex-col gap-1 text-xs text-faint">Payment date
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Method
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Reference # (check no. etc.)
          <input className="input" value={refNo} onChange={(e) => setRefNo(e.target.value)} />
        </label>
        {err && <div className="text-coral text-sm">{err}</div>}
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={busy}>Record payment</button>
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        </div>
        <p className="text-faint text-xs">This creates the expense transaction automatically — no double entry.</p>
      </form>
    </div>
  )
}

export default function Bills() {
  const { activeYear, isAdmin } = useApp()
  const [rows, setRows] = useState([])
  const [contacts, setContacts] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [paying, setPaying] = useState(null)

  async function load() {
    if (!activeYear) return
    const [bills, cts] = await Promise.all([
      supabase.from('bills')
        .select('*, contacts(name), categories(name)')
        .eq('event_year_id', activeYear.id)
        .order('status', { ascending: false })
        .order('due_date', { ascending: true, nullsFirst: false }),
      supabase.from('contacts').select('id, name').order('name'),
    ])
    setRows(bills.data ?? [])
    setContacts(cts.data ?? [])
  }
  useEffect(() => { load() }, [activeYear]) // eslint-disable-line react-hooks/exhaustive-deps

  async function voidBill(b) {
    if (!confirm(`Void bill from ${b.contacts?.name} (${money(b.amount)})?`)) return
    await supabase.from('bills').update({ status: 'void' }).eq('id', b.id)
    load()
  }

  async function remove(b) {
    if (!confirm(`Permanently delete this bill from ${b.contacts?.name}? (Its payment transaction, if any, is kept.)`)) return
    const { error } = await supabase.from('bills').delete().eq('id', b.id)
    if (error) alert(error.message)
    else load()
  }

  async function openFile(path) {
    const win = window.open('', '_blank')
    try {
      const url = await signedUrl(path)
      if (win) win.location = url
    } catch (e) {
      if (win) win.close()
      alert(e.message)
    }
  }

  if (!activeYear) return <div className="card text-faint text-sm">Create an event year first (Settings).</div>

  const unpaidTotal = rows.filter((b) => b.status === 'unpaid').reduce((s, b) => s + Number(b.amount), 0)

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="section-title">Bills — {activeYear.label}</div>
        <div className="flex items-center gap-3">
          {unpaidTotal > 0 && <span className="font-mono text-sm text-amber">{money(unpaidTotal)} unpaid</span>}
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Close' : '+ Enter bill'}
          </button>
        </div>
      </div>

      {showForm && <BillForm contacts={contacts} onSaved={() => { setShowForm(false); load() }} onCancel={() => setShowForm(false)} />}
      {paying && <PayModal bill={paying} onDone={() => { setPaying(null); load() }} onCancel={() => setPaying(null)} />}

      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr><th>Status</th><th>Vendor</th><th>Category</th><th>Description</th><th>Received</th><th>Due</th><th className="td-num">Amount</th><th>File</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} className={b.status === 'void' ? 'opacity-40' : ''}>
                <td><span className={`chip ${STATUS_CHIP[b.status]}`}>{b.status}</span></td>
                <td>{b.contacts?.name}</td>
                <td className="text-muted">{b.categories?.name}</td>
                <td className="text-muted">{b.description || '—'}</td>
                <td className="font-mono text-xs">{fmtDate(b.date_received)}</td>
                <td className="font-mono text-xs">{fmtDate(b.due_date)}</td>
                <td className="td-num">{money(b.amount)}</td>
                <td>{b.bill_file_url && <button className="btn btn-sm" onClick={() => openFile(b.bill_file_url)}>view</button>}</td>
                <td className="whitespace-nowrap text-right">
                  {b.status === 'unpaid' && (
                    <>
                      <button className="btn btn-sm btn-primary" onClick={() => setPaying(b)}>Mark paid</button>{' '}
                      <button className="btn btn-sm" onClick={() => voidBill(b)}>void</button>
                    </>
                  )}
                  {isAdmin && <>{' '}<button className="btn btn-sm btn-danger" onClick={() => remove(b)}>del</button></>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} className="text-faint text-center py-6">No bills entered.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
