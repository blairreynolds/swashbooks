import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/AppContext'
import { todayISO } from '../../lib/format'
import { addDaysISO } from '../../lib/sponsors'
import { draftPitch, draftFollowUp, mailtoHref } from '../../lib/pitchTemplates'
import { callMail, fmtBytes, MAX_ATTACH_BYTES, REPLIES_EVENT } from '../../lib/sponsorMail'
import { Field } from '../planner/widgets'

// Stages where a pitch or follow-up email makes sense.
const PITCHABLE = new Set(['research', 'to_contact', 'contacted', 'talks', 'parked'])
const BEFORE_CONTACT = new Set(['research', 'to_contact', 'parked'])

// files: the pitch-file library; emails: this prospect's sponsor_emails;
// mail: the Gmail connection (null until an admin connects one).
export default function PitchDraft({ prospect, notes, emails = [], files = [], mail, blocked, onChanged }) {
  const { settings, activeYear, profile, session, isAdmin } = useApp()
  // { subject, body, to, fileIds, inThread, source: 'template' | 'claude', generated }
  const [draft, setDraft] = useState(null)
  const [guidance, setGuidance] = useState('')
  const [busy, setBusy] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [msg, setMsg] = useState(null)

  if (!PITCHABLE.has(prospect.status)) return null
  const firstPitch = BEFORE_CONTACT.has(prospect.status)
  const canSend = isAdmin && Boolean(mail?.email)
  const latest = [...emails].sort((a, b) => b.sent_at.localeCompare(a.sent_at))[0]
  const lastOut = emails.filter((e) => e.direction === 'out').sort((a, b) => b.sent_at.localeCompare(a.sent_at))[0]
  const threadSubject = (() => {
    const s = latest?.subject || lastOut?.subject || ''
    return /^re:/i.test(s) ? s : `Re: ${s}`
  })()
  const labelsFor = (fileIds) => files.filter((f) => fileIds.includes(f.id)).map((f) => f.label)

  function write(fileIds, inThread) {
    const common = {
      prospect, settings, eventDate: activeYear?.event_date,
      senderName: profile?.display_name, senderTitle: profile?.pitch_title, attached: labelsFor(fileIds),
    }
    return inThread && lastOut
      ? draftFollowUp({ ...common, lastSentAt: lastOut.sent_at, lastSubject: latest?.subject || lastOut.subject })
      : draftPitch({ ...common, notes })
  }

  const defaults = () => ({
    fileIds: canSend ? files.filter((f) => f.attach_by_default).map((f) => f.id) : [],
    inThread: canSend && !firstPitch && Boolean(lastOut),
  })

  function start() {
    setMsg(null)
    const { fileIds, inThread } = defaults()
    const d = write(fileIds, inThread)
    setDraft({ ...d, to: prospect.email || '', fileIds, inThread, source: 'template', generated: d.body })
  }

  // Claude writes it from the prospect's details, notes and earlier emails.
  async function claudeDraft() {
    const base = draft ?? { ...defaults(), to: prospect.email || '' }
    if (draft && draft.body !== draft.generated && !confirm('Replace your edits with a new Claude draft?')) return
    setDrafting(true)
    setMsg(null)
    try {
      const d = await callMail('draft', {
        prospect_id: prospect.id,
        attached: labelsFor(base.fileIds),
        follow_up: !firstPitch && Boolean(lastOut),
        guidance,
      })
      const subject = base.inThread ? threadSubject : d.subject
      setDraft({ ...base, subject, body: d.body, source: 'claude', generated: d.body })
    } catch (e) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setDrafting(false)
    }
  }

  // New attachments or threading: a template draft is re-written unless it's been
  // edited by hand; a Claude draft keeps its text (redraft to change it).
  function rework(fileIds, inThread) {
    const untouched = draft.source === 'template' && draft.body === draft.generated
    const d = write(fileIds, inThread)
    const subject = inThread === draft.inThread ? draft.subject : draft.source === 'claude' ? (inThread ? threadSubject : draft.subject) : d.subject
    setDraft({
      ...draft,
      fileIds,
      inThread,
      subject,
      body: untouched ? d.body : draft.body,
      generated: untouched ? d.body : draft.generated,
    })
  }

  const toggleFile = (id) =>
    rework(draft.fileIds.includes(id) ? draft.fileIds.filter((x) => x !== id) : [...draft.fileIds, id], draft.inThread)

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`)
      setMsg({ ok: true, text: 'Copied.' })
    } catch {
      setMsg({ ok: false, text: "Couldn't copy — select the text and copy it manually." })
    }
  }

  async function send() {
    setBusy(true)
    setMsg(null)
    try {
      const out = await callMail('send', {
        prospect_id: prospect.id,
        to: draft.to,
        subject: draft.subject,
        body: draft.body,
        file_ids: draft.fileIds,
        in_thread: draft.inThread,
      })
      setDraft(null)
      setMsg(out.log_problems?.length
        ? { ok: false, text: `Sent, but it didn't all get logged: ${out.log_problems.join('; ')}` }
        : { ok: true, text: `Sent from ${mail.email}.` })
      window.dispatchEvent(new Event(REPLIES_EVENT))
      onChanged()
    } catch (e) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  // Logs an email sent some other way. A first pitch moves the stage to
  // Contacted, and the database then sets the follow-up a week out; a later
  // email just pushes the follow-up.
  async function markSent() {
    setBusy(true)
    setMsg(null)
    try {
      const patch = {}
      if (!prospect.owner_id) patch.owner_id = session.user.id
      if (firstPitch) patch.status = 'contacted'
      else patch.follow_up = addDaysISO(todayISO(), 7)
      const { error: e1 } = await supabase.from('sponsor_prospects').update(patch).eq('id', prospect.id)
      if (e1) throw e1
      const to = prospect.email ? ` to ${prospect.email}` : ''
      const { error: e2 } = await supabase.from('sponsor_activity').insert({
        prospect_id: prospect.id,
        body: `${firstPitch ? 'Pitch' : 'Follow-up'} emailed${to}: "${draft.subject}"`,
      })
      if (e2) throw e2
      setDraft(null)
      onChanged()
    } catch (e) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const attachBytes = draft ? files.filter((f) => draft.fileIds.includes(f.id)).reduce((n, f) => n + Number(f.size_bytes), 0) : 0
  const tooBig = attachBytes > MAX_ATTACH_BYTES
  const mentionsAttachment = draft && /attach/i.test(draft.body)

  return (
    <div className="flex flex-col gap-2">
      <div className="section-title !text-sm">{firstPitch ? 'Pitch' : 'Follow-up email'}</div>
      {!draft ? (
        <div className="flex flex-col gap-2">
          <input
            className="input"
            placeholder="Optional: steer Claude (e.g. mention our tiki bar, keep it short)"
            aria-label="Direction for Claude"
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            disabled={blocked || drafting}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" className="btn btn-sm btn-primary" disabled={blocked || drafting} onClick={claudeDraft}>
              {drafting ? 'Claude is writing…' : `Draft ${firstPitch ? 'pitch' : 'follow-up'} with Claude`}
            </button>
            <button type="button" className="btn btn-sm" disabled={blocked || drafting} onClick={start}>Use the template</button>
            {blocked && <span className="text-amber text-xs">Save your changes above first.</span>}
          </div>
          {!blocked && (
            <span className="text-faint text-xs">
              Claude writes from this prospect's details, notes and earlier emails, plus the talking points in Settings.
              {canSend ? ` You review it, then send it from ${mail.email}.` : ' You review it and send it from your own email.'}
              {isAdmin && !mail?.email && <> <Link to="/settings">Connect Gmail</Link> to send from here.</>}
            </span>
          )}
        </div>
      ) : (
        <div className="rounded bg-card2 p-3 flex flex-col gap-2">
          {canSend ? (
            <Field label={`To (from ${mail.email})`}>
              <input className="input" type="text" placeholder="name@example.com" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            </Field>
          ) : !prospect.email && (
            <div className="text-amber text-xs">No email address on file — add one above, or fill in the recipient in your email app.</div>
          )}
          {canSend && lastOut && (
            <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
              <input type="checkbox" checked={draft.inThread} onChange={(e) => rework(draft.fileIds, e.target.checked)} />
              Reply in the earlier thread ("{latest?.subject || lastOut.subject}")
            </label>
          )}
          <Field label="Subject">
            <input className="input" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          </Field>
          <Field label="Message">
            <textarea className="input" rows={12} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </Field>
          <input
            className="input"
            placeholder="Direction for a redraft (optional)"
            aria-label="Direction for Claude"
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            disabled={drafting}
          />

          {canSend && (
            <div className="flex flex-col gap-1">
              <div className="text-faint text-xs uppercase tracking-[0.08em] font-semibold">Attach</div>
              {files.length ? files.map((f) => (
                <label key={f.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={draft.fileIds.includes(f.id)} onChange={() => toggleFile(f.id)} />
                  {f.label} <span className="text-faint text-xs">{fmtBytes(f.size_bytes)}</span>
                </label>
              )) : <div className="text-faint text-xs">No pitch files yet. Upload them under "Pitch files" on the Sponsors page.</div>}
              {tooBig && <div className="text-coral text-xs">That's {fmtBytes(attachBytes)} of attachments; Gmail tops out around 20 MB. Leave one off.</div>}
              {draft.fileIds.length > 0 && !mentionsAttachment && <div className="text-amber text-xs">The message doesn't mention the attachments.</div>}
            </div>
          )}

          <div className="flex gap-2 flex-wrap items-center">
            {canSend ? (
              <button type="button" className="btn btn-sm btn-primary" disabled={busy || tooBig || !draft.to.trim()} onClick={send}>
                {busy ? 'Sending…' : 'Send'}
              </button>
            ) : (
              <a className="btn btn-sm btn-primary no-underline" href={mailtoHref(prospect.email, draft.subject, draft.body)}>Open in my email</a>
            )}
            <button type="button" className="btn btn-sm" disabled={drafting} onClick={claudeDraft} title="Uses the direction box and the ticked attachments">
              {drafting ? 'Claude is writing…' : draft.source === 'claude' ? 'Redraft with Claude' : 'Draft with Claude'}
            </button>
            <button type="button" className="btn btn-sm" onClick={copy}>Copy</button>
            <button type="button" className="btn btn-sm" onClick={() => setDraft(null)}>Discard</button>
            {canSend && (
              <span className="text-faint text-xs">
                {firstPitch ? 'Sending moves this to Contacted with a follow-up a week out.' : 'Sending sets the follow-up a week out.'}
                {!prospect.owner_id && ' You become the owner.'}
              </span>
            )}
          </div>
          <div className="flex gap-2 flex-wrap items-center border-t border-bdr pt-2">
            <button type="button" className="btn btn-sm" disabled={busy} onClick={markSent}>
              {canSend ? 'I sent it another way — log it' : firstPitch ? 'I sent it — mark Contacted' : 'I sent it — log it'}
            </button>
            <span className="text-faint text-xs">
              {firstPitch
                ? 'Moves this to Contacted, sets a follow-up a week out, and logs the email in the history.'
                : 'Logs the email in the history and sets the follow-up a week out.'}
              {!prospect.owner_id && ' You become the owner.'}
            </span>
          </div>
        </div>
      )}
      {msg && <div className={`text-sm ${msg.ok ? 'text-grn' : 'text-coral'}`}>{msg.text}</div>}
    </div>
  )
}
