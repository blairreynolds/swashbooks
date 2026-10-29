import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/AppContext'
import { todayISO } from '../../lib/format'
import { addDaysISO } from '../../lib/sponsors'
import { draftPitch, mailtoHref } from '../../lib/pitchTemplates'
import { Field } from '../planner/widgets'

// Stages where a pitch or follow-up email makes sense.
const PITCHABLE = new Set(['research', 'to_contact', 'contacted', 'talks', 'parked'])
const BEFORE_CONTACT = new Set(['research', 'to_contact', 'parked'])

export default function PitchDraft({ prospect, notes, blocked, onChanged }) {
  const { settings, activeYear, profile, session } = useApp()
  const [draft, setDraft] = useState(null) // { subject, body }
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  if (!PITCHABLE.has(prospect.status)) return null
  const firstPitch = BEFORE_CONTACT.has(prospect.status)

  function start() {
    setMsg(null)
    setDraft(draftPitch({
      prospect,
      notes,
      settings,
      eventDate: activeYear?.event_date,
      senderName: profile?.display_name,
    }))
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`)
      setMsg({ ok: true, text: 'Copied.' })
    } catch {
      setMsg({ ok: false, text: "Couldn't copy — select the text and copy it manually." })
    }
  }

  // Logs the send. A first pitch moves the stage to Contacted, and the database
  // then sets the follow-up a week out; a later email just pushes the follow-up.
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

  return (
    <div className="flex flex-col gap-2">
      <div className="section-title !text-sm">{firstPitch ? 'Pitch' : 'Follow-up email'}</div>
      {!draft ? (
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" className="btn btn-sm btn-primary" disabled={blocked} onClick={start}>
            {firstPitch ? 'Draft pitch email' : 'Draft follow-up email'}
          </button>
          {blocked && <span className="text-amber text-xs">Save your changes above first.</span>}
          {!blocked && <span className="text-faint text-xs">Written from the tier, ask and notes. You review it and send it from your own email.</span>}
        </div>
      ) : (
        <div className="rounded bg-card2 p-3 flex flex-col gap-2">
          {!prospect.email && (
            <div className="text-amber text-xs">No email address on file — add one above, or fill in the recipient in your email app.</div>
          )}
          <Field label="Subject">
            <input className="input" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          </Field>
          <Field label="Message">
            <textarea className="input" rows={12} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </Field>
          <div className="flex gap-2 flex-wrap items-center">
            <a className="btn btn-sm btn-primary no-underline" href={mailtoHref(prospect.email, draft.subject, draft.body)}>Open in my email</a>
            <button type="button" className="btn btn-sm" onClick={copy}>Copy</button>
            <button type="button" className="btn btn-sm" onClick={() => setDraft(null)}>Discard</button>
          </div>
          <div className="flex gap-2 flex-wrap items-center border-t border-bdr pt-2">
            <button type="button" className="btn btn-sm" disabled={busy} onClick={markSent}>
              {firstPitch ? 'I sent it — mark Contacted' : 'I sent it — log it'}
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
