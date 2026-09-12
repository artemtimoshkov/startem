/**
 * The sync loop — SPEC.md §10.
 *
 * Small on purpose. One user, a couple of devices, last-write-wins, no CRDTs
 * and no sync framework: the whole policy is "the newer edit is the right one",
 * and the device-partitioned ids from §9 are what make that safe — LWW on two
 * rows that accidentally shared a primary key would not merge them, it would
 * destroy one.
 *
 *   push: for each outbox entry, upsert the current local row; clear on success
 *   pull: fetch rows newer than the watermark, keep whichever side is newer,
 *         apply tombstones, then advance the watermark
 *
 * Nothing in the interface ever waits on any of this. Sync runs in the
 * background and the only visible trace is the indicator.
 */

import { db, type OutboxRow, type SyncTable } from '../db/db'
import { isPristine } from '../db/repo'
import { supabase } from './client'
import { currentSession } from './session'

/** Parents before children, so the cloud is coherent at every point mid-push. */
const PUSH_ORDER: SyncTable[] = ['areas', 'goals', 'subgoals', 'checkins', 'freezes']

const WATERMARK_META = 'last_pulled_at'
const FIRST_PULL_META = 'first_pull_done'
const EPOCH = '1970-01-01T00:00:00.000Z'

/**
 * Each pull re-reads a minute either side of the watermark.
 *
 * Re-applying a row that has not changed is a no-op, so the overlap costs
 * nothing; without it, a row written in the moment between the query running
 * and the watermark advancing would never be fetched again, and the two
 * devices would sit quietly out of step forever.
 */
const OVERLAP_MS = 60_000

/** Postgres and `toISOString()` format timestamps differently. Never compare
 *  them as strings — `+00:00` and `Z` sort against each other nonsensically. */
function isNewer(a: string | undefined, b: string | undefined): boolean {
  return Date.parse(a ?? EPOCH) > Date.parse(b ?? EPOCH)
}

function localTable(table: SyncTable) {
  return db[table]
}

/** The primary key of one remote row, in the shape the local table uses. */
function pkOf(table: SyncTable, row: Record<string, unknown>): number | [number, string] {
  return table === 'checkins'
    ? [row['subgoal_id'] as number, row['date'] as string]
    : (row['id'] as number)
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/**
 * Drains the outbox.
 *
 * An entry whose local row has vanished is dropped rather than retried: there
 * is nothing left to send, and leaving it would wedge the queue forever. That
 * only happens for rows cleared by an import, which re-queues everything it
 * writes anyway.
 */
async function push(userId: string): Promise<number> {
  if (!supabase) return 0
  const queued = await db.outbox.toArray()
  if (queued.length === 0) return 0

  const byTable = new Map<SyncTable, OutboxRow[]>()
  for (const entry of queued) {
    const bucket = byTable.get(entry.table)
    if (bucket) bucket.push(entry)
    else byTable.set(entry.table, [entry])
  }

  let sent = 0
  for (const table of PUSH_ORDER) {
    const entries = byTable.get(table)
    if (!entries || entries.length === 0) continue

    const rows: Record<string, unknown>[] = []
    const keys: string[] = []
    const stale: string[] = []
    for (const entry of entries) {
      const row = await (localTable(table) as never as { get: (k: unknown) => Promise<unknown> })
        .get(entry.pk)
      if (!row) {
        stale.push(entry.key)
        continue
      }
      rows.push({ ...(row as Record<string, unknown>), user_id: userId })
      keys.push(entry.key)
    }
    if (stale.length > 0) await db.outbox.bulkDelete(stale)
    if (rows.length === 0) continue

    const conflict = table === 'checkins' ? 'user_id,subgoal_id,date' : 'user_id,id'
    // Chunked so one very large first sync does not become one very large
    // request that a phone on a weak connection can never quite finish.
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200)
      const { error } = await supabase.from(table).upsert(chunk, { onConflict: conflict })
      // Stop at the first failure and keep the entries: the next run retries
      // them. Clearing on error is how an offline edit disappears for good.
      if (error) throw new Error(`push ${table}: ${error.message}`)
      await db.outbox.bulkDelete(keys.slice(i, i + 200))
      sent += chunk.length
    }
  }
  return sent
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

/**
 * Applies one table's remote rows, newest-wins, and returns the high-water
 * timestamp seen.
 *
 * Remote rows are written straight to Dexie rather than through `repo`'s
 * queueing helpers — a pulled row must not re-enter the outbox, or the two
 * devices would push the same row back and forth forever.
 */
async function applyRemote(
  table: SyncTable,
  remote: Record<string, unknown>[],
  adopt: boolean,
): Promise<string> {
  let highest = EPOCH
  await db.transaction('rw', localTable(table) as never, async () => {
    for (const raw of remote) {
      const { user_id: _ignored, ...row } = raw
      const stamped = row as Record<string, unknown> & { updated_at?: string }
      if (isNewer(stamped.updated_at, highest)) highest = stamped.updated_at ?? highest

      const pk = pkOf(table, stamped)
      const table_ = localTable(table) as never as {
        get: (k: unknown) => Promise<{ updated_at?: string } | undefined>
        put: (v: unknown) => Promise<unknown>
      }
      const local = await table_.get(pk)
      // Last-write-wins, and `adopt` is the one exception: on a device that has
      // never pulled and holds nothing of its own, the cloud is simply right.
      // Without it the ten default areas a fresh install seeds seconds ago
      // would out-date — and overwrite — a year of real ones.
      if (!adopt && local && !isNewer(stamped.updated_at, local.updated_at)) continue
      await table_.put(stamped)
    }
  })
  return highest
}

/**
 * Whether this device should take the cloud wholesale on this run.
 *
 * True only on a device that has never completed a pull *and* holds nothing of
 * its own — which is exactly a fresh install, ten seeded areas and no history.
 * Asked as a stored flag rather than inferred from the watermark, because an
 * account with nothing in it yet leaves the watermark untouched and would
 * otherwise look like a first sign-in forever.
 */
async function shouldAdopt(): Promise<boolean> {
  const done = await db.meta.get(FIRST_PULL_META)
  if (done?.value === true) return false
  return isPristine()
}

async function pull(adopt: boolean): Promise<number> {
  if (!supabase) return 0
  const watermarkRow = await db.meta.get(WATERMARK_META)
  const watermark = typeof watermarkRow?.value === 'string' ? watermarkRow.value : EPOCH
  const since = new Date(Date.parse(watermark) - OVERLAP_MS).toISOString()

  let highest = watermark
  let applied = 0
  for (const table of PUSH_ORDER) {
    // Paged, so a long history does not arrive as one unbounded response.
    let from = 0
    for (;;) {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .gt('updated_at', since)
        .order('updated_at', { ascending: true })
        .range(from, from + 999)
      if (error) throw new Error(`pull ${table}: ${error.message}`)
      const rows = (data ?? []) as Record<string, unknown>[]
      if (rows.length === 0) break

      if (adopt && from === 0 && applied === 0) await clearLocalForAdoption()
      const seen = await applyRemote(table, rows, adopt)
      if (isNewer(seen, highest)) highest = seen
      applied += rows.length
      if (rows.length < 1000) break
      from += 1000
    }
  }

  await db.meta.put({ key: WATERMARK_META, value: highest })
  // Whatever came back — rows or an empty account — the first pull has now
  // happened, and this device never adopts again.
  await db.meta.put({ key: FIRST_PULL_META, value: true })
  return applied
}

/**
 * Empties a pristine device before its first pull.
 *
 * Only the seeded areas can be here — `isPristine` has already established
 * there are no tasks and no check-ins — and their outbox entries go with them,
 * so the defaults are never pushed over the real areas on the way back.
 */
async function clearLocalForAdoption(): Promise<void> {
  await db.transaction(
    'rw',
    [db.areas, db.goals, db.subgoals, db.checkins, db.freezes, db.outbox],
    async () => {
      await Promise.all([
        db.areas.clear(),
        db.goals.clear(),
        db.subgoals.clear(),
        db.checkins.clear(),
        db.freezes.clear(),
        db.outbox.clear(),
      ])
    },
  )
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export interface SyncResult {
  pushed: number
  pulled: number
}

/**
 * One full cycle: push what is queued, then pull what is new.
 *
 * Push first, always. Pulling first would apply a remote row over a local edit
 * that has not been sent yet, and last-write-wins would then have nothing left
 * to compare — the local edit would be gone before it ever made an argument
 * for itself.
 */
export async function runSync(): Promise<SyncResult> {
  if (!supabase) return { pushed: 0, pulled: 0 }
  const session = await currentSession()
  if (!session) return { pushed: 0, pulled: 0 }

  // The one exception to push-first. A fresh install has ten seeded areas
  // queued and nothing worth keeping; pushing them before the first pull would
  // put today's defaults in the cloud beside — and, being newer, on top of — a
  // year of real ones. It pulls first, adopts, and pushes on the next run.
  const adopt = await shouldAdopt()
  const pushed = adopt ? 0 : await push(session.user.id)
  const pulled = await pull(adopt)
  return { pushed, pulled }
}

/** How many local writes are still waiting to go up. */
export async function pendingCount(): Promise<number> {
  return db.outbox.count()
}

/**
 * Forgets the pull watermark, so the next sync re-reads the account whole.
 *
 * Used when the signed-in user changes: the watermark describes one account's
 * history and means nothing for another's.
 */
export async function resetWatermark(): Promise<void> {
  await db.meta.delete(WATERMARK_META)
  await db.meta.delete(FIRST_PULL_META)
}
