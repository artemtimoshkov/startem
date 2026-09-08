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

/**
 * Ids are `deviceKey * 2^20 + counter` — see `newId` below for why. The
 * constants sit above the class because the v3 upgrade mints ids too, and it
 * has to do it through its own transaction.
 */
const DEVICE_KEY_BITS = 20
const COUNTER_SPACE = 2 ** 20

export const DEVICE_KEY_META = 'device_key'
const COUNTER_META = 'id_counter'

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

    /**
     * v2 — priority moved from the goal to the task, and a task gained an
     * area of its own so it can exist without a goal (§3).
     *
     * The upgrade has to hand each goal's importance down before it is
     * dropped: doing it later, from a row that no longer carries the column,
     * would silently reset every task on the device to `medium` and re-weight
     * the whole star.
     */
    this.version(2)
      .stores({
        areas: 'id, position',
        goals: 'id, area_id, status, deleted',
        subgoals: 'id, area_id, goal_id, archived, deleted',
        checkins: '[subgoal_id+date], subgoal_id, date',
        freezes: 'id, goal_id',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        const goals = await tx.table('goals').toArray()
        const byId = new Map<number, { area_id: number; importance?: string }>(
          goals.map((g: Record<string, unknown>) => [
            g['id'] as number,
            { area_id: g['area_id'] as number, importance: g['importance'] as string | undefined },
          ]),
        )
        await tx
          .table('subgoals')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            const parent = byId.get(row['goal_id'] as number)
            row['area_id'] = row['area_id'] ?? parent?.area_id ?? 0
            row['importance'] = row['importance'] ?? parent?.importance ?? 'medium'
            row['interval'] = row['interval'] ?? 1
            row['start_date'] = row['start_date'] ?? null
            row['repeat_until'] = row['repeat_until'] ?? null
            row['time'] = row['time'] ?? null
            if (row['goal_id'] === 0 || row['goal_id'] === undefined) row['goal_id'] = null
          })
        await tx
          .table('goals')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            delete row['importance']
          })
      })

    /**
     * v3 — the goal stops owning the work (§3).
     *
     * Areas hold habits directly, a goal becomes an aim with a status of its
     * own, and a pause moves from the goal down onto the habit it actually
     * pauses. Three things have to happen here rather than later:
     *
     * - a task keeps the area it was scoring against, taken from its goal when
     *   its own column never got one;
     * - `frozen` is not a goal state any more, so a frozen goal comes back as
     *   active — but its **pause periods survive**, re-pointed at each task
     *   that hung off it. Dropping them would back-fill every dormant week
     *   with misses, which is exactly what a period, rather than a flag, was
     *   introduced to prevent (§3);
     * - one goal-level period becomes N task-level ones, so N−1 need ids
     *   nothing else holds. They are minted from the same device-partitioned
     *   counter as everything else, read through `tx` so the whole upgrade
     *   stays inside one transaction.
     */
    this.version(3)
      .stores({
        areas: 'id, position',
        goals: 'id, area_id, status, deleted',
        subgoals: 'id, area_id, archived, deleted',
        checkins: '[subgoal_id+date], subgoal_id, date',
        freezes: 'id, subgoal_id',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        const goals = await tx.table('goals').toArray()
        const areaOfGoal = new Map<number, number>(
          goals.map((g: Record<string, unknown>) => [
            g['id'] as number,
            g['area_id'] as number,
          ]),
        )

        const tasksByGoal = new Map<number, number[]>()
        await tx
          .table('subgoals')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            const goalId = row['goal_id'] as number | null | undefined
            if (goalId != null) {
              const bucket = tasksByGoal.get(goalId)
              if (bucket) bucket.push(row['id'] as number)
              else tasksByGoal.set(goalId, [row['id'] as number])
            }
            if (!row['area_id'] && goalId != null) {
              row['area_id'] = areaOfGoal.get(goalId) ?? 0
            }
            delete row['goal_id']
          })

        // Freezes first, while the goal rows still say which were frozen.
        const freezes = (await tx.table('freezes').toArray()) as Record<string, unknown>[]
        const keyRow = await tx.table('meta').get(DEVICE_KEY_META)
        const deviceKey = typeof keyRow?.value === 'number' ? keyRow.value : 1
        const counterRow = await tx.table('meta').get(COUNTER_META)
        let counter = typeof counterRow?.value === 'number' ? counterRow.value : 0

        for (const period of freezes) {
          if (period['subgoal_id'] != null) continue // already task-level
          const targets = tasksByGoal.get(period['goal_id'] as number) ?? []
          await tx.table('freezes').delete(period['id'] as number)
          for (const [i, subgoalId] of targets.entries()) {
            const { goal_id: _dropped, ...rest } = period
            await tx.table('freezes').put({
              ...rest,
              // The first period keeps the id it already has, so a device that
              // synced it once does not see it as a new row (§10).
              id: i === 0 ? (period['id'] as number) : deviceKey * COUNTER_SPACE + ++counter,
              subgoal_id: subgoalId,
            })
          }
        }
        await tx.table('meta').put({ key: COUNTER_META, value: counter })

        await tx
          .table('goals')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            // `frozen` is not a goal state any more. The periods it stood for
            // have just been moved onto the tasks, so the goal itself is
            // simply active again.
            if (row['status'] !== 'achieved') row['status'] = 'active'
            row['position'] = row['position'] ?? 0
            row['achieved_on'] = row['status'] === 'achieved' ? (row['achieved_on'] ?? null) : null
          })
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
