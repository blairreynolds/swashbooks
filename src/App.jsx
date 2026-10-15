import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { isConfigured, supabase } from './lib/supabase'
import { AppProvider, useApp } from './lib/AppContext'
import { TAB_ACCESS } from './lib/tabs'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Transactions from './pages/Transactions'
import Bills from './pages/Bills'
import Invoices from './pages/Invoices'
import Donations from './pages/Donations'
import Sponsors from './pages/Sponsors'
import Contacts from './pages/Contacts'
import Budget from './pages/Budget'
import Planner from './pages/Planner'
import Import from './pages/Import'
import Settings from './pages/Settings'

const PAGES = {
  dashboard: Dashboard,
  transactions: Transactions,
  bills: Bills,
  invoices: Invoices,
  donations: Donations,
  sponsors: Sponsors,
  contacts: Contacts,
  budget: Budget,
  planner: Planner,
  import: Import,
}

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

function NoAccess() {
  const { session } = useApp()
  return (
    <div className="card max-w-lg">
      <div className="section-title mb-2">You're signed in — access pending</div>
      <p className="text-muted text-sm">
        Your account ({session.user.email}) is set up, but an admin still needs to choose which parts
        of SwashBooks you'll use. Let them know you've signed up; once they've granted access, reload this page.
      </p>
    </div>
  )
}

// Sends someone who opens a tab they can't use to their first permitted tab.
function Guarded({ tab, children }) {
  const { canSee } = useApp()
  if (canSee(tab)) return children
  const first = TAB_ACCESS.find((t) => canSee(t.key))
  return first ? <Navigate to={first.path} replace /> : <NoAccess />
}

function Shell() {
  const { session, profile, profileLoaded, isAdmin, canSee } = useApp()

  if (session === undefined || (session && !profileLoaded)) {
    return <div className="min-h-screen flex items-center justify-center text-faint">Loading…</div>
  }
  if (!session) return <Login />

  const tabs = [
    ...TAB_ACCESS.filter((t) => canSee(t.key)),
    ...(isAdmin ? [{ key: 'settings', label: 'Settings', path: '/settings' }] : []),
  ]

  return (
    <div className="min-h-screen flex flex-col">
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-6 h-14 print:hidden"
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

      <nav className="flex gap-1 px-6 pt-3 border-b border-bdr flex-wrap print:hidden">
        {tabs.map((t) => (
          <NavLink
            key={t.path}
            to={t.path}
            end={t.path === '/'}
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
          {TAB_ACCESS.map(({ key, path }) => {
            const Page = PAGES[key]
            return <Route key={key} path={path} element={<Guarded tab={key}><Page /></Guarded>} />
          })}
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
