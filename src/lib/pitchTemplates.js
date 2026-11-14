// Default pitch emails by sponsor tier. Crew always review and edit the draft;
// an admin can send it from the Sponsors page (Gmail), everyone else copies it
// into their own email. Tax language only when Settings says 501(c)(3),
// matching the acknowledgment-letter rules.

const TIER_PITCH = {
  Admiral: {
    subject: (ball) => `Presenting partner for ${ball}`,
    body: 'We are looking for a presenting partner this year: the name the whole night is associated with, from the invitations to the main stage.',
  },
  Captain: {
    subject: (ball) => `Bar partnership at ${ball}`,
    body: 'We are looking for partners to take over one of our themed bars for the night, with your products at the center of its menu.',
  },
  Quartermaster: {
    subject: (ball) => `Stocking the bars at ${ball}`,
    body: 'We are looking for product partners to help stock the bars for the night.',
  },
  Crew: {
    subject: (ball) => `Joining the crew at ${ball}`,
    body: 'We would love to have you aboard as a community partner this year.',
  },
}
const DEFAULT_PITCH = {
  subject: (ball) => `Partnering with ${ball}`,
  body: 'We would love to talk about partnering with you this year.',
}

const PAST_PARTNER = /past (partner|donor|sponsor)/i

function longDate(iso) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

// "One-sheet" -> "one-sheet", but leave "PDF deck" alone.
const inSentence = (label) => (/^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label)

function listOf(items) {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

const ballName = (settings) => (settings?.org_name || "The Swashbuckler's Ball").replace(/^the /i, 'The ')

function greeting(prospect) {
  const first = (prospect.contact_name || '').trim().split(/\s+/)[0]
  return first ? `Hi ${first},` : `Hello ${prospect.name} team,`
}

const signOff = (senderName, ball, senderTitle) =>
  `Thank you,\n${senderName || ''}\n${senderTitle ? `${senderTitle}, ${ball}` : `${ball} crew`}`.replace('\n\n', '\n')

// Settings' talking points, one per line, run together as sentences.
const talkingPoints = (settings) =>
  (settings?.pitch_talking_points || '').split('\n').map((l) => l.trim()).filter(Boolean).join(' ') || null

function introduce(senderName, senderTitle, ball) {
  if (!senderName) return `I'm one of the volunteer crew behind ${ball}`
  return senderTitle ? `I'm ${senderName}, ${senderTitle} for ${ball}` : `I'm ${senderName}, one of the volunteer crew behind ${ball}`
}

// prospect: sponsor_prospects row; notes: its note bodies; settings: org settings row
// (its talking points go in every pitch); attached: labels of the files going with it.
export function draftPitch({ prospect, notes = [], settings, eventDate, senderName, senderTitle, attached = [] }) {
  const ball = ballName(settings)
  const when = longDate(eventDate)
  const pitch = TIER_PITCH[prospect.tier] ?? DEFAULT_PITCH
  const returning = notes.some((n) => PAST_PARTNER.test(n)) || PAST_PARTNER.test(prospect.name)

  const paragraphs = [
    greeting(prospect),
    `${introduce(senderName, senderTitle, ball)}, a pirate-themed charity night in Milwaukie, Oregon${when ? `, on ${when}` : ''}. Around 700 guests come in full pirate attire for dancing, live music, food and drink, and the crew takes no proceeds: the money raised goes to local charitable organizations.`,
    returning ? 'You have supported the Ball before, and we would love to have you back.' : null,
    pitch.body + (prospect.ask ? ` What we have in mind: ${prospect.ask.replace(/\.?\s*$/, '.')}` : ''),
    settings?.entity_status === '501c3'
      ? `${ball} is a 501(c)(3) tax-exempt organization${settings.ein ? ` (EIN ${settings.ein})` : ''}.`
      : null,
    talkingPoints(settings),
    attached.length
      ? `I've attached our ${listOf(attached.map(inSentence))}. Could we set up a quick call in the next week or two to talk through what recognition looks like at each level?`
      : 'Could we set up a quick call in the next week or two? I am happy to send our sponsor deck and talk through what recognition looks like at each level.',
    signOff(senderName, ball, senderTitle),
  ].filter(Boolean)

  return { subject: pitch.subject(ball), body: paragraphs.join('\n\n') }
}

// A short nudge, sent as a reply in the thread of the last email.
export function draftFollowUp({ prospect, settings, eventDate, senderName, senderTitle, lastSentAt, lastSubject, attached = [] }) {
  const ball = ballName(settings)
  const when = longDate(eventDate)
  const sentOn = lastSentAt ? new Date(lastSentAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : null
  const paragraphs = [
    greeting(prospect),
    `Just following up on my note${sentOn ? ` from ${sentOn}` : ''} about ${ball}${when ? ` on ${when}` : ''}. We would still love to have you aboard${prospect.ask ? `: ${prospect.ask.replace(/\.?\s*$/, '.')}` : '.'}`,
    talkingPoints(settings),
    attached.length ? `I've attached our ${listOf(attached.map(inSentence))} in case it's useful.` : null,
    'Would a quick call in the next week or two work?',
    signOff(senderName, ball, senderTitle),
  ].filter(Boolean)
  const subject = lastSubject ? (/^re:/i.test(lastSubject) ? lastSubject : `Re: ${lastSubject}`) : `Following up: ${ball}`
  return { subject, body: paragraphs.join('\n\n') }
}

export function mailtoHref(to, subject, body) {
  const q = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  return `mailto:${encodeURIComponent(to || '').replace(/%40/g, '@')}?${q}`
}
