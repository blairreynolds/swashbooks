// Sponsor email through Gmail. One function, four jobs:
//   GET  ?code=&state=        Google sign-in callback: stores the Gmail connection
//   POST {action: 'connect'}  admin: returns the Google sign-in URL
//   POST {action: 'send'}     admin: sends a pitch from the Sponsors page
//   POST {action: 'check'}    cron job (x-cron-secret) or admin: logs new
//                             messages in threads the Sponsors page started
// Deployed with verify_jwt off because Google's callback and the cron job carry
// no Supabase session; every POST checks its caller below.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   OAuth client from Google Cloud
//   APP_URL (optional)                       defaults to the GitHub Pages site

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { buildMime, formatAddress, header, isBounce, messageText, parseAddress, type Attachment } from './mail.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? 'https://blairreynolds.github.io/swashbooks/'
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/sponsor-mail`
const SCOPES = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly'
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'

const MAX_ATTACH_BYTES = 20 * 1024 * 1024 // Gmail's 25MB cap, less base64 overhead
const TRACK_DAYS = 150 // stop watching threads this long after the last send
const BEFORE_CONTACT = new Set(['research', 'to_contact', 'parked'])

const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Today's date in Oregon, plus n days.
function oregonDate(plusDays = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + plusDays)
  return d.toISOString().slice(0, 10)
}

// --- Who's calling ---

interface Caller { id: string; admin: boolean; db: SupabaseClient; name: string }

async function caller(req: Request): Promise<Caller | null> {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return null
  const db = createClient(SUPABASE_URL, req.headers.get('apikey') || ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
  const { data, error } = await db.auth.getUser(auth.slice(7))
  if (error || !data.user) return null
  const { data: profile } = await db.from('profiles').select('role, display_name').eq('id', data.user.id).single()
  return { id: data.user.id, admin: profile?.role === 'admin', db, name: profile?.display_name || '' }
}

// --- Google ---

async function googleToken(params: Record<string, string>) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  })
  return { ok: r.ok, body: await r.json() }
}

async function accessToken(): Promise<string> {
  const { data: refresh, error } = await svc.rpc('mail_refresh_token')
  if (error) throw error
  if (!refresh) throw new HttpError(409, "Gmail isn't connected yet. An admin can connect it in Settings.")
  const t = await googleToken({ refresh_token: refresh, grant_type: 'refresh_token' })
  if (!t.ok) throw new HttpError(502, `Google refused the saved Gmail connection (${t.body.error}). Reconnect Gmail in Settings.`)
  return t.body.access_token
}

// deno-lint-ignore no-explicit-any
async function gmail(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${GMAIL}/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new HttpError(502, `Gmail: ${body.error?.message ?? r.statusText}`)
  return body
}

// Media upload endpoint: takes up to 35MB, where the plain JSON one stops at 5MB.
async function gmailSend(token: string, mime: string, threadId?: string) {
  const b = `swash_rel_${crypto.randomUUID()}`
  const body = [
    `--${b}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify(threadId ? { threadId } : {}),
    `--${b}`, 'Content-Type: message/rfc822', '', mime,
    `--${b}--`, '',
  ].join('\r\n')
  const r = await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${b}` },
    body,
  })
  const out = await r.json().catch(() => ({}))
  if (!r.ok) throw new HttpError(502, `Gmail didn't send it: ${out.error?.message ?? r.statusText}`)
  return out as { id: string; threadId: string }
}

async function connection() {
  const { data } = await svc.from('mail_connection').select('*').eq('id', 1).maybeSingle()
  return data
}

// --- connect: start the Google sign-in ---

async function connect(who: Caller, body: { return_to?: string }) {
  if (!who.admin) throw new HttpError(403, 'Only an admin can connect Gmail.')
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new HttpError(409, 'The Google OAuth client isn\'t set up yet: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the Edge Function secrets.')
  }
  const back = body.return_to ?? ''
  const returnTo = back.startsWith(APP_URL) || /^http:\/\/localhost:\d+\//.test(back) ? back : APP_URL
  const nonce = crypto.randomUUID()
  await svc.from('mail_oauth_states').delete().lt('created_at', new Date(Date.now() - 3600e3).toISOString())
  const { error } = await svc.from('mail_oauth_states').insert({ nonce, user_id: who.id, return_to: returnTo })
  if (error) throw error
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: CALLBACK_URL,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: nonce,
  }).toString()
  return { url: url.toString() }
}

// --- Google sends the browser back here ---

async function oauthCallback(url: URL): Promise<Response> {
  const nonce = url.searchParams.get('state') ?? ''
  const { data: state } = await svc.from('mail_oauth_states').select('*').eq('nonce', nonce).maybeSingle()
  if (!state || Date.now() - new Date(state.created_at).getTime() > 15 * 60e3) {
    return new Response('This sign-in link has expired. Go back to SwashBooks Settings and press Connect Gmail again.', { status: 400 })
  }
  await svc.from('mail_oauth_states').delete().eq('nonce', nonce)
  const back = (status: string) => Response.redirect(`${state.return_to}#/settings?gmail=${encodeURIComponent(status)}`, 302)

  const code = url.searchParams.get('code')
  if (!code) return back(url.searchParams.get('error') || 'cancelled')
  const t = await googleToken({ code, grant_type: 'authorization_code', redirect_uri: CALLBACK_URL })
  if (!t.ok) return back(`error:${t.body.error}`)
  if (!t.body.refresh_token) return back('error:no_refresh_token')
  const granted = String(t.body.scope ?? '')
  if (!granted.includes('gmail.send') || !granted.includes('gmail.readonly')) return back('error:missing_permissions')

  const profile = await gmail(t.body.access_token, 'profile')
  const { error } = await svc.rpc('mail_store_refresh_token', { p_token: t.body.refresh_token })
  if (error) return back(`error:${error.message}`)
  await svc.from('mail_connection').upsert({
    id: 1,
    email: profile.emailAddress,
    connected_by: state.user_id,
    connected_at: new Date().toISOString(),
    last_check_error: null,
  })
  return back('connected')
}

// --- send: a pitch or follow-up from the Sponsors page ---

interface SendBody { prospect_id: string; to: string; subject: string; body: string; file_ids?: string[]; in_thread?: boolean }

async function send(who: Caller, b: SendBody) {
  if (!who.admin) throw new HttpError(403, 'Only an admin can send from the Sponsors page.')
  const to = (b.to ?? '').replace(/[\r\n]+/g, ' ').split(/[,;]/).map((s) => s.trim()).filter(Boolean)
  if (!to.length) throw new HttpError(400, 'Add who it goes to.')
  if (to.length > 5) throw new HttpError(400, 'Five recipients at most.')
  const bad = to.find((a) => !/^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(parseAddress(a).email))
  if (bad) throw new HttpError(400, `"${bad}" doesn't look like an email address.`)
  if (!b.subject?.trim() || !b.body?.trim()) throw new HttpError(400, 'Add a subject and a message.')

  const { data: prospect, error: pErr } = await who.db.from('sponsor_prospects')
    .select('id, name, status, owner_id').eq('id', b.prospect_id).single()
  if (pErr || !prospect) throw new HttpError(404, 'That prospect no longer exists.')

  const conn = await connection()
  if (!conn?.email) throw new HttpError(409, "Gmail isn't connected yet. An admin can connect it in Settings.")
  const token = await accessToken()

  // Attachments, straight from the pitch-file library.
  const attachments: Attachment[] = []
  const attachedInfo: { id: string; label: string; filename: string }[] = []
  if (b.file_ids?.length) {
    const { data: files, error } = await svc.from('sponsor_files').select('*').in('id', b.file_ids)
    if (error) throw error
    const total = (files ?? []).reduce((n, f) => n + Number(f.size_bytes || 0), 0)
    if (total > MAX_ATTACH_BYTES) {
      throw new HttpError(400, `Those attachments add up to ${(total / 1048576).toFixed(1)}MB; Gmail tops out around 20MB. Leave one off.`)
    }
    for (const f of files ?? []) {
      const { data: blob, error: dErr } = await svc.storage.from('sponsor-files').download(f.storage_path)
      if (dErr || !blob) throw new HttpError(500, `Couldn't load "${f.label}" from the file library.`)
      attachments.push({ filename: f.filename, mime: f.mime_type || blob.type, bytes: new Uint8Array(await blob.arrayBuffer()) })
      attachedInfo.push({ id: f.id, label: f.label, filename: f.filename })
    }
  }

  // Reply in the prospect's latest thread, if asked and there is one.
  let threadId: string | undefined
  let inReplyTo: string | undefined
  let references: string | undefined
  if (b.in_thread) {
    const { data: last } = await svc.from('sponsor_emails').select('gmail_message_id, gmail_thread_id')
      .eq('prospect_id', prospect.id).order('sent_at', { ascending: false }).limit(1).maybeSingle()
    if (last) {
      const m = await gmail(token, `messages/${last.gmail_message_id}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`)
      threadId = last.gmail_thread_id
      inReplyTo = header(m, 'Message-ID') || undefined
      references = [header(m, 'References'), inReplyTo].filter(Boolean).join(' ') || undefined
    }
  }

  const mime = buildMime({
    from: formatAddress(who.name, conn.email),
    to: to.join(', '),
    subject: b.subject.trim(),
    text: b.body,
    inReplyTo,
    references,
    attachments,
  })
  const sent = await gmailSend(token, mime, threadId)

  // Sent. From here on, a failure only means the log is incomplete.
  const problems: string[] = []
  const now = new Date().toISOString()
  const { error: eErr } = await svc.from('sponsor_emails').insert({
    prospect_id: prospect.id,
    direction: 'out',
    gmail_message_id: sent.id,
    gmail_thread_id: sent.threadId,
    from_addr: conn.email,
    to_addr: to.join(', '),
    subject: b.subject.trim(),
    body_text: b.body,
    attachments: attachedInfo,
    sent_by: who.id,
    sent_at: now,
  })
  if (eErr) problems.push(eErr.message)
  // Writing back means the open replies on this prospect are answered.
  await svc.from('sponsor_emails').update({ handled_at: now, handled_by: who.id })
    .eq('prospect_id', prospect.id).eq('direction', 'in').is('handled_at', null)

  const firstPitch = BEFORE_CONTACT.has(prospect.status)
  const patch: Record<string, unknown> = {}
  if (!prospect.owner_id) patch.owner_id = who.id
  if (firstPitch) patch.status = 'contacted' // the database sets the follow-up a week out (migration 008)
  else patch.follow_up = oregonDate(7)
  const { error: uErr } = await who.db.from('sponsor_prospects').update(patch).eq('id', prospect.id)
  if (uErr) problems.push(uErr.message)

  const attachedNote = attachedInfo.length ? `\nAttached: ${attachedInfo.map((a) => a.label).join(', ')}` : ''
  const { error: nErr } = await who.db.from('sponsor_activity').insert({
    prospect_id: prospect.id,
    body: `${firstPitch ? 'Pitch' : 'Email'} sent to ${to.join(', ')}: "${b.subject.trim()}"${attachedNote}`,
  })
  if (nErr) problems.push(nErr.message)

  return { sent: true, thread_id: sent.threadId, log_problems: problems }
}

// --- check: log new messages in our threads, notify owners ---

async function check() {
  const conn = await connection()
  if (!conn?.email) return { skipped: 'not connected' }
  try {
    const result = await checkThreads(conn)
    await svc.from('mail_connection').update({ last_check_at: new Date().toISOString(), last_check_error: null }).eq('id', 1)
    return result
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await svc.from('mail_connection').update({ last_check_at: new Date().toISOString(), last_check_error: message }).eq('id', 1)
    throw e
  }
}

// deno-lint-ignore no-explicit-any
async function checkThreads(conn: any) {
  const token = await accessToken()
  const since = new Date(Date.now() - TRACK_DAYS * 864e5).toISOString()
  const { data: recent, error } = await svc.from('sponsor_emails').select('gmail_thread_id, prospect_id')
    .eq('direction', 'out').gte('sent_at', since)
  if (error) throw error
  const threads = new Map<string, string>() // thread -> prospect
  for (const r of recent ?? []) threads.set(r.gmail_thread_id, r.prospect_id)
  if (!threads.size) return { threads: 0, new_messages: 0 }

  const { data: known } = await svc.from('sponsor_emails').select('gmail_message_id').in('gmail_thread_id', [...threads.keys()])
  const seen = new Set((known ?? []).map((k) => k.gmail_message_id))

  // deno-lint-ignore no-explicit-any
  const fresh: { prospectId: string; msg: any }[] = []
  for (const [threadId, prospectId] of threads) {
    let t
    try {
      t = await gmail(token, `threads/${threadId}?format=minimal`)
    } catch (e) {
      if (e instanceof HttpError && /not found/i.test(e.message)) continue // deleted in Gmail
      throw e
    }
    for (const m of t.messages ?? []) {
      if (seen.has(m.id) || (m.labelIds ?? []).includes('DRAFT')) continue
      fresh.push({ prospectId, msg: await gmail(token, `messages/${m.id}?format=full`) })
    }
  }
  fresh.sort((a, b) => Number(a.msg.internalDate) - Number(b.msg.internalDate))

  const replies: { prospectId: string; emailId: string; from: string; subject: string; text: string; bounced: boolean }[] = []
  for (const { prospectId, msg } of fresh) {
    const fromHeader = header(msg, 'From')
    const from = parseAddress(fromHeader)
    const mine = (msg.labelIds ?? []).includes('SENT') || from.email === String(conn.email).toLowerCase()
    const subject = header(msg, 'Subject')
    const text = messageText(msg).slice(0, 8000)
    const sentAt = new Date(Number(msg.internalDate)).toISOString()
    const bounced = !mine && isBounce(fromHeader)

    const { data: row } = await svc.from('sponsor_emails').upsert({
      prospect_id: prospectId,
      direction: mine ? 'out' : 'in',
      gmail_message_id: msg.id,
      gmail_thread_id: msg.threadId,
      from_addr: fromHeader,
      to_addr: header(msg, 'To'),
      subject,
      body_text: text,
      bounced,
      sent_by: mine ? conn.connected_by : null,
      sent_at: sentAt,
    }, { onConflict: 'gmail_message_id', ignoreDuplicates: true }).select('id').maybeSingle()
    if (!row) continue // another check got there first

    if (mine) {
      // Answered straight from Gmail: log it and clear the open replies.
      await svc.from('sponsor_emails').update({ handled_at: sentAt, handled_by: conn.connected_by })
        .eq('prospect_id', prospectId).eq('direction', 'in').is('handled_at', null).lte('sent_at', sentAt)
      await svc.from('sponsor_activity').insert({
        prospect_id: prospectId,
        body: `Email sent from Gmail to ${header(msg, 'To')}: "${subject}"`,
        created_by: conn.connected_by,
      })
    } else {
      const who = from.name || from.email
      await svc.from('sponsor_activity').insert({
        prospect_id: prospectId,
        body: bounced
          ? `Bounced: the email "${subject}" couldn't be delivered. Check the address.`
          : `Reply from ${who}: "${subject}"\n\n${text.slice(0, 1200)}${text.length > 1200 ? '…' : ''}`,
        author_label: bounced ? 'Mail delivery' : `Email from ${who}`,
      })
      replies.push({ prospectId, emailId: row.id, from: fromHeader, subject, text, bounced })
    }
  }

  const notified = await notifyOwners(token, conn, replies)
  return { threads: threads.size, new_messages: fresh.length, replies: replies.length, owners_notified: notified }
}

// Forward replies to the prospect's owner, unless the owner is the Gmail account holder.
// deno-lint-ignore no-explicit-any
async function notifyOwners(token: string, conn: any, replies: any[]) {
  if (!replies.length) return 0
  const ids = [...new Set(replies.map((r) => r.prospectId))]
  const { data: prospects } = await svc.from('sponsor_prospects').select('id, name, owner_id').in('id', ids)
  const ownerIds = [...new Set((prospects ?? []).map((p) => p.owner_id).filter((o) => o && o !== conn.connected_by))]
  if (!ownerIds.length) return 0
  const { data: owners } = await svc.from('profiles').select('id, email, display_name').in('id', ownerIds)
  const ownerOf = new Map((owners ?? []).map((o) => [o.id, o]))

  let n = 0
  for (const r of replies) {
    const p = (prospects ?? []).find((x) => x.id === r.prospectId)
    const owner = p && ownerOf.get(p.owner_id)
    if (!owner?.email) continue
    const text = [
      `Hi ${owner.display_name || 'there'},`,
      '',
      r.bounced
        ? `An email to ${p.name} bounced: "${r.subject}". The address on file may be wrong.`
        : `${p.name} replied to "${r.subject}". You're the owner on this one in SwashBooks.`,
      '',
      ...(r.bounced ? [] : [`From: ${r.from}`, '', r.text.slice(0, 4000), '']),
      `Open the Sponsors page: ${APP_URL}#/sponsors`,
      '',
      `Replies go to ${conn.email}; coordinate with Blair before answering.`,
    ].join('\n')
    try {
      await gmailSend(token, buildMime({
        from: formatAddress('SwashBooks', conn.email),
        to: owner.email,
        subject: `${r.bounced ? 'Bounced' : 'Reply'}: ${p.name}`,
        text,
      }))
      await svc.from('sponsor_emails').update({ owner_notified_at: new Date().toISOString() }).eq('id', r.emailId)
      n++
    } catch (e) {
      console.error('owner notification failed', e)
    }
  }
  return n
}

// --- Routing ---

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)
  try {
    if (req.method === 'GET') {
      if (url.searchParams.has('state')) return await oauthCallback(url)
      return json({ ok: true })
    }
    const body = await req.json().catch(() => ({}))
    const cronSecret = req.headers.get('x-cron-secret')
    if (body.action === 'check' && cronSecret) {
      const { data: expected } = await svc.rpc('mail_cron_secret')
      if (!expected || cronSecret !== expected) throw new HttpError(401, 'Bad cron secret.')
      return json(await check())
    }
    const who = await caller(req)
    if (!who) throw new HttpError(401, 'Sign in again.')
    if (body.action === 'connect') return json(await connect(who, body))
    if (body.action === 'send') return json(await send(who, body))
    if (body.action === 'check') {
      if (!who.admin) throw new HttpError(403, 'Only an admin can run a check.')
      return json(await check())
    }
    throw new HttpError(400, 'Unknown action.')
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    const message = e instanceof Error ? e.message : String(e)
    if (status === 500) console.error(e)
    return json({ error: message }, status)
  }
})
