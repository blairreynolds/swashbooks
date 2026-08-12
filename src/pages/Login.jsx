import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [mode, setMode] = useState('signin') // signin | signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: name } },
        })
        if (error) throw error
        if (!data.session) setMsg({ ok: true, text: 'Account created. Check your email to confirm, then sign in.' })
      }
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="card w-full max-w-sm flex flex-col gap-3">
        <div className="text-center mb-2">
          <div className="font-display text-gold text-3xl font-semibold tracking-wide">SwashBooks</div>
          <div className="text-muted text-xs tracking-[0.14em] uppercase mt-1">The Swashbuckler's Ball</div>
        </div>
        {mode === 'signup' && (
          <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
        )}
        <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
        {msg && (
          <div className={`text-sm ${msg.ok ? 'text-grn' : 'text-coral'}`}>{msg.text}</div>
        )}
        <button className="btn btn-primary" disabled={busy}>
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
        <button
          type="button"
          className="text-faint text-xs hover:text-muted bg-transparent border-0"
          onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMsg(null) }}
        >
          {mode === 'signin' ? 'New crew member? Create an account' : 'Already aboard? Sign in'}
        </button>
      </form>
    </div>
  )
}
