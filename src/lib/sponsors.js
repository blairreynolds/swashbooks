import { todayISO } from './format'

export const STAGES = [
  { id: 'research', label: 'Research', chip: 'chip-muted' },
  { id: 'to_contact', label: 'To contact', chip: 'chip-blue' },
  { id: 'contacted', label: 'Contacted', chip: 'chip-blue' },
  { id: 'talks', label: 'In talks', chip: 'chip-amber' },
  { id: 'committed', label: 'Committed', chip: 'chip-green' },
  { id: 'received', label: 'Received', chip: 'chip-green' },
  { id: 'declined', label: 'Declined', chip: 'chip-coral' },
  { id: 'parked', label: 'Parked', chip: 'chip-muted' },
  { id: 'dnp', label: 'Do not pitch', chip: 'chip-coral' },
]
export const CLOSED = new Set(['declined', 'parked', 'dnp'])
export const stageOf = (id) => STAGES.find((s) => s.id === id) ?? { id, label: id ?? '—', chip: 'chip-muted' }

export const CATEGORIES = [
  'Rum', 'Vodka', 'Whiskey', 'Other spirits', 'Local distillery', 'Distributor',
  'Beer, cider & mead', 'Seltzer & RTD', 'Water & NA', 'Mixers & serveware', 'Other',
]

export const TIERS = [
  { id: 'Admiral', label: 'Admiral (presenting)' },
  { id: 'Captain', label: 'Captain (bar partner)' },
  { id: 'Quartermaster', label: 'Quartermaster (product partner)' },
  { id: 'Crew', label: 'Crew (community partner)' },
]

export const PRIORITIES = [
  { id: 'high', label: 'High', color: 'var(--coral)' },
  { id: 'medium', label: 'Medium', color: 'var(--amber)' },
  { id: 'low', label: 'Low', color: 'var(--faint)' },
]
const PRI_RANK = { high: 0, medium: 1, low: 2 }
export const priorityColor = (p) => PRIORITIES.find((x) => x.id === p)?.color ?? 'var(--amber)'

export function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(y, m - 1, d + n)
  const p = (v) => String(v).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`
}

// A follow-up counts only while the prospect is still being worked.
const tracksFollowUp = (p) => p.follow_up && !CLOSED.has(p.status) && p.status !== 'received'
export const isDue = (p, today = todayISO()) => tracksFollowUp(p) && p.follow_up <= today

// 'over' | 'soon' | '' for colouring the follow-up date.
export function followUpState(p, today = todayISO()) {
  if (!tracksFollowUp(p)) return ''
  if (p.follow_up < today) return 'over'
  return p.follow_up <= addDaysISO(today, 3) ? 'soon' : ''
}

export function summarize(prospects, today = todayISO()) {
  let cash = 0, cases = 0, talks = 0, due = 0
  for (const p of prospects) {
    if (p.status === 'committed' || p.status === 'received') {
      cash += Number(p.cash_committed) || 0
      cases += Number(p.cases_committed) || 0
    }
    if (p.status === 'contacted' || p.status === 'talks') talks++
    if (isDue(p, today)) due++
  }
  return { cash, cases, talks, due }
}

export const SORTS = [
  { id: 'followUp', label: 'Follow-up date' },
  { id: 'priority', label: 'Priority' },
  { id: 'updated', label: 'Recently updated' },
  { id: 'name', label: 'Name' },
]
const rank = (p) => PRI_RANK[p.priority] ?? 1
const byName = (a, b) => (a.name || '').localeCompare(b.name || '')
const COMPARE = {
  // Blank dates last; priority breaks ties.
  followUp: (a, b) => (a.follow_up || '9999').localeCompare(b.follow_up || '9999') || rank(a) - rank(b),
  priority: (a, b) => rank(a) - rank(b) || byName(a, b),
  updated: (a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''),
  name: byName,
}

// stage: 'open' | 'all' | a stage id. latestNote: prospect id -> note text.
export function filterProspects(prospects, { stage, dueOnly, q, category, sort }, latestNote = {}, today = todayISO()) {
  const needle = q.trim().toLowerCase()
  return prospects
    .filter((p) => {
      if (dueOnly) { if (!isDue(p, today)) return false }
      else if (stage === 'open') { if (CLOSED.has(p.status)) return false }
      else if (stage !== 'all' && p.status !== stage) return false
      if (category && p.category !== category) return false
      if (needle) {
        const hay = [p.name, p.contact_name, p.contact_title, p.category, p.next_step, p.ask, p.email, latestNote[p.id]]
          .join(' ').toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
    .sort(COMPARE[sort] ?? COMPARE.followUp)
}
