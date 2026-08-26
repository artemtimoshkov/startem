/**
 * Snapshot → view payloads — SPEC.md §5, §6.
 *
 * All five derived views are pure functions of the stored rows plus today's
 * date. None of them needs storing. Pure: imports nothing but `./score`,
 * `./types` — no Dexie, no Supabase, no React (§9).
 */

import {
  CALENDAR_WEEKS,
  GOAL_GRID_WEEKS,
  SCORING_WINDOW_DAYS,
  WEEKLY_STRIP_WEEKS,
  addDays,
  canEditDay,
  colourBand,
  dayCellState,
  emptyDayTotals,
  emptyResolution,
  emptyTally,
  isFrozenOn,
  isScheduled,
  rateOf,
  scoreOf,
  tallyRange,
  tallyStanding,
  weekStart,
  weightOf,
} from './score'
import type {
  CheckinsByDate,
  DayCellState,
  DayResolution,
  DayTotals,
  Tally,
} from './score'
import type {
  Area,
  Checkin,
  CheckinStatus,
  Freeze,
  Goal,
  Importance,
  ISODate,
  Snapshot,
  Subgoal,
} from './types'

// ---------------------------------------------------------------------------
// Index — one pass over the snapshot, then everything below is lookups
// ---------------------------------------------------------------------------

const NO_FREEZES: readonly Freeze[] = []
const NO_CHECKINS: CheckinsByDate = new Map()

/** A snapshot with tombstones dropped and the foreign keys resolved. */
export interface Index {
  today: ISODate
  /** Live areas, in chart order. */
  areas: Area[]
  /** Live goals whose area exists, in area order then id order. */
  goals: Goal[]
  areaById: Map<number, Area>
  goalById: Map<number, Goal>
  subgoalById: Map<number, Subgoal>
  /** Live, non-archived actions per goal. */
  subgoalsByGoal: Map<number, Subgoal[]>
  goalsByArea: Map<number, Goal[]>
  freezesByGoal: Map<number, Freeze[]>
  checkinsBySubgoal: Map<number, Map<ISODate, Checkin>>
}

function live<T extends { deleted?: boolean }>(rows: readonly T[]): T[] {
  return rows.filter((r) => !r.deleted)
}

/**
 * Builds the lookup structures every view below shares. Tombstoned rows are
 * dropped here once, so nothing downstream has to remember to check.
 */
export function buildIndex(snapshot: Snapshot, today: ISODate): Index {
  const areas = live(snapshot.areas).sort(
    (a, b) => a.position - b.position || a.id - b.id,
  )
  const areaById = new Map(areas.map((a) => [a.id, a]))

  const goals = live(snapshot.goals)
    .filter((g) => areaById.has(g.area_id))
    .sort((a, b) => {
      const pa = areaById.get(a.area_id)!.position
      const pb = areaById.get(b.area_id)!.position
      return pa - pb || a.id - b.id
    })
  const goalById = new Map(goals.map((g) => [g.id, g]))

  const goalsByArea = new Map<number, Goal[]>()
  for (const a of areas) goalsByArea.set(a.id, [])
  for (const g of goals) goalsByArea.get(g.area_id)!.push(g)

  const subgoals = live(snapshot.subgoals)
    .filter((s) => !s.archived && goalById.has(s.goal_id))
    .sort((a, b) => a.id - b.id)
  const subgoalById = new Map(subgoals.map((s) => [s.id, s]))

  const subgoalsByGoal = new Map<number, Subgoal[]>()
  for (const g of goals) subgoalsByGoal.set(g.id, [])
  for (const s of subgoals) subgoalsByGoal.get(s.goal_id)!.push(s)

  const freezesByGoal = new Map<number, Freeze[]>()
  for (const f of live(snapshot.freezes)) {
    const bucket = freezesByGoal.get(f.goal_id)
    if (bucket) bucket.push(f)
    else freezesByGoal.set(f.goal_id, [f])
  }

  const checkinsBySubgoal = new Map<number, Map<ISODate, Checkin>>()
  for (const c of live(snapshot.checkins)) {
    let bucket = checkinsBySubgoal.get(c.subgoal_id)
    if (!bucket) {
      bucket = new Map()
      checkinsBySubgoal.set(c.subgoal_id, bucket)
    }
    // (subgoal_id, date) is the real key, so a later row simply wins.
    bucket.set(c.date, c)
  }

  return {
    today,
    areas,
    goals,
    areaById,
    goalById,
    subgoalById,
    subgoalsByGoal,
    goalsByArea,
    freezesByGoal,
    checkinsBySubgoal,
  }
}

function freezesOf(idx: Index, goalId: number): readonly Freeze[] {
  return idx.freezesByGoal.get(goalId) ?? NO_FREEZES
}

function checkinsOf(idx: Index, subgoalId: number): CheckinsByDate {
  return idx.checkinsBySubgoal.get(subgoalId) ?? NO_CHECKINS
}

function actionsOf(idx: Index, goalId: number): readonly Subgoal[] {
  return idx.subgoalsByGoal.get(goalId) ?? []
}

/** Frozen goals are excluded from every score and absent from the list (§5). */
function activeGoals(idx: Index): Goal[] {
  return idx.goals.filter((g) => g.status === 'active')
}

// ---------------------------------------------------------------------------
// The three levels of percentage (§5)
// ---------------------------------------------------------------------------

/** Standing-mode weighted pool for one goal. Frozen goals contribute nothing. */
export function goalTally(idx: Index, goal: Goal, weighted = true): Tally {
  if (goal.status !== 'active') return emptyTally()
  const freezes = freezesOf(idx, goal.id)
  const tally = emptyTally()
  for (const action of actionsOf(idx, goal.id)) {
    const w = weighted ? weightOf(goal, action) : 1
    const t = tallyStanding(action, w, idx.today, checkinsOf(idx, action.id), freezes)
    tally.earned += t.earned
    tally.available += t.available
  }
  return tally
}

/** Standing-mode weighted pool across all active goals in one area. */
export function areaTally(idx: Index, areaId: number): Tally {
  const tally = emptyTally()
  for (const goal of idx.goalsByArea.get(areaId) ?? []) {
    if (goal.status !== 'active') continue
    const t = goalTally(idx, goal)
    tally.earned += t.earned
    tally.available += t.available
  }
  return tally
}

/** The number on the chart: 1.0–10.0, or null when nothing is scheduled (§5). */
export function areaScore(idx: Index, areaId: number): number | null {
  return scoreOf(rateOf(areaTally(idx, areaId)))
}

/** The number on a goal card header: 0–1, or null. */
export function goalRate(idx: Index, goal: Goal): number | null {
  return rateOf(goalTally(idx, goal))
}

/**
 * The number next to an action: **unweighted** — occurrences done ÷
 * occurrences resolved. Weight is irrelevant when comparing an action to
 * itself (§5).
 */
export function actionRate(idx: Index, action: Subgoal): number | null {
  const goal = idx.goalById.get(action.goal_id)
  if (!goal || goal.status !== 'active') return null
  return rateOf(
    tallyStanding(action, 1, idx.today, checkinsOf(idx, action.id), freezesOf(idx, goal.id)),
  )
}

// ---------------------------------------------------------------------------
// View 1 — Today's list (§6)
// ---------------------------------------------------------------------------

export interface TodayItem {
  subgoal_id: number
  goal_id: number
  area_id: number
  title: string
  goalTitle: string
  areaName: string
  importance: Importance
  weight: number
  cadence_type: Subgoal['cadence_type']
  /** True for the one-time exception below. */
  once: boolean
  due_date: ISODate | null
  /** null means unresolved — pending, not missed. */
  status: CheckinStatus | null
}

export interface TodayGroup {
  area_id: number
  areaName: string
  items: TodayItem[]
}

export interface TodayView {
  date: ISODate
  groups: TodayGroup[]
  items: TodayItem[]
  /** Everything listed. */
  total: number
  doneCount: number
  skippedCount: number
  /** `total − crossed out`: crossing something out removes it from the target
   *  rather than making the day unwinnable (§6). */
  target: number
}

/**
 * Every action due today across active goals, sorted heaviest first, grouped
 * by area in the order the groups first appear (§6).
 *
 * One-time actions are the exception: they appear while pending regardless of
 * date, plus on the day they were completed.
 */
export function buildToday(snapshot: Snapshot, today: ISODate): TodayView {
  const idx = buildIndex(snapshot, today)
  const items: TodayItem[] = []

  for (const goal of activeGoals(idx)) {
    const area = idx.areaById.get(goal.area_id)!
    const freezes = freezesOf(idx, goal.id)
    const frozenToday = isFrozenOn(today, freezes)
    for (const action of actionsOf(idx, goal.id)) {
      const checkins = checkinsOf(idx, action.id)
      const todayCheckin = checkins.get(today)
      const once = action.cadence_type === 'once'

      let listed: boolean
      if (once) {
        // Pending (no check-in at all, ever) regardless of date, plus on the
        // day it was resolved. Freezes and creation date still apply.
        listed =
          !frozenToday && action.created_at <= today && (checkins.size === 0 || !!todayCheckin)
      } else {
        listed = isScheduled(action, today, freezes)
      }
      if (!listed) continue

      items.push({
        subgoal_id: action.id,
        goal_id: goal.id,
        area_id: area.id,
        title: action.title,
        goalTitle: goal.title,
        areaName: area.name,
        importance: goal.importance,
        weight: weightOf(goal, action),
        cadence_type: action.cadence_type,
        once,
        due_date: action.due_date,
        status: todayCheckin ? todayCheckin.status : null,
      })
    }
  }

  // Heaviest first, so the day's most important work is at the top. Area
  // position then ids break ties, which keeps the order stable across renders.
  items.sort(
    (a, b) =>
      b.weight - a.weight ||
      idx.areaById.get(a.area_id)!.position - idx.areaById.get(b.area_id)!.position ||
      a.goal_id - b.goal_id ||
      a.subgoal_id - b.subgoal_id,
  )

  const groups: TodayGroup[] = []
  const groupByArea = new Map<number, TodayGroup>()
  for (const item of items) {
    let group = groupByArea.get(item.area_id)
    if (!group) {
      group = { area_id: item.area_id, areaName: item.areaName, items: [] }
      groupByArea.set(item.area_id, group)
      groups.push(group) // in the order the groups first appear
    }
    group.items.push(item)
  }

  const doneCount = items.filter((i) => i.status === 'done').length
  const skippedCount = items.filter((i) => i.status === 'skipped').length

  return {
    date: today,
    groups,
    items,
    total: items.length,
    doneCount,
    skippedCount,
    target: items.length - skippedCount,
  }
}

// ---------------------------------------------------------------------------
// View 2 — The star (§6)
// ---------------------------------------------------------------------------

export interface StarVertex {
  area_id: number
  name: string
  position: number
  /** Index around the chart, 0-based, clockwise from twelve o'clock. */
  index: number
  /** Degrees: `-90 + (360 / count) * index`. */
  angle: number
  score: number | null
  rate: number | null
  earned: number
  available: number
  /** `score / 10`, or 0.5 for a null score — which draws at the midpoint. */
  radiusRatio: number
  /** `"7.4"`, or an em dash for a null score. */
  label: string
}

export interface StarView {
  date: ISODate
  vertices: StarVertex[]
  /** Faint rings at 2, 4, 6, 8, 10 (§6). */
  rings: number[]
  /** The chart is the main data display, so it needs a text description (§8). */
  description: string
}

/** The radar chart: one vertex per area, first at twelve o'clock, clockwise. */
export function buildStar(snapshot: Snapshot, today: ISODate): StarView {
  const idx = buildIndex(snapshot, today)
  const count = idx.areas.length
  const vertices = idx.areas.map((area, i) => {
    const tally = areaTally(idx, area.id)
    const rate = rateOf(tally)
    const score = scoreOf(rate)
    return {
      area_id: area.id,
      name: area.name,
      position: area.position,
      index: i,
      angle: count === 0 ? -90 : -90 + (360 / count) * i,
      score,
      rate,
      earned: tally.earned,
      available: tally.available,
      radiusRatio: score == null ? 0.5 : score / 10,
      label: score == null ? '—' : score.toFixed(1),
    }
  })

  const described = vertices.map((v) => `${v.name} ${v.label}`).join(', ')
  return {
    date: today,
    vertices,
    rings: [2, 4, 6, 8, 10],
    description: described
      ? `Area scores out of 10 over the last ${SCORING_WINDOW_DAYS} days: ${described}.`
      : 'No areas to score.',
  }
}

// ---------------------------------------------------------------------------
// View 3 — Weekly history strip (§6)
// ---------------------------------------------------------------------------

export interface WeekBar {
  weekStart: ISODate
  weekEnd: ISODate
  earned: number
  available: number
  /** null when nothing was due that week — renders flat, not empty (§6). */
  rate: number | null
  score: number | null
  isCurrent: boolean
}

/**
 * Eight calendar weeks, Monday-start, one bar per week, in **range** mode —
 * only what genuinely came due inside each week. The current week is scored
 * on the days resolved so far (§6).
 */
export function buildWeeklyStrip(
  snapshot: Snapshot,
  today: ISODate,
  weeks = WEEKLY_STRIP_WEEKS,
): WeekBar[] {
  const idx = buildIndex(snapshot, today)
  const current = weekStart(today)
  const bars: WeekBar[] = []

  for (let w = weeks - 1; w >= 0; w--) {
    const from = addDays(current, -7 * w)
    const to = addDays(from, 6)
    const tally = emptyTally()
    for (const goal of activeGoals(idx)) {
      const freezes = freezesOf(idx, goal.id)
      for (const action of actionsOf(idx, goal.id)) {
        const t = tallyRange(
          action,
          weightOf(goal, action),
          from,
          to,
          today,
          checkinsOf(idx, action.id),
          freezes,
        )
        tally.earned += t.earned
        tally.available += t.available
      }
    }
    const rate = rateOf(tally)
    bars.push({
      weekStart: from,
      weekEnd: to,
      earned: tally.earned,
      available: tally.available,
      rate,
      score: scoreOf(rate),
      isCurrent: from === current,
    })
  }
  return bars
}

// ---------------------------------------------------------------------------
// View 4 — Per-goal tracker grid (§6)
// ---------------------------------------------------------------------------

export interface GridCell {
  date: ISODate
  state: DayCellState
  due: number
  done: number
  skipped: number
  unresolved: number
}

export interface GridWeek {
  weekStart: ISODate
  days: GridCell[]
}

export interface GoalGridView {
  goal_id: number
  weeks: GridWeek[]
}

/** How a single goal's day resolved, in unweighted counts. */
function resolveGoalDay(idx: Index, goal: Goal, date: ISODate): DayResolution {
  const freezes = freezesOf(idx, goal.id)
  const out = emptyResolution()
  for (const action of actionsOf(idx, goal.id)) {
    if (!isScheduled(action, date, freezes)) continue
    out.due++
    const c = checkinsOf(idx, action.id).get(date)
    if (!c) out.unresolved++
    else if (c.status === 'done') out.done++
    else out.skipped++
  }
  return out
}

/** Fifteen weeks of day cells for a single goal, Monday-aligned (§6). */
export function buildGoalGrid(
  snapshot: Snapshot,
  goalId: number,
  today: ISODate,
  weeks = GOAL_GRID_WEEKS,
): GoalGridView {
  const idx = buildIndex(snapshot, today)
  const goal = idx.goalById.get(goalId)
  const start = addDays(weekStart(today), -7 * (weeks - 1))
  const freezes = goal ? freezesOf(idx, goal.id) : NO_FREEZES

  const out: GridWeek[] = []
  for (let w = 0; w < weeks; w++) {
    const ws = addDays(start, 7 * w)
    const days: GridCell[] = []
    for (let d = 0; d < 7; d++) {
      const date = addDays(ws, d)
      const resolution = goal ? resolveGoalDay(idx, goal, date) : emptyResolution()
      days.push({
        date,
        state: dayCellState(date, today, resolution, isFrozenOn(date, freezes)),
        due: resolution.due,
        done: resolution.done,
        skipped: resolution.skipped,
        unresolved: resolution.unresolved,
      })
    }
    out.push({ weekStart: ws, days })
  }
  return { goal_id: goalId, weeks: out }
}

// ---------------------------------------------------------------------------
// View 5 — Day-by-day calendar (§6)
// ---------------------------------------------------------------------------

export interface CalendarDay extends DayTotals {
  /** Five colour bands, 0 = nothing logged … 4 = everything logged; null when
   *  nothing was due, so a gap reads differently from a zero. */
  band: number | null
  isToday: boolean
  isFuture: boolean
  editable: boolean
}

export interface CalendarWeek {
  weekStart: ISODate
  days: CalendarDay[]
}

export interface CalendarView {
  date: ISODate
  weeks: CalendarWeek[]
}

function totalsForDay(idx: Index, date: ISODate): DayTotals {
  const totals = emptyDayTotals(date)
  for (const goal of activeGoals(idx)) {
    const freezes = freezesOf(idx, goal.id)
    for (const action of actionsOf(idx, goal.id)) {
      if (!isScheduled(action, date, freezes)) continue
      const weight = weightOf(goal, action)
      // A day cell's ratio counts *all* weight due, including today's
      // unresolved items — today reads as progress so far. The star excludes
      // unresolved items instead. Both are right for their purpose (§6);
      // do not "fix" one to match the other.
      totals.total += weight
      totals.count++
      const c = checkinsOf(idx, action.id).get(date)
      if (!c) continue
      if (c.status === 'done') {
        totals.done += weight
        totals.doneCount++
      } else {
        totals.skipped += weight
      }
    }
  }
  totals.ratio = totals.total === 0 ? null : totals.done / totals.total
  return totals
}

/**
 * Twenty-six weeks across all active goals, Monday-aligned columns, ending
 * with the week containing today (§6).
 */
export function buildCalendar(
  snapshot: Snapshot,
  today: ISODate,
  weeks = CALENDAR_WEEKS,
): CalendarView {
  const idx = buildIndex(snapshot, today)
  const start = addDays(weekStart(today), -7 * (weeks - 1))

  const out: CalendarWeek[] = []
  for (let w = 0; w < weeks; w++) {
    const ws = addDays(start, 7 * w)
    const days: CalendarDay[] = []
    for (let d = 0; d < 7; d++) {
      const date = addDays(ws, d)
      const isFuture = date > today
      const totals = isFuture ? emptyDayTotals(date) : totalsForDay(idx, date)
      days.push({
        ...totals,
        band: colourBand(totals.ratio),
        isToday: date === today,
        isFuture,
        editable: canEditDay(date, today),
      })
    }
    out.push({ weekStart: ws, days })
  }
  return { date: today, weeks: out }
}

// ---------------------------------------------------------------------------
// Day detail — the editable checklist behind a calendar day (§6, §7)
// ---------------------------------------------------------------------------

export interface DayDetailItem {
  subgoal_id: number
  goal_id: number
  area_id: number
  title: string
  goalTitle: string
  areaName: string
  importance: Importance
  weight: number
  once: boolean
  /** null means unresolved. */
  status: CheckinStatus | null
  /** False for an item that only appears because it was logged that day. */
  wasDue: boolean
}

export interface DayDetailView extends DayTotals {
  items: DayDetailItem[]
  editable: boolean
  isToday: boolean
}

/**
 * The checklist for one day: what was owed as well as what was logged.
 *
 * For **today** it also includes pending one-time actions, so it matches the
 * Today list exactly; for a **past** day it does not, because a task due next
 * week was not owed back then (§6).
 */
export function buildDayDetail(
  snapshot: Snapshot,
  date: ISODate,
  today: ISODate,
): DayDetailView {
  const idx = buildIndex(snapshot, today)
  const isToday = date === today
  const items: DayDetailItem[] = []

  for (const goal of activeGoals(idx)) {
    const area = idx.areaById.get(goal.area_id)!
    const freezes = freezesOf(idx, goal.id)
    const frozen = isFrozenOn(date, freezes)
    for (const action of actionsOf(idx, goal.id)) {
      const checkins = checkinsOf(idx, action.id)
      const checkin = checkins.get(date)
      const wasDue = isScheduled(action, date, freezes)
      const once = action.cadence_type === 'once'
      const pendingOnce =
        once && isToday && !frozen && action.created_at <= date && checkins.size === 0

      // Logged items always show, even if the cadence has since changed —
      // the row describes a real day and the checklist must not hide it.
      if (!wasDue && !checkin && !pendingOnce) continue

      items.push({
        subgoal_id: action.id,
        goal_id: goal.id,
        area_id: area.id,
        title: action.title,
        goalTitle: goal.title,
        areaName: area.name,
        importance: goal.importance,
        weight: weightOf(goal, action),
        once,
        status: checkin ? checkin.status : null,
        wasDue,
      })
    }
  }

  items.sort(
    (a, b) =>
      b.weight - a.weight ||
      idx.areaById.get(a.area_id)!.position - idx.areaById.get(b.area_id)!.position ||
      a.goal_id - b.goal_id ||
      a.subgoal_id - b.subgoal_id,
  )

  const totals = date > today ? emptyDayTotals(date) : totalsForDay(idx, date)
  return { ...totals, items, editable: canEditDay(date, today), isToday }
}
