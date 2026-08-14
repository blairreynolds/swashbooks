import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/AppContext'
import { money, fmtDate } from '../lib/format'

function StatCard({ label, value, tone }) {
  return (
    <div className="card">
      <div className="text-faint text-xs uppercase tracking-[0.08em] font-semibold">{label}</div>
      <div className={`font-mono text-2xl mt-1 ${tone ?? 'text-txt'}`}>{value}</div>
    </div>
  )
}

function BvaRow({ name, budget, actual }) {
  const over = budget > 0 && actual > budget
  const denom = Math.max(budget, actual, 1)
  const budgetPct = budget > 0 ? (budget / denom) * 100 : 0
  const actualPct = (actual / denom) * 100
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-40 shrink-0 text-sm text-muted truncate" title={name}>{name}</div>
      <div className="flex-1 relative h-2 rounded bg-card2 overflow-hidden">
        {budget > 0 && (
          <div className="absolute inset-y-0 left-0 rounded bg-bdr/60" style={{ width: `${budgetPct}%` }} />
        )}
        <div
          className="absolute inset-y-0 left-0 rounded"
          style={{ width: `${actualPct}%`, background: over ? 'var(--coral)' : 'var(--gold)' }}
        />
      </div>
      <div className={`w-44 shrink-0 text-right font-mono text-xs ${over ? 'text-coral' : 'text-muted'}`}>
        {money(actual)} / {budget > 0 ? money(budget) : '—'}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { activeYear, categories, isAdmin } = useApp()
  const [txns, setTxns] = useState([])
  const [budgets, setBudgets] = useState([])
  const [donated, setDonated] = useState(0)
  const [openBills, setOpenBills] = useState([])
  const [openInvoices, setOpenInvoices] = useState([])

  useEffect(() => {
    if (!activeYear) return
    let cancelled = false
    async function load() {
      const yid = activeYear.id
      const [tx, bg, don, bills, invs] = await Promise.all([
        supabase.from('transactions').select('category_id, amount, direction').eq('event_year_id', yid).eq('voided', false),
        supabase.from('budgets').select('category_id, amount').eq('event_year_id', yid),
        supabase.from('outbound_donations').select('amount').eq('event_year_id', yid),
        supabase.from('bills').select('id, amount, due_date, description, contacts(name)').eq('event_year_id', yid).eq('status', 'unpaid').order('due_date'),
        supabase.from('invoices').select('id, invoice_number, due_date, status, contacts(name), invoice_line_items(line_total)').eq('event_year_id', yid).in('status', ['draft', 'sent']).order('due_date'),
      ])
      if (cancelled) return
      setTxns(tx.data ?? [])
      setBudgets(bg.data ?? [])
      setDonated((don.data ?? []).reduce((s, r) => s + Number(r.amount), 0))
      setOpenBills(bills.data ?? [])
      setOpenInvoices(invs.data ?? [])
    }
    load()
    return () => { cancelled = true }
  }, [activeYear])

  if (!activeYear) {
    return (
      <div className="card text-center py-10">
        <div className="section-title mb-2">No event year yet</div>
        <p className="text-muted text-sm">
          {isAdmin
            ? <>Create your first event year (e.g. "Ball 2026") in <Link to="/settings">Settings</Link>.</>
            : 'Ask an admin to create the first event year in Settings.'}
        </p>
      </div>
    )
  }

  const income = txns.filter((t) => t.direction === 'income').reduce((s, t) => s + Number(t.amount), 0)
  const expenses = txns.filter((t) => t.direction === 'expense').reduce((s, t) => s + Number(t.amount), 0)

  const budgetByCat = Object.fromEntries(budgets.map((b) => [b.category_id, Number(b.amount)]))
  const actualByCat = {}
  for (const t of txns) {
    actualByCat[t.category_id] = (actualByCat[t.category_id] ?? 0) + Number(t.amount)
  }

  const bvaSection = (type) =>
    categories
      .filter((c) => c.type === type && !c.archived)
      .map((c) => ({ name: c.name, budget: budgetByCat[c.id] ?? 0, actual: actualByCat[c.id] ?? 0 }))
      .filter((r) => r.budget > 0 || r.actual > 0)

  const expenseRows = bvaSection('expense')
  const incomeRows = bvaSection('income')

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Income" value={money(income)} tone="text-grn" />
        <StatCard label="Total Expenses" value={money(expenses)} tone="text-coral" />
        <StatCard label="Net" value={money(income - expenses)} tone={income - expenses >= 0 ? 'text-grn' : 'text-coral'} />
        <StatCard label="Donated to Charity" value={money(donated)} tone="text-gold" />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card">
          <div className="section-title mb-3">Expenses — Budget vs Actual</div>
          {expenseRows.length
            ? expenseRows.map((r) => <BvaRow key={r.name} {...r} />)
            : <div className="text-faint text-sm">No expense budgets or transactions yet.</div>}
        </div>
        <div className="card">
          <div className="section-title mb-3">Income — Budget vs Actual</div>
          {incomeRows.length
            ? incomeRows.map((r) => <BvaRow key={r.name} {...r} />)
            : <div className="text-faint text-sm">No income budgets or transactions yet.</div>}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card">
          <div className="section-title mb-3">Unpaid Bills</div>
          {openBills.length ? (
            <table className="tbl">
              <thead><tr><th>Vendor</th><th>Description</th><th>Due</th><th className="td-num">Amount</th></tr></thead>
              <tbody>
                {openBills.map((b) => (
                  <tr key={b.id}>
                    <td>{b.contacts?.name ?? '—'}</td>
                    <td className="text-muted">{b.description}</td>
                    <td className="font-mono text-xs">{fmtDate(b.due_date)}</td>
                    <td className="td-num">{money(b.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="text-faint text-sm">Nothing outstanding.</div>}
        </div>
        <div className="card">
          <div className="section-title mb-3">Open Invoices</div>
          {openInvoices.length ? (
            <table className="tbl">
              <thead><tr><th>#</th><th>Contact</th><th>Status</th><th className="td-num">Total</th></tr></thead>
              <tbody>
                {openInvoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="font-mono text-xs">{inv.invoice_number}</td>
                    <td>{inv.contacts?.name ?? '—'}</td>
                    <td><span className={`chip ${inv.status === 'sent' ? 'chip-amber' : 'chip-muted'}`}>{inv.status}</span></td>
                    <td className="td-num">{money((inv.invoice_line_items ?? []).reduce((s, li) => s + Number(li.line_total), 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="text-faint text-sm">No open invoices.</div>}
        </div>
      </div>
    </>
  )
}
