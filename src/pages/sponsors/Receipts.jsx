import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/AppContext'
import { money, fmtDate, todayISO } from '../../lib/format'
import { Field } from '../planner/widgets'

const METHODS = ['check', 'card', 'cash', 'transfer', 'other']
const sameName = (a, b) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

// Turns a prospect into books entries: a donor contact, an income transaction
// for cash, and an in-kind donation for product. Each money step creates the
// record first, then links it and marks the prospect Received.
export default function Receipts({ prospect, contacts, blocked, onChanged }) {
  const { activeYear, categories, session } = useApp()
  const [mode, setMode] = useState(null) // 'link' | 'cash' | 'product'
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const contact = contacts.find((c) => c.id === prospect.contact_id)
  const nameMatch = contacts.find((c) => sameName(c.name, prospect.name))
  const [pickId, setPickId] = useState(nameMatch?.id ?? '')
  const [cash, setCash] = useState({ amount: prospect.cash_committed ?? '', date: todayISO(), method: 'check', ref: '' })
  const barCategory = categories.find((c) => c.type === 'expense' && c.name === 'Bar/Beverage' && !c.archived)
  const [product, setProduct] = useState({
    description: prospect.cases_committed ? `${prospect.cases_committed} cases from ${prospect.name}` : `Product from ${prospect.name}`,
    value: '',
    date: todayISO(),
    category_id: barCategory?.id ?? '',
  })

  async function run(fn) {
    setBusy(true)
    setErr(null)
    try {
      await fn()
      setMode(null)
      onChanged()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const linkProspect = async (patch) => {
    const { error } = await supabase.from('sponsor_prospects').update(patch).eq('id', prospect.id)
    if (error) throw error
  }

  const createContact = () => run(async () => {
    const who = [prospect.contact_name, prospect.contact_title].filter(Boolean).join(', ')
    const { data, error } = await supabase.from('contacts').insert({
      name: prospect.name,
      type: 'donor',
      email: prospect.email,
      phone: prospect.phone,
      notes: who ? `Contact: ${who}` : null,
    }).select('id').single()
    if (error) throw error
    await linkProspect({ contact_id: data.id })
  })

  const recordCash = (e) => {
    e.preventDefault()
    return run(async () => {
      const amount = Number(cash.amount)
      if (!(amount > 0)) throw new Error('Enter the amount received.')
      const cat = categories.find((c) => c.type === 'income' && c.name === 'Sponsorships' && !c.archived)
      if (!cat) throw new Error('There is no "Sponsorships" income category. Add or restore it in Settings → Categories.')
      const { data, error } = await supabase.from('transactions').insert({
        event_year_id: activeYear.id,
        date: cash.date,
        category_id: cat.id,
        contact_id: prospect.contact_id,
        description: `Sponsorship: ${prospect.name}`,
        amount,
        direction: 'income',
        payment_method: cash.method,
        reference_no: cash.ref || null,
        created_by: session.user.id,
      }).select('id').single()
      if (error) throw error
      await linkProspect({ transaction_id: data.id, status: 'received' })
    })
  }

  const logProduct = (e) => {
    e.preventDefault()
    return run(async () => {
      if (!product.description.trim()) throw new Error('Describe what was received.')
      const { data, error } = await supabase.from('in_kind_donations').insert({
        event_year_id: activeYear.id,
        contact_id: prospect.contact_id,
        date_received: product.date,
        item_description: product.description.trim(),
        estimated_value: product.value === '' ? null : Math.max(0, Number(product.value) || 0),
        category_id: product.category_id || null,
      }).select('id').single()
      if (error) throw error
      await linkProspect({ in_kind_donation_id: data.id, status: 'received' })
    })
  }

  const tx = prospect.transactions
  const gift = prospect.in_kind_donations

  return (
    <div className="flex flex-col gap-3">
      <div className="section-title !text-sm">Into the books</div>
      {blocked && <p className="text-amber text-xs">Save your changes above first.</p>}

      {/* Contact */}
      <div className="rounded bg-card2 p-3 flex flex-col gap-2 text-sm">
        {contact ? (
          <div>Contact: <Link to="/contacts">{contact.name}</Link> <span className="chip chip-muted">{contact.type}</span></div>
        ) : mode === 'link' ? (
          <div className="flex gap-2 items-end flex-wrap">
            <Field label="Existing contact" className="flex-1 min-w-48">
              <select className="input" value={pickId} onChange={(e) => setPickId(e.target.value)}>
                <option value="">— pick —</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
              </select>
            </Field>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy || !pickId} onClick={() => run(() => linkProspect({ contact_id: pickId }))}>Link</button>
            <button type="button" className="btn btn-sm" onClick={() => setMode(null)}>Cancel</button>
          </div>
        ) : (
          <>
            <div className="text-muted">No contact yet. Cash and product need a contact in the address book.</div>
            {nameMatch && <div className="text-amber text-xs">A contact named "{nameMatch.name}" already exists — link it instead of creating a duplicate.</div>}
            <div className="flex gap-2 flex-wrap">
              <button type="button" className="btn btn-sm btn-primary" disabled={busy || blocked} onClick={createContact}>Make donor contact</button>
              <button type="button" className="btn btn-sm" disabled={busy || blocked} onClick={() => setMode('link')}>Link existing contact…</button>
            </div>
          </>
        )}
      </div>

      {/* Cash */}
      <div className="rounded bg-card2 p-3 flex flex-col gap-2 text-sm">
        {tx ? (
          <div>Cash received: <span className="font-mono text-grn">{money(tx.amount)}</span> on {fmtDate(tx.date)} · <Link to="/transactions">Transactions</Link></div>
        ) : mode === 'cash' ? (
          <form onSubmit={recordCash} className="grid grid-cols-2 gap-2">
            <Field label="Amount ($)"><input className="input font-mono" type="number" min="0.01" step="0.01" value={cash.amount} onChange={(e) => setCash({ ...cash, amount: e.target.value })} required autoFocus /></Field>
            <Field label="Date received"><input className="input" type="date" value={cash.date} onChange={(e) => setCash({ ...cash, date: e.target.value })} required /></Field>
            <Field label="Method">
              <select className="input" value={cash.method} onChange={(e) => setCash({ ...cash, method: e.target.value })}>
                {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Reference # (check no.)"><input className="input" value={cash.ref} onChange={(e) => setCash({ ...cash, ref: e.target.value })} /></Field>
            <div className="col-span-2 flex gap-2">
              <button className="btn btn-sm btn-primary" disabled={busy}>Record income</button>
              <button type="button" className="btn btn-sm" onClick={() => setMode(null)}>Cancel</button>
            </div>
            <p className="col-span-2 text-faint text-xs">Adds an income transaction under Sponsorships and marks this prospect Received.</p>
          </form>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" className="btn btn-sm" disabled={busy || blocked || !contact} onClick={() => setMode('cash')}>Record cash received</button>
            {!contact && <span className="text-faint text-xs">Needs a contact first.</span>}
          </div>
        )}
      </div>

      {/* Product */}
      <div className="rounded bg-card2 p-3 flex flex-col gap-2 text-sm">
        {gift ? (
          <div>
            Product received: {gift.item_description} on {fmtDate(gift.date_received)} ·{' '}
            <Link to="/donations?tab=inkind">Acknowledgment letter on Donations</Link>
          </div>
        ) : mode === 'product' ? (
          <form onSubmit={logProduct} className="grid grid-cols-2 gap-2">
            <Field label="What was received" className="col-span-2">
              <input className="input" value={product.description} onChange={(e) => setProduct({ ...product, description: e.target.value })} required autoFocus />
            </Field>
            <Field label="Date received"><input className="input" type="date" value={product.date} onChange={(e) => setProduct({ ...product, date: e.target.value })} required /></Field>
            <Field label="Estimated value ($, optional)">
              <input className="input font-mono" type="number" min="0" step="0.01" value={product.value} onChange={(e) => setProduct({ ...product, value: e.target.value })} />
            </Field>
            <Field label="Category" className="col-span-2">
              <select className="input" value={product.category_id} onChange={(e) => setProduct({ ...product, category_id: e.target.value })}>
                <option value="">— none —</option>
                {categories.filter((c) => c.type === 'expense' && !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <div className="col-span-2 flex gap-2">
              <button className="btn btn-sm btn-primary" disabled={busy}>Log product</button>
              <button type="button" className="btn btn-sm" onClick={() => setMode(null)}>Cancel</button>
            </div>
            <p className="col-span-2 text-faint text-xs">
              Adds an in-kind donation and marks this prospect Received. The value is for internal records only — acknowledgment letters never print it.
            </p>
          </form>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" className="btn btn-sm" disabled={busy || blocked || !contact} onClick={() => setMode('product')}>Log product received</button>
            {!contact && <span className="text-faint text-xs">Needs a contact first.</span>}
          </div>
        )}
      </div>

      {err && <div className="text-coral text-sm">{err}</div>}
    </div>
  )
}
