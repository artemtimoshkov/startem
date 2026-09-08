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

/**
 * `once` is the to-do; everything else is a habit (§3).
 *
 * There is no separate `kind` column, and there must not be one: two fields
 * saying the same thing drift, and this one is already load-bearing for
 * scheduling. `isHabit` / `isTodo` in `./score` read it.
 */
export type CadenceType = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'once'
export type Importance = 'high' | 'medium' | 'low'
/** A goal is an aim, so it is either still being aimed at or reached (§3). */
export type GoalStatus = 'active' | 'achieved'
export type CheckinStatus = 'done' | 'skipped'

/** Sync columns carried by every row in every table (§10). */
export interface SyncMeta {
  /** ISO timestamp. Orders conflicting writes; never describes a lived day. */
  updated_at?: string
  /** Tombstone. A row with `deleted` is treated as absent everywhere. */
  deleted?: boolean
}

/**
 * One spoke of the star. Created, renamed, reordered and removed by the user
 * (§7): the count is whatever they need, and the chart's geometry is derived
 * from it rather than fixed at ten.
 */
export interface Area extends SyncMeta {
  id: number
  name: string
  /** Order around the chart, clockwise from twelve o'clock. */
  position: number
}

/**
 * A goal is something you are aiming at, and nothing else.
 *
 * It owns no tasks, carries no weight, and never touches a score (§3, §5).
 * "Bench 100 kg" is the aim; "gym session, three times a week" is the habit
 * that gets you there, and the habit hangs off the *area*. Keeping the two
 * apart is what lets the daily list be nothing but habits while the area
 * screen still says what all of it is for.
 */
export interface Goal extends SyncMeta {
  id: number
  area_id: number
  title: string
  description: string
  status: GoalStatus
  /** Order inside its area, as the user dragged — or rather, sorted — them. */
  position: number
  /** The day it was reached, set when `status` becomes `achieved`. */
  achieved_on: ISODate | null
  created_at: ISODate
}

/**
 * A task — the only thing that ever gets ticked.
 *
 * Stored as `subgoals` for continuity with §3's table names. A task belongs to
 * exactly one **area**; there is no goal in between (§3). A repeating task is a
 * *habit* and is what the star scores; a `once` task is a *to-do*, tracked here
 * for convenience and deliberately kept out of scoring (§5).
 */
export interface Subgoal extends SyncMeta {
  id: number
  /** → areas.id. Required: every task belongs to exactly one area. */
  area_id: number
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
  /** To-dos only, and optional even then. */
  due_date: ISODate | null
  /** Habits only: the first day it can come due, and the interval's anchor. */
  start_date: ISODate | null
  /** Habits only: the last day it can come due. **Inclusive.** */
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

/**
 * A pause on one habit — a period, not a flag, so unpausing cannot back-fill
 * misses (§3).
 *
 * It hangs off the task rather than off a goal: a goal no longer owns any
 * work, so freezing one would pause nothing. "I am away for a fortnight, stop
 * counting the gym" is a statement about the habit.
 */
export interface Freeze extends SyncMeta {
  id: number
  subgoal_id: number
  start_date: ISODate
  /** Null means still paused. **Exclusive** when set. */
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
