/**
 * Normalisers — SPEC.md §3, §4, §12.
 *
 * "Give it plain row objects, get plain values back" only holds if the rows
 * really are plain. Everything entering the store goes through here, so a
 * goal created offline on the phone becomes the same row as one created
 * anywhere else — and so the traps that have already been paid for once
 * (fixed monthly days above 28, a number input nudged by the mouse wheel)
 * are caught at the storage boundary rather than in the scoring maths.
 *
 * Pure: imports nothing but its own types.
 */

import { clampMonthlyDay } from './score'
import type {
  Area,
  CadenceType,
  CheckinStatus,
  ClockTime,
  Goal,
  GoalStatus,
  Importance,
  ISODate,
  Checkin,
  Freeze,
  Snapshot,
  Subgoal,
} from './types'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CLOCK_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

const CADENCE_TYPES: CadenceType[] = ['daily', 'weekly', 'monthly', 'quarterly', 'once']
const IMPORTANCES: Importance[] = ['high', 'medium', 'low']
const GOAL_STATUSES: GoalStatus[] = ['active', 'frozen']
const CHECKIN_STATUSES: CheckinStatus[] = ['done', 'skipped']

/** The ten areas the app ships with. The chart adapts to any count (§3). */
export const DEFAULT_AREAS: readonly string[] = [
  'Health',
  'Hobbies',
  'Work',
  'Business',
  'Friends',
  'Family',
  'Purpose',
  'Money',
  'Relationship',
  'Other',
]

function asInt(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.round(n)
}

function asText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim()
  if (value == null) return fallback
  return String(value).trim()
}

function asBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function asEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return (allowed as string[]).includes(s) ? (s as T) : fallback
}

/** Keeps a `YYYY-MM-DD` string, or null. Timestamps are truncated to their day. */
export function asDate(value: unknown, fallback: ISODate | null = null): ISODate | null {
  if (typeof value !== 'string') return fallback
  const s = value.trim()
  if (ISO_DATE_RE.test(s)) return s
  // Tolerate an ISO timestamp arriving from an older export or a `timestamptz`
  // column that should never have been one (§2) — keep the day, drop the time.
  const head = s.slice(0, 10)
  return ISO_DATE_RE.test(head) ? head : fallback
}

function requireDate(value: unknown, fallback: ISODate): ISODate {
  return asDate(value, fallback) ?? fallback
}

/**
 * Keeps an `HH:MM` local wall-clock string, or null.
 *
 * A time is never widened into a timestamp: §2 stores days, and a task at
 * 07:30 means half seven wherever the phone happens to be, not an instant
 * that moves when it crosses a border.
 */
export function asTime(value: unknown): ClockTime | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (CLOCK_TIME_RE.test(s)) return s
  // `07:30:00` from a Postgres `time` column, or `07:30 ` from an input.
  const head = s.slice(0, 5)
  return CLOCK_TIME_RE.test(head) ? head : null
}

/** Weekday list for a weekly action: unique, sorted, 0–6, Monday-first. */
export function normaliseDays(value: unknown): number[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim().startsWith('[')
      ? safeParseArray(value)
      : []
  const seen = new Set<number>()
  for (const entry of raw) {
    const n = asInt(entry, -1)
    if (n >= 0 && n <= 6) seen.add(n)
  }
  return [...seen].sort((a, b) => a - b)
}

function safeParseArray(value: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 1–4, or -1 for "last". Anything else means "last" (§4). */
export function normaliseOrdinal(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = asInt(value, -1)
  if (n >= 1 && n <= 4) return n
  return -1
}

function normaliseSyncMeta(raw: Record<string, unknown>): {
  updated_at?: string
  deleted?: boolean
} {
  const out: { updated_at?: string; deleted?: boolean } = {}
  if (typeof raw['updated_at'] === 'string') out.updated_at = raw['updated_at']
  if ('deleted' in raw) out.deleted = asBool(raw['deleted'])
  return out
}

export function normaliseArea(raw: Record<string, unknown>, index = 0): Area {
  return {
    id: asInt(raw['id'], index + 1),
    name: asText(raw['name'], 'Area'),
    position: asInt(raw['position'], index),
    ...normaliseSyncMeta(raw),
  }
}

/**
 * A goal carries no importance any more — priority is the task's (§3). An
 * export written before that change still has the column; it is read here
 * only to seed the tasks underneath it, in `normaliseSnapshot`.
 */
export function normaliseGoal(raw: Record<string, unknown>, today: ISODate): Goal {
  return {
    id: asInt(raw['id'], 0),
    area_id: asInt(raw['area_id'], 0),
    title: asText(raw['title']),
    description: asText(raw['description']),
    status: asEnum(raw['status'], GOAL_STATUSES, 'active'),
    created_at: requireDate(raw['created_at'], today),
    ...normaliseSyncMeta(raw),
  }
}

/** What a task inherits from the goal it hangs on, when its own row is silent. */
export interface SubgoalContext {
  area_id?: number
  importance?: Importance
}

/**
 * The important one. A fixed monthly day is clamped to 1–28 here as well as on
 * read, and the two cadence modes are kept mutually exclusive: a non-null
 * `month_weekday` selects weekday mode, so the fixed day is dropped rather
 * than left lying around to confuse a later read.
 */
export function normaliseSubgoal(
  raw: Record<string, unknown>,
  today: ISODate,
  context: SubgoalContext = {},
): Subgoal {
  const cadence = asEnum(raw['cadence_type'], CADENCE_TYPES, 'weekly')
  const recursMonthly = cadence === 'monthly' || cadence === 'quarterly'
  const recurs = cadence !== 'once'

  const rawWeekday = raw['month_weekday']
  const weekdayMode =
    recursMonthly && rawWeekday != null && rawWeekday !== ''
      ? Math.min(6, Math.max(0, asInt(rawWeekday, 0)))
      : null

  const rawDay = raw['monthly_day']
  const fixedDay =
    recursMonthly && weekdayMode == null && rawDay != null && rawDay !== ''
      ? clampMonthlyDay(asInt(rawDay, 1))
      : null

  const weight = raw['weight']
  const normalisedWeight =
    weight == null || weight === '' ? null : Math.max(1, asInt(weight, 1))

  const rawGoal = raw['goal_id']
  const goalId = rawGoal == null || rawGoal === '' ? null : asInt(rawGoal, 0) || null

  const rawInterval = raw['interval']
  const interval =
    rawInterval == null || rawInterval === '' ? 1 : Math.max(1, asInt(rawInterval, 1))

  const start = recurs ? asDate(raw['start_date']) : null
  const until = recurs ? asDate(raw['repeat_until']) : null

  return {
    id: asInt(raw['id'], 0),
    // A task always scores against an area. An export written before tasks
    // had one gets it from the goal it hangs on (§3).
    area_id: asInt(raw['area_id'], context.area_id ?? 0),
    goal_id: goalId,
    title: asText(raw['title']),
    importance: asEnum(raw['importance'], IMPORTANCES, context.importance ?? 'medium'),
    cadence_type: cadence,
    interval,
    days: cadence === 'weekly' ? normaliseDays(raw['days']) : [],
    monthly_day: fixedDay,
    month_weekday: weekdayMode,
    month_ordinal: weekdayMode == null ? null : normaliseOrdinal(raw['month_ordinal']),
    due_date: cadence === 'once' ? asDate(raw['due_date']) : null,
    start_date: start,
    // An end before the start would make the task permanently unscheduled
    // while still looking live in the editor, so it is simply dropped.
    repeat_until: until != null && start != null && until < start ? null : until,
    time: asTime(raw['time']),
    weight: normalisedWeight,
    created_at: requireDate(raw['created_at'], today),
    archived: asBool(raw['archived']),
    ...normaliseSyncMeta(raw),
  }
}

export function normaliseCheckin(raw: Record<string, unknown>, today: ISODate): Checkin {
  return {
    subgoal_id: asInt(raw['subgoal_id'], 0),
    date: requireDate(raw['date'], today),
    status: asEnum(raw['status'], CHECKIN_STATUSES, 'done'),
    ...normaliseSyncMeta(raw),
  }
}

export function normaliseFreeze(raw: Record<string, unknown>, today: ISODate): Freeze {
  return {
    id: asInt(raw['id'], 0),
    goal_id: asInt(raw['goal_id'], 0),
    start_date: requireDate(raw['start_date'], today),
    end_date: asDate(raw['end_date']),
    ...normaliseSyncMeta(raw),
  }
}

type RawTable = unknown

function rows(value: RawTable): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (r): r is Record<string, unknown> => typeof r === 'object' && r !== null,
  )
}

/**
 * Normalises a whole JSON export into a snapshot, ids preserved — the tables
 * reference each other by id, so remapping them would break every foreign key
 * (see the migration note at the end of the spec).
 */
export function normaliseSnapshot(raw: unknown, today: ISODate): Snapshot {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, RawTable>

  // Read the goals *raw*, so that an export written when importance lived on
  // the goal can hand it down to that goal's tasks before it is dropped.
  const rawGoals = rows(src['goals'])
  const context = new Map<number, SubgoalContext>()
  for (const g of rawGoals) {
    context.set(asInt(g['id'], 0), {
      area_id: asInt(g['area_id'], 0),
      importance: asEnum(g['importance'], IMPORTANCES, 'medium'),
    })
  }

  return {
    areas: rows(src['areas']).map(normaliseArea),
    goals: rawGoals.map((r) => normaliseGoal(r, today)),
    subgoals: rows(src['subgoals']).map((r) =>
      normaliseSubgoal(r, today, context.get(asInt(r['goal_id'], 0)) ?? {}),
    ),
    checkins: rows(src['checkins']).map((r) => normaliseCheckin(r, today)),
    freezes: rows(src['freezes']).map((r) => normaliseFreeze(r, today)),
  }
}

/** An empty snapshot with the default areas in place. */
export function emptySnapshot(): Snapshot {
  return {
    areas: DEFAULT_AREAS.map((name, i) => ({ id: i + 1, name, position: i })),
    goals: [],
    subgoals: [],
    checkins: [],
    freezes: [],
  }
}
