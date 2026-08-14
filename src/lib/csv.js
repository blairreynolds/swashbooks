// Minimal CSV parsing + value normalizers for the importer. No dependencies.

// RFC-4180-ish parser: handles quoted fields, escaped quotes, CRLF, and
// newlines inside quotes. Returns array of rows (arrays of strings).
export function parseCSV(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  // Drop fully-empty trailing rows
  return rows.filter((r) => r.some((v) => v.trim() !== ''))
}

// "8/3/2026", "08-03-26", "2026-08-03" → "2026-08-03" (or null if unparseable)
export function normalizeDate(v) {
  const s = String(v ?? '').trim()
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (m) {
    const yr = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${yr}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  }
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) {
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
  return null
}

// "$1,234.56", "(50.00)", "-50" → number (negative for parens/minus); null if not a number
export function normalizeAmount(v) {
  let s = String(v ?? '').trim()
  if (!s) return null
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  s = s.replace(/[$,\s]/g, '')
  if (s.startsWith('-')) { neg = true; s = s.slice(1) }
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return neg ? -n : n
}

// Loose string match for category/contact names: case/punctuation-insensitive,
// then containment either way.
export function fuzzyFind(name, candidates, keyFn) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
  const target = norm(name)
  if (!target) return null
  let hit = candidates.find((c) => norm(keyFn(c)) === target)
  if (hit) return hit
  hit = candidates.find((c) => {
    const k = norm(keyFn(c))
    return k.length >= 3 && (k.includes(target) || target.includes(k))
  })
  return hit ?? null
}

export function normalizeDirection(v) {
  const s = String(v ?? '').trim().toLowerCase()
  if (['income', 'in', 'deposit', 'credit', 'revenue'].includes(s)) return 'income'
  if (['expense', 'out', 'withdrawal', 'debit', 'payment'].includes(s)) return 'expense'
  return null
}
