/**
 * Snapshot → view payloads — SPEC.md §5, §6.
 *
 * All the derived views are pure functions of the stored rows plus today's
 * date. None of them needs storing. Pure: imports nothing but `./score`,
 * `./types` — no Dexie, no Supabase, no React (§9).
 */

import {
  CALENDAR_WEEKS,
  HABIT_GRID_WEEKS,
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
  isHabit,
  isScheduled,
  isTodo,
  occurrenceOn,
  onceOccurrence,
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
  /** Live goals whose area exists, in area order then position. */
  goals: Goal[]
  /** Live, non-archived tasks whose area exists — habits and to-dos alike. */
  tasks: Subgoal[]
  /** Just the repeating ones. This is what scoring walks (§5). */
  habits: Subgoal[]
  /** Just the one-time ones. Tracked, never scored (§5). */
  todos: Subgoal[]
  areaById: Map<number, Area>
  goalById: Map<number, Goal>
  subgoalById: Map<number, Subgoal>
  /** Every task in an area, in the order it was created. */
  subgoalsByArea: Map<number, Subgoal[]>
  /** Just that area's habits, and just its to-dos. */
  habitsByArea: Map<number, Subgoal[]>
  todosByArea: Map<number, Subgoal[]>
  goalsByArea: Map<number, Goal[]>
  /** Pause periods per task (§3). */
  freezesBySubgoal: Map<number, Freeze[]>
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
      return pa - pb || a.position - b.position || a.id - b.id
    })
  const goalById = new Map(goals.map((g) => [g.id, g]))

  const goalsByArea = new Map<number, Goal[]>()
  for (const a of areas) goalsByArea.set(a.id, [])
  for (const g of goals) goalsByArea.get(g.area_id)!.push(g)

  const subgoals = live(snapshot.subgoals)
    .filter((s) => !s.archived && areaById.has(s.area_id))
    .sort((a, b) => a.id - b.id)
  const subgoalById = new Map(subgoals.map((s) => [s.id, s]))

  const subgoalsByArea = new Map<number, Subgoal[]>()
  const habitsByArea = new Map<number, Subgoal[]>()
  const todosByArea = new Map<number, Subgoal[]>()
  for (const a of areas) {
    subgoalsByArea.set(a.id, [])
    habitsByArea.set(a.id, [])
    todosByArea.set(a.id, [])
  }
  for (const s of subgoals) {
    subgoalsByArea.get(s.area_id)!.push(s)
    ;(isHabit(s) ? habitsByArea : todosByArea).get(s.area_id)!.push(s)
  }

  const freezesBySubgoal = new Map<number, Freeze[]>()
  for (const f of live(snapshot.freezes)) {
    const bucket = freezesBySubgoal.get(f.subgoal_id)
    if (bucket) bucket.push(f)
    else freezesBySubgoal.set(f.subgoal_id, [f])
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
    tasks: subgoals,
    habits: subgoals.filter(isHabit),
    todos: subgoals.filter(isTodo),
    areaById,
    goalById,
    subgoalById,
    subgoalsByArea,
    habitsByArea,
    todosByArea,
    goalsByArea,
    freezesBySubgoal,
    checkinsBySubgoal,
  }
}

function checkinsOf(idx: Index, subgoalId: number): CheckinsByDate {
  return idx.checkinsBySubgoal.get(subgoalId) ?? NO_CHECKINS
}

/** The pause periods that apply to a task: its own, and nothing else's (§3). */
export function taskFreezes(idx: Index, task: Subgoal): readonly Freeze[] {
  return idx.freezesBySubgoal.get(task.id) ?? NO_FREEZES
}

/** True while a pause period covers today — the habit is out of scoring (§5). */
export function isPaused(idx: Index, task: Subgoal): boolean {
  return isFrozenOn(idx.today, taskFreezes(idx, task))
}

/** Every habit in an area. To-dos are deliberately not here (§5). */
function areaHabits(idx: Index, areaId: number): readonly Subgoal[] {
  return idx.habitsByArea.get(areaId) ?? []
}

// ---------------------------------------------------------------------------
// The two levels of percentage (§5)
// ---------------------------------------------------------------------------

/**
 * Standing-mode weighted pool for one area: every habit in it.
 *
 * To-dos are excluded on purpose. The star is a statement about how well the
 * habits are being kept, and an errand jotted down and dropped is not evidence
 * about that (§5).
 */
export function areaTally(idx: Index, areaId: number): Tally {
  const tally = emptyTally()
  for (const task of areaHabits(idx, areaId)) {
    const t = tallyStanding(
      task,
      weightOf(task),
      idx.today,
      checkinsOf(idx, task.id),
      taskFreezes(idx, task),
    )
    tally.earned += t.earned
    tally.available += t.available
  }
  return tally
}

/** The number on the chart: 1.0–10.0, or null when nothing is scheduled (§5). */
export function areaScore(idx: Index, areaId: number): number | null {
  return scoreOf(rateOf(areaTally(idx, areaId)))
}

/**
 * The number next to a habit: **unweighted** — occurrences done ÷ occurrences
 * resolved. Weight is irrelevant when comparing a habit to itself (§5).
 */
export function habitRate(idx: Index, task: Subgoal): number | null {
  if (isTodo(task)) return null
  return rateOf(
    tallyStanding(task, 1, idx.today, checkinsOf(idx, task.id), taskFreezes(idx, task)),
  )
}

/**
 * The current run of consecutive kept days, counting back from the last day
 * the habit came due.
 *
 * Today is not allowed to break a streak: it is pending until it is resolved
 * (§5), so an unticked today is stepped over rather than counted as a miss.
 * Paused days are stepped over too — that is the whole point of a pause.
 */
export function habitStreak(idx: Index, task: Subgoal): number {
  if (isTodo(task)) return 0
  const checkins = checkinsOf(idx, task.id)
  const freezes = taskFreezes(idx, task)
  let streak = 0
  for (let i = 0; i < 366; i++) {
    const date = addDays(idx.today, -i)
    if (date < task.created_at) break
    if (!isScheduled(task, date, freezes)) continue
    const c = checkins.get(date)
    if (date === idx.today && !c) continue // pending, not a break
    if (c && c.status === 'done') streak++
    else break
  }
  return streak
}

// ---------------------------------------------------------------------------
// View 1 — Today's habits (§6)
// ---------------------------------------------------------------------------

export interface TodayItem {
  subgoal_id: number
  area_id: number
  title: string
  areaName: string
  importance: Importance
  weight: number
  cadence_type: Subgoal['cadence_type']
  /** Optional time of day, `HH:MM`. Display only. */
  time: string | null
  /** null means unresolved — pending, not missed. */
  status: CheckinStatus | null
  /** Consecutive kept days up to now. */
  streak: number
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
 * Every **habit** due today, sorted heaviest first, grouped by area in the
 * order the groups first appear (§6).
 *
 * To-dos are not here. The day's list is the habit list, which is what makes
 * it a habit tracker rather than an inbox; `buildTodos` is the other half, and
 * the two are never mixed into one score (§6).
 */
export function buildToday(snapshot: Snapshot, today: ISODate): TodayView {
  const idx = buildIndex(snapshot, today)
  const items: TodayItem[] = []

  for (const task of idx.habits) {
    const freezes = taskFreezes(idx, task)
    if (!isScheduled(task, today, freezes)) continue
    const area = idx.areaById.get(task.area_id)!
    const todayCheckin = checkinsOf(idx, task.id).get(today)

    items.push({
      subgoal_id: task.id,
      area_id: area.id,
      title: task.title,
      areaName: area.name,
      importance: task.importance,
      weight: weightOf(task),
      cadence_type: task.cadence_type,
      time: task.time,
      status: todayCheckin ? todayCheckin.status : null,
      streak: habitStreak(idx, task),
    })
  }

  // Heaviest first, so the day's most important work is at the top. Area
  // position then ids break ties, which keeps the order stable across renders.
  items.sort(
    (a, b) =>
      b.weight - a.weight ||
      idx.areaById.get(a.area_id)!.position - idx.areaById.get(b.area_id)!.position ||
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
// View 2 — the to-do list (§6)
// ---------------------------------------------------------------------------

/** Which pile a to-do falls into, in the order the list shows them (§6). */
export type TodoBucket = 'overdue' | 'today' | 'upcoming' | 'someday' | 'done'

export interface TodoItem {
  subgoal_id: number
  area_id: number
  title: string
  areaName: string
  importance: Importance
  due_date: ISODate | null
  time: string | null
  /** null means still open. */
  status: CheckinStatus | null
  /** The day it was ticked or crossed out, when it was. */
  resolved_on: ISODate | null
  bucket: TodoBucket
}

export interface TodoSection {
  bucket: TodoBucket
  items: TodoItem[]
}

export interface TodosView {
  date: ISODate
  sections: TodoSection[]
  items: TodoItem[]
  /** Still open, whatever their date — the number worth badging. */
  openCount: number
  /** Open with a deadline that has already passed. */
  overdueCount: number
  /** Open and owed today, or already past. What the Today screen surfaces. */
  dueTodayCount: number
}

const BUCKET_ORDER: TodoBucket[] = ['overdue', 'today', 'upcoming', 'someday', 'done']

/**
 * Every to-do, in five piles.
 *
 * A resolved to-do stays on the list for a fortnight so that ticking one does
 * not make it vanish before the eye has followed it — after that it drops off
 * on its own rather than needing to be cleared.
 */
const DONE_TAIL_DAYS = 14

export function buildTodos(snapshot: Snapshot, today: ISODate): TodosView {
  const idx = buildIndex(snapshot, today)
  const items: TodoItem[] = []

  for (const task of idx.todos) {
    const area = idx.areaById.get(task.area_id)!
    const checkins = checkinsOf(idx, task.id)
    const freezes = taskFreezes(idx, task)
    const occ = onceOccurrence(task, today, checkins, freezes)
    const resolved = occ && occ.status != null ? occ : null

    let bucket: TodoBucket
    if (resolved) {
      if (resolved.date < addDays(today, -DONE_TAIL_DAYS)) continue
      bucket = 'done'
    } else if (task.due_date == null) bucket = 'someday'
    else if (task.due_date < today) bucket = 'overdue'
    else if (task.due_date === today) bucket = 'today'
    else bucket = 'upcoming'

    items.push({
      subgoal_id: task.id,
      area_id: area.id,
      title: task.title,
      areaName: area.name,
      importance: task.importance,
      due_date: task.due_date,
      time: task.time,
      status: resolved ? resolved.status : null,
      resolved_on: resolved ? resolved.date : null,
      bucket,
    })
  }

  // Inside a pile: soonest deadline first, then heaviest, then oldest. The
  // done pile reads the other way round — most recently finished at the top.
  items.sort((a, b) => {
    const order = BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket)
    if (order !== 0) return order
    if (a.bucket === 'done') {
      return (b.resolved_on ?? '').localeCompare(a.resolved_on ?? '') || b.subgoal_id - a.subgoal_id
    }
    const da = a.due_date ?? '9999-12-31'
    const db = b.due_date ?? '9999-12-31'
    if (da !== db) return da < db ? -1 : 1
    const wa = idx.subgoalById.get(a.subgoal_id)!
    const wb = idx.subgoalById.get(b.subgoal_id)!
    return weightOf(wb) - weightOf(wa) || a.subgoal_id - b.subgoal_id
  })

  const sections: TodoSection[] = []
  for (const bucket of BUCKET_ORDER) {
    const inBucket = items.filter((i) => i.bucket === bucket)
    if (inBucket.length > 0) sections.push({ bucket, items: inBucket })
  }

  const open = items.filter((i) => i.status == null)
  return {
    date: today,
    sections,
    items,
    openCount: open.length,
    overdueCount: open.filter((i) => i.bucket === 'overdue').length,
    dueTodayCount: open.filter((i) => i.bucket === 'overdue' || i.bucket === 'today').length,
  }
}

// ---------------------------------------------------------------------------
// View 3 — The star (§6)
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
  /** How many habits stand behind the number. */
  habitCount: number
  goalCount: number
}

export interface StarView {
  date: ISODate
  vertices: StarVertex[]
  /** Faint rings at 2, 4, 6, 8, 10 (§6). */
  rings: number[]
  /** The chart is the main data display, so it needs a text description (§8). */
  description: string
}

/**
 * The radar chart: one vertex per area, first at twelve o'clock, clockwise.
 *
 * The geometry is derived from the count, so adding or removing an area
 * (§7) simply redraws the star — there is no fixed ten anywhere.
 */
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
      habitCount: (idx.habitsByArea.get(area.id) ?? []).length,
      goalCount: (idx.goalsByArea.get(area.id) ?? []).filter((g) => g.status === 'active').length,
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
// View 4 — Weekly history strip (§6)
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
 * on the days resolved so far (§6). Habits only, like every other score.
 *
 * `areaId` narrows it to one area; omitted, it covers all of them.
 */
export function buildWeeklyStrip(
  snapshot: Snapshot,
  today: ISODate,
  weeks = WEEKLY_STRIP_WEEKS,
  areaId?: number,
): WeekBar[] {
  const idx = buildIndex(snapshot, today)
  const current = weekStart(today)
  const habits = areaId == null ? idx.habits : areaHabits(idx, areaId)
  const bars: WeekBar[] = []

  for (let w = weeks - 1; w >= 0; w--) {
    const from = addDays(current, -7 * w)
    const to = addDays(from, 6)
    const tally = emptyTally()
    for (const task of habits) {
      const t = tallyRange(
        task,
        weightOf(task),
        from,
        to,
        today,
        checkinsOf(idx, task.id),
        taskFreezes(idx, task),
      )
      tally.earned += t.earned
      tally.available += t.available
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
// View 5 — Per-habit tracker grid (§6)
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

export interface HabitGridView {
  subgoal_id: number
  weeks: GridWeek[]
}

/** How a single habit's day resolved, in unweighted counts. */
function resolveHabitDay(idx: Index, task: Subgoal, date: ISODate): DayResolution {
  const out = emptyResolution()
  const occ = occurrenceOn(
    task,
    date,
    idx.today,
    checkinsOf(idx, task.id),
    taskFreezes(idx, task),
  )
  if (!occ) return out
  out.due++
  if (occ.status === 'done') out.done++
  else if (occ.status === 'skipped') out.skipped++
  else out.unresolved++
  return out
}

/**
 * Fifteen weeks of day cells for a single habit, Monday-aligned (§6).
 *
 * This is the grid that used to hang off a goal. It belongs on the habit: the
 * habit is the thing with a cadence, so it is the only thing whose day cells
 * mean "kept" or "missed" rather than an average of unrelated work.
 */
export function buildHabitGrid(
  snapshot: Snapshot,
  subgoalId: number,
  today: ISODate,
  weeks = HABIT_GRID_WEEKS,
): HabitGridView {
  const idx = buildIndex(snapshot, today)
  const task = idx.subgoalById.get(subgoalId)
  const start = addDays(weekStart(today), -7 * (weeks - 1))
  const freezes = task ? taskFreezes(idx, task) : NO_FREEZES

  const out: GridWeek[] = []
  for (let w = 0; w < weeks; w++) {
    const ws = addDays(start, 7 * w)
    const days: GridCell[] = []
    for (let d = 0; d < 7; d++) {
      const date = addDays(ws, d)
      const resolution = task ? resolveHabitDay(idx, task, date) : emptyResolution()
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
  return { subgoal_id: subgoalId, weeks: out }
}

// ---------------------------------------------------------------------------
// View 6 — Day-by-day calendar (§6)
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
  for (const task of idx.habits) {
    const occ = occurrenceOn(
      task,
      date,
      idx.today,
      checkinsOf(idx, task.id),
      taskFreezes(idx, task),
    )
    if (!occ) continue
    const weight = weightOf(task)
    // A day cell's ratio counts *all* weight due, including today's
    // unresolved items — today reads as progress so far. The star excludes
    // unresolved items instead. Both are right for their purpose (§6);
    // do not "fix" one to match the other.
    totals.total += weight
    totals.count++
    if (occ.status === 'done') {
      totals.done += weight
      totals.doneCount++
    } else if (occ.status === 'skipped') {
      totals.skipped += weight
    }
  }
  totals.ratio = totals.total === 0 ? null : totals.done / totals.total
  return totals
}

/**
 * Twenty-six weeks of habit-keeping, Monday-aligned columns, ending with the
 * week containing today (§6).
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
  area_id: number
  title: string
  areaName: string
  importance: Importance
  weight: number
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
 * The checklist of habits for one day: what was owed as well as what was
 * logged. A day that was owed nothing shows nothing, which is the point of
 * the calendar's null band (§6).
 */
export function buildDayDetail(
  snapshot: Snapshot,
  date: ISODate,
  today: ISODate,
): DayDetailView {
  const idx = buildIndex(snapshot, today)
  const items: DayDetailItem[] = []

  for (const task of idx.habits) {
    const area = idx.areaById.get(task.area_id)!
    const checkins = checkinsOf(idx, task.id)
    const checkin = checkins.get(date)
    const occ = occurrenceOn(task, date, today, checkins, taskFreezes(idx, task))

    // Logged items always show, even if the cadence has since changed —
    // the row describes a real day and the checklist must not hide it.
    if (!occ && !checkin) continue

    items.push({
      subgoal_id: task.id,
      area_id: area.id,
      title: task.title,
      areaName: area.name,
      importance: task.importance,
      weight: weightOf(task),
      status: checkin ? checkin.status : occ ? occ.status : null,
      wasDue: occ !== null,
    })
  }

  items.sort(
    (a, b) =>
      b.weight - a.weight ||
      idx.areaById.get(a.area_id)!.position - idx.areaById.get(b.area_id)!.position ||
      a.subgoal_id - b.subgoal_id,
  )

  const totals = date > today ? emptyDayTotals(date) : totalsForDay(idx, date)
  return { ...totals, items, editable: canEditDay(date, today), isToday: date === today }
}

// ---------------------------------------------------------------------------
// Goals — an aim, not a container (§3, §6)
// ---------------------------------------------------------------------------

export interface AreaGoals {
  active: Goal[]
  achieved: Goal[]
}

/**
 * One area's goals, split by whether they have been reached.
 *
 * There is no percentage here, and there must not be one: a goal owns no
 * tasks any more, so any number attached to it would be invented (§5).
 */
export function areaGoals(idx: Index, areaId: number): AreaGoals {
  const goals = idx.goalsByArea.get(areaId) ?? []
  return {
    active: goals.filter((g) => g.status === 'active'),
    // Most recently reached first — the newest win is the one worth seeing.
    achieved: goals
      .filter((g) => g.status === 'achieved')
      .sort((a, b) => (b.achieved_on ?? '').localeCompare(a.achieved_on ?? '')),
  }
}
