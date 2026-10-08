import { useEffect, useRef, useState } from 'react'
import { SOURCES } from '../../lib/plannerCalc'

export function Field({ label, className = '', children }) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-faint ${className}`}>
      {label}
      {children}
    </label>
  )
}

// Keeps its own text while focused so partial input ("1.", "") isn't
// clobbered by re-renders; commits a number whenever the text parses.
export function NumField({ value, onChange, blankZero = false, className = '', ...rest }) {
  const show = (v) => (blankZero && !Number(v) ? '' : String(v ?? ''))
  const [text, setText] = useState(show(value))
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setText(show(value))
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <input
      type="number"
      className={`input font-mono ${className}`}
      value={text}
      onFocus={() => { focused.current = true }}
      onBlur={() => { focused.current = false; setText(show(value)) }}
      onChange={(e) => {
        const t = e.target.value
        setText(t)
        if (t === '') { if (blankZero) onChange(0); return }
        const n = Number(t)
        if (Number.isFinite(n)) onChange(n)
      }}
      {...rest}
    />
  )
}

// Two-click inline confirm: first click arms for 3 seconds.
export function ConfirmButton({ onConfirm, children, prompt = 'Confirm remove?' }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button
      type="button"
      className={`btn btn-sm ${armed ? '' : 'btn-danger'}`}
      style={armed ? { background: 'var(--coral)', color: '#fff', borderColor: 'var(--coral)' } : undefined}
      onClick={() => {
        if (armed) { setArmed(false); onConfirm() } else setArmed(true)
      }}
    >
      {armed ? prompt : children}
    </button>
  )
}

export function SourceBadge({ source }) {
  const s = SOURCES[source]
  const color = s?.color ?? '#7a8795'
  return (
    <span
      className="chip whitespace-nowrap"
      style={{ background: `${color}26`, color, border: `1px solid ${color}4d` }}
    >
      {s?.label ?? source}
    </span>
  )
}

export function SourceSelect({ value, onChange, className = '' }) {
  return (
    <select className={`input ${className}`} value={value} onChange={(e) => onChange(e.target.value)}>
      {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
    </select>
  )
}

export function JumpChips({ items, prefix }) {
  if (items.length < 2) return null
  return (
    <div className="flex gap-1.5 flex-wrap print:hidden">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className="btn btn-sm"
          style={it.dim ? { opacity: 0.5 } : undefined}
          onClick={() => document.getElementById(`${prefix}-${it.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          {it.name || '(unnamed)'}
        </button>
      ))}
    </div>
  )
}
