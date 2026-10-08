import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { fetchPlan } from './plannerData'

const COLL = {
  planner_bars: 'bars',
  planner_drinks: 'drinks',
  planner_assignments: 'assignments',
  planner_inventory: 'inventory',
}
const DEBOUNCE_MS = 700

// Shared-plan store. Edits apply locally at once and persist per row after a
// short pause, sending only the changed fields, so crew members editing
// different rows (or different fields of one row) don't overwrite each other.
export function usePlannerStore(eventYearId) {
  const [plan, setPlan] = useState(null)
  const [status, setStatus] = useState('loading') // loading | missing | empty | ready | error
  const [loadError, setLoadError] = useState(null)
  const [save, setSave] = useState({ kind: 'idle' }) // idle | pending | saving | saved | error
  const pending = useRef(new Map()) // `${table}:${id}` -> { table, keyCol, id, patch, timer }
  const inflight = useRef(0)
  const planRef = useRef(null)
  const loadSeq = useRef(0)
  planRef.current = plan

  const markSaved = useCallback(() => {
    if (!inflight.current && !pending.current.size) {
      setSave((s) => (s.kind === 'error' ? s : { kind: 'saved' }))
    }
  }, [])

  const fail = useCallback((message) => setSave({ kind: 'error', message }), [])

  const flush = useCallback(async (key) => {
    const p = pending.current.get(key)
    if (!p) return
    clearTimeout(p.timer)
    pending.current.delete(key)
    inflight.current++
    setSave((s) => (s.kind === 'error' ? s : { kind: 'saving' }))
    const { data, error } = await supabase.from(p.table).update(p.patch).eq(p.keyCol, p.id).select(p.keyCol)
    inflight.current--
    if (error) fail(error.message)
    else if (!data?.length) fail('Someone else removed an item you were editing — reload to see the latest plan.')
    else markSaved()
  }, [fail, markSaved])

  const flushAll = useCallback(
    () => Promise.all([...pending.current.keys()].map((key) => flush(key))),
    [flush],
  )

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!eventYearId) return
    const seq = ++loadSeq.current
    if (!quiet) setStatus('loading')
    try {
      const { plan: p, missing } = await fetchPlan(eventYearId)
      if (seq !== loadSeq.current) return
      setPlan(p)
      setLoadError(null)
      setStatus(missing ? 'missing' : p ? 'ready' : 'empty')
      setSave({ kind: 'idle' })
    } catch (e) {
      if (seq !== loadSeq.current) return
      setLoadError(e.message)
      setStatus('error')
    }
  }, [eventYearId])

  // Load on year change; send any unsaved edits for the previous year first.
  useEffect(() => {
    load()
    return () => flushAll()
  }, [load, flushAll])

  // Pick up crew members' changes when returning to the tab, if nothing is mid-save.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !pending.current.size && !inflight.current) load({ quiet: true })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (pending.current.size || inflight.current) {
        flushAll()
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [flushAll])

  const update = useCallback((table, id, patch) => {
    setPlan((prev) => {
      if (!prev) return prev
      if (table === 'planner_settings') return { ...prev, settings: { ...prev.settings, ...patch } }
      const coll = COLL[table]
      return { ...prev, [coll]: prev[coll].map((r) => (r.id === id ? { ...r, ...patch } : r)) }
    })
    const key = `${table}:${id}`
    const p = pending.current.get(key) ?? { table, keyCol: table === 'planner_settings' ? 'event_year_id' : 'id', id, patch: {} }
    clearTimeout(p.timer)
    p.patch = { ...p.patch, ...patch }
    p.timer = setTimeout(() => flush(key), DEBOUNCE_MS)
    pending.current.set(key, p)
    setSave((s) => (s.kind === 'error' ? s : { kind: 'pending' }))
  }, [flush])

  const insert = useCallback(async (table, row) => {
    const coll = COLL[table]
    const full = { id: crypto.randomUUID(), ...row }
    setPlan((prev) => ({ ...prev, [coll]: [...prev[coll], full] }))
    inflight.current++
    setSave((s) => (s.kind === 'error' ? s : { kind: 'saving' }))
    const { error } = await supabase.from(table).insert(full)
    inflight.current--
    if (error) {
      setPlan((prev) => ({ ...prev, [coll]: prev[coll].filter((r) => r.id !== full.id) }))
      fail(error.message)
    } else markSaved()
    return full
  }, [fail, markSaved])

  const remove = useCallback(async (table, id) => {
    const coll = COLL[table]
    const current = planRef.current
    // The database cascades assignment deletes; drop their queued edits too.
    const doomed = new Set([`${table}:${id}`])
    if (current && (table === 'planner_bars' || table === 'planner_drinks')) {
      const col = table === 'planner_bars' ? 'bar_id' : 'drink_id'
      current.assignments.filter((a) => a[col] === id).forEach((a) => doomed.add(`planner_assignments:${a.id}`))
    }
    for (const key of doomed) {
      const p = pending.current.get(key)
      if (p) { clearTimeout(p.timer); pending.current.delete(key) }
    }
    setPlan((prev) => {
      const next = { ...prev, [coll]: prev[coll].filter((r) => r.id !== id) }
      if (table === 'planner_bars') next.assignments = prev.assignments.filter((a) => a.bar_id !== id)
      if (table === 'planner_drinks') next.assignments = prev.assignments.filter((a) => a.drink_id !== id)
      return next
    })
    inflight.current++
    setSave((s) => (s.kind === 'error' ? s : { kind: 'saving' }))
    const { error } = await supabase.from(table).delete().eq('id', id)
    inflight.current--
    if (error) {
      fail(error.message)
      load({ quiet: true })
    } else markSaved()
  }, [fail, markSaved, load])

  return { plan, status, loadError, save, load, update, insert, remove, flushAll }
}
