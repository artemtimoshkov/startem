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
  MAX_AREAS,
  MIN_AREAS,
  type Area,
  type CheckinStatus,
  type ClockTime,
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
import sampleExport from '../../migration/sample-export.json'
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
// Goals (§7)
// ---------------------------------------------------------------------------

/**
 * What the goal editor hands back.
 *
 * A goal is an aim: an area, a title and some prose. It carries no importance,
 * owns no tasks and never appears in a score — habits hang off the area
 * directly (§3, §5). Editing one is therefore only ever these three fields
 * plus, separately, whether it has been reached.
 */
export interface GoalDraft {
  id?: number
  area_id: number
  title: string
  description: string
}

/** Creates or updates a goal. Returns its id. */
export async function saveGoal(draft: GoalDraft, today = todayISO()): Promise<number> {
  return db.transaction('rw', db.goals, db.meta, async () => {
    const now = stamp()
    const existing = draft.id == null ? undefined : await db.goals.get(draft.id)
    const goalId = draft.id ?? (await newId())
    // A new goal goes to the end of its area's list rather than the top: the
    // aims already written down are the ones being worked on.
    const position =
      existing?.position ??
      (await db.goals.where('area_id').equals(draft.area_id).toArray()).reduce(
        (max, g) => (g.deleted ? max : Math.max(max, g.position + 1)),
        0,
      )
    await db.goals.put({
      id: goalId,
      area_id: draft.area_id,
      title: draft.title.trim(),
      description: draft.description.trim(),
      status: existing?.status ?? 'active',
      position,
      achieved_on: existing?.achieved_on ?? null,
      created_at: existing?.created_at ?? today,
      updated_at: now,
      deleted: false,
    })
    return goalId
  })
}

/** The one-line create behind the area screen's "What are you aiming for?". */
export async function createGoal(
  area_id: number,
  title: string,
  today = todayISO(),
): Promise<number> {
  return saveGoal({ area_id, title, description: '' }, today)
}

/**
 * Marks a goal reached, or puts it back in play.
 *
 * `achieved_on` is the day it happened, and it is cleared on the way back out
 * — a goal reopened in October must not still claim it was reached in March.
 */
export async function setGoalStatus(
  goalId: number,
  status: GoalStatus,
  today = todayISO(),
): Promise<void> {
  const goal = await db.goals.get(goalId)
  if (!goal) return
  await db.goals.put({
    ...goal,
    status,
    achieved_on: status === 'achieved' ? today : null,
    updated_at: stamp(),
  })
}

/**
 * Removes a goal — as a tombstone, so the removal can propagate at §10 rather
 * than a device that missed it quietly resurrecting the goal on the next pull.
 *
 * Nothing else moves. A goal owns no tasks now (§3): deleting "bench 100 kg"
 * has no more effect on the gym habit than crossing a line out of a notebook.
 */
export async function deleteGoal(goalId: number): Promise<void> {
  const goal = await db.goals.get(goalId)
  if (!goal) return
  await db.goals.put({ ...goal, deleted: true, updated_at: stamp() })
}

/** Reorders one area's goals to exactly the ids given, in that order. */
export async function reorderGoals(areaId: number, orderedIds: number[]): Promise<void> {
  await db.transaction('rw', db.goals, async () => {
    const now = stamp()
    for (const [position, id] of orderedIds.entries()) {
      const goal = await db.goals.get(id)
      if (!goal || goal.area_id !== areaId) continue
      if (goal.position === position) continue
      await db.goals.put({ ...goal, position, updated_at: now })
    }
  })
}

// ---------------------------------------------------------------------------
// Tasks (§7)
// ---------------------------------------------------------------------------

/** What the task composer hands back. No id means a new task. */
export interface TaskDraft {
  id?: number
  area_id: number
  title: string
  importance: Importance
  cadence_type: Subgoal['cadence_type']
  interval: number
  days: number[]
  monthly_day: number | null
  month_weekday: number | null
  month_ordinal: number | null
  due_date: ISODate | null
  start_date: ISODate | null
  repeat_until: ISODate | null
  time: ClockTime | null
  weight: number | null
}

/**
 * Creates or updates one task.
 *
 * `created_at` is never rewritten on an edit: it is the day the task started
 * existing, and moving it would retroactively schedule — or unschedule — every
 * occurrence behind it (§3).
 */
export async function saveTask(draft: TaskDraft, today = todayISO()): Promise<number> {
  return db.transaction('rw', db.subgoals, db.meta, async () => {
    const now = stamp()
    const existing = draft.id == null ? undefined : await db.subgoals.get(draft.id)
    const id = draft.id ?? (await newId())
    const row = normaliseSubgoal(
      {
        ...draft,
        id,
        archived: existing?.archived ?? false,
        created_at: existing?.created_at ?? today,
      },
      today,
    )
    await db.subgoals.put({ ...row, id, updated_at: now, deleted: false })
    return id
  })
}

/**
 * Removes a task from the interface without touching its history.
 *
 * **Archive, never delete:** its past check-ins still exist and still describe
 * real days; deleting the task would orphan them and silently rewrite what
 * those days looked like (§3).
 */
export async function archiveTask(taskId: number, archived = true): Promise<void> {
  const task = await db.subgoals.get(taskId)
  if (!task) return
  await db.subgoals.put({ ...task, archived, updated_at: stamp() })
}

/** Moves a task to another area. That is the only place a task can live (§3). */
export async function moveTask(taskId: number, area_id: number): Promise<void> {
  const task = await db.subgoals.get(taskId)
  if (!task) return
  await db.subgoals.put({ ...task, area_id, updated_at: stamp() })
}

/**
 * Pauses one habit: opens a period, starting today.
 *
 * The period is what matters, not a flag. A flag would say the habit is paused
 * *now* but not that it was paused last March, and unpausing would back-fill
 * every dormant day with a miss (§3). Paused days are outside scoring
 * entirely — they are neither kept nor missed.
 */
export async function pauseTask(taskId: number, today = todayISO()): Promise<void> {
  await db.transaction('rw', db.freezes, db.meta, async () => {
    const open = (await db.freezes.where('subgoal_id').equals(taskId).toArray()).find(
      (f) => !f.deleted && f.end_date == null,
    )
    if (open) return
    await db.freezes.add({
      id: await newId(),
      subgoal_id: taskId,
      start_date: today,
      end_date: null,
      updated_at: stamp(),
      deleted: false,
    })
  })
}

/** Closes the open period. `end_date` is exclusive, so today is live again. */
export async function resumeTask(taskId: number, today = todayISO()): Promise<void> {
  await db.transaction('rw', db.freezes, async () => {
    const now = stamp()
    for (const period of await db.freezes.where('subgoal_id').equals(taskId).toArray()) {
      if (period.deleted || period.end_date != null) continue
      // Exclusive end: resuming makes today itself live again.
      const end = period.start_date > today ? period.start_date : today
      if (end === period.start_date) {
        // Paused and resumed on the same day: the period covers no days at
        // all, so it is noise in the history rather than a record of anything.
        await db.freezes.put({ ...period, end_date: end, deleted: true, updated_at: now })
      } else {
        await db.freezes.put({ ...period, end_date: end, updated_at: now })
      }
    }
  })
}

/** `paused` is what the habit screen's one switch writes. */
export async function setTaskPaused(
  taskId: number,
  paused: boolean,
  today = todayISO(),
): Promise<void> {
  if (paused) await pauseTask(taskId, today)
  else await resumeTask(taskId, today)
}

// ---------------------------------------------------------------------------
// Areas (§7) — the user's, from the first run onwards
// ---------------------------------------------------------------------------

/** Thrown when a write would leave the star with no spokes, or too many. */
export class AreaLimitError extends Error {}

/** Live areas, in chart order. */
async function liveAreas(): Promise<Area[]> {
  return (await db.areas.toArray())
    .filter((a) => !a.deleted)
    .sort((a, b) => a.position - b.position || a.id - b.id)
}

/** A blank name is refused rather than stored — an unlabelled spoke is noise. */
export async function renameArea(areaId: number, name: string): Promise<void> {
  const area = await db.areas.get(areaId)
  if (!area) return
  await db.areas.put({ ...area, name: name.trim() || area.name, updated_at: stamp() })
}

/**
 * Adds a spoke to the star, at the end of the ring.
 *
 * The chart's geometry is `360 / count`, so this is genuinely all there is to
 * it — nothing downstream assumes ten (§6).
 */
export async function addArea(name: string): Promise<number> {
  const clean = name.trim()
  if (!clean) throw new AreaLimitError('An area needs a name.')
  return db.transaction('rw', db.areas, db.meta, async () => {
    const areas = await liveAreas()
    if (areas.length >= MAX_AREAS) {
      throw new AreaLimitError(`The star holds ${MAX_AREAS} areas at most.`)
    }
    const id = await newId()
    await db.areas.put({
      id,
      name: clean,
      position: areas.length === 0 ? 0 : areas[areas.length - 1]!.position + 1,
      updated_at: stamp(),
      deleted: false,
    })
    return id
  })
}

/** What deleting an area would take with it, so the confirmation can say so. */
export interface AreaContents {
  habits: number
  todos: number
  goals: number
}

export async function areaContents(areaId: number): Promise<AreaContents> {
  const [tasks, goals] = await Promise.all([
    db.subgoals.where('area_id').equals(areaId).toArray(),
    db.goals.where('area_id').equals(areaId).toArray(),
  ])
  const live = tasks.filter((t) => !t.deleted && !t.archived)
  return {
    habits: live.filter((t) => t.cadence_type !== 'once').length,
    todos: live.filter((t) => t.cadence_type === 'once').length,
    goals: goals.filter((g) => !g.deleted).length,
  }
}

/**
 * Removes an area, and with it the spoke on the star.
 *
 * The area is tombstoned so the removal propagates (§10). Its tasks are
 * **archived, not deleted** — their check-ins still describe real days, and
 * this is the same rule that governs retiring a single task (§3). Its goals
 * are tombstoned, because an aim with nowhere to live is just a stray row.
 *
 * The last area cannot go: a star with no spokes has nothing to draw, and an
 * app whose only screen is empty has no way back.
 */
export async function deleteArea(areaId: number): Promise<void> {
  await db.transaction('rw', db.areas, db.goals, db.subgoals, async () => {
    const areas = await liveAreas()
    if (areas.length <= MIN_AREAS) {
      throw new AreaLimitError('The last area cannot be removed.')
    }
    const area = await db.areas.get(areaId)
    if (!area || area.deleted) return
    const now = stamp()

    await db.areas.put({ ...area, deleted: true, updated_at: now })
    for (const task of await db.subgoals.where('area_id').equals(areaId).toArray()) {
      if (task.archived) continue
      await db.subgoals.put({ ...task, archived: true, updated_at: now })
    }
    for (const goal of await db.goals.where('area_id').equals(areaId).toArray()) {
      if (goal.deleted) continue
      await db.goals.put({ ...goal, deleted: true, updated_at: now })
    }

    // Positions are compacted so the ring has no gap in it, and so a later
    // insert cannot land on a position two areas already share.
    let position = 0
    for (const other of areas) {
      if (other.id === areaId) continue
      if (other.position !== position) {
        await db.areas.put({ ...other, position, updated_at: now })
      }
      position++
    }
  })
}

/** Moves one area `by` places around the ring. Clamped at both ends. */
export async function moveArea(areaId: number, by: number): Promise<void> {
  await db.transaction('rw', db.areas, async () => {
    const areas = await liveAreas()
    const from = areas.findIndex((a) => a.id === areaId)
    if (from < 0) return
    const to = Math.min(areas.length - 1, Math.max(0, from + by))
    if (to === from) return
    const reordered = areas.slice()
    reordered.splice(to, 0, reordered.splice(from, 1)[0]!)
    const now = stamp()
    for (const [position, area] of reordered.entries()) {
      if (area.position === position) continue
      await db.areas.put({ ...area, position, updated_at: now })
    }
  })
}

// ---------------------------------------------------------------------------
// Loading a whole snapshot — the sample dataset's engine
// ---------------------------------------------------------------------------

export interface ImportResult {
  areas: number
  goals: number
  subgoals: number
  checkins: number
  freezes: number
}

/**
 * Replaces the local store with a whole snapshot, **ids preserved** — the
 * tables reference each other by id, so remapping them would break every
 * foreign key. Normalisation reads the destination's column list, so a
 * snapshot written before a schema change still loads.
 *
 * The app no longer imports or exports JSON — that screen is gone — so the
 * only caller left is `importSample` below. It stays whole, and tested,
 * because it is also the shape §11's one-off migration would arrive in.
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

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

/**
 * Loads `migration/sample-export.json` through the snapshot loader above.
 *
 * It exists for the same reason the file is checked in: a fresh install has
 * nothing to show, and the star, the strip and the calendar cannot be judged
 * against an empty store. Preview builds (`VITE_SEED_SAMPLE=1`) are its only
 * caller.
 */
export async function importSample(today = todayISO()): Promise<ImportResult> {
  return importSnapshot(sampleExport, today)
}

export type { Area, Freeze }
