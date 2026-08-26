/**
 * The on-device store — SPEC.md §9.
 *
 * IndexedDB via Dexie, one store per table, the *same field names* as §3 and
 * as Postgres. Check-ins are keyed on the compound `[subgoal_id+date]`: it is
 * the natural key, it makes double-logging a day impossible, and it is what
 * lets two devices editing the same day upsert into one row at §10.
 */

import Dexie, { type Table } from 'dexie'
import type { Area, Checkin, Freeze, Goal, Subgoal } from '../core'

/** Small key/value store for things that are not one of the five tables. */
export interface MetaRow {
  key: string
  value: unknown
}

export class StartemDB extends Dexie {
  areas!: Table<Area, number>
  goals!: Table<Goal, number>
  subgoals!: Table<Subgoal, number>
  checkins!: Table<Checkin, [number, string]>
  freezes!: Table<Freeze, number>
  meta!: Table<MetaRow, string>

  constructor() {
    super('startem')
    this.version(1).stores({
      // Ids are assigned explicitly by `newId` below, never auto-incremented —
      // see the note there. A JSON import keeps its own ids either way, because
      // the tables reference each other by id and remapping would break every
      // foreign key.
      areas: 'id, position',
      goals: 'id, area_id, status, deleted',
      subgoals: 'id, goal_id, archived, deleted',
      // The compound key is the primary key, exactly as in Postgres.
      checkins: '[subgoal_id+date], subgoal_id, date',
      freezes: 'id, goal_id',
      meta: 'key',
    })
  }
}

// ---------------------------------------------------------------------------
// Id allocation
// ---------------------------------------------------------------------------

/**
 * Ids are `deviceKey * 2^20 + counter`.
 *
 * **Why not auto-increment:** §10 upserts rows between devices by primary key,
 * so two devices that both allocate `47` while offline do not create two goals
 * — they create one goal that last-write-wins silently merges, losing whichever
 * edit lost. Auto-increment guarantees that collision the moment two devices
 * add a row without having synced in between, which for an offline-first app is
 * the normal case rather than the edge case.
 *
 * Partitioning the id space per device removes the collision instead of making
 * it unlikely: each install draws a random 20-bit key once, and every id it
 * ever mints carries that key in its high bits. Two devices collide only if
 * they draw the same key — about one chance in a million per pair, against a
 * near-certainty for a shared counter.
 *
 * The low 20 bits allow ~1M rows per device. The whole id stays under 2^40, so
 * it is exact in a JS number and fits a Postgres `bigint` (§3).
 */
const DEVICE_KEY_BITS = 20
const COUNTER_SPACE = 2 ** 20

export const DEVICE_KEY_META = 'device_key'
const COUNTER_META = 'id_counter'

async function deviceKey(): Promise<number> {
  const row = await db.meta.get(DEVICE_KEY_META)
  if (typeof row?.value === 'number' && row.value >= 1) return row.value
  // 1 … 2^20-1. Zero is reserved so that small imported ids (1, 2, 41 …) can
  // never be mistaken for something this device minted.
  const key = 1 + Math.floor(Math.random() * (2 ** DEVICE_KEY_BITS - 1))
  await db.meta.put({ key: DEVICE_KEY_META, value: key })
  return key
}

/**
 * The next id for a new row. Unique per device by construction, and unique
 * across devices as long as their device keys differ.
 */
export async function newId(): Promise<number> {
  const key = await deviceKey()
  const row = await db.meta.get(COUNTER_META)
  const next = (typeof row?.value === 'number' ? row.value : 0) + 1
  if (next >= COUNTER_SPACE) {
    throw new Error('This device has minted its million ids; the id space needs widening.')
  }
  await db.meta.put({ key: COUNTER_META, value: next })
  return key * COUNTER_SPACE + next
}

/**
 * Raises the counter past anything already stored under this device's key, so
 * that ids imported from an export taken *on this device* are not re-minted.
 */
export async function reserveIds(ids: readonly number[]): Promise<void> {
  const key = await deviceKey()
  let highest = 0
  for (const id of ids) {
    if (Math.floor(id / COUNTER_SPACE) !== key) continue
    highest = Math.max(highest, id % COUNTER_SPACE)
  }
  if (highest === 0) return
  const row = await db.meta.get(COUNTER_META)
  const current = typeof row?.value === 'number' ? row.value : 0
  if (highest > current) await db.meta.put({ key: COUNTER_META, value: highest })
}

export const db = new StartemDB()

/**
 * Ask the browser to keep this data. An installed home-screen PWA is already
 * exempt from Safari's 7-day eviction, but the explicit request costs nothing
 * and protects the in-browser session too (§9).
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist()
  } catch {
    // A browser that refuses to answer is not an error worth surfacing —
    // sync (§10) is the real backup regardless.
  }
  return false
}
