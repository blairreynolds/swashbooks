import { useEffect, useMemo, useState } from 'react'
import { supabase, uploadFile, signedUrl } from '../lib/supabase'
import { useApp } from '../lib/AppContext'
import { money, fmtDate, todayISO, downloadCSV } from '../lib/format'

const METHODS = ['check', 'card', 'cash', 'transfer', 'other']

const EMPTY = {
  date: todayISO(),
  direction: 'expense',
  category_id: '',
  contact_id: '',
  description: '',
  amount: '',
  payment_method: 'card',
  reference_no: '',
  notes: '',
}

function TxnForm({ initial, contacts, onSaved, onCancel }) {
  const { activeYear, categories, session } = useApp()
  const [form, setForm] = useState(initial)
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const isEdit = Boolean(initial.id)

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const cats = categories.filter((c) => c.type === form.direction && !c.archived)

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      let receipt_file_url = form.receipt_file_url ?? null
      if (file) receipt_file_url = await uploadFile(file, 'receipts')
      const row = {
        event_year_id: activeYear.id,
        date: form.date,
        direction: form.direction,
        category_id: form.category_id || null,
        contact_id: form.contact_id || null,
        description: form.description,
        amount: Number(form.amount),
        payment_method: form.payment_method,
        reference_no: form.reference_no || null,
        notes: form.notes || null,
        receipt_file_url,
      }
      if (!row.category_id) throw new Error('Pick a category.')
      if (!(row.amount > 0)) throw new Error('Amount must be greater than zero.')
      let q
      if (isEdit) {
        q = supabase.from('transactions').update(row).eq('id', initial.id)
      } else {
        q = supabase.from('transactions').insert({ ...row, created_by: session.user.id })
      }
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
    <form onSubmit={save} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1 text-xs text-faint">Date
          <input className="input" type="date" value={form.date} onChange={set('date')} required />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Direction
          <select className="input" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value, category_id: '' })}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Category
          <select className="input" value={form.category_id} onChange={set('category_id')} required>
            <option value="">— pick —</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Amount ($)
          <input className="input" type="number" step="0.01" min="0.01" value={form.amount} onChange={set('amount')} required />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint col-span-2">Description
          <input className="input" value={form.description} onChange={set('description')} required placeholder="What was this for?" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Contact
          <select className="input" value={form.contact_id} onChange={set('contact_id')}>
            <option value="">— none —</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Method
          <select className="input" value={form.payment_method} onChange={set('payment_method')}>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Reference # (check no. etc.)
          <input className="input" value={form.reference_no} onChange={set('reference_no')} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Receipt (image/PDF)
          <input className="input" type="file" accept="image/*,.pdf" onChange={(e) => setFile(e.target.files[0] ?? null)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint col-span-2">Notes
          <input className="input" value={form.notes ?? ''} onChange={set('notes')} />
        </label>
      </div>
      {err && <div className="text-coral text-sm">{err}</div>}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy}>{isEdit ? 'Save changes' : 'Add transaction'}</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  )
}

export default function Transactions() {
  const { activeYear, categories, isAdmin } = useApp()
  const [rows, setRows] = useState([])
  const [contacts, setContacts] = useState([])
  const [editing, setEditing] = useState(null) // row being edited
  const [showAdd, setShowAdd] = useState(false)
  const [filters, setFilters] = useState({ q: '', category_id: '', direction: '', from: '', to: '' })
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' })

  async function load() {
    if (!activeYear) return
    const [tx, cts] = await Promise.all([
      supabase
        .from('transactions')
        .select('*, contacts(name), categories(name)')
        .eq('event_year_id', activeYear.id)
        .order('date', { ascending: false }),
      supabase.from('contacts').select('id, name').order('name'),
    ])
    setRows(tx.data ?? [])
    setContacts(cts.data ?? [])
  }

  useEffect(() => { load() }, [activeYear]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    let out = rows
    const { q, category_id, direction, from, to } = filters
    if (q) {
      const needle = q.toLowerCase()
      out = out.filter((r) =>
        [r.description, r.notes, r.reference_no, r.contacts?.name, r.categories?.name]
          .some((v) => v && v.toLowerCase().includes(needle)))
    }
    if (category_id) out = out.filter((r) => r.category_id === category_id)
    if (direction) out = out.filter((r) => r.direction === direction)
    if (from) out = out.filter((r) => r.date >= from)
    if (to) out = out.filter((r) => r.date <= to)
    const mul = sort.dir === 'asc' ? 1 : -1
    return [...out].sort((a, b) => {
      const av = sort.key === 'amount' ? Number(a.amount) : (a[sort.key] ?? '')
      const bv = sort.key === 'amount' ? Number(b.amount) : (b[sort.key] ?? '')
      return av < bv ? -mul : av > bv ? mul : 0
    })
  }, [rows, filters, sort])

  function th(key, label) {
    const active = sort.key === key
    return (
      <th className="cursor-pointer select-none" onClick={() => setSort({ key, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}>
        {label}{active ? (sort.dir === 'desc' ? ' ▾' : ' ▴') : ''}
      </th>
    )
  }

  async function toggleVoid(row) {
    const { error } = await supabase.from('transactions').update({ voided: !row.voided }).eq('id', row.id)
    if (!error) load()
  }

  async function remove(row) {
    if (!confirm(`Permanently delete "${row.description}" (${money(row.amount)})? This cannot be undone.`)) return
    const { error } = await supabase.from('transactions').delete().eq('id', row.id)
    if (error) alert(error.message)
    else load()
  }

  async function openReceipt(path) {
    // Open the window synchronously so popup blockers see a user gesture,
    // then point it at the signed URL once it resolves.
    const win = window.open('', '_blank')
    try {
      const url = await signedUrl(path)
      if (win) win.location = url
      else window.open(url, '_blank')
    } catch (e) {
      if (win) win.close()
      alert(e.message)
    }
  }

  function exportCSV() {
    downloadCSV(
      `swashbooks-transactions-${activeYear.label.replace(/\s+/g, '-')}.csv`,
      ['Date', 'Direction', 'Category', 'Contact', 'Description', 'Amount', 'Method', 'Reference', 'Voided', 'Notes'],
      filtered.map((r) => [
        r.date, r.direction, r.categories?.name ?? '', r.contacts?.name ?? '', r.description,
        r.amount, r.payment_method ?? '', r.reference_no ?? '', r.voided ? 'yes' : '', r.notes ?? '',
      ]),
    )
  }

  if (!activeYear) return <div className="card text-faint text-sm">Create an event year first (Settings).</div>

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="section-title">Transactions — {activeYear.label}</div>
        <div className="flex gap-2">
          <button className="btn" onClick={exportCSV} disabled={!filtered.length}>Export CSV</button>
          <button className="btn btn-primary" onClick={() => { setShowAdd(!showAdd); setEditing(null) }}>
            {showAdd ? 'Close' : '+ Add transaction'}
          </button>
        </div>
      </div>

      {(showAdd || editing) && (
        <div className="card">
          <div className="section-title mb-3">{editing ? 'Edit transaction' : 'Quick add'}</div>
          <TxnForm
            key={editing?.id ?? 'new'}
            initial={editing ?? EMPTY}
            contacts={contacts}
            onSaved={() => { setShowAdd(false); setEditing(null); load() }}
            onCancel={editing ? () => setEditing(null) : null}
          />
        </div>
      )}

      <div className="card">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <input className="input" placeholder="Search…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          <select className="input" value={filters.category_id} onChange={(e) => setFilters({ ...filters, category_id: e.target.value })}>
            <option value="">All categories</option>
            {categories.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="input" value={filters.direction} onChange={(e) => setFilters({ ...filters, direction: e.target.value })}>
            <option value="">In + out</option>
            <option value="expense">Expenses</option>
            <option value="income">Income</option>
          </select>
          <input className="input" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} title="From date" />
          <input className="input" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} title="To date" />
        </div>

        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                {th('date', 'Date')}
                {th('direction', 'Dir')}
                <th>Category</th>
                <th>Contact</th>
                {th('description', 'Description')}
                {th('amount', 'Amount')}
                <th>Receipt</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className={r.voided ? 'opacity-40' : ''}>
                  <td className="font-mono text-xs">{fmtDate(r.date)}</td>
                  <td>
                    <span className={`chip ${r.direction === 'income' ? 'chip-green' : 'chip-coral'}`}>
                      {r.direction === 'income' ? 'in' : 'out'}
                    </span>
                    {r.voided && <span className="chip chip-muted ml-1">void</span>}
                  </td>
                  <td className="text-muted">{r.categories?.name ?? '—'}</td>
                  <td className="text-muted">{r.contacts?.name ?? '—'}</td>
                  <td>{r.description}</td>
                  <td className={`td-num ${r.direction === 'income' ? 'text-grn' : ''}`}>{money(r.amount)}</td>
                  <td>
                    {r.receipt_file_url && (
                      <button className="btn btn-sm" onClick={() => openReceipt(r.receipt_file_url)}>view</button>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn btn-sm" onClick={() => { setEditing(r); setShowAdd(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>edit</button>{' '}
                    <button className="btn btn-sm" onClick={() => toggleVoid(r)}>{r.voided ? 'unvoid' : 'void'}</button>
                    {isAdmin && <>{' '}<button className="btn btn-sm btn-danger" onClick={() => remove(r)}>del</button></>}
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={8} className="text-faint text-center py-6">No transactions match.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <div className="flex justify-end gap-6 mt-3 font-mono text-sm">
            <span className="text-grn">in {money(filtered.filter((r) => r.direction === 'income' && !r.voided).reduce((s, r) => s + Number(r.amount), 0))}</span>
            <span className="text-coral">out {money(filtered.filter((r) => r.direction === 'expense' && !r.voided).reduce((s, r) => s + Number(r.amount), 0))}</span>
          </div>
        )}
      </div>
    </>
  )
}
