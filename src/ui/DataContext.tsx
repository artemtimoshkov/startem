/**
 * The single source of app state: the whole store, in memory, plus today.
 *
 * The pure core takes a snapshot of all five tables and returns the view
 * payloads (§6), so the UI's job is only to keep one snapshot fresh and hand
 * it to those builders. `useLiveQuery` re-reads whenever Dexie writes, which
 * is also what will pick up §10's sync pulls for free.
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { buildIndex, todayISO, type Index, type Snapshot } from '../core'
import { db, requestPersistence } from '../db/db'
import { ensureSeeded, loadSnapshot } from '../db/repo'

interface DataValue {
  snapshot: Snapshot | undefined
  index: Index | undefined
  today: string
  loading: boolean
}

const DataContext = createContext<DataValue>({
  snapshot: undefined,
  index: undefined,
  today: todayISO(),
  loading: true,
})

/** Recomputed at midnight so an app left open overnight rolls over. */
function useToday(): string {
  const [today, setToday] = useState(() => todayISO())
  useEffect(() => {
    const tick = () => setToday(todayISO())
    const id = window.setInterval(tick, 60_000)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  return today
}

export function DataProvider({ children }: { children: ReactNode }) {
  const today = useToday()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void (async () => {
      await ensureSeeded()
      void requestPersistence()
      setReady(true)
    })()
  }, [])

  const snapshot = useLiveQuery(
    () => (ready ? loadSnapshot() : Promise.resolve(undefined)),
    [ready],
    undefined,
  )

  const index = useMemo(
    () => (snapshot ? buildIndex(snapshot, today) : undefined),
    [snapshot, today],
  )

  const value = useMemo<DataValue>(
    () => ({ snapshot, index, today, loading: !snapshot }),
    [snapshot, index, today],
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData(): DataValue {
  return useContext(DataContext)
}

/** The snapshot, or a throw — for screens that render only once loaded. */
export function useSnapshot(): { snapshot: Snapshot; index: Index; today: string } {
  const { snapshot, index, today } = useData()
  if (!snapshot || !index) throw new Error('snapshot not loaded')
  return { snapshot, index, today }
}

export { db }
