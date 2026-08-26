/**
 * Repeats — SPEC.md §4.
 *
 * The composer offers named repeats and a custom builder; both are only ever
 * presets over the cadence fields. These tests pin what each preset means, and
 * what the intervals and the end date do to `isScheduled`, because the
 * scheduling rules are where every past bug in this codebase has lived.
 */

import { describe, expect, it } from 'vitest'
import {
  buildRepeat,
  classifyRepeat,
  describeRepeat,
  noRepeat,
  type RepeatKind,
} from './repeat'
import {
  SCORING_WINDOW_DAYS,
  addDays,
  anchorOf,
  isScheduled,
  lookbackFor,
  periodDays,
  tallyStanding,
} from './score'
import { normaliseSubgoal } from './rows'
import { subgoal } from './test-fixtures'

const THU = '2026-08-27' // a Thursday, weekday 3 Monday-first
const SUN = '2026-08-30' // a Sunday, weekday 6

/** A task carrying just the scheduling fields a repeat decides. */
const withRepeat = (kind: RepeatKind, date: string | null, over = {}) =>
  subgoal({ created_at: '2026-01-01', ...buildRepeat(kind, date), ...over })

describe('the named repeats', () => {
  it('reads "every week" off the day the task is on', () => {
    expect(buildRepeat('weekly', SUN)).toMatchObject({ cadence_type: 'weekly', days: [6] })
    expect(buildRepeat('weekly', THU)).toMatchObject({ cadence_type: 'weekly', days: [3] })
  })

  it('spells every day and every weekday as weekly day sets', () => {
    expect(buildRepeat('daily', THU).days).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(buildRepeat('weekdays', THU).days).toEqual([0, 1, 2, 3, 4])
  })

  it('reads "every month" and "every quarter" off the day of the month', () => {
    expect(buildRepeat('monthly', THU)).toMatchObject({
      cadence_type: 'monthly',
      monthly_day: 27,
    })
    expect(buildRepeat('quarterly', THU)).toMatchObject({
      cadence_type: 'quarterly',
      monthly_day: 27,
    })
  })

  it('clamps a monthly repeat picked on the 31st to 28, on the way in', () => {
    // Days 29–31 do not exist in every month, so "every month on the 31st"
    // would quietly skip five months a year (§4).
    expect(buildRepeat('monthly', '2026-08-31').monthly_day).toBe(28)
  })

  it('leaves a task with no date on the first of the month', () => {
    expect(buildRepeat('monthly', null).monthly_day).toBe(1)
    expect(buildRepeat('weekly', null).days).toEqual([0])
  })

  it('round-trips: what it builds is what it reads back', () => {
    const kinds: RepeatKind[] = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'quarterly']
    for (const kind of kinds) {
      expect(classifyRepeat(buildRepeat(kind, THU))).toBe(kind)
    }
  })

  it('calls anything the presets cannot express custom', () => {
    expect(classifyRepeat(buildRepeat('custom', THU, { interval: 4 }))).toBe('custom')
    expect(
      classifyRepeat({ ...noRepeat(), cadence_type: 'weekly', days: [0, 3] }),
    ).toBe('custom')
    expect(
      classifyRepeat({ ...noRepeat(), cadence_type: 'monthly', month_weekday: 4, month_ordinal: -1 }),
    ).toBe('custom')
  })

  it('keeps the end date when the user swaps one preset for another', () => {
    const spec = buildRepeat('weekly', THU, { repeat_until: '2026-12-31' })
    expect(spec.repeat_until).toBe('2026-12-31')
  })
})

describe('describing a repeat in words', () => {
  it('says what the picker says', () => {
    expect(describeRepeat(buildRepeat('none', THU))).toBe('No repeat')
    expect(describeRepeat(buildRepeat('daily', THU))).toBe('Every day')
    expect(describeRepeat(buildRepeat('weekdays', THU))).toBe('Every weekday')
    expect(describeRepeat(buildRepeat('weekly', SUN))).toBe('Every week on Sunday')
    expect(describeRepeat(buildRepeat('monthly', THU))).toBe('Every month on day 27')
    expect(describeRepeat(buildRepeat('quarterly', THU))).toBe('Every quarter on day 27')
  })

  it('spells out a custom interval', () => {
    expect(
      describeRepeat({ ...buildRepeat('weekly', THU), interval: 4 }, { short: true }),
    ).toBe('Every 4 weeks on Thu')
    expect(describeRepeat({ ...buildRepeat('monthly', THU), interval: 3 })).toBe(
      'Every 3 months on day 27',
    )
  })

  it('names a month-end weekday rather than a day number', () => {
    expect(
      describeRepeat({
        ...noRepeat(),
        cadence_type: 'monthly',
        month_weekday: 4,
        month_ordinal: -1,
      }),
    ).toBe('Every month on the last Friday')
  })

  it('mentions the end date when there is one', () => {
    expect(
      describeRepeat({ ...buildRepeat('weekly', SUN), repeat_until: '2026-12-31' }),
    ).toBe('Every week on Sunday, until 2026-12-31')
  })
})

describe('intervals', () => {
  it('fires every week when the interval is 1', () => {
    const task = withRepeat('weekly', THU)
    for (const d of [THU, addDays(THU, 7), addDays(THU, 14)]) {
      expect(isScheduled(task, d)).toBe(true)
    }
  })

  it('fires every fourth week, counted from the start date', () => {
    const task = withRepeat('custom', THU, { interval: 4, days: [3], start_date: THU })
    expect(isScheduled(task, THU)).toBe(true)
    expect(isScheduled(task, addDays(THU, 7))).toBe(false)
    expect(isScheduled(task, addDays(THU, 21))).toBe(false)
    expect(isScheduled(task, addDays(THU, 28))).toBe(true)
    expect(isScheduled(task, addDays(THU, 56))).toBe(true)
  })

  it('counts weeks Monday-first, so a Sunday start does not slip a week', () => {
    const task = withRepeat('custom', SUN, { interval: 2, days: [6], start_date: SUN })
    expect(isScheduled(task, SUN)).toBe(true)
    expect(isScheduled(task, addDays(SUN, 7))).toBe(false)
    expect(isScheduled(task, addDays(SUN, 14))).toBe(true)
  })

  it('fires every N days', () => {
    const task = subgoal({
      cadence_type: 'daily',
      interval: 3,
      days: [],
      created_at: '2026-01-01',
      start_date: THU,
    })
    expect(isScheduled(task, THU)).toBe(true)
    expect(isScheduled(task, addDays(THU, 1))).toBe(false)
    expect(isScheduled(task, addDays(THU, 3))).toBe(true)
    expect(isScheduled(task, addDays(THU, 6))).toBe(true)
  })

  it('fires every N months on the same day of the month', () => {
    const task = subgoal({
      cadence_type: 'monthly',
      interval: 3,
      days: [],
      monthly_day: 27,
      created_at: '2026-01-01',
      start_date: '2026-08-27',
    })
    expect(isScheduled(task, '2026-08-27')).toBe(true)
    expect(isScheduled(task, '2026-09-27')).toBe(false)
    expect(isScheduled(task, '2026-11-27')).toBe(true)
    expect(isScheduled(task, '2027-02-27')).toBe(true)
  })

  it('anchors on created_at when no start date was chosen', () => {
    const task = subgoal({ cadence_type: 'weekly', interval: 2, days: [3], created_at: THU })
    expect(anchorOf(task)).toBe(THU)
    expect(isScheduled(task, addDays(THU, 14))).toBe(true)
    expect(isScheduled(task, addDays(THU, 7))).toBe(false)
  })
})

describe('the window a repeat lives inside', () => {
  it('never comes due before its start date', () => {
    const task = withRepeat('weekly', THU, { start_date: addDays(THU, 7) })
    expect(isScheduled(task, THU)).toBe(false)
    expect(isScheduled(task, addDays(THU, 7))).toBe(true)
  })

  it('ends *inclusively* — the last day still counts', () => {
    const task = withRepeat('daily', THU, { repeat_until: addDays(THU, 2) })
    expect(isScheduled(task, addDays(THU, 2))).toBe(true)
    expect(isScheduled(task, addDays(THU, 3))).toBe(false)
  })

  it('drops an end date that precedes the start rather than deadlocking the task', () => {
    // Caught at the storage boundary, so a stored row can never be in the
    // state where it looks live in the editor and can never come due.
    const row = normaliseSubgoal(
      { cadence_type: 'weekly', days: [3], start_date: '2026-08-27', repeat_until: '2026-01-01' },
      THU,
    )
    expect(row.start_date).toBe('2026-08-27')
    expect(row.repeat_until).toBeNull()
  })

  it('keeps neither a start nor an end on a one-time task — it has a deadline instead', () => {
    const row = normaliseSubgoal(
      { cadence_type: 'once', due_date: THU, start_date: THU, repeat_until: THU },
      THU,
    )
    expect(row.due_date).toBe(THU)
    expect(row.start_date).toBeNull()
    expect(row.repeat_until).toBeNull()
  })
})

describe('scoring a repeat that outruns the 28-day window', () => {
  it('reads short cadences through the plain window', () => {
    // "Every day" is a weekly repeat on all seven days, so its period is the
    // week it repeats over — well inside the 28-day window either way.
    expect(periodDays(withRepeat('daily', THU))).toBe(7)
    expect(periodDays(withRepeat('weekly', THU))).toBe(7)
    expect(lookbackFor(withRepeat('weekly', THU))).toBe(SCORING_WINDOW_DAYS)
  })

  it('reaches back two whole periods for a long custom repeat', () => {
    const every8 = withRepeat('custom', THU, { interval: 8, days: [3] })
    expect(periodDays(every8)).toBe(56)
    expect(lookbackFor(every8)).toBe(112)
  })

  it('still represents an every-8-weeks task that missed the window', () => {
    const today = '2026-08-27'
    const task = subgoal({
      cadence_type: 'weekly',
      interval: 8,
      days: [3],
      created_at: '2026-01-01',
      start_date: '2026-07-02', // eight weeks before 2026-08-27 is 2026-07-02
    })
    // Its most recent due day is 2026-07-02, outside the 28-day window, so a
    // plain window reading would score the task as having no opinion at all.
    const missed = tallyStanding(task, 2, today, new Map())
    expect(missed).toEqual({ earned: 0, available: 2 })
  })
})
