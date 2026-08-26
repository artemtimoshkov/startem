/** SPEC.md §5 — weights, windows, tallies and the score formula. */
import { describe, expect, it } from 'vitest'
import {
  IMPORTANCE_WEIGHT,
  MONTHLY_LOOKBACK_DAYS,
  QUARTERLY_LOOKBACK_DAYS,
  SCORING_WINDOW_DAYS,
  addDays,
  canEditDay,
  colourBand,
  dayCellState,
  eachDay,
  isScheduled,
  occurrenceOn,
  onceOccurrence,
  rateOf,
  scoreOf,
  scoreOfTally,
  tallyRange,
  tallyStanding,
  weightOf,
} from './score'
import type { Checkin, ISODate } from './types'
import { freeze, subgoal } from './test-fixtures'

const TODAY = '2026-08-26' // a Wednesday
const WEDNESDAYS = subgoal({ cadence_type: 'weekly', days: [2] })

function log(entries: Record<ISODate, Checkin['status']>): Map<ISODate, Checkin> {
  return new Map(
    Object.entries(entries).map(([date, status]) => [
      date,
      { subgoal_id: 1, date, status },
    ]),
  )
}

const window28 = (today: ISODate) => addDays(today, -(SCORING_WINDOW_DAYS - 1))

describe('weights', () => {
  it('is 4 / 2 / 1 for high / medium / low', () => {
    expect(IMPORTANCE_WEIGHT).toEqual({ high: 4, medium: 2, low: 1 })
  })

  it("comes from the task's own priority, not the goal above it", () => {
    expect(weightOf(subgoal({ importance: 'high' }))).toBe(4)
    expect(weightOf(subgoal({ importance: 'medium' }))).toBe(2)
    expect(weightOf(subgoal({ importance: 'low' }))).toBe(1)
  })

  it('weighs two tasks under one goal differently', () => {
    const light = subgoal({ id: 1, goal_id: 1, importance: 'low' })
    const heavy = subgoal({ id: 2, goal_id: 1, importance: 'high' })
    expect(weightOf(light)).toBe(1)
    expect(weightOf(heavy)).toBe(4)
  })

  it('lets a per-task weight override it', () => {
    expect(weightOf(subgoal({ importance: 'low', weight: 7 }))).toBe(7)
    expect(weightOf(subgoal({ importance: 'high', weight: 1 }))).toBe(1)
  })

  it('falls back to the priority when the override is absent or nonsensical', () => {
    expect(weightOf(subgoal({ importance: 'high', weight: null }))).toBe(4)
    expect(weightOf(subgoal({ importance: 'high', weight: 0 }))).toBe(4)
    expect(weightOf(subgoal({ importance: 'high', weight: -3 }))).toBe(4)
  })

  it('lets frequency multiply weight, deliberately', () => {
    // A daily low action generates 7 × 1 per week; a weekly high one 1 × 4.
    const daily = subgoal({ cadence_type: 'weekly', days: [0, 1, 2, 3, 4, 5, 6] })
    const weekly = subgoal({ id: 2, cadence_type: 'weekly', days: [0] })
    const from = '2026-08-24'
    const to = '2026-08-30'
    const after = '2026-09-01' // the week is fully in the past
    const dailyLow = tallyRange(daily, 1, from, to, after, new Map())
    const weeklyHigh = tallyRange(weekly, 4, from, to, after, new Map())
    expect(dailyLow.available).toBe(7)
    expect(weeklyHigh.available).toBe(4)
  })
})

describe('the formula', () => {
  it('maps 0% to 1.0 and 100% to 10.0', () => {
    expect(scoreOf(0)).toBe(1)
    expect(scoreOf(1)).toBe(10)
  })

  it('interpolates linearly to one decimal', () => {
    expect(scoreOf(0.5)).toBe(5.5)
    expect(scoreOf(0.25)).toBe(3.3) // 1 + 2.25 = 3.25 → 3.3
    expect(scoreOf(2 / 3)).toBe(7)
  })

  it('never returns zero — a 1–10 chart cannot draw a zero-length spoke', () => {
    for (let r = 0; r <= 1; r += 0.01) {
      expect(scoreOf(r)!).toBeGreaterThanOrEqual(1)
      expect(scoreOf(r)!).toBeLessThanOrEqual(10)
    }
  })

  it('is null when nothing came due, which is not the same as scoring badly', () => {
    expect(rateOf({ earned: 0, available: 0 })).toBeNull()
    expect(scoreOf(null)).toBeNull()
    expect(scoreOfTally({ earned: 0, available: 0 })).toBeNull()
    // Zero earned out of something due is a real, bad score — not null.
    expect(scoreOfTally({ earned: 0, available: 6 })).toBe(1)
  })
})

describe('today is pending, a past day with no row is a miss', () => {
  it('excludes an unresolved today from the denominator', () => {
    // Wednesdays in the window ending 2026-08-26: 05, 12, 19 and 26 (today).
    const t = tallyStanding(WEDNESDAYS, 2, TODAY, new Map())
    expect(t.available).toBe(3 * 2) // today skipped
    expect(t.earned).toBe(0)
    expect(scoreOfTally(t)).toBe(1)
  })

  it('includes today once it is resolved', () => {
    const done = tallyStanding(WEDNESDAYS, 2, TODAY, log({ '2026-08-26': 'done' }))
    expect(done.available).toBe(4 * 2)
    expect(done.earned).toBe(1 * 2)

    const skipped = tallyStanding(WEDNESDAYS, 2, TODAY, log({ '2026-08-26': 'skipped' }))
    expect(skipped.available).toBe(4 * 2)
    expect(skipped.earned).toBe(0)
  })

  it('treats a past skipped day and a past unlogged day identically', () => {
    const unlogged = tallyStanding(WEDNESDAYS, 1, TODAY, log({ '2026-08-26': 'done' }))
    const crossedOut = tallyStanding(
      WEDNESDAYS,
      1,
      TODAY,
      log({ '2026-08-26': 'done', '2026-08-19': 'skipped' }),
    )
    expect(crossedOut).toEqual(unlogged)
  })

  it('scores a perfect window at 10.0 and an empty one at 1.0', () => {
    const perfect = log({
      '2026-08-26': 'done',
      '2026-08-19': 'done',
      '2026-08-12': 'done',
      '2026-08-05': 'done',
    })
    expect(scoreOfTally(tallyStanding(WEDNESDAYS, 2, TODAY, perfect))).toBe(10)
    expect(scoreOfTally(tallyStanding(WEDNESDAYS, 2, TODAY, new Map()))).toBe(1)
  })

  it('never counts a future day, even inside a range that reaches past today', () => {
    const week = tallyRange(WEDNESDAYS, 1, '2026-08-24', '2026-08-30', TODAY, new Map())
    expect(week.available).toBe(0) // the only Wednesday is today, unresolved
    const resolved = tallyRange(
      WEDNESDAYS,
      1,
      '2026-08-24',
      '2026-08-30',
      TODAY,
      log({ '2026-08-26': 'done' }),
    )
    expect(resolved).toEqual({ earned: 1, available: 1 })
  })
})

describe('range mode counts only what came due inside the range', () => {
  it('ignores occurrences on either side of the range', () => {
    const t = tallyRange(WEDNESDAYS, 1, '2026-08-10', '2026-08-16', TODAY, new Map())
    expect(t.available).toBe(1) // just 2026-08-12
  })

  it('excludes days before the action was created', () => {
    const born = subgoal({ ...WEDNESDAYS, created_at: '2026-08-13' })
    const t = tallyRange(born, 1, window28(TODAY), TODAY, TODAY, new Map())
    // Wednesdays from the 13th are the 19th and the 26th; the 26th is today
    // and unresolved, so only the 19th counts.
    expect(t.available).toBe(1)
  })

  it('excludes frozen days', () => {
    const periods = [freeze({ start_date: '2026-08-10', end_date: '2026-08-20' })]
    const t = tallyRange(WEDNESDAYS, 1, window28(TODAY), TODAY, TODAY, new Map(), periods)
    expect(t.available).toBe(1) // 12 and 19 frozen, 26 pending, so only 05
  })

  it('excludes archived and tombstoned actions entirely', () => {
    const from = window28(TODAY)
    expect(
      tallyRange({ ...WEDNESDAYS, archived: true }, 1, from, TODAY, TODAY, new Map()),
    ).toEqual({ earned: 0, available: 0 })
    expect(
      tallyRange({ ...WEDNESDAYS, deleted: true }, 1, from, TODAY, TODAY, new Map()),
    ).toEqual({ earned: 0, available: 0 })
  })
})

describe('standing mode: rare cadences keep their place', () => {
  it('reads a weekly action through the plain 28-day window', () => {
    const standing = tallyStanding(WEDNESDAYS, 1, TODAY, new Map())
    const ranged = tallyRange(WEDNESDAYS, 1, window28(TODAY), TODAY, TODAY, new Map())
    expect(standing).toEqual(ranged)
  })

  it('finds a monthly occurrence that falls outside the 28-day window', () => {
    // 2026-03-30 back 28 days is 2026-03-03 — no 1st of the month inside it.
    const firstOfMonth = subgoal({ cadence_type: 'monthly', monthly_day: 1 })
    const today = '2026-03-30'
    const inWindow = tallyRange(
      firstOfMonth,
      2,
      window28(today),
      today,
      today,
      log({ '2026-03-01': 'done' }),
    )
    expect(inWindow.available).toBe(0) // would silently drop out of the score

    const standing = tallyStanding(firstOfMonth, 2, today, log({ '2026-03-01': 'done' }))
    expect(standing).toEqual({ earned: 2, available: 2 })
  })

  it('represents a monthly action by exactly one occurrence, its latest', () => {
    const firstOfMonth = subgoal({ cadence_type: 'monthly', monthly_day: 1 })
    const t = tallyStanding(
      firstOfMonth,
      2,
      '2026-08-20',
      log({ '2026-08-01': 'skipped', '2026-07-01': 'done', '2026-06-01': 'done' }),
    )
    expect(t).toEqual({ earned: 0, available: 2 }) // only August counts
  })

  it('reaches back 45 days for monthly and 115 for quarterly', () => {
    expect(MONTHLY_LOOKBACK_DAYS).toBe(45)
    expect(QUARTERLY_LOOKBACK_DAYS).toBe(115)

    // "Last Sunday" pairs can sit 35 days apart, so 28 is not enough.
    const lastSunday = subgoal({
      cadence_type: 'monthly',
      month_weekday: 6,
      month_ordinal: -1,
    })
    for (const today of eachDay('2026-01-01', '2026-12-31')) {
      const t = tallyStanding(lastSunday, 1, today, log({ [today]: 'done' }))
      // Every day of the year finds an occurrence within the look-back.
      expect(t.available, `no standing occurrence on ${today}`).toBe(1)
    }
  })

  it('finds a quarterly occurrence up to ~97 days back', () => {
    const quarterly = subgoal({ cadence_type: 'quarterly', monthly_day: 1 })
    const today = '2026-06-30' // 90 days after 2026-04-01
    const t = tallyStanding(quarterly, 4, today, log({ '2026-04-01': 'done' }))
    expect(t).toEqual({ earned: 4, available: 4 })
  })

  it('keeps a quarterly action scored on every day of the year', () => {
    const quarterly = subgoal({ cadence_type: 'quarterly', monthly_day: 1 })
    for (const today of eachDay('2026-05-01', '2026-12-31')) {
      expect(tallyStanding(quarterly, 1, today, new Map()).available, today).toBe(1)
    }
  })

  it('keeps last month represented while today is still pending', () => {
    // 2026-08-01 is itself the due date; unresolved, so it must not blank the
    // action out — the scan keeps going and July stands in until today lands.
    const firstOfMonth = subgoal({ cadence_type: 'monthly', monthly_day: 1 })
    const pending = tallyStanding(firstOfMonth, 2, '2026-08-01', log({ '2026-07-01': 'done' }))
    expect(pending).toEqual({ earned: 2, available: 2 })

    const resolved = tallyStanding(
      firstOfMonth,
      2,
      '2026-08-01',
      log({ '2026-07-01': 'done', '2026-08-01': 'skipped' }),
    )
    expect(resolved).toEqual({ earned: 0, available: 2 })
  })

  it('contributes nothing when the action has never come due', () => {
    const brandNew = subgoal({
      cadence_type: 'monthly',
      monthly_day: 1,
      created_at: '2026-08-05',
    })
    expect(tallyStanding(brandNew, 2, '2026-08-20', new Map())).toEqual({
      earned: 0,
      available: 0,
    })
  })

  it('scores a one-time action through its single occurrence', () => {
    const once = subgoal({ cadence_type: 'once', due_date: '2026-08-01' })
    expect(tallyStanding(once, 4, TODAY, log({ '2026-08-01': 'done' }))).toEqual({
      earned: 4,
      available: 4,
    })
  })

  it('contributes nothing while the goal is frozen', () => {
    const periods = [freeze({ start_date: '2026-01-01', end_date: null })]
    expect(tallyStanding(WEDNESDAYS, 2, TODAY, new Map(), periods)).toEqual({
      earned: 0,
      available: 0,
    })
  })
})

describe('one-time actions earn and lose weight, on one effective date', () => {
  const physio = subgoal({ cadence_type: 'once', due_date: '2026-08-10' })

  it('is a win once completed, credited to the day it was logged', () => {
    const t = tallyStanding(physio, 4, TODAY, log({ '2026-08-20': 'done' }))
    expect(t).toEqual({ earned: 4, available: 4 })
    // The credit lands on the day the work happened, not on the deadline.
    const onTheDay = tallyRange(physio, 4, '2026-08-20', '2026-08-20', TODAY, log({ '2026-08-20': 'done' }))
    expect(onTheDay).toEqual({ earned: 4, available: 4 })
    const onTheDeadline = tallyRange(physio, 4, '2026-08-10', '2026-08-10', TODAY, log({ '2026-08-20': 'done' }))
    expect(onTheDeadline).toEqual({ earned: 0, available: 0 })
  })

  it('is a standing miss once its deadline passes, credited to the deadline', () => {
    const t = tallyStanding(physio, 4, TODAY, new Map())
    expect(t).toEqual({ earned: 0, available: 4 })
    expect(
      tallyRange(physio, 4, '2026-08-10', '2026-08-10', TODAY, new Map()),
    ).toEqual({ earned: 0, available: 4 })
  })

  it('counts a crossed-out one-time action as a miss', () => {
    expect(tallyStanding(physio, 4, TODAY, log({ '2026-08-20': 'skipped' }))).toEqual({
      earned: 0,
      available: 4,
    })
  })

  it('is simply not yet owed before its deadline — and due today is pending', () => {
    const future = subgoal({ cadence_type: 'once', due_date: '2026-12-01' })
    expect(tallyStanding(future, 4, TODAY, new Map())).toEqual({ earned: 0, available: 0 })
    const dueToday = subgoal({ cadence_type: 'once', due_date: TODAY })
    expect(tallyStanding(dueToday, 4, TODAY, new Map())).toEqual({ earned: 0, available: 0 })
  })

  it('never counts against anything with no deadline at all', () => {
    const someday = subgoal({ cadence_type: 'once', due_date: null })
    expect(tallyStanding(someday, 4, TODAY, new Map())).toEqual({ earned: 0, available: 0 })
    // But it is still a win once done.
    expect(tallyStanding(someday, 4, TODAY, log({ [TODAY]: 'done' }))).toEqual({
      earned: 4,
      available: 4,
    })
  })

  it('ages out of the 28-day window rather than propping the score up forever', () => {
    const old = log({ '2026-01-05': 'done' })
    expect(tallyStanding(physio, 4, TODAY, old)).toEqual({ earned: 0, available: 0 })
    // Still visible on its own day in the calendar, though.
    expect(tallyRange(physio, 4, '2026-01-05', '2026-01-05', TODAY, old)).toEqual({
      earned: 4,
      available: 4,
    })
  })

  it('has exactly one occurrence — never two', () => {
    const occ = onceOccurrence(physio, TODAY, log({ '2026-08-20': 'done' }))
    expect(occ).toEqual({ date: '2026-08-20', status: 'done' })
    const days = eachDay('2026-07-01', TODAY).filter(
      (d) => occurrenceOn(physio, d, TODAY, log({ '2026-08-20': 'done' })) !== null,
    )
    expect(days).toEqual(['2026-08-20'])
  })

  it('contributes nothing while archived, tombstoned or frozen', () => {
    const done = log({ '2026-08-20': 'done' })
    expect(onceOccurrence({ ...physio, archived: true }, TODAY, done)).toBeNull()
    expect(onceOccurrence({ ...physio, deleted: true }, TODAY, done)).toBeNull()
    expect(
      onceOccurrence(physio, TODAY, done, [
        freeze({ start_date: '2026-08-01', end_date: null }),
      ]),
    ).toBeNull()
  })

  it('ignores a log entry from before the action existed', () => {
    const born = subgoal({ ...physio, created_at: '2026-08-15' })
    expect(onceOccurrence(born, TODAY, log({ '2026-08-01': 'done' }))).toBeNull()
  })

  it('still never recurs — isScheduled stays false on every date', () => {
    for (const d of eachDay('2026-08-01', '2026-08-31')) {
      expect(isScheduled(physio, d)).toBe(false)
    }
  })
})

describe('grid cell states', () => {
  const past = '2026-08-20'
  it('reads a past day from what resolved', () => {
    const s = (due: number, done: number, skipped: number, unresolved: number) =>
      dayCellState(past, TODAY, { due, done, skipped, unresolved }, false)
    expect(s(0, 0, 0, 0)).toBe('none')
    expect(s(2, 2, 0, 0)).toBe('done')
    expect(s(2, 1, 1, 0)).toBe('partial')
    expect(s(2, 1, 0, 1)).toBe('partial')
    expect(s(2, 0, 1, 1)).toBe('missed')
    expect(s(2, 0, 0, 2)).toBe('missed')
  })

  it('marks today as `today` only while something is unresolved', () => {
    const s = (due: number, done: number, skipped: number, unresolved: number) =>
      dayCellState(TODAY, TODAY, { due, done, skipped, unresolved }, false)
    expect(s(2, 1, 0, 1)).toBe('today')
    expect(s(2, 2, 0, 0)).toBe('done')
    expect(s(2, 1, 1, 0)).toBe('partial')
    expect(s(0, 0, 0, 0)).toBe('none')
  })

  it('puts future ahead of frozen, and frozen ahead of none', () => {
    const empty = { due: 0, done: 0, skipped: 0, unresolved: 0 }
    expect(dayCellState('2026-09-01', TODAY, empty, true)).toBe('future')
    expect(dayCellState(past, TODAY, empty, true)).toBe('frozen')
    expect(dayCellState(past, TODAY, empty, false)).toBe('none')
  })
})

describe('colour bands', () => {
  it('runs in five bands, and stays null when nothing was due', () => {
    expect(colourBand(null)).toBeNull()
    expect(colourBand(0)).toBe(0)
    expect(colourBand(0.2)).toBe(1)
    expect(colourBand(0.5)).toBe(2)
    expect(colourBand(0.8)).toBe(3)
    expect(colourBand(1)).toBe(4)
    expect(new Set([0, 0.2, 0.5, 0.8, 1].map(colourBand)).size).toBe(5)
  })
})

describe('back-dating', () => {
  it('allows any day within 182 days, and never a future one', () => {
    expect(canEditDay(TODAY, TODAY)).toBe(true)
    expect(canEditDay(addDays(TODAY, -182), TODAY)).toBe(true)
    expect(canEditDay(addDays(TODAY, -183), TODAY)).toBe(false)
    expect(canEditDay(addDays(TODAY, 1), TODAY)).toBe(false)
  })
})
