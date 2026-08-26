/** SPEC.md §6 — the five derived views, plus the day detail behind a cell. */
import { describe, expect, it } from 'vitest'
import {
  CALENDAR_WEEKS,
  GOAL_GRID_WEEKS,
  WEEKLY_STRIP_WEEKS,
  addDays,
  weekStart,
} from './score'
import {
  actionRate,
  areaScore,
  areaTally,
  buildCalendar,
  buildDayDetail,
  buildGoalGrid,
  buildIndex,
  buildStar,
  buildToday,
  buildWeeklyStrip,
  goalRate,
} from './state'
import { area, checkin, freeze, goal, snapshot, subgoal } from './test-fixtures'

const TODAY = '2026-08-26' // a Wednesday

const AREAS = [
  area({ id: 1, name: 'Health', position: 0 }),
  area({ id: 2, name: 'Work', position: 1 }),
  area({ id: 3, name: 'Money', position: 2 }),
]

/** One high goal in Health with a daily action, one low goal in Work. */
function twoAreas() {
  return snapshot({
    areas: AREAS,
    goals: [
      goal({ id: 1, area_id: 1, title: 'Bench 100 kg', importance: 'high' }),
      goal({ id: 2, area_id: 2, title: 'Ship v2', importance: 'low' }),
    ],
    subgoals: [
      subgoal({ id: 1, goal_id: 1, title: 'Gym', cadence_type: 'weekly', days: [2] }),
      subgoal({ id: 2, goal_id: 2, title: 'Deep work', cadence_type: 'weekly', days: [2] }),
    ],
  })
}

describe("Today's list", () => {
  it('lists every action due today, heaviest first, grouped by area', () => {
    const view = buildToday(twoAreas(), TODAY)
    expect(view.items.map((i) => i.title)).toEqual(['Gym', 'Deep work'])
    expect(view.items.map((i) => i.weight)).toEqual([4, 1])
    expect(view.groups.map((g) => g.areaName)).toEqual(['Health', 'Work'])
  })

  it('groups in the order the groups first appear, which follows the sort', () => {
    // Work carries the heavier goal here, so its group must come first even
    // though Health sits earlier on the chart.
    const s = twoAreas()
    s.goals[0]!.importance = 'low'
    s.goals[1]!.importance = 'high'
    const view = buildToday(s, TODAY)
    expect(view.groups.map((g) => g.areaName)).toEqual(['Work', 'Health'])
  })

  it('reports progress as done of (total − crossed out)', () => {
    const s = twoAreas()
    s.checkins = [
      checkin({ subgoal_id: 1, date: TODAY, status: 'done' }),
      checkin({ subgoal_id: 2, date: TODAY, status: 'skipped' }),
    ]
    const view = buildToday(s, TODAY)
    expect(view.total).toBe(2)
    expect(view.doneCount).toBe(1)
    expect(view.skippedCount).toBe(1)
    // Crossing something out removes it from the target rather than making
    // the day unwinnable.
    expect(view.target).toBe(1)
  })

  it('omits actions from frozen goals', () => {
    const s = twoAreas()
    s.goals[1]!.status = 'frozen'
    expect(buildToday(s, TODAY).items.map((i) => i.title)).toEqual(['Gym'])
  })

  it('omits actions on a day covered by a freeze period', () => {
    const s = twoAreas()
    s.freezes = [freeze({ goal_id: 1, start_date: '2026-08-01', end_date: null })]
    expect(buildToday(s, TODAY).items.map((i) => i.title)).toEqual(['Deep work'])
  })

  it('omits archived and tombstoned actions', () => {
    const s = twoAreas()
    s.subgoals[0]!.archived = true
    s.subgoals[1]!.deleted = true
    expect(buildToday(s, TODAY).items).toEqual([])
  })

  describe('one-time actions', () => {
    const withOnce = () => {
      const s = twoAreas()
      s.subgoals.push(
        subgoal({
          id: 3,
          goal_id: 1,
          title: 'Book a physio',
          cadence_type: 'once',
          due_date: '2026-12-01',
        }),
      )
      return s
    }

    it('appears while pending regardless of its due date', () => {
      const view = buildToday(withOnce(), TODAY)
      expect(view.items.map((i) => i.title)).toContain('Book a physio')
    })

    it('appears on the day it was completed', () => {
      const s = withOnce()
      s.checkins = [checkin({ subgoal_id: 3, date: TODAY, status: 'done' })]
      expect(buildToday(s, TODAY).items.map((i) => i.title)).toContain('Book a physio')
    })

    it('disappears once it was completed on an earlier day', () => {
      const s = withOnce()
      s.checkins = [checkin({ subgoal_id: 3, date: '2026-08-20', status: 'done' })]
      expect(buildToday(s, TODAY).items.map((i) => i.title)).not.toContain('Book a physio')
    })

    it('does not appear before it was created', () => {
      const s = withOnce()
      s.subgoals[2]!.created_at = '2026-09-01'
      expect(buildToday(s, TODAY).items.map((i) => i.title)).not.toContain('Book a physio')
    })
  })
})

describe('the star', () => {
  it('places the first vertex at twelve o\'clock and goes clockwise', () => {
    const view = buildStar(twoAreas(), TODAY)
    expect(view.vertices.map((v) => v.angle)).toEqual([-90, 30, 150])
    expect(view.rings).toEqual([2, 4, 6, 8, 10])
  })

  it('divides 360° by however many areas there are', () => {
    const four = snapshot({
      areas: [...AREAS, area({ id: 4, name: 'Family', position: 3 })],
      goals: [],
    })
    expect(buildStar(four, TODAY).vertices.map((v) => v.angle)).toEqual([-90, 0, 90, 180])
  })

  it('scores an area from the weighted pool of its active goals', () => {
    const s = twoAreas()
    // Gym is a Wednesday action: 05, 12, 19 in the window (26 is pending).
    s.checkins = [
      checkin({ subgoal_id: 1, date: '2026-08-05', status: 'done' }),
      checkin({ subgoal_id: 1, date: '2026-08-12', status: 'done' }),
      checkin({ subgoal_id: 1, date: '2026-08-19', status: 'done' }),
    ]
    const idx = buildIndex(s, TODAY)
    expect(areaTally(idx, 1)).toEqual({ earned: 12, available: 12 })
    expect(areaScore(idx, 1)).toBe(10)
    expect(areaScore(idx, 2)).toBe(1) // Work: nothing logged
  })

  it('draws a null score at the midpoint with an em dash', () => {
    const view = buildStar(twoAreas(), TODAY)
    const money = view.vertices.find((v) => v.name === 'Money')!
    expect(money.score).toBeNull()
    expect(money.label).toBe('—')
    expect(money.radiusRatio).toBe(0.5)
  })

  it('scores an area whose goals are all frozen as null, not zero', () => {
    const s = twoAreas()
    s.goals[1]!.status = 'frozen'
    const work = buildStar(s, TODAY).vertices.find((v) => v.name === 'Work')!
    expect(work.score).toBeNull()
    expect(work.available).toBe(0)
  })

  it('carries a text description, because the chart is the main data display', () => {
    const view = buildStar(twoAreas(), TODAY)
    expect(view.description).toContain('Health')
    expect(view.description).toContain('Money —')
  })
})

describe('the three levels of percentage', () => {
  it('reads the goal weighted and the action unweighted', () => {
    const s = snapshot({
      areas: AREAS,
      goals: [goal({ id: 1, area_id: 1, importance: 'high' })],
      subgoals: [
        subgoal({ id: 1, goal_id: 1, cadence_type: 'weekly', days: [2] }),
        subgoal({ id: 2, goal_id: 1, cadence_type: 'weekly', days: [3], weight: 1 }),
      ],
      checkins: [
        checkin({ subgoal_id: 1, date: '2026-08-05', status: 'done' }),
        checkin({ subgoal_id: 1, date: '2026-08-12', status: 'done' }),
        checkin({ subgoal_id: 1, date: '2026-08-19', status: 'done' }),
      ],
    })
    const idx = buildIndex(s, TODAY)
    const g = idx.goalById.get(1)!
    // Action 1: 3 Wednesdays at weight 4 = 12 earned of 12.
    // Action 2: 4 Thursdays at weight 1 = 0 earned of 4.
    expect(goalRate(idx, g)).toBeCloseTo(12 / 16)
    // The action percentage ignores weight entirely.
    expect(actionRate(idx, idx.subgoalById.get(1)!)).toBe(1)
    expect(actionRate(idx, idx.subgoalById.get(2)!)).toBe(0)
  })

  it('is null for a goal with nothing due', () => {
    const idx = buildIndex(twoAreas(), TODAY)
    const empty = goal({ id: 9, area_id: 3 })
    expect(goalRate(idx, empty)).toBeNull()
  })
})

describe('weekly history strip', () => {
  it('renders 8 Monday-start weeks ending with the current one', () => {
    const bars = buildWeeklyStrip(twoAreas(), TODAY)
    expect(bars).toHaveLength(WEEKLY_STRIP_WEEKS)
    expect(bars[bars.length - 1]!.weekStart).toBe(weekStart(TODAY))
    expect(bars[bars.length - 1]!.isCurrent).toBe(true)
    expect(bars[0]!.weekStart).toBe(addDays(weekStart(TODAY), -7 * 7))
    for (const b of bars) expect(addDays(b.weekStart, 6)).toBe(b.weekEnd)
  })

  it('uses range mode: a week with nothing due reads null, not zero', () => {
    const s = twoAreas()
    s.subgoals = [
      subgoal({ id: 1, goal_id: 1, cadence_type: 'monthly', monthly_day: 3 }),
    ]
    const bars = buildWeeklyStrip(s, TODAY)
    const withDue = bars.filter((b) => b.available > 0)
    expect(withDue.length).toBeGreaterThan(0)
    expect(bars.some((b) => b.rate === null)).toBe(true)
  })

  it('scores the current week on the days resolved so far', () => {
    const s = twoAreas()
    // Gym on Wednesday = today. Nothing logged, so the week is still empty.
    const bars = buildWeeklyStrip(s, TODAY)
    expect(bars[bars.length - 1]!.available).toBe(0)

    s.checkins = [checkin({ subgoal_id: 1, date: TODAY, status: 'done' })]
    const after = buildWeeklyStrip(s, TODAY)
    expect(after[after.length - 1]!.earned).toBe(4)
    expect(after[after.length - 1]!.rate).toBe(1)
  })
})

describe('per-goal tracker grid', () => {
  it('renders 15 Monday-aligned weeks ending with the week containing today', () => {
    const grid = buildGoalGrid(twoAreas(), 1, TODAY)
    expect(grid.weeks).toHaveLength(GOAL_GRID_WEEKS)
    expect(grid.weeks[0]!.days).toHaveLength(7)
    expect(grid.weeks[GOAL_GRID_WEEKS - 1]!.weekStart).toBe(weekStart(TODAY))
    expect(grid.weeks.every((w) => w.days[0]!.date === w.weekStart)).toBe(true)
  })

  function cellOn(date: string, s = twoAreas(), goalId = 1) {
    const grid = buildGoalGrid(s, goalId, TODAY)
    for (const w of grid.weeks) for (const d of w.days) if (d.date === date) return d
    throw new Error(`${date} is not in the grid`)
  }

  it('marks days with nothing due as none, and future days as future', () => {
    expect(cellOn('2026-08-25').state).toBe('none') // a Tuesday
    expect(cellOn('2026-08-27').state).toBe('future')
  })

  it('marks a past day with nothing logged as missed', () => {
    expect(cellOn('2026-08-19').state).toBe('missed')
  })

  it('marks today as `today` while unresolved, and resolves it once ticked', () => {
    expect(cellOn(TODAY).state).toBe('today')
    const s = twoAreas()
    s.checkins = [checkin({ subgoal_id: 1, date: TODAY, status: 'done' })]
    expect(cellOn(TODAY, s).state).toBe('done')
  })

  it('marks done, partial and missed from a multi-action goal', () => {
    const s = twoAreas()
    s.subgoals.push(
      subgoal({ id: 3, goal_id: 1, title: 'Stretch', cadence_type: 'weekly', days: [2] }),
    )
    s.checkins = [
      checkin({ subgoal_id: 1, date: '2026-08-19', status: 'done' }),
      checkin({ subgoal_id: 3, date: '2026-08-19', status: 'done' }),
      checkin({ subgoal_id: 1, date: '2026-08-12', status: 'done' }),
      checkin({ subgoal_id: 3, date: '2026-08-12', status: 'skipped' }),
    ]
    expect(cellOn('2026-08-19', s).state).toBe('done')
    expect(cellOn('2026-08-12', s).state).toBe('partial')
    expect(cellOn('2026-08-05', s).state).toBe('missed')
  })

  it('marks frozen days as frozen, not missed — and end_date is exclusive', () => {
    const s = twoAreas()
    s.freezes = [
      freeze({ goal_id: 1, start_date: '2026-08-05', end_date: '2026-08-19' }),
    ]
    expect(cellOn('2026-08-05', s).state).toBe('frozen')
    expect(cellOn('2026-08-12', s).state).toBe('frozen')
    expect(cellOn('2026-08-19', s).state).toBe('missed') // live again
  })
})

describe('day-by-day calendar', () => {
  it('renders 26 Monday-aligned weeks ending with the week containing today', () => {
    const cal = buildCalendar(twoAreas(), TODAY)
    expect(cal.weeks).toHaveLength(CALENDAR_WEEKS)
    expect(cal.weeks[CALENDAR_WEEKS - 1]!.weekStart).toBe(weekStart(TODAY))
    const first = cal.weeks[0]!.days[0]!.date
    // 26 weeks is exactly the 182-day back-dating limit, so every day in the
    // calendar is correctable.
    expect(cal.weeks.flatMap((w) => w.days).every((d) => d.editable || d.isFuture)).toBe(true)
    expect(first).toBe(addDays(weekStart(TODAY), -7 * 25))
  })

  function dayOn(date: string, s = twoAreas()) {
    const cal = buildCalendar(s, TODAY)
    for (const w of cal.weeks) for (const d of w.days) if (d.date === date) return d
    throw new Error(`${date} is not in the calendar`)
  }

  it('carries weighted totals and counts', () => {
    const s = twoAreas()
    s.checkins = [checkin({ subgoal_id: 1, date: '2026-08-19', status: 'done' })]
    const d = dayOn('2026-08-19', s)
    expect(d.total).toBe(5) // Gym 4 + Deep work 1
    expect(d.done).toBe(4)
    expect(d.count).toBe(2)
    expect(d.doneCount).toBe(1)
    expect(d.ratio).toBe(0.8)
    expect(d.band).toBe(3)
  })

  it('counts skipped weight separately from done', () => {
    const s = twoAreas()
    s.checkins = [checkin({ subgoal_id: 1, date: '2026-08-19', status: 'skipped' })]
    const d = dayOn('2026-08-19', s)
    expect(d.skipped).toBe(4)
    expect(d.done).toBe(0)
    expect(d.ratio).toBe(0)
    expect(d.band).toBe(0)
  })

  it('reads null, not zero, on a day with nothing due', () => {
    const d = dayOn('2026-08-25')
    expect(d.total).toBe(0)
    expect(d.ratio).toBeNull()
    expect(d.band).toBeNull()
  })

  it("counts today's unresolved weight in the day ratio — deliberately unlike the star", () => {
    const s = twoAreas()
    s.checkins = [checkin({ subgoal_id: 1, date: TODAY, status: 'done' })]
    const cell = dayOn(TODAY, s)
    // The calendar is a record of a day: all 5 weight due, 4 logged.
    expect(cell.total).toBe(5)
    expect(cell.ratio).toBe(0.8)
    // The star is a judgement about a standing: Deep work is pending today,
    // so it is excluded from its denominator entirely.
    const idx = buildIndex(s, TODAY)
    expect(areaTally(idx, 2)).toEqual({ earned: 0, available: 3 })
  })

  it('leaves future days blank and uneditable', () => {
    const d = dayOn('2026-08-27')
    expect(d.isFuture).toBe(true)
    expect(d.editable).toBe(false)
    expect(d.total).toBe(0)
  })
})

describe('the day detail checklist', () => {
  const withOnce = () => {
    const s = twoAreas()
    s.subgoals.push(
      subgoal({ id: 3, goal_id: 1, title: 'Book a physio', cadence_type: 'once' }),
    )
    return s
  }

  it('shows what was owed as well as what was logged', () => {
    const s = twoAreas()
    s.checkins = [checkin({ subgoal_id: 1, date: '2026-08-19', status: 'done' })]
    const view = buildDayDetail(s, '2026-08-19', TODAY)
    expect(view.items.map((i) => i.title)).toEqual(['Gym', 'Deep work'])
    expect(view.items[0]!.status).toBe('done')
    expect(view.items[1]!.status).toBeNull() // pending items still show
  })

  it('matches the Today list exactly for today, one-time actions included', () => {
    const s = withOnce()
    const detail = buildDayDetail(s, TODAY, TODAY)
    const today = buildToday(s, TODAY)
    expect(detail.items.map((i) => i.subgoal_id)).toEqual(
      today.items.map((i) => i.subgoal_id),
    )
  })

  it('omits pending one-time actions from a past day — they were not owed then', () => {
    const view = buildDayDetail(withOnce(), '2026-08-19', TODAY)
    expect(view.items.map((i) => i.title)).not.toContain('Book a physio')
  })

  it('shows a one-time action on the past day it was logged, and counts it', () => {
    const s = withOnce()
    s.checkins = [checkin({ subgoal_id: 3, date: '2026-08-19', status: 'done' })]
    const view = buildDayDetail(s, '2026-08-19', TODAY)
    const item = view.items.find((i) => i.title === 'Book a physio')!
    expect(item.status).toBe('done')
    // Its one occurrence lands on that day, so it is genuinely part of it.
    expect(item.wasDue).toBe(true)
    expect(view.total).toBe(5 + 4) // Gym 4 + Deep work 1 + physio 4
    expect(view.done).toBe(4)
  })

  it('shows an overdue one-time action on the deadline it blew past', () => {
    const s = withOnce()
    s.subgoals[2]!.due_date = '2026-08-19'
    const view = buildDayDetail(s, '2026-08-19', TODAY)
    const item = view.items.find((i) => i.title === 'Book a physio')!
    expect(item.status).toBeNull()
    expect(item.wasDue).toBe(true)
  })

  it('is editable within 182 days and never in the future', () => {
    expect(buildDayDetail(twoAreas(), addDays(TODAY, -182), TODAY).editable).toBe(true)
    expect(buildDayDetail(twoAreas(), addDays(TODAY, -183), TODAY).editable).toBe(false)
    expect(buildDayDetail(twoAreas(), addDays(TODAY, 1), TODAY).editable).toBe(false)
  })
})

describe('a completed one-time action moves the calendar and the star', () => {
  function withOnce(over: Partial<import('./types').Subgoal> = {}) {
    const s = twoAreas()
    s.subgoals.push(
      subgoal({
        id: 3,
        goal_id: 1, // Health, high → weight 4
        title: 'Book a physio',
        cadence_type: 'once',
        ...over,
      }),
    )
    return s
  }

  it('moves the star once ticked', () => {
    const before = buildStar(withOnce(), TODAY).vertices.find((v) => v.name === 'Health')!
    expect(before.available).toBe(3 * 4) // just the three resolved Wednesdays

    const s = withOnce()
    s.checkins = [checkin({ subgoal_id: 3, date: TODAY, status: 'done' })]
    const after = buildStar(s, TODAY).vertices.find((v) => v.name === 'Health')!
    expect(after.available).toBe(3 * 4 + 4)
    expect(after.earned).toBe(4)
    expect(after.score).toBeGreaterThan(before.score!)
  })

  it('moves the calendar cell for the day it was logged', () => {
    const s = withOnce()
    s.checkins = [checkin({ subgoal_id: 3, date: TODAY, status: 'done' })]
    const cal = buildCalendar(s, TODAY)
    const cell = cal.weeks.flatMap((w) => w.days).find((d) => d.date === TODAY)!
    expect(cell.total).toBe(4 + 1 + 4) // Gym + Deep work + physio
    expect(cell.done).toBe(4)
    expect(cell.doneCount).toBe(1)
  })

  it('drags the star down once its deadline passes unresolved', () => {
    const s = withOnce({ due_date: '2026-08-20' })
    const health = buildStar(s, TODAY).vertices.find((v) => v.name === 'Health')!
    expect(health.available).toBe(3 * 4 + 4)
    expect(health.earned).toBe(0)
  })

  it('stays out of the score while it is not yet owed', () => {
    const s = withOnce({ due_date: '2026-12-01' })
    const health = buildStar(s, TODAY).vertices.find((v) => v.name === 'Health')!
    expect(health.available).toBe(3 * 4)
  })

  it('marks an overdue item in the Today list', () => {
    const s = withOnce({ due_date: '2026-08-20' })
    const item = buildToday(s, TODAY).items.find((i) => i.title === 'Book a physio')!
    expect(item.overdue).toBe(true)
    expect(item.status).toBeNull()
    const notYet = buildToday(withOnce({ due_date: '2026-12-01' }), TODAY).items.find(
      (i) => i.title === 'Book a physio',
    )!
    expect(notYet.overdue).toBe(false)
  })

  it('shows in the per-goal grid on its occurrence day', () => {
    const s = withOnce()
    s.checkins = [checkin({ subgoal_id: 3, date: '2026-08-25', status: 'done' })]
    const grid = buildGoalGrid(s, 1, TODAY)
    const cell = grid.weeks.flatMap((w) => w.days).find((d) => d.date === '2026-08-25')!
    // A Tuesday: nothing recurring is due, so the one-time action is the day.
    expect(cell.due).toBe(1)
    expect(cell.state).toBe('done')
  })
})

describe('tombstones and orphans', () => {
  it('drops tombstoned rows from every view', () => {
    const s = twoAreas()
    s.areas[1]!.deleted = true
    s.goals[0]!.deleted = true
    const star = buildStar(s, TODAY)
    expect(star.vertices.map((v) => v.name)).toEqual(['Health', 'Money'])
    expect(buildToday(s, TODAY).items).toEqual([])
  })

  it('drops goals whose area is gone, rather than crashing', () => {
    const s = twoAreas()
    s.goals.push(goal({ id: 9, area_id: 99, title: 'Orphan' }))
    expect(buildIndex(s, TODAY).goalById.has(9)).toBe(false)
  })

  it('drops check-ins belonging to a tombstoned action', () => {
    const s = twoAreas()
    s.subgoals[0]!.deleted = true
    s.checkins = [checkin({ subgoal_id: 1, date: '2026-08-19', status: 'done' })]
    const idx = buildIndex(s, TODAY)
    expect(areaTally(idx, 1)).toEqual({ earned: 0, available: 0 })
    expect(areaScore(idx, 1)).toBeNull()
  })

  it('gives an empty snapshot a null score everywhere', () => {
    const empty = snapshot({ areas: AREAS, goals: [] })
    const star = buildStar(empty, TODAY)
    expect(star.vertices.every((v) => v.score === null)).toBe(true)
    expect(buildToday(empty, TODAY).total).toBe(0)
    expect(buildWeeklyStrip(empty, TODAY).every((b) => b.rate === null)).toBe(true)
  })
})
