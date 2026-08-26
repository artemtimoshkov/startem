/**
 * Row shapes — SPEC.md §3.
 *
 * These are the *storage* names: the identical field names are used in
 * IndexedDB, in the JSON export and in Postgres. `updated_at` / `deleted`
 * are sync plumbing (§10) and are invisible to every rule in this module —
 * except that a tombstoned row behaves as if it were not there at all.
 */

/** A local-time calendar day, `YYYY-MM-DD`. Compared lexicographically (§2). */
export type ISODate = string

/** A local wall-clock time, `HH:MM`, 24-hour. Never carries a date or a zone. */
export type ClockTime = string

/** Monday-first, zero-indexed: 0 = Monday … 6 = Sunday (§2). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export type CadenceType = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'once'
export type Importance = 'high' | 'medium' | 'low'
export type GoalStatus = 'active' | 'frozen'
export type CheckinStatus = 'done' | 'skipped'

/** Sync columns carried by every row in every table (§10). */
export interface SyncMeta {
  /** ISO timestamp. Orders conflicting writes; never describes a lived day. */
  updated_at?: string
  /** Tombstone. A row with `deleted` is treated as absent everywhere. */
  deleted?: boolean
}

export interface Area extends SyncMeta {
  id: number
  name: string
  /** Order around the chart, clockwise from twelve o'clock. */
  position: number
}

/**
 * A goal is a heading, not a weight.
 *
 * Priority lives on the task (§3, §5): two tasks under one goal are rarely
 * equally urgent, and a goal-level weight forced them to be. A goal groups
 * tasks inside an area, and can be frozen — that is all it does.
 */
export interface Goal extends SyncMeta {
  id: number
  area_id: number
  title: string
  description: string
  /** `frozen` goals leave scoring entirely, taking their tasks with them (§5). */
  status: GoalStatus
  /** Nothing is scheduled before this date. */
  created_at: ISODate
}

/**
 * A task — the only thing that ever gets ticked.
 *
 * Stored as `subgoals` for continuity with §3's table names. A task always
 * belongs to an **area**; a goal is optional, so a task can sit directly in
 * Health without inventing a goal to hang it on.
 */
export interface Subgoal extends SyncMeta {
  id: number
  /** → areas.id. Required: every task scores against exactly one area. */
  area_id: number
  /** → goals.id, or null for a task attached straight to its area. */
  goal_id: number | null
  title: string
  /** Sets the weight of every occurrence unless `weight` overrides it (§5). */
  importance: Importance
  cadence_type: CadenceType
  /** Every `interval` units of the cadence. 1 for everything but a custom repeat. */
  interval: number
  /** Weekly only. Monday-first weekday numbers, e.g. `[0,2,5]`. */
  days: number[]
  /** Monthly/quarterly fixed-date mode. Held to 1–28 on write *and* read. */
  monthly_day: number | null
  /** Monthly/quarterly weekday mode. Non-null selects this mode. */
  month_weekday: number | null
  /** 1–4, or -1 for "last". Pairs with `month_weekday`. */
  month_ordinal: number | null
  /** One-time only, and optional even then. */
  due_date: ISODate | null
  /** Recurring only: the first day it can come due, and the interval's anchor. */
  start_date: ISODate | null
  /** Recurring only: the last day it can come due. **Inclusive.** */
  repeat_until: ISODate | null
  /** Optional time of day, `HH:MM`. Display only — scoring is per day (§2). */
  time: ClockTime | null
  /** Overrides the importance weight for this task alone. */
  weight: number | null
  created_at: ISODate
  /** Archived tasks leave the interface; their history stays meaningful. */
  archived: boolean
}

/** The task is the unit of work; `Task` is the name the UI uses for it. */
export type Task = Subgoal

/**
 * `(subgoal_id, date)` is the real key. **No row means unresolved**, which is
 * not the same as missed: a past day with no row is a miss, today with no row
 * is still pending (§3, §5).
 */
export interface Checkin extends SyncMeta {
  subgoal_id: number
  date: ISODate
  status: CheckinStatus
}

/** A period, not a flag — so unfreezing cannot back-fill misses (§3). */
export interface Freeze extends SyncMeta {
  id: number
  goal_id: number
  start_date: ISODate
  /** Null means still frozen. **Exclusive** when set. */
  end_date: ISODate | null
}

/** Everything the pure core ever sees: the five tables, as plain arrays. */
export interface Snapshot {
  areas: Area[]
  goals: Goal[]
  subgoals: Subgoal[]
  checkins: Checkin[]
  freezes: Freeze[]
}
