import { signedUrl } from './supabase'
import { fmtDate } from './format'

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// Acknowledgment letter for an in-kind donation. Wording switches on
// settings.entity_status:
//   - '501c3': IRS-standard acknowledgment (tax-exempt statement + EIN,
//     no-goods-or-services statement). NEVER prints a dollar value —
//     valuation is the donor's responsibility.
//   - anything else ('nonprofit_non_exempt' or 'unconfirmed'): warm thank-you
//     with NO tax-deductibility language whatsoever.
// Opens a print window; call synchronously from a click handler.
export async function printAckLetter(donation, settings) {
  const win = window.open('', '_blank')
  if (!win) {
    alert('Popup blocked — allow popups for this site to print letters.')
    return false
  }
  let logoTag = ''
  try {
    if (settings?.logo_url) {
      const url = await signedUrl(settings.logo_url)
      logoTag = `<img src="${esc(url)}" alt="" style="max-height:64px;max-width:220px;object-fit:contain;margin-bottom:8px" />`
    }
  } catch { /* letter prints without logo */ }

  const orgName = settings?.org_name || "The Swashbuckler's Ball"
  const donor = donation.contacts ?? {}
  const is501c3 = settings?.entity_status === '501c3'

  const body = is501c3
    ? `
  <p>Thank you for your generous in-kind contribution to ${esc(orgName)}, received on
  ${fmtDate(donation.date_received)}:</p>
  <p class="item">${esc(donation.item_description)}</p>
  <p>${esc(orgName)} is a tax-exempt organization under Section 501(c)(3) of the
  Internal Revenue Code${settings?.ein ? ` (EIN ${esc(settings.ein)})` : ''}.
  No goods or services were provided in exchange for this contribution.</p>
  <p>Please retain this letter for your tax records. As required by IRS regulations,
  determining the fair market value of donated property is the responsibility of the donor;
  this acknowledgment does not assign a value to the contribution.</p>`
    : `
  <p>On behalf of the entire crew, thank you for your generous donation to
  ${esc(orgName)}, received on ${fmtDate(donation.date_received)}:</p>
  <p class="item">${esc(donation.item_description)}</p>
  <p>Contributions like yours are what make the Ball possible — and what allow the
  proceeds of the evening to go where they matter most: to the charitable organizations
  our community supports. We are truly grateful for your part in that.</p>`

  win.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>Acknowledgment — ${esc(donor.name || 'donor')}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; padding: 56px; font-size: 14px; line-height: 1.65; max-width: 720px; }
  .letterhead { margin-bottom: 36px; }
  .letterhead h1 { font-size: 20px; }
  .letterhead p { color: #555; white-space: pre-line; font-size: 12px; }
  .date { margin-bottom: 28px; }
  .addr { margin-bottom: 28px; white-space: pre-line; }
  p { margin-bottom: 14px; }
  .item { font-style: italic; padding: 10px 18px; border-left: 3px solid #999; margin: 18px 0; }
  .sig { margin-top: 40px; white-space: pre-line; }
  @media print { body { padding: 24px; } }
</style></head>
<body>
  <div class="letterhead">
    ${logoTag}
    <h1>${esc(orgName)}</h1>
    <p>${esc(settings?.org_address || '')}</p>
  </div>
  <div class="date">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
  <div class="addr"><strong>${esc(donor.name || '')}</strong>${donor.address ? '\n' + esc(donor.address) : ''}</div>
  <p>Dear ${esc(donor.name || 'Friend of the Ball')},</p>
  ${body}
  <div class="sig">${esc(settings?.ack_signature_block || `With gratitude,\nThe ${orgName} Crew`)}</div>
  <script>window.onload = () => window.print()</script>
</body></html>`)
  win.document.close()
  return true
}
