import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'

const AppContext = createContext(null)

export function useApp() {
  return useContext(AppContext)
}

export function AppProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const [profile, setProfile] = useState(null)
  const [eventYears, setEventYears] = useState([])
  const [activeYearId, setActiveYearId] = useState(null)
  const [categories, setCategories] = useState([])
  const [settings, setSettings] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const refreshCore = useCallback(async () => {
    if (!session) return
    const [{ data: prof }, { data: years }, { data: cats }, { data: sets }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).single(),
      supabase.from('event_years').select('*').order('event_date', { ascending: false }),
      supabase.from('categories').select('*').order('sort_order'),
      supabase.from('settings').select('*').limit(1).maybeSingle(),
    ])
    setProfile(prof ?? null)
    setEventYears(years ?? [])
    setCategories(cats ?? [])
    setSettings(sets ?? null)
    setActiveYearId((cur) => {
      if (cur && years?.some((y) => y.id === cur)) return cur
      return years?.find((y) => y.is_active)?.id ?? years?.[0]?.id ?? null
    })
  }, [session])

  useEffect(() => {
    refreshCore()
  }, [refreshCore])

  const activeYear = eventYears.find((y) => y.id === activeYearId) ?? null
  const isAdmin = profile?.role === 'admin'

  const value = {
    session,
    profile,
    isAdmin,
    eventYears,
    activeYear,
    activeYearId,
    setActiveYearId,
    categories,
    settings,
    refreshCore,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
