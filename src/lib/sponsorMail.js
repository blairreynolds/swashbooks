// Sponsor email: the sponsor-mail Edge Function (Gmail) and the pitch-file library.
import { supabase } from './supabase'

export const SPONSOR_FILES_BUCKET = 'sponsor-files'
// Gmail's 25MB message cap, less the encoding overhead.
export const MAX_ATTACH_BYTES = 20 * 1024 * 1024
// Fired after a reply is handled, so the Sponsors tab badge refreshes.
export const REPLIES_EVENT = 'swashbooks:sponsor-replies'

export async function callMail(action, body = {}) {
  const { data, error } = await supabase.functions.invoke('sponsor-mail', { body: { action, ...body } })
  if (error) {
    let message = error.message
    try {
      const j = await error.context.json()
      if (j?.error) message = j.error
    } catch { /* not a JSON error body */ }
    throw new Error(message)
  }
  return data
}

export const gmailThreadUrl = (account, threadId) =>
  `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${threadId}`

export function fmtBytes(n) {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

export const openReplies = (emails = []) => emails.filter((e) => e.direction === 'in' && !e.handled_at)

export async function markHandled(id, handled = true) {
  const { error } = await supabase.rpc('sponsor_email_handled', { p_id: id, p_handled: handled })
  if (error) throw error
  window.dispatchEvent(new Event(REPLIES_EVENT))
}

export async function uploadPitchFile(file, label) {
  const safe = file.name.replace(/[^\w.\- ]+/g, '_')
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}/${safe}`
  const { error } = await supabase.storage.from(SPONSOR_FILES_BUCKET).upload(path, file, { contentType: file.type || undefined })
  if (error) throw error
  const { error: e2 } = await supabase.from('sponsor_files').insert({
    label: label.trim() || file.name.replace(/\.[^.]+$/, ''),
    filename: file.name,
    storage_path: path,
    mime_type: file.type || null,
    size_bytes: file.size,
  })
  if (e2) {
    await supabase.storage.from(SPONSOR_FILES_BUCKET).remove([path])
    throw e2
  }
}

export async function pitchFileUrl(path) {
  const { data, error } = await supabase.storage.from(SPONSOR_FILES_BUCKET).createSignedUrl(path, 600)
  if (error) throw error
  return data.signedUrl
}
