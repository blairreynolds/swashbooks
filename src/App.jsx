import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { isConfigured, supabase } from './lib/supabase'
import { AppProvider, useApp } from './lib/AppContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Transactions from './pages/Transactions'
import Contacts from './pages/Contacts'
import Budget from './pages/Budget'
import Settings from './pages/Settings'

const TABS = [
  { path: '/', label: 'Dashboard', end: true },
  { path: '/transactions', label: 'Transactions' },
  { path: '/contacts', label: 'Contacts' },
  { path: '/budget', label: 'Budget' },
  { path: '/settings', label: 'Settings', adminOnly: true },
]

function NotConfigured() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card max-w-lg">
        <h1 className="font-display text-gold text-xl mb-3">SwashBooks isn't connected yet</h1>
        <p className="text-muted text-sm mb-3">
          Copy <code className="font-mono">.env.example</code> to <code className="font-mono">.env</code> and
          fill in <code className="font-mono">VITE_SUPABASE_URL</code> and{' '}
          <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> from your Supabase project
          (Settings → API), then restart the dev server. Full steps are in the README.
        </p>
      </div>
    </div>
  )
}

function YearSwitcher() {
  const { eventYears, activeYearId, setActiveYearId } = useApp()
  if (!eventYears.length) return null
  return (
    <select
      className="input !w-auto font-mono text-sm"
      value={activeYearId ?? ''}
      onChange={(e) => setActiveYearId(e.target.value)}
      title="Active event year"
    >
      {eventYears.map((y) => (
        <option key={y.id} value={y.id}>{y.label}</option>
      ))}
    </select>
  )
}

function Shell() {
  const { session, profile, isAdmin } = useApp()

  if (session === undefined) {
    return <div className="min-h-screen flex items-center justify-center text-faint">Loading…</div>
  }
  if (!session) return <Login />

  return (
    <div className="min-h-screen flex flex-col">
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-6 h-14"
        style={{ background: 'var(--card)', borderBottom: '1px solid var(--gold)', boxShadow: '0 1px 0 var(--gold-dim)' }}
      >
        <div className="flex items-baseline gap-3">
          <span className="font-display text-gold text-2xl font-semibold tracking-wide">SwashBooks</span>
          <span className="text-muted text-xs tracking-[0.12em] uppercase hidden sm:inline">
            The Swashbuckler's Ball
          </span>
        </div>
        <div className="flex items-center gap-3">
          <YearSwitcher />
          <span className="text-faint text-sm hidden md:inline" title={profile?.role}>
            {profile?.display_name || session.user.email}
          </span>
          <button className="btn btn-sm" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>

      <nav className="flex gap-1 px-6 pt-3 border-b border-bdr flex-wrap">
        {TABS.filter((t) => !t.adminOnly || isAdmin).map((t) => (
          <NavLink
            key={t.path}
            to={t.path}
            end={t.end}
            className={({ isActive }) =>
              `px-4 py-2 rounded-t-md text-sm font-medium border border-b-0 transition-colors ${
                isActive
                  ? 'bg-card border-bdr text-gold'
                  : 'border-transparent text-muted hover:text-txt'
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1 p-6 flex flex-col gap-5 max-w-7xl w-full mx-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/budget" element={<Budget />} />
          <Route path="/settings" element={isAdmin ? <Settings /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  if (!isConfigured) return <NotConfigured />
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
