// Default pitch emails by sponsor tier. Crew edit the draft before sending; the
// app never sends email itself. Tax language only when Settings says 501(c)(3),
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

// prospect: sponsor_prospects row; notes: its note bodies; settings: org settings row.
export function draftPitch({ prospect, notes = [], settings, eventDate, senderName }) {
  const org = settings?.org_name || "The Swashbuckler's Ball"
  const ball = org.replace(/^the /i, 'The ')
  const when = longDate(eventDate)
  const pitch = TIER_PITCH[prospect.tier] ?? DEFAULT_PITCH
  const first = (prospect.contact_name || '').trim().split(/\s+/)[0]
  const returning = notes.some((n) => PAST_PARTNER.test(n)) || PAST_PARTNER.test(prospect.name)

  const paragraphs = [
    first ? `Hi ${first},` : `Hello ${prospect.name} team,`,
    `I'm ${senderName || 'one of the volunteer crew'}${senderName ? ', one of the volunteer crew' : ''} behind ${ball}, a pirate-themed charity night in Milwaukie, Oregon${when ? `, on ${when}` : ''}. Around 700 guests come in full pirate attire for dancing, live music, food and drink, and the crew takes no proceeds: the money raised goes to local charitable organizations.`,
    returning ? 'You have supported the Ball before, and we would love to have you back.' : null,
    pitch.body + (prospect.ask ? ` What we have in mind: ${prospect.ask.replace(/\.?\s*$/, '.')}` : ''),
    settings?.entity_status === '501c3'
      ? `${ball} is a 501(c)(3) tax-exempt organization${settings.ein ? ` (EIN ${settings.ein})` : ''}.`
      : null,
    'Could we set up a quick call in the next week or two? I am happy to send our sponsor deck and talk through what recognition looks like at each level.',
    `Thank you,\n${senderName || ''}\n${ball} crew`.replace('\n\n', '\n'),
  ].filter(Boolean)

  return { subject: pitch.subject(ball), body: paragraphs.join('\n\n') }
}

export function mailtoHref(to, subject, body) {
  const q = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  return `mailto:${encodeURIComponent(to || '').replace(/%40/g, '@')}?${q}`
}
