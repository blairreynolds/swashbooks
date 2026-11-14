import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/AppContext'
import { money, fmtDate } from '../lib/format'
import {
  STAGES, CLOSED, CATEGORIES, SORTS, stageOf, priorityColor, followUpState, summarize, filterProspects,
} from '../lib/sponsors'
import ProspectPanel from './sponsors/ProspectPanel'
import PitchFiles from './sponsors/PitchFiles'
import { openReplies } from '../lib/sponsorMail'

const SORT_KEY = 'swashbooks-sponsor-sort'
const readSort = () => { try { return localStorage.getItem(SORT_KEY) || 'followUp' } catch { return 'followUp' } }
const MINE_KEY = 'swashbooks-sponsor-mine'
const readMine = () => { try { return localStorage.getItem(MINE_KEY) === '1' } catch { return false } }
// Past Research and still unclaimed: flagged in the list.
const NEEDS_OWNER = new Set(['to_contact', 'contacted', 'talks', 'committed'])

function Tile({ label, value, alert, onClick, active }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`card text-left ${onClick ? 'cursor-pointer hover:border-gold' : ''}`}
      style={alert ? { borderColor: 'var(--coral)', background: 'var(--coral-dim)' } : active ? { borderColor: 'var(--gold)' } : undefined}
    >
      <div className="text-faint text-xs uppercase tracking-[0.08em] font-semibold">{label}</div>
      <div className={`font-mono text-2xl mt-1 ${alert ? 'text-coral' : 'text-gold'}`}>{value}</div>
    </Tag>
  )
}

function FollowUp({ p }) {
  if (!p.follow_up) return <span className="text-faint">—</span>
  const state = followUpState(p)
  const cls = state === 'over' ? 'text-coral font-semibold' : state === 'soon' ? 'text-amber' : 'text-muted'
  return <span className={`font-mono text-xs whitespace-nowrap ${cls}`}>{state === 'over' ? 'Overdue · ' : ''}{fmtDate(p.follow_up)}</span>
}

const Dot = ({ priority }) => (
  <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: priorityColor(priority) }} title={`${priority} priority`} />
)

function StartYear({ onDone }) {
  const { activeYear, eventYears } = useApp()
  const [sources, setSources] = useState([])
  const [err, setErr] = useState(null)

  useEffect(() => {
    supabase.from('sponsor_prospects').select('event_year_id').then(({ data }) => {
      const ids = new Set((data ?? []).map((r) => r.event_year_id))
      setSources(eventYears.filter((y) => y.id !== activeYear.id && ids.has(y.id)))
    })
  }, [activeYear, eventYears])

  async function copy(y) {
    const { error } = await supabase.rpc('sponsor_copy_year', { p_from: y.id, p_to: activeYear.id })
    if (error) setErr(error.message)
    else onDone()
  }

  if (!sources.length) return null
  return (
    <div className="card flex flex-col gap-2">
      <div className="text-sm text-muted">Start {activeYear.label}'s list from another year: same prospects and contacts, stages reset to Research, no commitments or follow-ups carried over.</div>
      <div className="flex gap-2 flex-wrap">
        {sources.map((y) => <button key={y.id} className="btn btn-sm" onClick={() => copy(y)}>Copy {y.label} prospects</button>)}
      </div>
      {err && <div className="text-coral text-sm">{err}</div>}
    </div>
  )
}

export default function Sponsors() {
  const { activeYear, session } = useApp()
  const [prospects, setProspects] = useState(null)
  const [missing, setMissing] = useState(false)
  const [loadErr, setLoadErr] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [contacts, setContacts] = useState([])
  const [view, setView] = useState({ stage: 'open', dueOnly: false, q: '', category: '', sort: readSort(), mine: readMine() })
  const [openId, setOpenId] = useState(null) // prospect id | 'new' | null
  const [files, setFiles] = useState([])
  const [mail, setMail] = useState(null)
  const [showFiles, setShowFiles] = useState(false)
  const [repliesOnly, setRepliesOnly] = useState(false)

  const load = useCallback(async () => {
    if (!activeYear) return
    const [p, prof, cts, fl, mc] = await Promise.all([
      supabase.from('sponsor_prospects')
        .select('*, transactions(id, amount, date), in_kind_donations(id, item_description, date_received), sponsor_activity(*), sponsor_emails(*)')
        .eq('event_year_id', activeYear.id),
      supabase.from('profiles').select('id, display_name, email').order('display_name'),
      supabase.from('contacts').select('id, name, type').order('name'),
      supabase.from('sponsor_files').select('*').order('created_at'),
      supabase.from('mail_connection').select('email, last_check_at, last_check_error').eq('id', 1).maybeSingle(),
    ])
    if (p.error) {
      if (/sponsor_|does not exist|schema cache/i.test(p.error.message)) setMissing(true)
      else setLoadErr(p.error.message)
      return
    }
    setMissing(false)
    setLoadErr(null)
    setProspects(p.data)
    setProfiles(prof.data ?? [])
    setContacts(cts.data ?? [])
    setFiles(fl.data ?? [])
    setMail(mc.data ?? null)
  }, [activeYear?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setProspects(null); load() }, [load])

  // Pick up crew members' changes when returning to the tab.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  const latestNote = useMemo(() => {
    const out = {}
    for (const p of prospects ?? []) {
      const notes = (p.sponsor_activity ?? []).filter((a) => a.kind === 'note').sort((a, b) => b.created_at.localeCompare(a.created_at))
      if (notes[0]) out[p.id] = notes[0].body
    }
    return out
  }, [prospects])

  if (!activeYear) return <div className="card text-faint text-sm">Create an event year first (Settings).</div>
  if (missing) {
    return (
      <div className="card text-sm">
        <div className="section-title mb-2">Sponsor tables not set up</div>
        <p className="text-muted">Run <code className="font-mono">supabase/migrations/005_sponsors.sql</code> in the Supabase SQL editor, then reload this page.</p>
      </div>
    )
  }
  if (loadErr) return <div className="card text-coral text-sm">Couldn't load sponsors: {loadErr}</div>
  if (!prospects) return <div className="text-faint text-sm">Loading sponsors…</div>

  const stats = summarize(prospects)
  const me = session.user.id
  const waiting = Object.fromEntries(prospects.map((p) => [p.id, openReplies(p.sponsor_emails).length]))
  const replyCount = Object.values(waiting).filter(Boolean).length
  const rows = filterProspects(prospects, view, latestNote)
    .filter((p) => !view.mine || p.owner_id === me)
    .filter((p) => !repliesOnly || waiting[p.id])
  const mineCount = prospects.filter((p) => p.owner_id === me).length
  const setV = (patch) => setView((v) => ({ ...v, ...patch }))
  const count = (id) => prospects.filter((p) => p.status === id).length
  const open = prospects.filter((p) => !CLOSED.has(p.status)).length
  const owners = Object.fromEntries(profiles.map((p) => [p.id, p.display_name || p.email]))
  const daysOut = activeYear.event_date
    ? Math.round((new Date(`${activeYear.event_date}T00:00:00`) - new Date(new Date().toDateString())) / 864e5)
    : null
  const panelProspect = openId && openId !== 'new' ? prospects.find((p) => p.id === openId) : null

  return (
    <>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="section-title">Sponsors — {activeYear.label}</div>
        {daysOut > 0 && <div className="text-faint text-sm">Ball night {fmtDate(activeYear.event_date)} · <span className="text-gold">{daysOut} days out</span></div>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile label="Cash committed" value={money(stats.cash)} />
        <Tile label="Cases committed" value={stats.cases.toLocaleString()} />
        <Tile label="Active conversations" value={stats.talks} />
        <Tile
          label={view.dueOnly ? 'Follow-ups due (showing)' : 'Follow-ups due'}
          value={stats.due}
          alert={stats.due > 0}
          active={view.dueOnly}
          onClick={() => setV({ dueOnly: !view.dueOnly })}
        />
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {[['open', 'Open', open], ...STAGES.map((s) => [s.id, s.label, count(s.id)]), ['all', 'All', prospects.length]].map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            className={`btn btn-sm ${!view.dueOnly && view.stage === id ? 'btn-primary' : ''}`}
            onClick={() => setV({ stage: id, dueOnly: false })}
          >
            {label} <span className="font-mono opacity-70">{n}</span>
          </button>
        ))}
      </div>

      {replyCount > 0 && (
        <button
          type="button"
          className="card text-left flex items-center justify-between gap-3 flex-wrap"
          style={{ borderColor: 'var(--coral)', background: 'var(--coral-dim)' }}
          onClick={() => setRepliesOnly(!repliesOnly)}
        >
          <span><span className="font-semibold text-coral">{replyCount} {replyCount === 1 ? 'prospect has' : 'prospects have'} a reply to handle.</span> <span className="text-muted text-sm">Open one to read it, then mark it handled or answer it.</span></span>
          <span className="btn btn-sm">{repliesOnly ? 'Show everyone' : 'Show only these'}</span>
        </button>
      )}

      <div className="grid grid-cols-2 md:grid-cols-[2fr_1fr_1fr_auto_auto_auto] gap-3">
        <input className="input col-span-2 md:col-span-1" placeholder="Search name, contact, ask, notes…" value={view.q} onChange={(e) => setV({ q: e.target.value })} />
        <select className="input" value={view.category} onChange={(e) => setV({ category: e.target.value })}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          className="input"
          value={view.sort}
          title="Sort"
          onChange={(e) => { setV({ sort: e.target.value }); try { localStorage.setItem(SORT_KEY, e.target.value) } catch { /* per-browser convenience only */ } }}
        >
          {SORTS.map((s) => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}
        </select>
        <button
          type="button"
          aria-pressed={view.mine}
          className={`btn ${view.mine ? 'btn-primary' : ''}`}
          title="Only prospects you own"
          onClick={() => { setV({ mine: !view.mine }); try { localStorage.setItem(MINE_KEY, view.mine ? '0' : '1') } catch { /* per-browser convenience only */ } }}
        >
          Mine <span className="font-mono opacity-70">{mineCount}</span>
        </button>
        <button type="button" aria-pressed={showFiles} className={`btn ${showFiles ? 'btn-primary' : ''}`} onClick={() => setShowFiles(!showFiles)}>
          Pitch files <span className="font-mono opacity-70">{files.length}</span>
        </button>
        <button className="btn btn-primary" onClick={() => setOpenId('new')}>+ Add prospect</button>
      </div>

      {showFiles && <PitchFiles files={files} onChanged={load} />}

      {view.dueOnly && (
        <div className="text-sm text-muted flex items-center gap-2">
          Showing follow-ups due today or earlier.
          <button className="btn btn-sm" onClick={() => setV({ dueOnly: false })}>Clear</button>
        </div>
      )}

      {!prospects.length ? (
        <>
          <div className="card text-center py-8">
            <div className="section-title mb-1">No prospects yet</div>
            <p className="text-muted text-sm">Add your first sponsor prospect with "+ Add prospect".</p>
          </div>
          <StartYear onDone={load} />
        </>
      ) : !rows.length ? (
        <div className="card text-faint text-sm text-center py-6">Nothing matches these filters.</div>
      ) : (
        <>
          {/* Wide screens: table */}
          <div className="card overflow-x-auto hidden md:block !p-0">
            <table className="tbl">
              <thead>
                <tr><th>Prospect</th><th>Contact</th><th>Stage</th><th>Next step</th><th>Follow up</th></tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="cursor-pointer" onClick={() => setOpenId(p.id)}>
                    <td>
                      <div className="flex items-center gap-2 font-semibold"><Dot priority={p.priority} />{p.name}</div>
                      <div className="text-faint text-xs">{p.category}{p.tier ? ` · ${p.tier} target` : ''}</div>
                    </td>
                    <td>
                      <div className={p.contact_name ? '' : 'text-faint'}>{p.contact_name || 'No contact yet'}</div>
                      <div className="text-faint text-xs">{p.contact_title}</div>
                    </td>
                    <td>
                      <span className={`chip ${stageOf(p.status).chip}`}>{stageOf(p.status).label}</span>
                      {waiting[p.id] > 0 && <div className="mt-1"><span className="chip chip-coral">Replied</span></div>}
                    </td>
                    <td className="text-muted text-sm max-w-72">
                      {p.next_step}
                      {p.owner_id && owners[p.owner_id] && <div className="text-faint text-xs">{owners[p.owner_id]}</div>}
                      {!p.owner_id && NEEDS_OWNER.has(p.status) && <div className="text-amber text-xs">No owner yet</div>}
                    </td>
                    <td><FollowUp p={p} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Narrow screens: cards */}
          <div className="flex flex-col gap-2 md:hidden">
            {rows.map((p) => (
              <button key={p.id} type="button" className="card text-left flex flex-col gap-1" onClick={() => setOpenId(p.id)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-semibold"><Dot priority={p.priority} />{p.name}</span>
                  <span className="flex gap-1">
                    {waiting[p.id] > 0 && <span className="chip chip-coral">Replied</span>}
                    <span className={`chip ${stageOf(p.status).chip}`}>{stageOf(p.status).label}</span>
                  </span>
                </div>
                <div className="text-faint text-xs">{p.category}{p.tier ? ` · ${p.tier} target` : ''}{p.contact_name ? ` · ${p.contact_name}` : ''}</div>
                {p.next_step && <div className="text-muted text-sm">{p.next_step}</div>}
                <div className="flex items-center justify-between gap-2">
                  <FollowUp p={p} />
                  {p.owner_id && owners[p.owner_id]
                    ? <span className="text-faint text-xs">{owners[p.owner_id]}</span>
                    : NEEDS_OWNER.has(p.status) && <span className="text-amber text-xs">No owner yet</span>}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {openId && (openId === 'new' || panelProspect) && (
        <ProspectPanel
          key={openId}
          prospect={panelProspect}
          activity={panelProspect?.sponsor_activity ?? []}
          profiles={profiles}
          contacts={contacts}
          files={files}
          mail={mail}
          onClose={() => setOpenId(null)}
          onSaved={async (id) => {
            // Reload first: switching the panel to a just-created prospect
            // before it's in the list would close the panel until the reload lands.
            await load()
            if (id) setOpenId(id)
          }}
        />
      )}
    </>
  )
}
