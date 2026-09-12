/**
 * Sync state for the interface — SPEC.md §10.
 *
 * Nothing here ever blocks a screen. The loop runs in the background and this
 * only reports what it is doing; every write still goes to the device store
 * first and succeeds whether or not there is a network, a session, or a cloud
 * configured at all.
 */

import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from './router'
import { getSyncState, startSync, subscribeSync, type SyncState } from '../sync'

const SyncCtx = createContext<SyncState>(getSyncState())

export function SyncProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SyncState>(getSyncState)

  useEffect(() => {
    const unsubscribe = subscribeSync(setState)
    const stop = startSync()
    return () => {
      unsubscribe()
      stop()
    }
  }, [])

  return <SyncCtx.Provider value={state}>{children}</SyncCtx.Provider>
}

export function useSync(): SyncState {
  return useContext(SyncCtx)
}

/** The one-word state, for the badge and the account screen alike. */
export function syncLabel(state: SyncState): string {
  switch (state.status) {
    case 'local-only':
      return 'On this device'
    case 'signed-out':
      return 'Not backed up'
    case 'offline':
      return state.pending > 0 ? `Offline — ${state.pending} waiting` : 'Offline'
    case 'syncing':
      return 'Syncing…'
    case 'error':
      return 'Sync failed'
    case 'synced':
      return state.pending > 0 ? `${state.pending} waiting` : 'Synced'
  }
}

/**
 * The indicator: a dot and, when it matters, a word.
 *
 * Deliberately quiet when everything is fine and deliberately loud when it is
 * not. A Supabase project on the free tier pauses after about a week idle
 * (§12), and sync that failed silently for a week would make the whole backup
 * worthless — so `error` is the one state that always says so in words.
 */
export function SyncBadge() {
  const state = useSync()
  // A build with no cloud configured says nothing at all: there is no account
  // to sign in to and nothing useful to report.
  if (state.status === 'local-only') return null

  const loud = state.status === 'error' || state.status === 'signed-out'
  return (
    <Link
      to="/account"
      className={`sync-badge sync-${state.status}`}
      aria-label={`Sync: ${syncLabel(state)}`}
    >
      <span className="sync-dot" aria-hidden="true" />
      {loud || state.pending > 0 ? <span>{syncLabel(state)}</span> : null}
    </Link>
  )
}
