// Building outgoing MIME messages and reading incoming Gmail API messages.

const utf8 = new TextEncoder()

export function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function wrap76(s: string): string {
  const lines: string[] = []
  for (let i = 0; i < s.length; i += 76) lines.push(s.slice(i, i + 76))
  return lines.join('\r\n')
}

const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s)

// RFC 2047: non-ASCII header text as UTF-8 encoded words.
export function encodeHeader(v: string): string {
  return isAscii(v) ? v : `=?UTF-8?B?${base64(utf8.encode(v))}?=`
}

export function formatAddress(name: string | null | undefined, email: string): string {
  const n = (name ?? '').replace(/["\\\r\n]/g, '').trim()
  if (!n) return email
  return isAscii(n) ? `"${n}" <${email}>` : `${encodeHeader(n)} <${email}>`
}

function filenameParams(name: string): string {
  const safe = name.replace(/["\\\r\n]/g, '_')
  return isAscii(safe) ? `filename="${safe}"` : `filename*=UTF-8''${encodeURIComponent(safe)}`
}

export interface Attachment { filename: string; mime: string; bytes: Uint8Array }

export function buildMime(o: {
  from: string
  to: string
  subject: string
  text: string
  inReplyTo?: string
  references?: string
  attachments?: Attachment[]
}): string {
  const head = [
    `From: ${o.from}`,
    `To: ${o.to}`,
    `Subject: ${encodeHeader(o.subject)}`,
    'MIME-Version: 1.0',
  ]
  if (o.inReplyTo) head.push(`In-Reply-To: ${o.inReplyTo}`, `References: ${o.references || o.inReplyTo}`)

  const textPart = [
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(base64(utf8.encode(o.text.replace(/\r?\n/g, '\r\n')))),
  ].join('\r\n')

  if (!o.attachments?.length) return [...head, textPart].join('\r\n')

  const b = `swash_${crypto.randomUUID()}`
  const parts = [textPart, ...o.attachments.map((a) => [
    `Content-Type: ${a.mime || 'application/octet-stream'}; name="${a.filename.replace(/["\\\r\n]/g, '_')}"`,
    `Content-Disposition: attachment; ${filenameParams(a.filename)}`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(base64(a.bytes)),
  ].join('\r\n'))]
  return [
    ...head,
    `Content-Type: multipart/mixed; boundary="${b}"`,
    '',
    ...parts.map((p) => `--${b}\r\n${p}`),
    `--${b}--`,
    '',
  ].join('\r\n')
}

// --- Reading Gmail API messages (format=full) ---

// deno-lint-ignore no-explicit-any
type Part = any

export function header(msg: Part, name: string): string {
  const h = (msg.payload?.headers ?? []).find((x: Part) => x.name.toLowerCase() === name.toLowerCase())
  return h?.value ?? ''
}

function decodeBody(part: Part): string {
  const raw = atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0))
  const ct = (part.headers ?? []).find((h: Part) => h.name.toLowerCase() === 'content-type')?.value ?? ''
  const charset = /charset="?([^";\s]+)/i.exec(ct)?.[1] ?? 'utf-8'
  try { return new TextDecoder(charset).decode(bytes) } catch { return new TextDecoder().decode(bytes) }
}

function findPart(part: Part, mime: string): Part | null {
  if (!part) return null
  if (part.mimeType === mime && part.body?.data && !part.filename) return part
  for (const p of part.parts ?? []) {
    const hit = findPart(p, mime)
    if (hit) return hit
  }
  return null
}

function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<blockquote[\s\S]*$/i, '') // Gmail-style quoted history
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
}

// The new text of a reply, without the quoted conversation underneath it.
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const two = `${line} ${lines[i + 1] ?? ''}`
    if (/^\s*On\b.*\bwrote:\s*$/.test(line) || /^\s*On\b.*\bwrote:\s*$/.test(two)) break
    if (/^\s*-{2,}\s*Original Message/i.test(line)) break
    if (/^\s*From:\s.+/.test(line) && lines.slice(i + 1, i + 5).some((l) => /^\s*(Sent|Date):\s/.test(l))) break
    if (/^\s*>/.test(line)) continue
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function messageText(msg: Part): string {
  const plain = findPart(msg.payload, 'text/plain')
  if (plain) return stripQuoted(decodeBody(plain))
  const html = findPart(msg.payload, 'text/html')
  if (html) return stripQuoted(htmlToText(decodeBody(html)))
  return msg.snippet ?? ''
}

export function parseAddress(v: string): { name: string; email: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(v)
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() }
  return { name: '', email: v.trim().toLowerCase() }
}

export const isBounce = (from: string) => /mailer-daemon|postmaster|mail delivery subsystem/i.test(from)
