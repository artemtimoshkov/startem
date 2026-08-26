/** SPEC.md §2 — the two conventions everything else depends on. */
import { describe, expect, it } from 'vitest'
import {
  SCORING_WINDOW_DAYS,
  addDays,
  dayOfMonth,
  daysBetween,
  dow,
  eachDay,
  month,
  parseISO,
  toISO,
  todayISO,
  weekStart,
  year,
} from './score'

describe('weekdays are Monday-first, zero-indexed', () => {
  it('maps a known week 0 = Monday … 6 = Sunday', () => {
    // 2026-08-24 is a Monday.
    const week = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30']
    expect(week.map(dow)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('rotates getDay() rather than using it raw — Sunday is 6, not 0', () => {
    const sunday = '2026-08-30'
    expect(new Date(2026, 7, 30).getDay()).toBe(0) // JS: Sunday-first
    expect(dow(sunday)).toBe(6) // ours: Monday-first
  })

  it('agrees with (getDay() + 6) % 7 for a full year', () => {
    let d = '2026-01-01'
    for (let i = 0; i < 366; i++) {
      const [y, m, day] = parseISO(d)
      expect(dow(d)).toBe((new Date(y, m - 1, day).getDay() + 6) % 7)
      d = addDays(d, 1)
    }
  })

  it('never returns a value outside 0–6', () => {
    let d = '2024-02-26'
    for (let i = 0; i < 500; i++) {
      const v = dow(d)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(6)
      d = addDays(d, 1)
    }
  })

  it('starts weeks on Monday', () => {
    expect(weekStart('2026-08-24')).toBe('2026-08-24') // Monday itself
    expect(weekStart('2026-08-30')).toBe('2026-08-24') // Sunday belongs to it
    expect(weekStart('2026-08-31')).toBe('2026-08-31') // next Monday
  })
})

describe('dates are local-time YYYY-MM-DD strings', () => {
  it('compares lexicographically in calendar order', () => {
    expect('2026-01-09' < '2026-01-10').toBe(true)
    expect('2026-01-31' < '2026-02-01').toBe(true)
    expect('2025-12-31' < '2026-01-01').toBe(true)
    expect('2026-03-09' > '2026-03-08').toBe(true)
  })

  it('sorts a shuffled year into calendar order by plain string sort', () => {
    const dates: string[] = []
    let d = '2025-11-20'
    for (let i = 0; i < 400; i++) {
      dates.push(d)
      d = addDays(d, 1)
    }
    const shuffled = [...dates].reverse()
    expect([...shuffled].sort()).toEqual(dates)
  })

  it('zero-pads, so month and day are always two digits', () => {
    expect(toISO(2026, 1, 5)).toBe('2026-01-05')
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('is local-time, never UTC — 23:50 belongs to the day it was lived', () => {
    const lateEvening = new Date(2026, 7, 26, 23, 50)
    expect(todayISO(lateEvening)).toBe('2026-08-26')
    const earlyMorning = new Date(2026, 7, 26, 0, 10)
    expect(todayISO(earlyMorning)).toBe('2026-08-26')
  })

  it('rejects anything that is not YYYY-MM-DD', () => {
    expect(() => parseISO('2026-8-26')).toThrow()
    expect(() => parseISO('26/08/2026')).toThrow()
    expect(() => parseISO('2026-08-26T12:00:00Z')).toThrow()
    expect(() => parseISO('2026-13-01')).toThrow()
  })
})

describe('date arithmetic', () => {
  it('crosses month, year and leap-day boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29') // 2024 is a leap year
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01') // 2026 is not
  })

  it('is unaffected by the daylight-saving transitions', () => {
    // Adding a day must never land on the same date or skip one, whatever the
    // clocks do — which is exactly why these are strings, not timestamps.
    for (const around of ['2026-03-28', '2026-10-24', '2026-11-01']) {
      const next = addDays(around, 1)
      expect(next).not.toBe(around)
      expect(daysBetween(around, next)).toBe(1)
    }
  })

  it('reports whole days between dates, signed', () => {
    expect(daysBetween('2026-08-01', '2026-08-29')).toBe(28)
    expect(daysBetween('2026-08-29', '2026-08-01')).toBe(-28)
    expect(daysBetween('2026-08-01', '2026-08-01')).toBe(0)
  })

  it('reads calendar parts back out', () => {
    expect(year('2026-08-26')).toBe(2026)
    expect(month('2026-08-26')).toBe(8)
    expect(dayOfMonth('2026-08-26')).toBe(26)
  })

  it('enumerates inclusive ranges, and nothing for an inverted one', () => {
    expect(eachDay('2026-08-24', '2026-08-26')).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
    ])
    expect(eachDay('2026-08-26', '2026-08-24')).toEqual([])
  })
})

describe('the 28-day window', () => {
  it('gives every weekday exactly four occurrences, whatever the end date', () => {
    let end = '2026-01-01'
    for (let i = 0; i < 400; i++) {
      const counts = [0, 0, 0, 0, 0, 0, 0]
      const from = addDays(end, -(SCORING_WINDOW_DAYS - 1))
      for (const d of eachDay(from, end)) counts[dow(d)]!++
      expect(counts, `window ending ${end}`).toEqual([4, 4, 4, 4, 4, 4, 4])
      end = addDays(end, 1)
    }
  })

  it('is 28 and not 30 — 30 days re-weights weekdays as the calendar drifts', () => {
    expect(SCORING_WINDOW_DAYS).toBe(28)
    const uneven = new Set<string>()
    let end = '2026-01-01'
    for (let i = 0; i < 60; i++) {
      const counts = [0, 0, 0, 0, 0, 0, 0]
      for (const d of eachDay(addDays(end, -29), end)) counts[dow(d)]!++
      uneven.add(counts.join(','))
      end = addDays(end, 1)
    }
    // A 30-day window produces several different weekday distributions.
    expect(uneven.size).toBeGreaterThan(1)
    for (const shape of uneven) expect(shape).not.toBe('4,4,4,4,4,4,4')
  })

  it('never contains the same day-of-month twice, unlike a 30-day one', () => {
    // 1 Feb and 1 Mar are 28 days apart, so a 30-day window can hold both.
    const thirty = eachDay(addDays('2026-03-02', -29), '2026-03-02').filter(
      (d) => dayOfMonth(d) === 1,
    )
    expect(thirty).toHaveLength(2)
    const twentyEight = eachDay(
      addDays('2026-03-02', -(SCORING_WINDOW_DAYS - 1)),
      '2026-03-02',
    ).filter((d) => dayOfMonth(d) === 1)
    expect(twentyEight).toHaveLength(1)
  })
})
