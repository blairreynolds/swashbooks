// The sponsor-mail function's message building and reply reading (mail.ts),
// run under Node's TypeScript type stripping. Run: npm run test:db
import { buildMime, encodeHeader, formatAddress, header, isBounce, messageText, parseAddress, stripQuoted } from '../functions/sponsor-mail/mail.ts'

let pass = 0, fails = 0
const out = []
const check = (label, cond, detail = '') => { cond ? pass++ : fails++; out.push(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  [' + detail + ']' : ''}`) }
const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url')
const unb64 = (s) => Buffer.from(s.replace(/\r\n/g, ''), 'base64')

// Building
const plain = buildMime({ from: formatAddress('Blair Reynolds', 'b@x.com'), to: 'rum@y.com', subject: 'Bar partnership', text: 'Hi Sam,\nLine two' })
check('Plain email has the headers Gmail needs', /^From: "Blair Reynolds" <b@x\.com>\r\nTo: rum@y\.com\r\nSubject: Bar partnership\r\nMIME-Version: 1\.0/.test(plain))
const plainBody = plain.split('\r\n\r\n')[1]
check('Body round-trips as UTF-8 with CRLF line ends', unb64(plainBody).toString('utf8') === 'Hi Sam,\r\nLine two')
check('Every line stays within 78 characters', plain.split('\r\n').every((l) => l.length <= 78))

const pdf = new Uint8Array(70000).map((_, i) => i % 256)
const withFile = buildMime({
  from: 'b@x.com', to: 'a@y.com', subject: 'Pitch — Swashbuckler’s Ball', text: 'Attached.',
  inReplyTo: '<abc@mail.gmail.com>', attachments: [{ filename: 'One-sheet 2027.pdf', mime: 'application/pdf', bytes: pdf }],
})
check('Non-ASCII subject is encoded', /^Subject: =\?UTF-8\?B\?/m.test(withFile))
check('Subject decodes back exactly', unb64(/Subject: =\?UTF-8\?B\?(.+)\?=/.exec(withFile)[1]).toString('utf8') === 'Pitch — Swashbuckler’s Ball')
check('Reply headers present', /In-Reply-To: <abc@mail\.gmail\.com>\r\nReferences: <abc@mail\.gmail\.com>/.test(withFile))
const boundary = /boundary="([^"]+)"/.exec(withFile)[1]
const parts = withFile.split(`--${boundary}`)
check('Text part plus one attachment, closed properly', parts.length === 4 && parts[3].startsWith('--'))
const att = parts[2].split('\r\n\r\n')
check('Attachment is named and typed', /Content-Type: application\/pdf; name="One-sheet 2027\.pdf"/.test(att[0]) && /filename="One-sheet 2027\.pdf"/.test(att[0]))
const back = unb64(att[1].trim())
check('Attachment bytes round-trip exactly', back.length === pdf.length && back.every((b, i) => b === pdf[i]))
check('Non-ASCII filename uses RFC 2231', /filename\*=UTF-8''Cr%C3%A8me\.pdf/.test(buildMime({ from: 'a@x', to: 'b@x', subject: 's', text: 't', attachments: [{ filename: 'Crème.pdf', mime: 'application/pdf', bytes: new Uint8Array(1) }] })))
check('Display names cannot inject headers', !formatAddress('Evil\r\nBcc: x@y', 'a@b.com').includes('\r\n'))
check('Plain ASCII header left alone', encodeHeader('Hello') === 'Hello')

// Reading
check('Parses "Name <email>"', JSON.stringify(parseAddress('"Sam Rum" <Sam@Rum.com>')) === JSON.stringify({ name: 'Sam Rum', email: 'sam@rum.com' }))
check('Parses a bare address', parseAddress('sam@rum.com').email === 'sam@rum.com')
check('Spots bounces', isBounce('Mail Delivery Subsystem <mailer-daemon@googlemail.com>') && !isBounce('Sam <sam@rum.com>'))

const gmailReply = 'Sounds great, count us in for two cases.\n\nSam\n\nOn Tue, Nov 12, 2026 at 3:04 PM Blair Reynolds <\nb@x.com> wrote:\n> Hi Sam,\n> We are looking for...'
check('Drops Gmail\'s quoted history (wrapped "wrote:" line)', stripQuoted(gmailReply) === 'Sounds great, count us in for two cases.\n\nSam')
const outlook = 'Yes please.\r\n\r\nFrom: Blair Reynolds <b@x.com>\r\nSent: Tuesday, November 12, 2026 3:04 PM\r\nTo: Sam\r\nSubject: Bar partnership'
check('Drops Outlook\'s quoted header block', stripQuoted(outlook) === 'Yes please.')
check('Keeps a reply that quotes nothing', stripQuoted('Call me Friday.\nFrom the team') === 'Call me Friday.\nFrom the team')

const msg = {
  snippet: 'snip',
  payload: {
    mimeType: 'multipart/mixed', headers: [{ name: 'From', value: 'Sam <sam@rum.com>' }, { name: 'Subject', value: 'Re: Bar partnership' }],
    parts: [
      { mimeType: 'multipart/alternative', parts: [
        { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }], body: { data: b64url('Count us in — two cases.\n\nOn Mon, Blair wrote:\n> pitch') } },
        { mimeType: 'text/html', body: { data: b64url('<p>html</p>') } },
      ] },
      { mimeType: 'application/pdf', filename: 'invoice.pdf', body: { attachmentId: 'x' } },
    ],
  },
}
check('Reads headers case-insensitively', header(msg, 'subject') === 'Re: Bar partnership')
check('Reads the plain-text part, minus the quote', messageText(msg) === 'Count us in — two cases.')
const htmlOnly = { payload: { mimeType: 'text/html', body: { data: b64url('<div>See you&nbsp;there &amp; thanks</div><br><blockquote>old stuff</blockquote>') } } }
check('Falls back to HTML, minus the quote', messageText(htmlOnly) === 'See you there & thanks')
check('Falls back to the snippet', messageText({ snippet: 'just a snippet', payload: { mimeType: 'multipart/mixed', parts: [] } }) === 'just a snippet')

console.log(out.join('\n'))
console.log(`\n${pass} passed, ${fails} failed`)
process.exit(fails ? 1 : 0)
