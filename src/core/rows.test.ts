/** SPEC.md §3, §4, §12 — normalisation at the storage boundary. */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AREAS,
  asDate,
  emptySnapshot,
  normaliseDays,
  normaliseGoal,
  normaliseOrdinal,
  normaliseSnapshot,
  normaliseSubgoal,
} from './rows'
import { isScheduled } from './score'

const TODAY = '2026-08-26'

describe('dates on the way in', () => {
  it('keeps YYYY-MM-DD untouched', () => {
    expect(asDate('2026-08-26')).toBe('2026-08-26')
  })

  it('truncates a timestamp to the day it describes', () => {
    // Only sync's updated_at is ever a real timestamp; a day column that
    // arrives as one is an older export, and the time is not information.
    expect(asDate('2026-08-26T23:50:00Z')).toBe('2026-08-26')
  })

  it('falls back rather than storing rubbish', () => {
    expect(asDate('not a date')).toBeNull()
    expect(asDate(undefined)).toBeNull()
    expect(asDate(42)).toBeNull()
    expect(normaliseGoal({}, TODAY).created_at).toBe(TODAY)
  })
})

describe('weekly days', () => {
  it('dedupes, sorts and drops anything outside 0–6', () => {
    expect(normaliseDays([5, 0, 5, 2])).toEqual([0, 2, 5])
    expect(normaliseDays([-1, 7, 3])).toEqual([3])
    expect(normaliseDays('[0,2]')).toEqual([0, 2]) // JSON column
    expect(normaliseDays(null)).toEqual([])
    expect(normaliseDays('garbage')).toEqual([])
  })

  it('clears the day list for cadences that do not use it', () => {
    const monthly = normaliseSubgoal(
      { cadence_type: 'monthly', days: [0, 1], monthly_day: 4 },
      TODAY,
    )
    expect(monthly.days).toEqual([])
  })
})

describe('monthly configuration', () => {
  it('clamps a fixed day to 1–28 on write as well as on read', () => {
    // The mouse-wheel trap: scrolling over a focused number field silently
    // changes its value and `max` does not prevent it, so validation has to
    // happen here rather than in the input.
    expect(normaliseSubgoal({ cadence_type: 'monthly', monthly_day: 31 }, TODAY).monthly_day).toBe(28)
    expect(normaliseSubgoal({ cadence_type: 'monthly', monthly_day: 0 }, TODAY).monthly_day).toBe(1)
    expect(normaliseSubgoal({ cadence_type: 'monthly', monthly_day: 900 }, TODAY).monthly_day).toBe(28)
  })

  it('keeps the two modes mutually exclusive', () => {
    const weekdayMode = normaliseSubgoal(
      { cadence_type: 'monthly', monthly_day: 12, month_weekday: 4, month_ordinal: -1 },
      TODAY,
    )
    expect(weekdayMode.month_weekday).toBe(4)
    expect(weekdayMode.monthly_day).toBeNull() // dropped, not left to confuse a read

    const fixedMode = normaliseSubgoal(
      { cadence_type: 'monthly', monthly_day: 12, month_ordinal: 2 },
      TODAY,
    )
    expect(fixedMode.month_weekday).toBeNull()
    expect(fixedMode.month_ordinal).toBeNull()
  })

  it('normalises the ordinal to 1–4 or -1 for last', () => {
    expect(normaliseOrdinal(1)).toBe(1)
    expect(normaliseOrdinal(4)).toBe(4)
    expect(normaliseOrdinal(5)).toBe(-1) // there is no fifth Friday every month
    expect(normaliseOrdinal(-1)).toBe(-1)
    expect(normaliseOrdinal(null)).toBeNull()
  })

  it('strips monthly fields from a weekly or one-time action', () => {
    const weekly = normaliseSubgoal(
      { cadence_type: 'weekly', days: [1], monthly_day: 15, month_weekday: 3 },
      TODAY,
    )
    expect(weekly.monthly_day).toBeNull()
    expect(weekly.month_weekday).toBeNull()

    const once = normaliseSubgoal(
      { cadence_type: 'once', due_date: '2026-09-01', monthly_day: 15 },
      TODAY,
    )
    expect(once.monthly_day).toBeNull()
    expect(once.due_date).toBe('2026-09-01')
  })

  it('drops a due_date from a recurring action', () => {
    expect(
      normaliseSubgoal({ cadence_type: 'weekly', days: [1], due_date: '2026-09-01' }, TODAY)
        .due_date,
    ).toBeNull()
  })
})

describe('enums and flags', () => {
  it('falls back to sane defaults', () => {
    const g = normaliseGoal({ status: 'paused' }, TODAY)
    expect(g.status).toBe('active')
    expect(normaliseSubgoal({ importance: 'urgent' }, TODAY).importance).toBe('medium')
  })

  it('accepts a stray case or space', () => {
    expect(normaliseSubgoal({ importance: ' HIGH ' }, TODAY).importance).toBe('high')
  })

  it('coerces truthy shapes to booleans', () => {
    expect(normaliseSubgoal({ archived: 1 }, TODAY).archived).toBe(true)
    expect(normaliseSubgoal({ archived: 'true' }, TODAY).archived).toBe(true)
    expect(normaliseSubgoal({ archived: 0 }, TODAY).archived).toBe(false)
    expect(normaliseSubgoal({}, TODAY).archived).toBe(false)
  })

  it('rejects a zero or negative weight override', () => {
    expect(normaliseSubgoal({ weight: 0 }, TODAY).weight).toBe(1)
    expect(normaliseSubgoal({ weight: null }, TODAY).weight).toBeNull()
    expect(normaliseSubgoal({ weight: 5 }, TODAY).weight).toBe(5)
  })
})

describe('importing a JSON export', () => {
  const exported = {
    areas: [{ id: 3, name: 'Work', position: 2 }],
    goals: [
      { id: 41, area_id: 3, title: 'Ship v2', importance: 'high', created_at: '2025-01-04' },
    ],
    subgoals: [
      {
        id: 108,
        goal_id: 41,
        title: 'Month-end review',
        cadence_type: 'monthly',
        monthly_day: 31,
        created_at: '2025-01-04',
      },
    ],
    checkins: [{ subgoal_id: 108, date: '2025-01-31', status: 'done' }],
    freezes: [{ id: 2, goal_id: 41, start_date: '2025-06-01', end_date: null }],
  }

  it('preserves ids, because the tables reference each other by id', () => {
    const s = normaliseSnapshot(exported, TODAY)
    expect(s.areas[0]!.id).toBe(3)
    expect(s.goals[0]!.id).toBe(41)
    expect(s.subgoals[0]!.id).toBe(108)
    expect(s.subgoals[0]!.goal_id).toBe(41)
    expect(s.checkins[0]!.subgoal_id).toBe(108)
    expect(s.freezes[0]!.goal_id).toBe(41)
  })

  it('repairs an out-of-range monthly day on the way in', () => {
    const s = normaliseSnapshot(exported, TODAY)
    expect(s.subgoals[0]!.monthly_day).toBe(28)
    // And the repaired action now fires in February, which day 31 never would.
    expect(isScheduled(s.subgoals[0]!, '2026-02-28')).toBe(true)
  })

  it('reads the destination column list, so a stale export still loads', () => {
    const stale = { goals: [{ id: 1, area_id: 1, name: 'old field name' }] }
    const s = normaliseSnapshot(stale, TODAY)
    expect(s.goals[0]).toMatchObject({ id: 1, area_id: 1, title: '', status: 'active' })
    expect(s.areas).toEqual([])
  })

  it('survives missing tables and junk entries', () => {
    expect(normaliseSnapshot(null, TODAY)).toEqual({
      areas: [],
      goals: [],
      subgoals: [],
      checkins: [],
      freezes: [],
    })
    expect(normaliseSnapshot({ areas: [null, 'x', { id: 1 }] }, TODAY).areas).toHaveLength(1)
  })
})

describe('a fresh install', () => {
  it('ships the ten default areas in chart order', () => {
    const s = emptySnapshot()
    expect(s.areas.map((a) => a.name)).toEqual([...DEFAULT_AREAS])
    expect(s.areas.map((a) => a.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(s.goals).toEqual([])
  })
})
