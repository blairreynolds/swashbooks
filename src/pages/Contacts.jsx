import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/AppContext'

const TYPES = ['vendor', 'donor', 'charity', 'other']
const EMPTY = { name: '', type: 'vendor', email: '', phone: '', address: '', notes: '' }

export default function Contacts() {
  const { isAdmin } = useApp()
  const [rows, setRows] = useState([])
  const [typeFilter, setTypeFilter] = useState('')
  const [form, setForm] = useState(null) // null = closed; {..} = add/edit form
  const [err, setErr] = useState(null)

  async function load() {
    const { data } = await supabase.from('contacts').select('*').order('name')
    setRows(data ?? [])
  }
  useEffect(() => { load() }, [])

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function save(e) {
    e.preventDefault()
    setErr(null)
    const row = { ...form }
    delete row.id
    const q = form.id
      ? supabase.from('contacts').update(row).eq('id', form.id)
      : supabase.from('contacts').insert(row)
    const { error } = await q
    if (error) setErr(error.message)
    else { setForm(null); load() }
  }

  async function remove(row) {
    if (!confirm(`Delete contact "${row.name}"?`)) return
    const { error } = await supabase.from('contacts').delete().eq('id', row.id)
    if (error) alert(error.message.includes('foreign key') || error.message.includes('violates')
      ? 'This contact is referenced by records and cannot be deleted.'
      : error.message)
    else load()
  }

  const filtered = typeFilter ? rows.filter((r) => r.type === typeFilter) : rows

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="section-title">Contacts</div>
        <div className="flex gap-2">
          <select className="input !w-auto" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className="btn btn-primary" onClick={() => setForm(form ? null : { ...EMPTY })}>
            {form ? 'Close' : '+ Add contact'}
          </button>
        </div>
      </div>

      {form && (
        <form onSubmit={save} className="card grid grid-cols-2 md:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1 text-xs text-faint">Name
            <input className="input" value={form.name} onChange={set('name')} required />
          </label>
          <label className="flex flex-col gap-1 text-xs text-faint">Type
            <select className="input" value={form.type} onChange={set('type')}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-faint">Email
            <input className="input" type="email" value={form.email ?? ''} onChange={set('email')} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-faint">Phone
            <input className="input" value={form.phone ?? ''} onChange={set('phone')} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-faint col-span-2">Address
            <input className="input" value={form.address ?? ''} onChange={set('address')} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-faint col-span-2 md:col-span-3">Notes
            <input className="input" value={form.notes ?? ''} onChange={set('notes')} />
          </label>
          {err && <div className="text-coral text-sm col-span-full">{err}</div>}
          <div className="col-span-full flex gap-2">
            <button className="btn btn-primary">{form.id ? 'Save' : 'Add'}</button>
            <button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr><th>Name</th><th>Type</th><th>Email</th><th>Phone</th><th>Notes</th><th></th></tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td><span className={`chip ${r.type === 'charity' ? 'chip-gold' : r.type === 'donor' ? 'chip-green' : 'chip-muted'}`}>{r.type}</span></td>
                <td className="text-muted">{r.email || '—'}</td>
                <td className="text-muted font-mono text-xs">{r.phone || '—'}</td>
                <td className="text-faint text-xs max-w-56 truncate">{r.notes || ''}</td>
                <td className="whitespace-nowrap text-right">
                  <button className="btn btn-sm" onClick={() => setForm(r)}>edit</button>
                  {isAdmin && <>{' '}<button className="btn btn-sm btn-danger" onClick={() => remove(r)}>del</button></>}
                </td>
              </tr>
            ))}
            {!filtered.length && <tr><td colSpan={6} className="text-faint text-center py-6">No contacts yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
