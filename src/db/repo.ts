/**
 * Every write the app makes — SPEC.md §7, §9.
 *
 * All mutations funnel through here so that three invariants hold in one
 * place: rows are normalised on the way in (§3), multi-table writes happen in
 * one transaction so they cannot half-apply (§9), and nothing is ever hard
 * deleted — removals are `archived` for actions and a `deleted` tombstone for
 * everything else, which is also what lets a delete propagate at §10.
 */

import {
  DEFAULT_AREAS,
  type Area,
  type CheckinStatus,
  type Freeze,
  type GoalStatus,
  type ISODate,
  type Importance,
  type Snapshot,
  type Subgoal,
  normaliseSnapshot,
  normaliseSubgoal,
  todayISO,
} from '../core'
import { db, newId, reserveIds } from './db'

/** Set on every write, so §10's last-write-wins has something to order by. */
function stamp(): string {
  return new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * The whole store, as the plain arrays the pure core expects. At one person's
 * scale this is a few thousand rows, so reading it whole and letting §6's view
 * builders do the thinking is both simpler and faster than querying per view.
 */
export async function loadSnapshot(): Promise<Snapshot> {
  const [areas, goals, subgoals, checkins, freezes] = await Promise.all([
    db.areas.toArray(),
    db.goals.toArray(),
    db.subgoals.toArray(),
    db.checkins.toArray(),
    db.freezes.toArray(),
  ])
  return { areas, goals, subgoals, checkins, freezes }
}

/** Seeds the ten default areas on a fresh install. Idempotent. */
export async function ensureSeeded(): Promise<void> {
  const count = await db.areas.count()
  if (count > 0) return
  await db.areas.bulkPut(
    DEFAULT_AREAS.map((name, i) => ({
      id: i + 1,
      name,
      position: i,
      updated_at: stamp(),
      deleted: false,
    })),
  )
}

// ---------------------------------------------------------------------------
// Check-ins (§7)
// ---------------------------------------------------------------------------

/**
 * Writes, changes or clears one day's check-in.
 *
 * `null` clears the row back to unresolved. Locally that is a real delete —
 * there is no other device to tell yet — but §10 turns the same call into a
 * tombstone, because "untick" has to propagate.
 */
export async function setCheckin(
  subgoal_id: number,
  date: ISODate,
  status: CheckinStatus | null,
): Promise<void> {
  if (status == null) {
    await db.checkins.delete([subgoal_id, date])
    return
  }
  await db.checkins.put({ subgoal_id, date, status, updated_at: stamp(), deleted: false })
}

/** Ticking an item writes `done`; ticking again clears it back to unresolved. */
export async function toggleDone(
  subgoal_id: number,
  date: ISODate,
  current: CheckinStatus | null,
): Promise<void> {
  await setCheckin(subgoal_id, date, current === 'done' ? null : 'done')
}

/** Crossing out writes `skipped` — an immediate miss. Reversible. */
export async function toggleSkipped(
  subgoal_id: number,
  date: ISODate,
  current: CheckinStatus | null,
): Promise<void> {
  await setCheckin(subgoal_id, date, current === 'skipped' ? null : 'skipped')
}

// ---------------------------------------------------------------------------
// Goals and their actions (§7)
// ---------------------------------------------------------------------------

/** What the goal editor hands back. Actions without an id are new. */
export interface GoalDraft {
  id?: number
  area_id: number
  title: string
  description: string
  importance: Importance
  actions: ActionDraft[]
}

export interface ActionDraft {
  id?: number
  title: string
  cadence_type: Subgoal['cadence_type']
  days: number[]
  monthly_day: number | null
  month_weekday: number | null
  month_ordinal: number | null
  due_date: ISODate | null
  weight: number | null
}

/**
 * Creates or updates a goal and its actions in one transaction.
 *
 * An action the user removed while editing is **archived, never deleted**:
 * its past check-ins still exist and still describe real days, and deleting
 * the action would orphan them and silently rewrite history (§3).
 */
export async function saveGoal(draft: GoalDraft, today = todayISO()): Promise<number> {
  return db.transaction('rw', db.goals, db.subgoals, db.meta, async () => {
    const now = stamp()
    let goalId = draft.id

    if (goalId == null) {
      goalId = await newId()
      await db.goals.add({
        id: goalId,
        area_id: draft.area_id,
        title: draft.title,
        description: draft.description,
        status: 'active',
        importance: draft.importance,
        created_at: today,
        updated_at: now,
        deleted: false,
      })
    } else {
      const existing = await db.goals.get(goalId)
      await db.goals.put({
        id: goalId,
        area_id: draft.area_id,
        title: draft.title,
        description: draft.description,
        status: existing?.status ?? 'active',
        importance: draft.importance,
        created_at: existing?.created_at ?? today,
        updated_at: now,
        deleted: false,
      })
    }

    const kept = new Set<number>()
    for (const action of draft.actions) {
      const row = normaliseSubgoal(
        {
          ...action,
          id: action.id ?? undefined,
          goal_id: goalId,
          archived: false,
          created_at: action.id == null ? today : undefined,
        },
        today,
      )
      if (action.id == null) {
        const created = await newId()
        await db.subgoals.add({ ...row, id: created, updated_at: now, deleted: false })
        kept.add(created)
      } else {
        const existing = await db.subgoals.get(action.id)
        await db.subgoals.put({
          ...row,
          id: action.id,
          created_at: existing?.created_at ?? today,
          updated_at: now,
          deleted: false,
        })
        kept.add(action.id)
      }
    }

    // Anything the editor no longer lists is archived, not removed.
    const all = await db.subgoals.where('goal_id').equals(goalId).toArray()
    for (const row of all) {
      if (!kept.has(row.id) && !row.archived) {
        await db.subgoals.put({ ...row, archived: true, updated_at: now })
      }
    }
    return goalId
  })
}

/**
 * Removes a goal, its actions, their check-ins and its freeze periods —
 * as tombstones, so the removal can propagate at §10 rather than a device
 * that missed it quietly resurrecting the goal on the next pull.
 */
export async function deleteGoal(goalId: number): Promise<void> {
  await db.transaction('rw', db.goals, db.subgoals, db.checkins, db.freezes, async () => {
    const now = stamp()
    const goal = await db.goals.get(goalId)
    if (goal) await db.goals.put({ ...goal, deleted: true, updated_at: now })

    const actions = await db.subgoals.where('goal_id').equals(goalId).toArray()
    for (const action of actions) {
      await db.subgoals.put({ ...action, deleted: true, updated_at: now })
      const rows = await db.checkins.where('subgoal_id').equals(action.id).toArray()
      for (const row of rows) {
        await db.checkins.put({ ...row, deleted: true, updated_at: now })
      }
    }

    const periods = await db.freezes.where('goal_id').equals(goalId).toArray()
    for (const period of periods) {
      await db.freezes.put({ ...period, deleted: true, updated_at: now })
    }
  })
}

/**
 * Opens a freeze period and flips `status`.
 *
 * The period is what matters: `goals.status` alone would say the goal is
 * frozen *now* but not that it was frozen last March, and unfreezing would
 * back-fill the dormant weeks with misses (§3).
 */
export async function freezeGoal(goalId: number, today = todayISO()): Promise<void> {
  await db.transaction('rw', db.goals, db.freezes, db.meta, async () => {
    const now = stamp()
    const goal = await db.goals.get(goalId)
    if (!goal) return
    const open = (await db.freezes.where('goal_id').equals(goalId).toArray()).find(
      (f) => !f.deleted && f.end_date == null,
    )
    if (!open) {
      await db.freezes.add({
        id: await newId(),
        goal_id: goalId,
        start_date: today,
        end_date: null,
        updated_at: now,
        deleted: false,
      })
    }
    await db.goals.put({ ...goal, status: 'frozen', updated_at: now })
  })
}

/** Closes the open period. `end_date` is exclusive, so today is live again. */
export async function unfreezeGoal(goalId: number, today = todayISO()): Promise<void> {
  await db.transaction('rw', db.goals, db.freezes, db.meta, async () => {
    const now = stamp()
    const goal = await db.goals.get(goalId)
    if (!goal) return
    const periods = await db.freezes.where('goal_id').equals(goalId).toArray()
    for (const period of periods) {
      if (period.deleted || period.end_date != null) continue
      // Exclusive end: unfreezing makes today itself live again.
      const end = period.start_date > today ? period.start_date : today
      if (end === period.start_date) {
        // Frozen and unfrozen on the same day: the period covers no days at
        // all, so it is noise in the history rather than a record of anything.
        await db.freezes.put({ ...period, end_date: end, deleted: true, updated_at: now })
      } else {
        await db.freezes.put({ ...period, end_date: end, updated_at: now })
      }
    }
    await db.goals.put({ ...goal, status: 'active', updated_at: now })
  })
}

export async function setGoalStatus(goalId: number, status: GoalStatus): Promise<void> {
  if (status === 'frozen') await freezeGoal(goalId)
  else await unfreezeGoal(goalId)
}

// ---------------------------------------------------------------------------
// Areas (§7 — name only; areas are not created or destroyed by the user)
// ---------------------------------------------------------------------------

export async function renameArea(areaId: number, name: string): Promise<void> {
  const area = await db.areas.get(areaId)
  if (!area) return
  await db.areas.put({ ...area, name: name.trim() || area.name, updated_at: stamp() })
}

// ---------------------------------------------------------------------------
// Migration: the JSON import and export
// ---------------------------------------------------------------------------

export interface ImportResult {
  areas: number
  goals: number
  subgoals: number
  checkins: number
  freezes: number
}

/**
 * Replaces the local store with a JSON export, **ids preserved** — the tables
 * reference each other by id, so remapping them would break every foreign
 * key. Normalisation reads the destination's column list, so an export taken
 * before a schema change still loads.
 */
export async function importSnapshot(raw: unknown, today = todayISO()): Promise<ImportResult> {
  const snapshot = normaliseSnapshot(raw, today)
  const now = stamp()
  const withStamp = <T extends object>(rows: T[]): T[] =>
    rows.map((r) => ({ deleted: false, ...r, updated_at: now }))

  await db.transaction(
    'rw',
    [db.areas, db.goals, db.subgoals, db.checkins, db.freezes, db.meta],
    async () => {
      await Promise.all([
        db.areas.clear(),
        db.goals.clear(),
        db.subgoals.clear(),
        db.checkins.clear(),
        db.freezes.clear(),
      ])
      await db.areas.bulkPut(withStamp(snapshot.areas))
      await db.goals.bulkPut(withStamp(snapshot.goals))
      await db.subgoals.bulkPut(withStamp(snapshot.subgoals))
      await db.checkins.bulkPut(withStamp(snapshot.checkins))
      await db.freezes.bulkPut(withStamp(snapshot.freezes))
      await reserveIds([
        ...snapshot.areas.map((r) => r.id),
        ...snapshot.goals.map((r) => r.id),
        ...snapshot.subgoals.map((r) => r.id),
        ...snapshot.freezes.map((r) => r.id),
      ])
    },
  )

  if (snapshot.areas.length === 0) await ensureSeeded()

  return {
    areas: snapshot.areas.length,
    goals: snapshot.goals.length,
    subgoals: snapshot.subgoals.length,
    checkins: snapshot.checkins.length,
    freezes: snapshot.freezes.length,
  }
}

/** The five tables dumped whole, in the same shape the importer accepts. */
export async function exportSnapshot(): Promise<Snapshot> {
  return loadSnapshot()
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

/**
 * Loads `migration/sample-export.json` through the ordinary import path.
 *
 * It exists for the same reason the file is checked in: a fresh install has
 * nothing to show, and the star, the strip and the calendar cannot be judged
 * against an empty store. It is also a live, working example of the export
 * shape the real migration has to match.
 */
export async function importSample(today = todayISO()): Promise<ImportResult> {
  const sample: unknown = (await import('../../migration/sample-export.json')).default
  return importSnapshot(sample, today)
}

export type { Area, Freeze }
