/**
 * Date helpers, cadence rules, weights, windows, tallies and grid cells —
 * SPEC.md §2, §4, §5, §6.
 *
 * Pure. This file imports nothing but its own types: no Dexie, no Supabase,
 * no React. Plain rows in, plain values out (§9).
 */

import type {
  Checkin,
  CheckinStatus,
  Freeze,
  Importance,
  ISODate,
  Subgoal,
} from './types'

// ---------------------------------------------------------------------------
// Constants — every number here is load-bearing and justified in the spec.
// ---------------------------------------------------------------------------

/**
 * 28, never 30. Over 28 days every weekday falls *exactly* four times; over 30
 * two weekdays fall five times and which ones drifts with the calendar, so a
 * 30-day window silently re-weights actions underneath the user's weights.
 * A 30-day window can also contain the same monthly date twice (§5).
 */
export const SCORING_WINDOW_DAYS = 28

/** Standing-mode reach for monthly actions. Consecutive "last Sunday" dates
 *  can sit 35 days apart, so 45 clears it comfortably (§5). */
export const MONTHLY_LOOKBACK_DAYS = 45

/** Standing-mode reach for quarterly actions — consecutive ones ≈97 days (§5). */
export const QUARTERLY_LOOKBACK_DAYS = 115

/** Any day within 182 days (26 weeks) can be edited; future dates never (§7). */
export const BACKDATE_LIMIT_DAYS = 182

/** Weekly history strip (§6). */
export const WEEKLY_STRIP_WEEKS = 8
/** Per-goal tracker grid (§6). */
export const GOAL_GRID_WEEKS = 15
/** Day-by-day calendar (§6). */
export const CALENDAR_WEEKS = 26

/** Quarterly actions fire only in these months (§4). */
export const QUARTER_MONTHS = [1, 4, 7, 10]

/** Fixed monthly days are clamped to this range on write *and* on read (§4). */
export const MIN_MONTHLY_DAY = 1
export const MAX_MONTHLY_DAY = 28

// ---------------------------------------------------------------------------
// Dates — local-time `YYYY-MM-DD` strings, Monday-first weekdays (§2)
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Splits `YYYY-MM-DD` into `[year, month (1–12), day]`. Throws on anything else. */
export function parseISO(date: ISODate): [number, number, number] {
  if (typeof date !== 'string' || !ISO_DATE_RE.test(date)) {
    throw new Error(`Not a YYYY-MM-DD date: ${JSON.stringify(date)}`)
  }
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  const d = Number(date.slice(8, 10))
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    throw new Error(`Not a calendar date: ${date}`)
  }
  return [y, m, d]
}

/** Builds a `YYYY-MM-DD` string, normalising overflow (month 13, day 32, …). */
export function toISO(year: number, month1: number, day: number): ISODate {
  const dt = new Date(year, month1 - 1, day)
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`
}

/** A `Date` at local midnight on `date`. Only ever used inside this file. */
function toLocalDate(date: ISODate): Date {
  const [y, m, d] = parseISO(date)
  return new Date(y, m - 1, d)
}

/** Today, as a local-time `YYYY-MM-DD` string. */
export function todayISO(now: Date = new Date()): ISODate {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

/**
 * Monday-first, zero-indexed weekday. `getDay()` is Sunday-first, so it always
 * needs the `+6 % 7` rotation — forgetting it is the single most repeated bug
 * in this codebase's history (§2).
 */
export function dow(date: ISODate): number {
  return (toLocalDate(date).getDay() + 6) % 7
}

/** Calendar day of the month, 1–31. */
export function dayOfMonth(date: ISODate): number {
  return parseISO(date)[2]
}

/** Calendar month, 1–12. */
export function month(date: ISODate): number {
  return parseISO(date)[1]
}

/** Calendar year. */
export function year(date: ISODate): number {
  return parseISO(date)[0]
}

/** `date` shifted by `n` days (negative goes back). Crosses months and years. */
export function addDays(date: ISODate, n: number): ISODate {
  const [y, m, d] = parseISO(date)
  return toISO(y, m, d + n)
}

/** Whole days from `from` to `to`; negative when `to` precedes `from`. */
export function daysBetween(from: ISODate, to: ISODate): number {
  const ms = toLocalDate(to).getTime() - toLocalDate(from).getTime()
  return Math.round(ms / 86_400_000)
}

/** Whole months from `from` to `to`, ignoring the day of the month. */
export function monthsBetween(from: ISODate, to: ISODate): number {
  const [fy, fm] = parseISO(from)
  const [ty, tm] = parseISO(to)
  return (ty - fy) * 12 + (tm - fm)
}

/** The Monday of the week containing `date` (§2, §6 — weeks are Monday-start). */
export function weekStart(date: ISODate): ISODate {
  return addDays(date, -dow(date))
}

/** Whole Monday-start weeks from the week of `from` to the week of `to`. */
export function weeksBetween(from: ISODate, to: ISODate): number {
  return daysBetween(weekStart(from), weekStart(to)) / 7
}

/** Every date from `from` to `to` inclusive. Empty when `to` precedes `from`. */
export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

// ---------------------------------------------------------------------------
// Freezes — periods, not a flag (§3)
// ---------------------------------------------------------------------------

/**
 * A date is frozen when a period covers it. Note the asymmetry: `start_date`
 * is inclusive and `end_date` is **exclusive**, so unfreezing makes that same
 * day live again (§3).
 */
export function isFrozenOn(date: ISODate, freezes: readonly Freeze[]): boolean {
  for (const f of freezes) {
    if (f.deleted) continue
    if (f.start_date <= date && (f.end_date == null || date < f.end_date)) {
      return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Cadence (§4)
// ---------------------------------------------------------------------------

/**
 * Holds a fixed monthly day to 1–28. Days 29–31 do not exist in every month,
 * so an action on "day 31" would silently never come due in five months a
 * year. "Last Friday" is the only correct way to express genuine month-end.
 */
export function clampMonthlyDay(day: number): number {
  const n = Math.round(day)
  if (!Number.isFinite(n)) return MIN_MONTHLY_DAY
  return Math.min(MAX_MONTHLY_DAY, Math.max(MIN_MONTHLY_DAY, n))
}

/**
 * The monthly / quarterly pattern, in its two modes (§4).
 *
 * Fixed-date mode (`month_weekday` null) matches the clamped day of month.
 * Weekday mode matches "the Nth <weekday>", where ordinal -1 means "last":
 * a date is the last of its weekday in the month exactly when seven days
 * later lands in a different month, and `ceil(day / 7)` gives the ordinal
 * because the 1st–7th always hold the first of every weekday.
 */
export function monthPattern(action: Subgoal, date: ISODate): boolean {
  if (action.month_weekday == null) {
    if (action.monthly_day == null) return false
    return dayOfMonth(date) === clampMonthlyDay(action.monthly_day)
  }
  if (dow(date) !== action.month_weekday) return false
  const ordinal = action.month_ordinal ?? -1
  if (ordinal === -1) return month(addDays(date, 7)) !== month(date)
  return Math.ceil(dayOfMonth(date) / 7) === ordinal
}

/** Every repeat is "every N of something"; 1 unless a custom repeat says otherwise. */
export function intervalOf(action: Subgoal): number {
  const n = action.interval
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) return 1
  return Math.round(n)
}

/**
 * The date an interval counts from: the chosen start, or failing that the day
 * the task was created. Anchoring on a stored date rather than on "today"
 * is what keeps "every 4 weeks" landing on the same weeks tomorrow as it does
 * today — a drifting anchor would silently reschedule the task on every read.
 */
export function anchorOf(action: Subgoal): ISODate {
  return action.start_date ?? action.created_at
}

/**
 * Does `date` fall on one of the repeat's periods? Always true for the plain
 * `interval: 1` case, so the ordinary cadences pay nothing for this.
 */
function onIntervalStep(action: Subgoal, date: ISODate): boolean {
  const every = intervalOf(action)
  if (every === 1) return true
  const anchor = anchorOf(action)
  switch (action.cadence_type) {
    case 'daily':
      return daysBetween(anchor, date) % every === 0
    case 'weekly':
      return weeksBetween(anchor, date) % every === 0
    case 'monthly':
      return monthsBetween(anchor, date) % every === 0
    default:
      return true
  }
}

/**
 * The one predicate everything rests on: does this action come due on this
 * date? `freezes` are the periods of the action's *goal* — a task with no goal
 * has none (§4).
 */
export function isScheduled(
  action: Subgoal,
  date: ISODate,
  freezes: readonly Freeze[] = [],
): boolean {
  if (action.deleted) return false // tombstoned rows are simply not there
  if (action.archived) return false
  if (action.created_at > date) return false // did not exist yet
  if (action.start_date != null && action.start_date > date) return false
  // Inclusive, unlike a freeze's exclusive end: "ends on the 30th" has to
  // include the 30th, which is what the repeat editor says out loud.
  if (action.repeat_until != null && action.repeat_until < date) return false
  if (isFrozenOn(date, freezes)) return false
  if (!onIntervalStep(action, date)) return false

  switch (action.cadence_type) {
    case 'daily':
      return true
    case 'weekly':
      return action.days.includes(dow(date))
    case 'monthly':
      return monthPattern(action, date)
    case 'quarterly':
      return monthPattern(action, date) && QUARTER_MONTHS.includes(month(date))
    case 'once':
      return false // never recurs
    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// Weights (§5)
// ---------------------------------------------------------------------------

export const IMPORTANCE_WEIGHT: Record<Importance, number> = {
  high: 4,
  medium: 2,
  low: 1,
}

/**
 * A task's weight comes from its own priority, unless `subgoals.weight`
 * overrides it with an explicit number.
 *
 * Priority is the task's, not the goal's: a goal groups work, it does not
 * declare that every piece of it matters equally (§5).
 */
export function weightOf(action: Subgoal): number {
  const override = action.weight
  if (override != null && Number.isFinite(override) && override > 0) {
    return override
  }
  return IMPORTANCE_WEIGHT[action.importance] ?? IMPORTANCE_WEIGHT.medium
}

// ---------------------------------------------------------------------------
// Tallies and the score formula (§5)
// ---------------------------------------------------------------------------

/** A weighted pool of occurrences: weight completed over weight that came due. */
export interface Tally {
  earned: number
  available: number
}

export function emptyTally(): Tally {
  return { earned: 0, available: 0 }
}

export function addTally(a: Tally, b: Tally): Tally {
  return { earned: a.earned + b.earned, available: a.available + b.available }
}

export function sumTallies(tallies: readonly Tally[]): Tally {
  return tallies.reduce(addTally, emptyTally())
}

/** `earned / available`, or **null** when nothing came due (§5). */
export function rateOf(tally: Tally): number | null {
  if (tally.available === 0) return null
  return tally.earned / tally.available
}

/**
 * `score = round((1 + rate * 9) * 10) / 10` — so 0% → 1.0 and 100% → 10.0.
 * The floor is 1 because a 1–10 chart cannot draw a zero-length spoke; null
 * stays null, because an area with nothing scheduled has no opinion (§5).
 */
export function scoreOf(rate: number | null): number | null {
  if (rate == null) return null
  return Math.round((1 + rate * 9) * 10) / 10
}

/** Convenience: tally → score. */
export function scoreOfTally(tally: Tally): number | null {
  return scoreOf(rateOf(tally))
}

/** Check-ins for one action, keyed by date. Tombstones must already be gone. */
export type CheckinsByDate = ReadonlyMap<ISODate, Checkin>

const NO_CHECKINS: CheckinsByDate = new Map()

/** One occurrence of an action on one day, and how it resolved. */
export interface Occurrence {
  date: ISODate
  /** null means unresolved — pending today, a miss in the past. */
  status: CheckinStatus | null
}

/**
 * The single occurrence a one-time action ever has, or null (§4).
 *
 * A one-time action never recurs, so `isScheduled` is false for it on every
 * date. It still earns and loses weight though — "a win once completed, a
 * standing miss once its deadline passes, and simply not yet owed before
 * then" — so it gets exactly one occurrence, on one effective date:
 *
 * - **completed or crossed out** → the day it was actually logged;
 * - **unresolved with a deadline that has passed** → that deadline;
 * - **unresolved and due today, or with no deadline at all** → none, because
 *   today is pending and a deadline-free task never counts against anything.
 *
 * The occurrence is then windowed like any other, so a win ages out of the
 * star after 28 days rather than propping it up forever.
 */
export function onceOccurrence(
  action: Subgoal,
  today: ISODate,
  checkins: CheckinsByDate = NO_CHECKINS,
  freezes: readonly Freeze[] = [],
): Occurrence | null {
  if (action.cadence_type !== 'once') return null
  if (action.deleted || action.archived) return null

  // Logged: the day the work actually happened. There should only ever be one
  // row, but the latest wins if an older store managed to write two.
  let logged: Checkin | undefined
  for (const c of checkins.values()) {
    if (c.date < action.created_at) continue
    if (c.date > today) continue
    if (!logged || c.date > logged.date) logged = c
  }
  if (logged) {
    if (isFrozenOn(logged.date, freezes)) return null
    return { date: logged.date, status: logged.status }
  }

  const due = action.due_date
  if (
    due != null &&
    due < today && // due today is still pending, not failed
    due >= action.created_at &&
    !isFrozenOn(due, freezes)
  ) {
    return { date: due, status: null }
  }
  return null
}

/**
 * Does this action have an occurrence on this date, and how did it resolve?
 *
 * The one entry point that covers both recurring cadences and the one-time
 * exception, so the calendar, the grid and the day detail all agree.
 */
export function occurrenceOn(
  action: Subgoal,
  date: ISODate,
  today: ISODate,
  checkins: CheckinsByDate = NO_CHECKINS,
  freezes: readonly Freeze[] = [],
): Occurrence | null {
  if (action.cadence_type === 'once') {
    const occ = onceOccurrence(action, today, checkins, freezes)
    return occ && occ.date === date ? occ : null
  }
  if (!isScheduled(action, date, freezes)) return null
  const c = checkins.get(date)
  return { date, status: c ? c.status : null }
}

/**
 * Range mode: only what genuinely came due inside `[from, to]` (§5).
 *
 * Walks each day, skipping days the action wasn't due. Future days never
 * count, and **today with no check-in is skipped** — today is pending, not
 * failed. Everything else counts toward `available`; `done` also counts
 * toward `earned`, so `skipped` and a past unlogged day behave identically.
 */
export function tallyRange(
  action: Subgoal,
  weight: number,
  from: ISODate,
  to: ISODate,
  today: ISODate,
  checkins: CheckinsByDate = NO_CHECKINS,
  freezes: readonly Freeze[] = [],
): Tally {
  const last = to < today ? to : today

  // A one-time action has one occurrence on one effective date rather than a
  // cadence to walk, so it is counted directly (§4).
  if (action.cadence_type === 'once') {
    const occ = onceOccurrence(action, today, checkins, freezes)
    if (!occ || occ.date < from || occ.date > last) return emptyTally()
    return { earned: occ.status === 'done' ? weight : 0, available: weight }
  }

  const tally = emptyTally()
  for (let d = from; d <= last; d = addDays(d, 1)) {
    if (!isScheduled(action, d, freezes)) continue
    const c = checkins.get(d)
    if (d === today && !c) continue // pending, not failed
    tally.available += weight
    if (c && c.status === 'done') tally.earned += weight
  }
  return tally
}

/**
 * Roughly how many days sit between two occurrences. Only its size relative to
 * the 28-day window matters: it picks which of the two standing readings a
 * cadence gets, and how far the scanning one reaches (§5).
 */
export function periodDays(action: Subgoal): number {
  const every = intervalOf(action)
  switch (action.cadence_type) {
    case 'daily':
      return every
    case 'weekly':
      return every * 7
    case 'monthly':
      return every * 31
    case 'quarterly':
      return 97 // Jan → Apr → Jul → Oct
    default:
      return 1 // a one-time action is read through the plain window
  }
}

/** How far standing mode reaches back for each cadence (§5). */
export function lookbackFor(action: Subgoal): number {
  switch (action.cadence_type) {
    case 'monthly':
      return Math.max(MONTHLY_LOOKBACK_DAYS, periodDays(action) + 14)
    case 'quarterly':
      return QUARTERLY_LOOKBACK_DAYS
    default:
      // A custom repeat can outrun the 28-day window — "every 8 weeks" has no
      // due date at all inside it — so it reaches back two whole periods.
      return Math.max(SCORING_WINDOW_DAYS, periodDays(action) * 2)
  }
}

/**
 * Standing mode: where this action stands *now* (§5) — used by the star and
 * the goal percentages.
 *
 * Weekly actions — and the single occurrence of a one-time one — read the
 * plain 28-day window: every weekday falls exactly four times inside it, so
 * nothing can drop out. Monthly and quarterly ones
 * can have no due date at all inside 28 days, so instead their *most recent*
 * due instance represents them, found by scanning back day by day until the
 * first hit — up to 45 days (monthly) or 115 (quarterly). Today with no
 * check-in is skipped rather than ending the scan, so a monthly action stays
 * represented by last month's result until today is resolved.
 */
export function tallyStanding(
  action: Subgoal,
  weight: number,
  today: ISODate,
  checkins: CheckinsByDate = NO_CHECKINS,
  freezes: readonly Freeze[] = [],
): Tally {
  // A cadence that fits inside the window is read through it directly: every
  // weekday falls exactly four times in 28 days, so nothing can drop out. One
  // that does not fit — monthly, quarterly, or a long custom repeat — is
  // represented by its most recent due instance instead.
  if (periodDays(action) <= SCORING_WINDOW_DAYS) {
    const from = addDays(today, -(SCORING_WINDOW_DAYS - 1))
    return tallyRange(action, weight, from, today, today, checkins, freezes)
  }

  const lookback = lookbackFor(action)
  for (let i = 0; i < lookback; i++) {
    const d = addDays(today, -i)
    if (!isScheduled(action, d, freezes)) continue
    const c = checkins.get(d)
    if (d === today && !c) continue // pending — keep scanning for the previous one
    return {
      earned: c && c.status === 'done' ? weight : 0,
      available: weight,
    }
  }
  return emptyTally()
}

// ---------------------------------------------------------------------------
// Grid cells (§6)
// ---------------------------------------------------------------------------

/** The per-day state of a cell in the per-goal tracker grid (§6). */
export type DayCellState =
  | 'done'
  | 'partial'
  | 'missed'
  | 'today'
  | 'none'
  | 'frozen'
  | 'future'

/** How a day resolved, in unweighted counts. */
export interface DayResolution {
  /** Occurrences that came due. */
  due: number
  /** Of those, ticked. */
  done: number
  /** Of those, crossed out. */
  skipped: number
  /** Of those, with no row at all. */
  unresolved: number
}

export function emptyResolution(): DayResolution {
  return { due: 0, done: 0, skipped: 0, unresolved: 0 }
}

/**
 * Cell state from a day's resolution (§6). `frozen` is decided by the goal's
 * freeze periods before this is called, because `isScheduled` already returns
 * false on frozen days and a frozen day must not read as `none`.
 */
export function dayCellState(
  date: ISODate,
  today: ISODate,
  resolution: DayResolution,
  frozen: boolean,
): DayCellState {
  if (date > today) return 'future'
  if (frozen) return 'frozen'
  if (resolution.due === 0) return 'none'
  if (date === today && resolution.unresolved > 0) return 'today'
  if (resolution.done === resolution.due) return 'done'
  if (resolution.done > 0) return 'partial'
  return 'missed'
}

/** Weighted totals for one calendar day (§6). */
export interface DayTotals {
  date: ISODate
  /** All weight due, **including today's unresolved items**. */
  total: number
  /** Weight ticked. */
  done: number
  /** Weight crossed out. */
  skipped: number
  /** Occurrences due. */
  count: number
  /** Occurrences ticked. */
  doneCount: number
  /** `done / total`, or null when nothing was due. */
  ratio: number | null
}

export function emptyDayTotals(date: ISODate): DayTotals {
  return {
    date,
    total: 0,
    done: 0,
    skipped: 0,
    count: 0,
    doneCount: 0,
    ratio: null,
  }
}

/**
 * Five colour bands, "nothing logged" (0) through "everything logged" (4).
 * Null when nothing was due, which must read differently from a zero (§6).
 */
export function colourBand(ratio: number | null): number | null {
  if (ratio == null) return null
  if (ratio <= 0) return 0
  if (ratio >= 1) return 4
  if (ratio < 1 / 3) return 1
  if (ratio < 2 / 3) return 2
  return 3
}

/** Any day within 182 days can be edited; future dates never are (§7). */
export function canEditDay(date: ISODate, today: ISODate): boolean {
  if (date > today) return false
  return date >= addDays(today, -BACKDATE_LIMIT_DAYS)
}
