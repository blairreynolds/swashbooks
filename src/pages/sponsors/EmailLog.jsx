import { useState } from 'react'
import { useApp } from '../../lib/AppContext'
import { gmailThreadUrl, markHandled } from '../../lib/sponsorMail'

const when = (iso) => {
  try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
  catch { return iso }
}
const shortAddr = (v = '') => v.replace(/\s*<[^>]+>/, '').replace(/"/g, '') || v

// Emails in the threads this prospect's pitches started, newest first.
export default function EmailLog({ emails, mail, onChanged }) {
  const { isAdmin } = useApp()
  const [open, setOpen] = useState(() => new Set(emails.filter((e) => e.direction === 'in' && !e.handled_at).map((e) => e.id)))
  const [err, setErr] = useState(null)
  if (!emails.length) return null

  const sorted = [...emails].sort((a, b) => b.sent_at.localeCompare(a.sent_at))
  const toggle = (id) => setOpen((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  async function handled(e, value) {
    setErr(null)
    try { await markHandled(e.id, value); onChanged() }
    catch (x) { setErr(x.message) }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="section-title !text-sm">Email</div>
        {isAdmin && mail?.email && sorted[0] && (
          <a className="text-xs" href={gmailThreadUrl(mail.email, sorted[0].gmail_thread_id)} target="_blank" rel="noopener noreferrer">Open in Gmail ↗</a>
        )}
      </div>
      {err && <div className="text-coral text-sm">{err}</div>}
      {sorted.map((e) => {
        const reply = e.direction === 'in'
        const waiting = reply && !e.handled_at
        return (
          <div
            key={e.id}
            className="rounded p-2.5 bg-card2 flex flex-col gap-1"
            style={waiting ? { border: '1px solid var(--coral)', background: 'var(--coral-dim)' } : undefined}
          >
            <button type="button" className="flex justify-between gap-2 text-left" onClick={() => toggle(e.id)}>
              <span className="text-sm min-w-0">
                <span className={`chip ${e.bounced ? 'chip-coral' : reply ? 'chip-gold' : 'chip-muted'} mr-1.5`}>{e.bounced ? 'Bounced' : reply ? 'Reply' : 'Sent'}</span>
                <span className="font-semibold">{e.subject || '(no subject)'}</span>
              </span>
              <span className="text-faint text-xs whitespace-nowrap">{when(e.sent_at)}</span>
            </button>
            <div className="text-faint text-xs">
              {reply ? `From ${shortAddr(e.from_addr)}` : `To ${e.to_addr}`}
              {e.attachments?.length > 0 && ` · attached: ${e.attachments.map((a) => a.label).join(', ')}`}
            </div>
            {open.has(e.id) && e.body_text && <div className="text-sm whitespace-pre-wrap mt-1">{e.body_text}</div>}
            {reply && (
              <div className="flex items-center gap-2 mt-1">
                {waiting
                  ? <button type="button" className="btn btn-sm" onClick={() => handled(e, true)}>Mark handled</button>
                  : <><span className="text-faint text-xs">Handled</span><button type="button" className="btn btn-sm" onClick={() => handled(e, false)}>Undo</button></>}
                {e.owner_notified_at && <span className="text-faint text-xs">Owner emailed</span>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
