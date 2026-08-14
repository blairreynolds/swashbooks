import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/AppContext'
import { money } from '../lib/format'
import { parseCSV, normalizeDate, normalizeAmount, normalizeDirection, fuzzyFind } from '../lib/csv'

const TARGETS = {
  transactions: {
    label: 'Transactions',
    fields: [
      { key: 'date', label: 'Date', required: true, guess: ['date'] },
      { key: 'amount', label: 'Amount', required: true, guess: ['amount', 'total', 'value', 'cost'] },
      { key: 'description', label: 'Description', required: true, guess: ['description', 'desc', 'memo', 'item', 'details', 'what'] },
      { key: 'category', label: 'Category', required: false, guess: ['category', 'cat'] },
      { key: 'contact', label: 'Contact', required: false, guess: ['contact', 'vendor', 'payee', 'donor', 'who', 'name'] },
      { key: 'direction', label: 'Direction (in/out)', required: false, guess: ['direction', 'type', 'in/out', 'inout'] },
      { key: 'reference_no', label: 'Reference #', required: false, guess: ['reference', 'ref', 'check'] },
      { key: 'notes', label: 'Notes', required: false, guess: ['notes', 'note', 'comments'] },
    ],
  },
  contacts: {
    label: 'Contacts',
    fields: [
      { key: 'name', label: 'Name', required: true, guess: ['name', 'contact', 'who'] },
      { key: 'type', label: 'Type', required: false, guess: ['type', 'kind'] },
      { key: 'email', label: 'Email', required: false, guess: ['email', 'e-mail'] },
      { key: 'phone', label: 'Phone', required: false, guess: ['phone', 'tel'] },
      { key: 'address', label: 'Address', required: false, guess: ['address', 'addr'] },
      { key: 'notes', label: 'Notes', required: false, guess: ['notes', 'note'] },
    ],
  },
  in_kind_donations: {
    label: 'In-kind donations',
    fields: [
      { key: 'contact', label: 'Donor (contact name)', required: true, guess: ['donor', 'contact', 'name', 'who'] },
      { key: 'date_received', label: 'Date received', required: true, guess: ['date', 'received'] },
      { key: 'item_description', label: 'Item description', required: true, guess: ['item', 'description', 'donation', 'what'] },
      { key: 'estimated_value', label: 'Estimated value', required: false, guess: ['value', 'estimated', 'worth', 'amount'] },
      { key: 'notes', label: 'Notes', required: false, guess: ['notes', 'note'] },
    ],
  },
}

const CONTACT_TYPES = ['vendor', 'donor', 'charity', 'other']

function guessMapping(headers, fields) {
  const used = new Set()
  const mapping = {}
  for (const f of fields) {
    const idx = headers.findIndex((h, i) => {
      if (used.has(i)) return false
      const norm = h.toLowerCase().trim()
      return f.guess.some((g) => norm === g || norm.includes(g))
    })
    if (idx >= 0) { mapping[f.key] = idx; used.add(idx) }
  }
  return mapping
}

export default function Import() {
  const { activeYear, categories, session } = useApp()
  const [fileName, setFileName] = useState(null)
  const [headers, setHeaders] = useState([])
  const [dataRows, setDataRows] = useState([])
  const [target, setTarget] = useState('transactions')
  const [mapping, setMapping] = useState({}) // field key -> column index
  const [defaultDirection, setDefaultDirection] = useState('expense')
  const [contacts, setContacts] = useState([])
  const [existingTxns, setExistingTxns] = useState([])
  const [existingContacts, setExistingContacts] = useState([])
  const [presets, setPresets] = useState(null) // null = table missing / not loaded
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('contacts').select('id, name').order('name').then(({ data }) => {
      setContacts(data ?? [])
      setExistingContacts(data ?? [])
    })
    supabase.from('import_presets').select('*').order('name').then(({ data, error }) => {
      setPresets(error ? null : (data ?? []))
    })
  }, [])

  useEffect(() => {
    if (!activeYear || target !== 'transactions') return
    supabase.from('transactions')
      .select('date, amount, description')
      .eq('event_year_id', activeYear.id)
      .then(({ data }) => setExistingTxns(data ?? []))
  }, [activeYear, target, result])

  function onFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const rows = parseCSV(String(reader.result))
      if (rows.length < 2) { alert('CSV needs a header row plus at least one data row.'); return }
      setFileName(file.name)
      setHeaders(rows[0].map((h) => h.trim()))
      setDataRows(rows.slice(1))
      setMapping(guessMapping(rows[0], TARGETS[target].fields))
      setResult(null)
    }
    reader.readAsText(file)
  }

  function retarget(t) {
    setTarget(t)
    if (headers.length) setMapping(guessMapping(headers, TARGETS[t].fields))
    setResult(null)
  }

  const cell = (row, key) => (mapping[key] != null ? String(row[mapping[key]] ?? '').trim() : '')

  // Dry-run: process every row into {values, status: ok|warn|error, reasons[]}
  const preview = useMemo(() => {
    if (!dataRows.length || !activeYear) return null
    const cats = categories.filter((c) => !c.archived)
    const seenTx = new Set(existingTxns.map((t) => `${t.date}|${Number(t.amount)}|${t.description.toLowerCase()}`))
    const seenNames = new Set(existingContacts.map((c) => c.name.toLowerCase().trim()))
    const seenInFile = new Set()

    return dataRows.map((row, i) => {
      const reasons = []
      let status = 'ok'
      const warn = (m) => { reasons.push(m); if (status === 'ok') status = 'warn' }
      const fail = (m) => { reasons.push(m); status = 'error' }
      const out = { _row: i + 2 }

      if (target === 'transactions') {
        out.date = normalizeDate(cell(row, 'date'))
        if (!out.date) fail('bad/missing date')
        const amt = normalizeAmount(cell(row, 'amount'))
        if (amt == null || amt === 0) fail('bad/missing amount')
        out.description = cell(row, 'description')
        if (!out.description) fail('missing description')
        out.direction = normalizeDirection(cell(row, 'direction'))
          ?? (amt != null && amt < 0 ? 'expense' : null)
        out.amount = amt != null ? Math.abs(amt) : null
        const catName = cell(row, 'category')
        const cat = catName ? fuzzyFind(catName, cats, (c) => c.name) : null
        if (catName && !cat) fail(`category "${catName}" not matched`)
        if (!catName) fail('missing category')
        if (cat) {
          out.category_id = cat.id
          out.categoryName = cat.name
          if (!out.direction) out.direction = cat.type
          else if (out.direction !== cat.type) fail(`direction ${out.direction} conflicts with ${cat.type} category "${cat.name}"`)
        }
        if (!out.direction) { out.direction = defaultDirection; warn(`direction assumed ${defaultDirection}`) }
        const contactName = cell(row, 'contact')
        if (contactName) {
          const hit = fuzzyFind(contactName, contacts, (c) => c.name)
          if (hit) { out.contact_id = hit.id; out.contactName = hit.name }
          else warn(`contact "${contactName}" not found — importing without`)
        }
        out.reference_no = cell(row, 'reference_no') || null
        out.notes = cell(row, 'notes') || null
        const key = `${out.date}|${Number(out.amount)}|${(out.description || '').toLowerCase()}`
        if (status !== 'error') {
          if (seenTx.has(key)) fail('duplicate of existing transaction (date+amount+description)')
          else if (seenInFile.has(key)) fail('duplicate within this file')
          else seenInFile.add(key)
        }
      } else if (target === 'contacts') {
        out.name = cell(row, 'name')
        if (!out.name) fail('missing name')
        const t = cell(row, 'type').toLowerCase()
        out.type = CONTACT_TYPES.includes(t) ? t : 'other'
        if (t && out.type === 'other' && t !== 'other') warn(`type "${t}" → other`)
        out.email = cell(row, 'email') || null
        out.phone = cell(row, 'phone') || null
        out.address = cell(row, 'address') || null
        out.notes = cell(row, 'notes') || null
        const nk = out.name.toLowerCase().trim()
        if (status !== 'error') {
          if (seenNames.has(nk)) fail('contact already exists')
          else if (seenInFile.has(nk)) fail('duplicate within this file')
          else seenInFile.add(nk)
        }
      } else {
        const donorName = cell(row, 'contact')
        const hit = donorName ? fuzzyFind(donorName, contacts, (c) => c.name) : null
        if (!donorName) fail('missing donor')
        else if (!hit) fail(`donor "${donorName}" not found — import contacts first`)
        else { out.contact_id = hit.id; out.contactName = hit.name }
        out.date_received = normalizeDate(cell(row, 'date_received'))
        if (!out.date_received) fail('bad/missing date')
        out.item_description = cell(row, 'item_description')
        if (!out.item_description) fail('missing item description')
        const ev = cell(row, 'estimated_value')
        out.estimated_value = ev ? normalizeAmount(ev) : null
        out.notes = cell(row, 'notes') || null
      }
      return { values: out, status, reasons }
    })
  }, [dataRows, mapping, target, categories, contacts, existingTxns, existingContacts, defaultDirection, activeYear]) // eslint-disable-line react-hooks/exhaustive-deps

  const importable = preview?.filter((p) => p.status !== 'error') ?? []

  async function commit() {
    setBusy(true)
    try {
      let rows
      if (target === 'transactions') {
        rows = importable.map(({ values: v }) => ({
          event_year_id: activeYear.id,
          date: v.date,
          category_id: v.category_id,
          contact_id: v.contact_id ?? null,
          description: v.description,
          amount: v.amount,
          direction: v.direction,
          reference_no: v.reference_no,
          notes: v.notes,
          created_by: session.user.id,
        }))
        const { error } = await supabase.from('transactions').insert(rows)
        if (error) throw error
      } else if (target === 'contacts') {
        rows = importable.map(({ values: v }) => ({
          name: v.name, type: v.type, email: v.email, phone: v.phone, address: v.address, notes: v.notes,
        }))
        const { error } = await supabase.from('contacts').insert(rows)
        if (error) throw error
      } else {
        rows = importable.map(({ values: v }) => ({
          event_year_id: activeYear.id,
          contact_id: v.contact_id,
          date_received: v.date_received,
          item_description: v.item_description,
          estimated_value: v.estimated_value,
          notes: v.notes,
        }))
        const { error } = await supabase.from('in_kind_donations').insert(rows)
        if (error) throw error
      }
      setResult({ imported: rows.length, skipped: (preview?.length ?? 0) - rows.length })
      setDataRows([])
      setHeaders([])
      setFileName(null)
    } catch (e) {
      alert(`Import failed — nothing partial was kept ambiguous: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function savePreset() {
    const name = prompt('Preset name (e.g. "Ticket sheet export"):')
    if (!name) return
    const { error } = await supabase.from('import_presets')
      .upsert({ name, target, mapping }, { onConflict: 'name' })
    if (error) alert(error.message)
    else supabase.from('import_presets').select('*').order('name').then(({ data }) => setPresets(data ?? []))
  }

  function loadPreset(p) {
    setTarget(p.target)
    setMapping(p.mapping)
    setResult(null)
  }

  async function deletePreset(p) {
    if (!confirm(`Delete preset "${p.name}"?`)) return
    const { error } = await supabase.from('import_presets').delete().eq('id', p.id)
    if (error) alert(error.message)
    else setPresets(presets.filter((x) => x.id !== p.id))
  }

  if (!activeYear) return <div className="card text-faint text-sm">Create an event year first (Settings).</div>

  const fields = TARGETS[target].fields
  const statusChip = { ok: 'chip-green', warn: 'chip-amber', error: 'chip-coral' }

  return (
    <>
      <div className="section-title">Import CSV</div>

      <div className="card flex flex-col gap-3">
        <div className="grid md:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1 text-xs text-faint">CSV file (Sheets/Forms export)
            <input className="input" type="file" accept=".csv,text/csv" onChange={onFile} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-faint">Import into
            <select className="input" value={target} onChange={(e) => retarget(e.target.value)}>
              {Object.entries(TARGETS).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
            </select>
          </label>
          {target === 'transactions' && (
            <label className="flex flex-col gap-1 text-xs text-faint">Direction when unknowable
              <select className="input" value={defaultDirection} onChange={(e) => setDefaultDirection(e.target.value)}>
                <option value="expense">expense</option>
                <option value="income">income</option>
              </select>
            </label>
          )}
        </div>
        {target !== 'contacts' && (
          <p className="text-faint text-xs">Rows import into <strong>{activeYear.label}</strong> (the active event year).</p>
        )}
        {presets === null ? (
          <p className="text-faint text-xs">Mapping presets need migration <code className="font-mono">002_import_presets.sql</code> — run it in the Supabase SQL editor to enable saving.</p>
        ) : presets.length > 0 && (
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-faint text-xs">Presets:</span>
            {presets.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-0.5">
                <button className="btn btn-sm" onClick={() => loadPreset(p)} title={`→ ${TARGETS[p.target].label}`}>{p.name}</button>
                <button className="btn btn-sm btn-danger" onClick={() => deletePreset(p)} title="Delete preset">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {result && (
        <div className="card">
          <span className="chip chip-green">done</span>{' '}
          <span className="text-sm">Imported {result.imported} rows{result.skipped ? `, skipped ${result.skipped} flagged rows` : ''}.</span>
        </div>
      )}

      {headers.length > 0 && (
        <div className="card flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="section-title">Map columns — {fileName}</div>
            {presets !== null && <button className="btn btn-sm" onClick={savePreset}>Save mapping as preset</button>}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {fields.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 text-xs text-faint">
                {f.label}{f.required && <span className="text-coral"> *</span>}
                <select
                  className="input"
                  value={mapping[f.key] ?? ''}
                  onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) })}
                >
                  <option value="">— not in file —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      {preview && (
        <div className="card flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="section-title">
              Dry run — {importable.length} of {preview.length} rows will import
            </div>
            <button className="btn btn-primary" onClick={commit} disabled={busy || !importable.length}>
              Import {importable.length} rows
            </button>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="tbl">
              <thead>
                <tr><th>Row</th><th>Status</th><th>Parsed</th><th>Flags</th></tr>
              </thead>
              <tbody>
                {preview.map((p, i) => (
                  <tr key={i} className={p.status === 'error' ? 'opacity-60' : ''}>
                    <td className="font-mono text-xs">{p.values._row}</td>
                    <td><span className={`chip ${statusChip[p.status]}`}>{p.status === 'error' ? 'skip' : p.status}</span></td>
                    <td className="text-muted text-xs">
                      {target === 'transactions' && `${p.values.date ?? '?'} · ${p.values.direction ?? '?'} · ${p.values.categoryName ?? '?'} · ${p.values.description ?? ''} · ${p.values.amount != null ? money(p.values.amount) : '?'}${p.values.contactName ? ' · ' + p.values.contactName : ''}`}
                      {target === 'contacts' && `${p.values.name ?? '?'} (${p.values.type}) ${p.values.email ?? ''}`}
                      {target === 'in_kind_donations' && `${p.values.date_received ?? '?'} · ${p.values.contactName ?? '?'} · ${p.values.item_description ?? ''}${p.values.estimated_value != null ? ' · ' + money(p.values.estimated_value) : ''}`}
                    </td>
                    <td className="text-xs text-amber">{p.reasons.join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-faint text-xs">
            Nothing imports silently: rows marked <span className="chip chip-coral">skip</span> are excluded
            (fix the CSV or mapping and re-upload); <span className="chip chip-amber">warn</span> rows import
            with the noted assumption.
          </p>
        </div>
      )}
    </>
  )
}
