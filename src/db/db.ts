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
      // `++id` still honours an explicit id, so a JSON import keeps its own —
      // the tables reference each other by id and remapping would break every
      // foreign key. IndexedDB advances the generator past any explicit key.
      areas: '++id, position',
      goals: '++id, area_id, status, deleted',
      subgoals: '++id, goal_id, archived, deleted',
      // The compound key is the primary key, exactly as in Postgres.
      checkins: '[subgoal_id+date], subgoal_id, date',
      freezes: '++id, goal_id',
      meta: 'key',
    })
  }
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
