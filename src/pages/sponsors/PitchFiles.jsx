import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/AppContext'
import { SPONSOR_FILES_BUCKET, MAX_ATTACH_BYTES, fmtBytes, uploadPitchFile, pitchFileUrl } from '../../lib/sponsorMail'
import { Field, ConfirmButton } from '../planner/widgets'

// The one-sheet, decks and anything else worth attaching to a pitch.
export default function PitchFiles({ files, onChanged }) {
  const { isAdmin } = useApp()
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const input = useRef(null)

  async function upload(e) {
    e.preventDefault()
    const file = input.current?.files?.[0]
    if (!file) { setMsg({ ok: false, text: 'Choose a file first.' }); return }
    if (file.size > MAX_ATTACH_BYTES) { setMsg({ ok: false, text: `That file is ${fmtBytes(file.size)}; Gmail can't send attachments much over 20 MB. Export a smaller PDF.` }); return }
    setBusy(true)
    setMsg(null)
    try {
      await uploadPitchFile(file, label)
      setLabel('')
      input.current.value = ''
      setMsg({ ok: true, text: 'Uploaded.' })
      onChanged()
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    } finally {
      setBusy(false)
    }
  }

  async function update(f, patch) {
    const { error } = await supabase.from('sponsor_files').update(patch).eq('id', f.id)
    if (error) setMsg({ ok: false, text: error.message })
    else onChanged()
  }

  async function rename(f) {
    const next = prompt('Label for this file', f.label)
    if (next && next.trim() && next.trim() !== f.label) update(f, { label: next.trim() })
  }

  async function open(f) {
    try { window.open(await pitchFileUrl(f.storage_path), '_blank', 'noopener') }
    catch (err) { setMsg({ ok: false, text: err.message }) }
  }

  async function remove(f) {
    const { error } = await supabase.from('sponsor_files').delete().eq('id', f.id)
    if (error) { setMsg({ ok: false, text: error.message }); return }
    await supabase.storage.from(SPONSOR_FILES_BUCKET).remove([f.storage_path])
    onChanged()
  }

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="section-title !text-sm">Pitch files</div>
        {msg && <span className={`text-sm ${msg.ok ? 'text-grn' : 'text-coral'}`}>{msg.text}</span>}
      </div>
      {files.length ? (
        <div className="flex flex-col gap-1.5">
          {files.map((f) => (
            <div key={f.id} className="rounded bg-card2 px-3 py-2 flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <button type="button" className="font-semibold text-left hover:text-gold" onClick={() => open(f)} title="Open">{f.label}</button>
                <div className="text-faint text-xs truncate">{f.filename} · {fmtBytes(f.size_bytes)}</div>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer" title="Ticked automatically on new pitches">
                <input type="checkbox" checked={f.attach_by_default} onChange={(e) => update(f, { attach_by_default: e.target.checked })} />
                Attach by default
              </label>
              <button type="button" className="btn btn-sm" onClick={() => rename(f)}>Rename</button>
              {isAdmin && <ConfirmButton onConfirm={() => remove(f)} prompt="Delete file?">×</ConfirmButton>}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-faint text-sm">No files yet. Upload the one-sheet and sponsor decks (PDF works best), and they can be attached to any pitch.</div>
      )}
      <form onSubmit={upload} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <Field label="File"><input ref={input} className="input" type="file" accept=".pdf,.png,.jpg,.jpeg,.pptx,.docx" /></Field>
        <Field label="Label (shown when attaching)"><input className="input" placeholder="e.g. One-sheet" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</button>
      </form>
    </div>
  )
}
