import { signedUrl } from './supabase'
import { money, fmtDate } from './format'

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// Opens a print-ready invoice in a new window. Call synchronously from a click
// handler (the window opens before any awaits so popup blockers allow it).
export async function printInvoice(invoice, lineItems, settings) {
  const win = window.open('', '_blank')
  if (!win) {
    alert('Popup blocked — allow popups for this site to download invoice PDFs.')
    return
  }
  let logoTag = ''
  try {
    if (settings?.logo_url) {
      const url = await signedUrl(settings.logo_url)
      logoTag = `<img src="${esc(url)}" alt="" style="max-height:64px;max-width:220px;object-fit:contain" />`
    }
  } catch { /* logo is optional; print without it */ }

  const total = lineItems.reduce((s, li) => s + Number(li.line_total), 0)
  const contact = invoice.contacts ?? {}
  const rows = lineItems.map((li) => `
    <tr>
      <td>${esc(li.description)}</td>
      <td class="num">${Number(li.qty)}</td>
      <td class="num">${money(li.unit_price)}</td>
      <td class="num">${money(li.line_total)}</td>
    </tr>`).join('')

  win.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(invoice.invoice_number)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; padding: 48px; font-size: 14px; line-height: 1.5; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; }
  .org h1 { font-size: 22px; margin-bottom: 4px; }
  .org p { color: #555; white-space: pre-line; font-size: 12px; }
  .meta { text-align: right; }
  .meta .no { font-size: 18px; font-weight: bold; letter-spacing: 0.04em; }
  .meta p { color: #555; font-size: 12px; }
  .billto { margin-bottom: 28px; }
  .billto .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #888; margin-bottom: 4px; }
  .billto p { white-space: pre-line; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; border-bottom: 2px solid #1a1a1a; padding: 6px 8px; }
  td { padding: 8px; border-bottom: 1px solid #ddd; }
  .num { text-align: right; white-space: nowrap; }
  .total-row td { border-bottom: none; font-weight: bold; font-size: 16px; padding-top: 14px; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #ddd; color: #555; font-size: 12px; white-space: pre-line; }
  @media print { body { padding: 24px; } }
</style></head>
<body>
  <div class="head">
    <div class="org">
      ${logoTag}
      <h1>${esc(settings?.org_name || "The Swashbuckler's Ball")}</h1>
      <p>${esc(settings?.org_address || '')}</p>
    </div>
    <div class="meta">
      <div class="no">INVOICE ${esc(invoice.invoice_number)}</div>
      <p>Issued: ${fmtDate(invoice.issue_date)}</p>
      ${invoice.due_date ? `<p>Due: ${fmtDate(invoice.due_date)}</p>` : ''}
    </div>
  </div>
  <div class="billto">
    <div class="label">Bill to</div>
    <p><strong>${esc(contact.name || '')}</strong>${contact.address ? '\n' + esc(contact.address) : ''}${contact.email ? '\n' + esc(contact.email) : ''}</p>
  </div>
  <table>
    <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead>
    <tbody>
      ${rows}
      <tr class="total-row"><td colspan="3" class="num">Total</td><td class="num">${money(total)}</td></tr>
    </tbody>
  </table>
  ${invoice.notes ? `<p>${esc(invoice.notes)}</p>` : ''}
  <div class="footer">${esc(settings?.invoice_payment_instructions || '')}</div>
  <script>window.onload = () => window.print()</script>
</body></html>`)
  win.document.close()
}
