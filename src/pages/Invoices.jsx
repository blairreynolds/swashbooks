import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/AppContext'
import { money, fmtDate, todayISO } from '../lib/format'
import { printInvoice } from '../lib/invoicePdf'

const METHODS = ['check', 'card', 'cash', 'transfer', 'other']
const STATUS_CHIP = { draft: 'chip-muted', sent: 'chip-amber', paid: 'chip-green', void: 'chip-muted' }
const EMPTY_LINE = { description: '', qty: '1', unit_price: '' }

async function nextInvoiceNumber(activeYear) {
  const yr = activeYear.event_date.slice(0, 4)
  const prefix = `SB-${yr}-`
  const { data } = await supabase.from('invoices')
    .select('invoice_number')
    .like('invoice_number', `${prefix}%`)
    .order('invoice_number', { ascending: false })
    .limit(1)
  const last = data?.[0]?.invoice_number
  const n = last ? parseInt(last.slice(prefix.length), 10) + 1 : 1
  return `${prefix}${String(n).padStart(3, '0')}`
}

function InvoiceForm({ existing, contacts, onSaved, onCancel }) {
  const { activeYear } = useApp()
  const [form, setForm] = useState({
    contact_id: existing?.contact_id ?? '',
    issue_date: existing?.issue_date ?? todayISO(),
    due_date: existing?.due_date ?? '',
    notes: existing?.notes ?? '',
  })
  const [lines, setLines] = useState(
    existing?.invoice_line_items?.length
      ? existing.invoice_line_items.map((li) => ({ description: li.description, qty: String(li.qty), unit_price: String(li.unit_price) }))
      : [{ ...EMPTY_LINE }],
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const lineTotal = (l) => (Number(l.qty) || 0) * (Number(l.unit_price) || 0)
  const total = lines.reduce((s, l) => s + lineTotal(l), 0)

  function setLine(i, k, v) {
    setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)))
  }

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const cleanLines = lines.filter((l) => l.description.trim() && lineTotal(l) >= 0)
      if (!cleanLines.length) throw new Error('Add at least one line item.')
      let invoiceId = existing?.id
      if (existing) {
        const { error } = await supabase.from('invoices').update({
          contact_id: form.contact_id,
          issue_date: form.issue_date,
          due_date: form.due_date || null,
          notes: form.notes || null,
        }).eq('id', existing.id)
        if (error) throw error
        const { error: eDel } = await supabase.from('invoice_line_items').delete().eq('invoice_id', existing.id)
        if (eDel) throw eDel
      } else {
        const invoice_number = await nextInvoiceNumber(activeYear)
        const { data, error } = await supabase.from('invoices').insert({
          event_year_id: activeYear.id,
          invoice_number,
          contact_id: form.contact_id,
          issue_date: form.issue_date,
          due_date: form.due_date || null,
          notes: form.notes || null,
        }).select().single()
        if (error) throw error
        invoiceId = data.id
      }
      const { error: eLi } = await supabase.from('invoice_line_items').insert(
        cleanLines.map((l) => ({
          invoice_id: invoiceId,
          description: l.description.trim(),
          qty: Number(l.qty) || 1,
          unit_price: Number(l.unit_price) || 0,
          line_total: lineTotal(l),
        })),
      )
      if (eLi) throw eLi
      onSaved()
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="card flex flex-col gap-3">
      <div className="section-title">{existing ? `Edit ${existing.invoice_number}` : 'New invoice'}</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-xs text-faint">Bill to
          <select className="input" value={form.contact_id} onChange={set('contact_id')} required>
            <option value="">— pick contact —</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Issue date
          <input className="input" type="date" value={form.issue_date} onChange={set('issue_date')} required />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Due date
          <input className="input" type="date" value={form.due_date ?? ''} onChange={set('due_date')} />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-[1fr_80px_110px_110px_32px] gap-2 text-xs text-faint font-semibold uppercase tracking-wider">
          <span>Description</span><span className="text-right">Qty</span><span className="text-right">Unit price</span><span className="text-right">Total</span><span></span>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_80px_110px_110px_32px] gap-2 items-center">
            <input className="input" value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} placeholder="Line item…" />
            <input className="input text-right font-mono" type="number" step="0.01" min="0" value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} />
            <input className="input text-right font-mono" type="number" step="0.01" min="0" value={l.unit_price} onChange={(e) => setLine(i, 'unit_price', e.target.value)} />
            <span className="td-num text-sm">{money(lineTotal(l))}</span>
            <button type="button" className="btn btn-sm btn-danger" title="Remove line"
              onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [{ ...EMPTY_LINE }])}>×</button>
          </div>
        ))}
        <div className="flex justify-between items-center">
          <button type="button" className="btn btn-sm" onClick={() => setLines([...lines, { ...EMPTY_LINE }])}>+ line</button>
          <span className="font-mono font-semibold">{money(total)}</span>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-xs text-faint">Notes (printed on invoice)
        <input className="input" value={form.notes ?? ''} onChange={set('notes')} />
      </label>
      {err && <div className="text-coral text-sm">{err}</div>}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy}>{existing ? 'Save changes' : 'Create invoice'}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function PaidModal({ invoice, total, onDone, onCancel }) {
  const { session, categories } = useApp()
  const incomeCats = categories.filter((c) => c.type === 'income' && !c.archived)
  const [date, setDate] = useState(todayISO())
  const [method, setMethod] = useState('check')
  const [catId, setCatId] = useState(incomeCats.find((c) => c.name === 'Misc Income')?.id ?? incomeCats[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function markPaid(e) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const { data: txn, error: e1 } = await supabase.from('transactions').insert({
        event_year_id: invoice.event_year_id,
        date,
        category_id: catId,
        contact_id: invoice.contact_id,
        description: `Invoice ${invoice.invoice_number} paid`,
        amount: total,
        direction: 'income',
        payment_method: method,
        created_by: session.user.id,
      }).select().single()
      if (e1) throw e1
      const { error: e2 } = await supabase.from('invoices')
        .update({ status: 'paid', paid_transaction_id: txn.id })
        .eq('id', invoice.id)
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
      <form onSubmit={markPaid} className="card w-full max-w-md flex flex-col gap-3">
        <div className="section-title">Mark {invoice.invoice_number} paid</div>
        <div className="font-mono text-xl">{money(total)}</div>
        <label className="flex flex-col gap-1 text-xs text-faint">Payment date
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Method
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">Income category
          <select className="input" value={catId} onChange={(e) => setCatId(e.target.value)} required>
            {incomeCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {err && <div className="text-coral text-sm">{err}</div>}
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={busy}>Record payment</button>
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        </div>
        <p className="text-faint text-xs">This creates the income transaction automatically.</p>
      </form>
    </div>
  )
}

export default function Invoices() {
  const { activeYear, settings, isAdmin } = useApp()
  const [rows, setRows] = useState([])
  const [contacts, setContacts] = useState([])
  const [editing, setEditing] = useState(null) // null | 'new' | invoice row
  const [payingInvoice, setPayingInvoice] = useState(null)

  async function load() {
    if (!activeYear) return
    const [invs, cts] = await Promise.all([
      supabase.from('invoices')
        .select('*, contacts(name, address, email), invoice_line_items(*)')
        .eq('event_year_id', activeYear.id)
        .order('invoice_number', { ascending: false }),
      supabase.from('contacts').select('id, name').order('name'),
    ])
    setRows(invs.data ?? [])
    setContacts(cts.data ?? [])
  }
  useEffect(() => { load() }, [activeYear]) // eslint-disable-line react-hooks/exhaustive-deps

  const invTotal = (inv) => (inv.invoice_line_items ?? []).reduce((s, li) => s + Number(li.line_total), 0)

  async function markSent(inv) {
    await supabase.from('invoices').update({ status: 'sent' }).eq('id', inv.id)
    load()
  }

  async function voidInvoice(inv) {
    if (!confirm(`Void invoice ${inv.invoice_number}?`)) return
    await supabase.from('invoices').update({ status: 'void' }).eq('id', inv.id)
    load()
  }

  async function remove(inv) {
    if (!confirm(`Permanently delete ${inv.invoice_number}? (Its payment transaction, if any, is kept.)`)) return
    const { error } = await supabase.from('invoices').delete().eq('id', inv.id)
    if (error) alert(error.message)
    else load()
  }

  if (!activeYear) return <div className="card text-faint text-sm">Create an event year first (Settings).</div>

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="section-title">Invoices — {activeYear.label}</div>
        <button className="btn btn-primary" onClick={() => setEditing(editing ? null : 'new')}>
          {editing ? 'Close' : '+ New invoice'}
        </button>
      </div>

      {editing && (
        <InvoiceForm
          existing={editing === 'new' ? null : editing}
          contacts={contacts}
          onSaved={() => { setEditing(null); load() }}
          onCancel={() => setEditing(null)}
        />
      )}
      {payingInvoice && (
        <PaidModal
          invoice={payingInvoice}
          total={invTotal(payingInvoice)}
          onDone={() => { setPayingInvoice(null); load() }}
          onCancel={() => setPayingInvoice(null)}
        />
      )}

      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr><th>#</th><th>Status</th><th>Bill to</th><th>Issued</th><th>Due</th><th className="td-num">Total</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((inv) => (
              <tr key={inv.id} className={inv.status === 'void' ? 'opacity-40' : ''}>
                <td className="font-mono text-xs">{inv.invoice_number}</td>
                <td><span className={`chip ${STATUS_CHIP[inv.status]}`}>{inv.status}</span></td>
                <td>{inv.contacts?.name}</td>
                <td className="font-mono text-xs">{fmtDate(inv.issue_date)}</td>
                <td className="font-mono text-xs">{fmtDate(inv.due_date)}</td>
                <td className="td-num">{money(invTotal(inv))}</td>
                <td className="whitespace-nowrap text-right">
                  <button className="btn btn-sm" onClick={() => printInvoice(inv, inv.invoice_line_items ?? [], settings)}>PDF</button>{' '}
                  {(inv.status === 'draft' || inv.status === 'sent') && (
                    <>
                      <button className="btn btn-sm" onClick={() => setEditing(inv)}>edit</button>{' '}
                      {inv.status === 'draft' && <><button className="btn btn-sm" onClick={() => markSent(inv)}>mark sent</button>{' '}</>}
                      <button className="btn btn-sm btn-primary" onClick={() => setPayingInvoice(inv)}>Mark paid</button>{' '}
                      <button className="btn btn-sm" onClick={() => voidInvoice(inv)}>void</button>
                    </>
                  )}
                  {isAdmin && <>{' '}<button className="btn btn-sm btn-danger" onClick={() => remove(inv)}>del</button></>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="text-faint text-center py-6">No invoices yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
