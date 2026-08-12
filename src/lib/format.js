const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function money(n) {
  const v = Number(n)
  return Number.isFinite(v) ? usd.format(v) : '—'
}

export function fmtDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('T')[0].split('-')
  return `${m}/${d}/${y}`
}

export function todayISO() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Escape a value for a CSV cell.
function cell(v) {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function downloadCSV(filename, headers, rows) {
  const lines = [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))]
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
