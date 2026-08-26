/** SPEC.md §4 — when an action comes due. */
import { describe, expect, it } from 'vitest'
import {
  MAX_MONTHLY_DAY,
  QUARTER_MONTHS,
  addDays,
  clampMonthlyDay,
  dayOfMonth,
  dow,
  eachDay,
  isFrozenOn,
  isScheduled,
  month,
  monthPattern,
} from './score'
import { freeze, subgoal } from './test-fixtures'

const YEAR = eachDay('2026-01-01', '2026-12-31')

describe('weekly', () => {
  const gym = subgoal({ cadence_type: 'weekly', days: [0, 2, 5] }) // Mon, Wed, Sat

  it('fires on exactly the listed Monday-first weekdays', () => {
    expect(isScheduled(gym, '2026-08-24')).toBe(true) // Monday = 0
    expect(isScheduled(gym, '2026-08-25')).toBe(false) // Tuesday = 1
    expect(isScheduled(gym, '2026-08-26')).toBe(true) // Wednesday = 2
    expect(isScheduled(gym, '2026-08-29')).toBe(true) // Saturday = 5
    expect(isScheduled(gym, '2026-08-30')).toBe(false) // Sunday = 6
  })

  it('would fire on the wrong days if getDay() were used unrotated', () => {
    // A `days: [6]` action must mean Sunday, not Saturday.
    const sundayOnly = subgoal({ cadence_type: 'weekly', days: [6] })
    expect(isScheduled(sundayOnly, '2026-08-30')).toBe(true) // Sunday
    expect(isScheduled(sundayOnly, '2026-08-29')).toBe(false) // Saturday
  })

  it('fires 3 times a week, so 12 times in a 28-day window', () => {
    const window = eachDay('2026-08-01', '2026-08-28')
    expect(window.filter((d) => isScheduled(gym, d))).toHaveLength(12)
  })

  it('never fires with an empty day list', () => {
    const none = subgoal({ cadence_type: 'weekly', days: [] })
    expect(YEAR.some((d) => isScheduled(none, d))).toBe(false)
  })
})

describe('monthly, fixed-date mode', () => {
  it('fires once a month on the chosen day', () => {
    const rent = subgoal({ cadence_type: 'monthly', monthly_day: 5 })
    const hits = YEAR.filter((d) => isScheduled(rent, d))
    expect(hits).toHaveLength(12)
    expect(hits.every((d) => dayOfMonth(d) === 5)).toBe(true)
  })

  it('clamps a fixed day to 1–28 on read, so no month is ever skipped', () => {
    // The trap: an action on "day 31" silently never comes due in February,
    // April, June, September or November. Clamping keeps all twelve months.
    const monthEnd = subgoal({ cadence_type: 'monthly', monthly_day: 31 })
    const hits = YEAR.filter((d) => isScheduled(monthEnd, d))
    expect(hits).toHaveLength(12)
    expect(hits.every((d) => dayOfMonth(d) === MAX_MONTHLY_DAY)).toBe(true)
    expect(new Set(hits.map(month)).size).toBe(12)
    expect(isScheduled(monthEnd, '2026-02-28')).toBe(true)
  })

  it('clamps 29, 30 and 31 identically, and 0 or negative up to 1', () => {
    expect(clampMonthlyDay(29)).toBe(28)
    expect(clampMonthlyDay(30)).toBe(28)
    expect(clampMonthlyDay(31)).toBe(28)
    expect(clampMonthlyDay(28)).toBe(28)
    expect(clampMonthlyDay(1)).toBe(1)
    expect(clampMonthlyDay(0)).toBe(1)
    expect(clampMonthlyDay(-4)).toBe(1)
    expect(clampMonthlyDay(12.6)).toBe(13)
  })

  it('never fires in February on the 29th, 30th or 31st', () => {
    for (const day of [29, 30, 31]) {
      const a = subgoal({ cadence_type: 'monthly', monthly_day: day })
      const feb = eachDay('2024-02-01', '2024-02-29') // a leap February
      expect(feb.filter((d) => isScheduled(a, d))).toEqual(['2024-02-28'])
    }
  })

  it('never fires when neither mode is configured', () => {
    const unset = subgoal({ cadence_type: 'monthly' })
    expect(YEAR.some((d) => isScheduled(unset, d))).toBe(false)
  })
})

describe('monthly, weekday mode', () => {
  it('matches the Nth weekday via ceil(day / 7)', () => {
    // First Monday: the 1st–7th always hold the first of every weekday.
    const first = subgoal({ cadence_type: 'monthly', month_weekday: 0, month_ordinal: 1 })
    const hits = YEAR.filter((d) => isScheduled(first, d))
    expect(hits).toHaveLength(12)
    expect(hits.every((d) => dow(d) === 0 && dayOfMonth(d) <= 7)).toBe(true)
    expect(hits[0]).toBe('2026-01-05')
  })

  it('matches the third Thursday', () => {
    const third = subgoal({ cadence_type: 'monthly', month_weekday: 3, month_ordinal: 3 })
    const hits = YEAR.filter((d) => isScheduled(third, d))
    expect(hits).toHaveLength(12)
    for (const d of hits) {
      expect(dow(d)).toBe(3)
      expect(dayOfMonth(d)).toBeGreaterThanOrEqual(15)
      expect(dayOfMonth(d)).toBeLessThanOrEqual(21)
    }
  })

  it('ordinal 4 can miss a month; only "last" is genuine month-end', () => {
    const fourth = subgoal({ cadence_type: 'monthly', month_weekday: 5, month_ordinal: 4 })
    for (const d of YEAR.filter((x) => isScheduled(fourth, x))) {
      expect(dayOfMonth(d)).toBeGreaterThanOrEqual(22)
      expect(dayOfMonth(d)).toBeLessThanOrEqual(28)
    }
  })

  describe('the "last weekday of month" rule', () => {
    const lastFriday = subgoal({
      cadence_type: 'monthly',
      month_weekday: 4,
      month_ordinal: -1,
    })

    it('fires exactly once a month', () => {
      expect(YEAR.filter((d) => isScheduled(lastFriday, d))).toHaveLength(12)
    })

    it('picks the genuinely last Friday of each month, by brute force', () => {
      for (let m = 1; m <= 12; m++) {
        const days = YEAR.filter((d) => month(d) === m)
        const fridays = days.filter((d) => dow(d) === 4)
        const expected = fridays[fridays.length - 1]
        expect(days.filter((d) => isScheduled(lastFriday, d))).toEqual([expected])
      }
    })

    it('holds for every weekday across five years', () => {
      for (let weekday = 0; weekday <= 6; weekday++) {
        const action = subgoal({
          cadence_type: 'monthly',
          month_weekday: weekday,
          month_ordinal: -1,
        })
        const span = eachDay('2024-01-01', '2028-12-31')
        const hits = span.filter((d) => isScheduled(action, d))
        expect(hits).toHaveLength(5 * 12)
        for (const d of hits) {
          expect(dow(d)).toBe(weekday)
          // The test itself: seven days later is a different month.
          expect(month(addDays(d, 7))).not.toBe(month(d))
        }
      }
    })

    it('lands on the 29th–31st, which fixed-date mode can never reach', () => {
      const hits = YEAR.filter((d) => isScheduled(lastFriday, d))
      expect(hits.some((d) => dayOfMonth(d) > MAX_MONTHLY_DAY)).toBe(true)
    })

    it('treats a null ordinal as "last"', () => {
      const nullOrdinal = subgoal({
        cadence_type: 'monthly',
        month_weekday: 4,
        month_ordinal: null,
      })
      expect(YEAR.filter((d) => monthPattern(nullOrdinal, d))).toEqual(
        YEAR.filter((d) => monthPattern(lastFriday, d)),
      )
    })
  })
})

describe('quarterly', () => {
  it('is the monthly pattern, restricted to January, April, July and October', () => {
    const review = subgoal({ cadence_type: 'quarterly', monthly_day: 1 })
    const hits = YEAR.filter((d) => isScheduled(review, d))
    expect(hits).toEqual(['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01'])
    expect(hits.every((d) => QUARTER_MONTHS.includes(month(d)))).toBe(true)
  })

  it('works in weekday mode too', () => {
    const lastSunday = subgoal({
      cadence_type: 'quarterly',
      month_weekday: 6,
      month_ordinal: -1,
    })
    const hits = YEAR.filter((d) => isScheduled(lastSunday, d))
    expect(hits).toHaveLength(4)
    expect(hits.every((d) => dow(d) === 6)).toBe(true)
  })

  it('can put ~97 days between consecutive occurrences — hence a 115-day reach', () => {
    const lastSunday = subgoal({
      cadence_type: 'quarterly',
      month_weekday: 6,
      month_ordinal: -1,
    })
    const hits = eachDay('2024-01-01', '2028-12-31').filter((d) => isScheduled(lastSunday, d))
    let widest = 0
    for (let i = 1; i < hits.length; i++) {
      const gap = eachDay(hits[i - 1]!, hits[i]!).length - 1
      widest = Math.max(widest, gap)
    }
    expect(widest).toBeGreaterThan(90)
    expect(widest).toBeLessThan(115)
  })
})

describe('one-time actions never recur', () => {
  it('is never scheduled, with or without a deadline', () => {
    const withDue = subgoal({ cadence_type: 'once', due_date: '2026-08-26' })
    const withoutDue = subgoal({ cadence_type: 'once' })
    expect(isScheduled(withDue, '2026-08-26')).toBe(false)
    expect(YEAR.some((d) => isScheduled(withDue, d))).toBe(false)
    expect(YEAR.some((d) => isScheduled(withoutDue, d))).toBe(false)
  })
})

describe('the guards, before any cadence is consulted', () => {
  const daily = subgoal({ cadence_type: 'weekly', days: [0, 1, 2, 3, 4, 5, 6] })

  it('excludes archived actions — history stays, scheduling stops', () => {
    expect(isScheduled(daily, '2026-08-26')).toBe(true)
    expect(isScheduled({ ...daily, archived: true }, '2026-08-26')).toBe(false)
  })

  it('excludes tombstoned actions', () => {
    expect(isScheduled({ ...daily, deleted: true }, '2026-08-26')).toBe(false)
  })

  it('excludes dates before the action existed, comparing strings directly', () => {
    const created = subgoal({ ...daily, created_at: '2026-08-26' })
    expect(isScheduled(created, '2026-08-25')).toBe(false)
    expect(isScheduled(created, '2026-08-26')).toBe(true)
    expect(isScheduled(created, '2026-08-27')).toBe(true)
    // Lexicographic, so a single-digit month must not sort after a double one.
    const januaryBorn = subgoal({ ...daily, created_at: '2026-01-05' })
    expect(isScheduled(januaryBorn, '2026-10-05')).toBe(true)
  })

  it('excludes frozen days, with an exclusive end_date', () => {
    const period = [freeze({ start_date: '2026-03-01', end_date: '2026-03-10' })]
    expect(isScheduled(daily, '2026-02-28', period)).toBe(true)
    expect(isScheduled(daily, '2026-03-01', period)).toBe(false) // start inclusive
    expect(isScheduled(daily, '2026-03-09', period)).toBe(false)
    expect(isScheduled(daily, '2026-03-10', period)).toBe(true) // end exclusive
  })

  it('treats a null end_date as still frozen', () => {
    const open = [freeze({ start_date: '2026-03-01', end_date: null })]
    expect(isFrozenOn('2026-03-01', open)).toBe(true)
    expect(isFrozenOn('2030-01-01', open)).toBe(true)
    expect(isFrozenOn('2026-02-28', open)).toBe(false)
  })

  it('ignores tombstoned freeze periods', () => {
    const gone = [freeze({ start_date: '2026-03-01', end_date: null, deleted: true })]
    expect(isFrozenOn('2026-03-05', gone)).toBe(false)
    expect(isScheduled(daily, '2026-03-05', gone)).toBe(true)
  })

  it('unions overlapping periods', () => {
    const periods = [
      freeze({ id: 1, start_date: '2026-03-01', end_date: '2026-03-05' }),
      freeze({ id: 2, start_date: '2026-03-04', end_date: '2026-03-08' }),
    ]
    expect(eachDay('2026-03-01', '2026-03-08').filter((d) => isFrozenOn(d, periods))).toEqual(
      eachDay('2026-03-01', '2026-03-07'),
    )
  })
})
