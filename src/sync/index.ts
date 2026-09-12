/**
 * When sync runs, and what the indicator says — SPEC.md §10.
 *
 * Triggers, in the spec's words: on app open, on regaining network, and after
 * each write (debounced). "After each write" is read from the outbox rather
 * than pushed from `repo`, so that the store layer never has to know a sync
 * layer exists — a short ticker notices the queue is non-empty and runs.
 *
 * Every failure surfaces. A Supabase project on the free tier pauses after
 * about a week idle (§12), and sync failing quietly for a week is the one
 * outcome that would make all of this worthless.
 */

import { db } from '../db/db'
import { isCloudConfigured, supabase } from './client'
import { currentSession, onSessionChange } from './session'
import { pendingCount, resetWatermark, runSync } from './sync'

export { isCloudConfigured, supabase } from './client'
export { currentSession, onSessionChange, sendMagicLink, signOut } from './session'
export type { Session, User } from './session'
export { pendingCount, runSync } from './sync'

export type SyncStatus =
  /** No cloud configured for this build: the app is local-only, on purpose. */
  | 'local-only'
  /** A cloud exists but nobody is signed in. Nothing is backed up. */
  | 'signed-out'
  | 'offline'
  | 'syncing'
  | 'synced'
  | 'error'

export interface SyncState {
  status: SyncStatus
  /** Local writes still waiting to go up. */
  pending: number
  lastSyncedAt: string | null
  error: string | null
  email: string | null
}

const LAST_USER_META = 'last_user_id'
const LAST_SYNC_META = 'last_synced_at'

/** While the app is open, catch the other device's edits without a reload. */
const POLL_MS = 60_000
/** How soon after a local write the queue is noticed. */
const NUDGE_MS = 3_000

let state: SyncState = {
  status: isCloudConfigured() ? 'signed-out' : 'local-only',
  pending: 0,
  lastSyncedAt: null,
  error: null,
  email: null,
}

const listeners = new Set<(s: SyncState) => void>()

function set(patch: Partial<SyncState>): void {
  state = { ...state, ...patch }
  for (const fn of listeners) fn(state)
}

export function getSyncState(): SyncState {
  return state
}

export function subscribeSync(fn: (s: SyncState) => void): () => void {
  listeners.add(fn)
  fn(state)
  return () => listeners.delete(fn)
}

let running = false

/**
 * Runs one cycle, unless one is already in flight.
 *
 * Overlapping runs would have two pushes draining one outbox and two pulls
 * racing to advance one watermark, which is how a row gets skipped.
 */
export async function syncNow(): Promise<void> {
  if (!isCloudConfigured() || running) return
  const session = await currentSession()
  if (!session) {
    set({ status: 'signed-out', email: null, pending: await pendingCount() })
    return
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    set({ status: 'offline', email: session.user.email ?? null, pending: await pendingCount() })
    return
  }

  running = true
  set({ status: 'syncing', error: null, email: session.user.email ?? null })
  try {
    // A different account than last time means the watermark describes someone
    // else's history, and merging the two stores would be nonsense.
    const lastUser = await db.meta.get(LAST_USER_META)
    if (lastUser?.value !== session.user.id) {
      await resetWatermark()
      await db.meta.put({ key: LAST_USER_META, value: session.user.id })
    }

    await runSync()
    const at = new Date().toISOString()
    await db.meta.put({ key: LAST_SYNC_META, value: at })
    set({
      status: 'synced',
      pending: await pendingCount(),
      lastSyncedAt: at,
      error: null,
    })
  } catch (e) {
    // Offline mid-run reads as a network failure, which is not worth alarming
    // anyone about — the queue is intact and the next run sends it.
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    set({
      status: offline ? 'offline' : 'error',
      pending: await pendingCount(),
      error: offline ? null : e instanceof Error ? e.message : 'Sync failed.',
    })
  } finally {
    running = false
  }
}

let started = false

/** Wires the triggers. Idempotent, so a re-render cannot start a second loop. */
export function startSync(): () => void {
  if (!isCloudConfigured() || started) return () => {}
  started = true

  const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'
  const run = () => void syncNow()

  // On app open.
  run()

  // On regaining the network, and when the app comes back to the foreground —
  // which on a phone is what "opening the app" actually is.
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', () => {
    if (visible()) run()
  })

  // After each write, debounced: the queue is small and counting it is cheap.
  const nudge = window.setInterval(() => {
    if (!visible() || running) return
    void pendingCount().then((n) => {
      if (n !== state.pending) set({ pending: n })
      if (n > 0) run()
    })
  }, NUDGE_MS)

  // And a slow beat, so the other device's edits arrive while the app sits open.
  const poll = window.setInterval(() => {
    if (visible()) run()
  }, POLL_MS)

  const unsubscribe = onSessionChange((session) => {
    if (!session) {
      set({ status: 'signed-out', email: null })
      return
    }
    run()
  })

  return () => {
    started = false
    window.removeEventListener('online', run)
    window.clearInterval(nudge)
    window.clearInterval(poll)
    unsubscribe()
  }
}

/** Signs out and stops describing the store as backed up. */
export async function signOutAndStop(): Promise<void> {
  if (!supabase) return
  await supabase.auth.signOut()
  await resetWatermark()
  set({ status: 'signed-out', email: null, error: null })
}
