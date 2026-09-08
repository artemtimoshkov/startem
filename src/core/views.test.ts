/** SPEC.md §6 — the derived views, plus the day detail behind a cell. */
import { describe, expect, it } from 'vitest'
import {
  CALENDAR_WEEKS,
  HABIT_GRID_WEEKS,
  WEEKLY_STRIP_WEEKS,
  addDays,
  weekStart,
} from './score'
import {
  areaGoals,
  areaScore,
  areaTally,
  buildCalendar,
  buildDayDetail,
  buildHabitGrid,
  buildIndex,
  buildStar,
  buildToday,
  buildTodos,
  buildWeeklyStrip,
  habitRate,
  habitStreak,
  isPaused,
} from './state'
import { area, checkin, freeze, goal, snapshot, subgoal } from './test-fixtures'

const TODAY = '2026-08-26' // a Wednesday

/**
 * Fresh rows every call. A shared array would let one test's `deleted = true`
 * leak into the next one, which is exactly the kind of silent cross-talk that
 * makes a scoring bug look like a cadence bug.
 */
const AREAS = () => [
  area({ id: 1, name: 'Health', position: 0 }),
  area({ id: 2, name: 'Work', position: 1 }),
  area({ id: 3, name: 'Money', position: 2 }),
]

/**
 * A high habit in Health, a low one in Work — hanging straight off their
 * areas, because there is nothing in between any more (§3). The two goals are
 * aims that own none of it, which is the point: nothing below depends on them.
 */
function twoAreas() {
  return snapshot({
    areas: AREAS(),
    goals: [
      goal({ id: 1, area_id: 1, title: 'Bench 100 kg' }),
      goal({ id: 2, area_id: 2, title: 'Ship v2' }),
    ],
    subgoals: [
      subgoal({
        id: 1,
        area_id: 1,
        title: 'Gym',
        importance: 'high',
        cadence_type: 'weekly',
        days: [2],
      }),
      subgoal({
        id: 2,
        area_id: 2,
        title: 'Deep work',
        importance: 'low',
        cadence_type: 'weekly',
        days: [2],
      }),
    ],
  })
}

/** The same, plus one to-do in Health. */
function withTodo(over: Partial<import('./types').Subgoal> = {}) {
  const s = twoAreas()
  s.subgoals.push(
    subgoal({
      id: 3,
      area_id: 1,
      title: 'Book a physio',
      importance: 'high', // weight 4, if anything ever weighed it
      cadence_type: 'once',
      ...over,
    }),
  )
  return s
}

describe("Today's list", () => {
  it('lists every habit due today, heaviest first, grouped by area', () => {
    const view = buildToday(twoAreas(), TODAY)
    expect(view.items.map((i) => i.title)).toEqual(['Gym', 'Deep work'])
    expect(view.items.map((i) => i.weight)).toEqual([4, 1])
    expect(view.groups.map((g) => g.areaName)).toEqual(['Health', 'Work'])
  })

  it('groups in the order the groups first appear, which follows the sort', () => {
    // Work carries the heavier habit here, so its group must come first even
    // though Health sits earlier on the chart.
    const s = twoAreas()
    s.subgoals[0]!.importance = 'low'
    s.subgoals[1]!.importance = 'high'
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

  it('omits habits on a day covered by a pause period', () => {
    const s = twoAreas()
    s.freezes = [freeze({ subgoal_id: 1, start_date: '2026-08-01', end_date: null })]
    expect(buildToday(s, TODAY).items.map((i) => i.title)).toEqual(['Deep work'])
  })

  it('omits archived and tombstoned habits', () => {
    const s = twoAreas()
    s.subgoals[0]!.archived = true
    s.subgoals[1]!.deleted = true
    expect(buildToday(s, TODAY).items).toEqual([])
  })

  /**
   * The change the whole redesign turns on: the day's list is habits, full
   * stop. A to-do lives on its own list and is never mixed into this one.
   */
  it('never lists a to-do, pending or completed', () => {
    expect(buildToday(withTodo(), TODAY).items.map((i) => i.title)).toEqual([
      'Gym',
      'Deep work',
    ])
    const s = withTodo({ due_date: '2026-08-01' }) // long overdue
    expect(buildToday(s, TODAY).items.map((i) => i.title)).not.toContain('Book a physio')

    const done = withTodo()
    done.checkins = [checkin({ subgoal_id: 3, date: TODAY, status: 'done' })]
    expect(buildToday(done, TODAY).items.map((i) => i.title)).not.toContain('Book a physio')
  })

  it('carries the streak, and today pending does not break it', () => {
    const s = twoAreas()
    s.checkins = [
      checkin({ subgoal_id: 1, date: '2026-08-12', status: 'done' }),
      checkin({ subgoal_id: 1, date: '2026-08-19', status: 'done' }),
    ]
    const item = buildToday(s, TODAY).items.find((i) => i.title === 'Gym')!
    expect(item.status).toBeNull()
    expect(item.streak).toBe(2)
  })
})

describe('the to-do list', () => {
  it('sorts every to-do into a pile from its deadline alone', () => {
    const s = twoAreas()
    s.subgoals.push(
      subgoal({ id: 3, area_id: 1, title: 'Late', cadence_type: 'once', due_date: '2026-08-20' }),
      subgoal({ id: 4, area_id: 1, title: 'Now', cadence_type: 'once', due_date: TODAY }),
      subgoal({ id: 5, area_id: 2, title: 'Soon', cadence_type: 'once', due_date: '2026-09-05' }),
      subgoal({ id: 6, area_id: 2, title: 'Whenever', cadence_type: 'once', due_date: null }),
    )
    const view = buildTodos(s, TODAY)
    expect(view.sections.map((sec) => sec.bucket)).toEqual([
      'overdue',
      'today',
      'upcoming',
      'someday',
    ])
    expect(view.items.map((i) => i.title)).toEqual(['Late', 'Now', 'Soon', 'Whenever'])
    expect(view.openCount).toBe(4)
    expect(view.overdueCount).toBe(1)
    expect(view.dueTodayCount).toBe(2)
  })

  it('never lists a habit', () => {
    expect(buildTodos(twoAreas(), TODAY).items).toEqual([])
  })

  it('keeps a finished to-do for a fortnight, then drops it', () => {
    const recent = withTodo()
    recent.checkins = [checkin({ subgoal_id: 3, date: addDays(TODAY, -13), status: 'done' })]
    const kept = buildTodos(recent, TODAY).items.find((i) => i.title === 'Book a physio')!
    expect(kept.bucket).toBe('done')
    expect(kept.status).toBe('done')
    expect(kept.resolved_on).toBe(addDays(TODAY, -13))
    // Not counted as open: a finished errand is not work outstanding.
    expect(buildTodos(recent, TODAY).openCount).toBe(0)

    const old = withTodo()
    old.checkins = [checkin({ subgoal_id: 3, date: addDays(TODAY, -15), status: 'done' })]
    expect(buildTodos(old, TODAY).items).toEqual([])
  })

  it('sorts the finished pile most recent first', () => {
    const s = twoAreas()
    s.subgoals.push(
      subgoal({ id: 3, area_id: 1, title: 'Older', cadence_type: 'once' }),
      subgoal({ id: 4, area_id: 1, title: 'Newer', cadence_type: 'once' }),
    )
    s.checkins = [
      checkin({ subgoal_id: 3, date: addDays(TODAY, -5), status: 'done' }),
      checkin({ subgoal_id: 4, date: addDays(TODAY, -1), status: 'done' }),
    ]
    expect(buildTodos(s, TODAY).items.map((i) => i.title)).toEqual(['Newer', 'Older'])
  })
})

describe('the star', () => {
  it("places the first vertex at twelve o'clock and goes clockwise", () => {
    const view = buildStar(twoAreas(), TODAY)
    expect(view.vertices.map((v) => v.angle)).toEqual([-90, 30, 150])
    expect(view.rings).toEqual([2, 4, 6, 8, 10])
  })

  it('divides 360° by however many areas there are', () => {
    const four = snapshot({
      areas: [...AREAS(), area({ id: 4, name: 'Family', position: 3 })],
      goals: [],
    })
    expect(buildStar(four, TODAY).vertices.map((v) => v.angle)).toEqual([-90, 0, 90, 180])
  })

  /** Adding and removing areas is a user action now (§7), so the geometry has
   *  to hold at both ends of the range, not just at ten. */
  it('draws a single spoke, and twenty, without special-casing either', () => {
    const one = snapshot({ areas: [area({ id: 1, name: 'Health', position: 0 })], goals: [] })
    expect(buildStar(one, TODAY).vertices.map((v) => v.angle)).toEqual([-90])

    const many = snapshot({
      areas: Array.from({ length: 20 }, (_, i) => area({ id: i + 1, name: `A${i}`, position: i })),
      goals: [],
    })
    const angles = buildStar(many, TODAY).vertices.map((v) => v.angle)
    expect(angles).toHaveLength(20)
    expect(angles[1]! - angles[0]!).toBe(18)
  })

  it('scores an area from the weighted pool of its habits', () => {
    const s = twoAreas()
    // Gym is a Wednesday habit: 05, 12, 19 in the window (26 is pending).
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

  /**
   * The other half of the split. A to-do is tracked, never scored — so an
   * errand ticked, missed or never given a deadline moves nothing on the star
   * (§5). Without this the score stopped being a statement about habits.
   */
  it('ignores to-dos entirely, ticked or blown', () => {
    const base = buildStar(twoAreas(), TODAY).vertices.find((v) => v.name === 'Health')!

    const ticked = withTodo()
    ticked.checkins = [checkin({ subgoal_id: 3, date: TODAY, status: 'done' })]
    const afterTick = buildStar(ticked, TODAY).vertices.find((v) => v.name === 'Health')!
    expect(afterTick.available).toBe(base.available)
    expect(afterTick.earned).toBe(base.earned)

    const blown = withTodo({ due_date: '2026-08-20' })
    const afterMiss = buildStar(blown, TODAY).vertices.find((v) => v.name === 'Health')!
    expect(afterMiss.available).toBe(base.available)
    expect(afterMiss.earned).toBe(base.earned)
  })

  it('draws a null score at the midpoint with an em dash', () => {
    const view = buildStar(twoAreas(), TODAY)
    const money = view.vertices.find((v) => v.name === 'Money')!
    expect(money.score).toBeNull()
    expect(money.label).toBe('—')
    expect(money.radiusRatio).toBe(0.5)
  })

  it('scores an area whose only habit is paused as null, not zero', () => {
    const s = twoAreas()
    s.freezes = [freeze({ subgoal_id: 2, start_date: '2026-01-01', end_date: null })]
    const work = buildStar(s, TODAY).vertices.find((v) => v.name === 'Work')!
    expect(work.score).toBeNull()
    expect(work.available).toBe(0)
  })

  it('counts the habits and the live goals behind each number', () => {
    const s = withTodo()
    const health = buildStar(s, TODAY).vertices.find((v) => v.name === 'Health')!
    expect(health.habitCount).toBe(1) // the to-do is not one
    expect(health.goalCount).toBe(1)
  })

  it('carries a text description, because the chart is the main data display', () => {
    const view = buildStar(twoAreas(), TODAY)
    expect(view.description).toContain('Health')
    expect(view.description).toContain('Money —')
  })
})

describe('percentages and streaks', () => {
  it('reads the area weighted and the habit unweighted', () => {
    const s = snapshot({
      areas: AREAS(),
      goals: [],
      subgoals: [
        subgoal({ id: 1, area_id: 1, importance: 'high', cadence_type: 'weekly', days: [2] }),
        subgoal({ id: 2, area_id: 1, cadence_type: 'weekly', days: [3], weight: 1 }),
      ],
      checkins: [
        checkin({ subgoal_id: 1, date: '2026-08-05', status: 'done' }),
        checkin({ subgoal_id: 1, date: '2026-08-12', status: 'done' }),
        checkin({ subgoal_id: 1, date: '2026-08-19', status: 'done' }),
      ],
    })
    const idx = buildIndex(s, TODAY)
    // Habit 1: 3 Wednesdays at weight 4 = 12 earned of 12.
    // Habit 2: 4 Thursdays at weight 1 = 0 earned of 4.
    expect(areaTally(idx, 1)).toEqual({ earned: 12, available: 16 })
    // The habit percentage ignores weight entirely.
    expect(habitRate(idx, idx.subgoalById.get(1)!)).toBe(1)
    expect(habitRate(idx, idx.subgoalById.get(2)!)).toBe(0)
  })

  it('has no percentage for a to-do — there is no cadence to be kept', () => {
    const idx = buildIndex(withTodo(), TODAY)
    expect(habitRate(idx, idx.subgoalById.get(3)!)).toBeNull()
    expect(habitStreak(idx, idx.subgoalById.get(3)!)).toBe(0)
  })

  describe('streaks', () => {
    const gymOn = (dates: string[]) => {
      const s = twoAreas()
      s.checkins = dates.map((date) => checkin({ subgoal_id: 1, date, status: 'done' }))
      return buildIndex(s, TODAY)
    }

    it('counts consecutive kept occurrences, not days', () => {
      const idx = gymOn(['2026-08-05', '2026-08-12', '2026-08-19'])
      expect(habitStreak(idx, idx.subgoalById.get(1)!)).toBe(3)
    })

    it('breaks on a miss, and today unresolved does not break it', () => {
      const idx = gymOn(['2026-08-05', '2026-08-19'])
      // 19 kept, 12 missed: the run stops at one.
      expect(habitStreak(idx, idx.subgoalById.get(1)!)).toBe(1)
    })

    it('counts today once it is ticked', () => {
      const idx = gymOn(['2026-08-19', TODAY])
      expect(habitStreak(idx, idx.subgoalById.get(1)!)).toBe(2)
    })

    it('steps over paused days rather than breaking on them', () => {
      const s = twoAreas()
      s.checkins = [
        checkin({ subgoal_id: 1, date: '2026-08-05', status: 'done' }),
        checkin({ subgoal_id: 1, date: '2026-08-19', status: 'done' }),
      ]
      s.freezes = [freeze({ subgoal_id: 1, start_date: '2026-08-10', end_date: '2026-08-14' })]
      const idx = buildIndex(s, TODAY)
      expect(habitStreak(idx, idx.subgoalById.get(1)!)).toBe(2)
    })
  })

  it('reports a habit paused today', () => {
    const s = twoAreas()
    s.freezes = [freeze({ subgoal_id: 1, start_date: '2026-08-01', end_date: null })]
    const idx = buildIndex(s, TODAY)
    expect(isPaused(idx, idx.subgoalById.get(1)!)).toBe(true)
    expect(isPaused(idx, idx.subgoalById.get(2)!)).toBe(false)
  })
})

describe('goals', () => {
  it('splits an area into aims still open and aims reached', () => {
    const s = twoAreas()
    s.goals.push(
      goal({ id: 3, area_id: 1, title: 'Sleep before midnight', position: 1 }),
      goal({
        id: 4,
        area_id: 1,
        title: 'Run 10 km',
        status: 'achieved',
        achieved_on: '2026-07-01',
        position: 2,
      }),
    )
    const { active, achieved } = areaGoals(buildIndex(s, TODAY), 1)
    expect(active.map((g) => g.title)).toEqual(['Bench 100 kg', 'Sleep before midnight'])
    expect(achieved.map((g) => g.title)).toEqual(['Run 10 km'])
  })

  it('never affects a score — a goal owns no work', () => {
    const s = twoAreas()
    const before = buildStar(s, TODAY).vertices.find((v) => v.name === 'Health')!
    s.goals[0]!.status = 'achieved'
    s.goals[0]!.achieved_on = TODAY
    s.goals.push(goal({ id: 7, area_id: 1, title: 'Another aim', position: 3 }))
    const after = buildStar(s, TODAY).vertices.find((v) => v.name === 'Health')!
    expect(after.available).toBe(before.available)
    expect(after.earned).toBe(before.earned)
  })

  it('leaves the habits alone when a goal is tombstoned', () => {
    const s = twoAreas()
    s.goals[0]!.deleted = true
    expect(buildToday(s, TODAY).items.map((i) => i.title)).toEqual(['Gym', 'Deep work'])
    expect(buildIndex(s, TODAY).goalById.has(1)).toBe(false)
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
    s.subgoals = [subgoal({ id: 1, area_id: 1, cadence_type: 'monthly', monthly_day: 3 })]
    const bars = buildWeeklyStrip(s, TODAY)
    expect(bars.filter((b) => b.available > 0).length).toBeGreaterThan(0)
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

  it('narrows to one area when asked, and still ignores to-dos', () => {
    const s = withTodo()
    s.checkins = [
      checkin({ subgoal_id: 1, date: '2026-08-19', status: 'done' }),
      checkin({ subgoal_id: 3, date: '2026-08-19', status: 'done' }),
    ]
    const health = buildWeeklyStrip(s, TODAY, 8, 1)
    const week = health.find((b) => b.weekStart === weekStart('2026-08-19'))!
    expect(week.available).toBe(4) // Gym alone; Deep work is Work's, the physio is nobody's
    expect(week.earned).toBe(4)
  })
})

describe('per-habit tracker grid', () => {
  it('renders 15 Monday-aligned weeks ending with the week containing today', () => {
    const grid = buildHabitGrid(twoAreas(), 1, TODAY)
    expect(grid.weeks).toHaveLength(HABIT_GRID_WEEKS)
    expect(grid.weeks[0]!.days).toHaveLength(7)
    expect(grid.weeks[HABIT_GRID_WEEKS - 1]!.weekStart).toBe(weekStart(TODAY))
    expect(grid.weeks.every((w) => w.days[0]!.date === w.weekStart)).toBe(true)
  })

  function cellOn(date: string, s = twoAreas(), taskId = 1) {
    const grid = buildHabitGrid(s, taskId, TODAY)
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

  /**
   * The grid is one habit's, so its cells are binary. Under a goal they were
   * an average of unrelated work, and a half-shaded cell told you nothing
   * about what you had actually failed to do.
   */
  it('reads only the habit it was asked for', () => {
    const s = twoAreas()
    s.checkins = [checkin({ subgoal_id: 2, date: '2026-08-19', status: 'done' })]
    expect(cellOn('2026-08-19', s, 1).state).toBe('missed')
    expect(cellOn('2026-08-19', s, 2).state).toBe('done')
  })

  it('marks a crossed-out day as missed, not kept', () => {
    const s = twoAreas()
    s.checkins = [checkin({ subgoal_id: 1, date: '2026-08-19', status: 'skipped' })]
    expect(cellOn('2026-08-19', s).state).toBe('missed')
  })

  it('marks paused days as frozen, not missed — and end_date is exclusive', () => {
    const s = twoAreas()
    s.freezes = [freeze({ subgoal_id: 1, start_date: '2026-08-05', end_date: '2026-08-19' })]
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

  it('leaves to-dos out, so the day is a record of habits kept', () => {
    const s = withTodo()
    s.checkins = [checkin({ subgoal_id: 3, date: '2026-08-19', status: 'done' })]
    expect(dayOn('2026-08-19', s).total).toBe(5)
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
  it('shows what was owed as well as what was logged', () => {
    const s = twoAreas()
    s.checkins = [checkin({ subgoal_id: 1, date: '2026-08-19', status: 'done' })]
    const view = buildDayDetail(s, '2026-08-19', TODAY)
    expect(view.items.map((i) => i.title)).toEqual(['Gym', 'Deep work'])
    expect(view.items[0]!.status).toBe('done')
    expect(view.items[1]!.status).toBeNull() // pending items still show
  })

  it('matches the Today list exactly for today', () => {
    const s = withTodo()
    expect(buildDayDetail(s, TODAY, TODAY).items.map((i) => i.subgoal_id)).toEqual(
      buildToday(s, TODAY).items.map((i) => i.subgoal_id),
    )
  })

  it('shows a habit logged on a day its cadence no longer covers', () => {
    const s = twoAreas()
    // A Tuesday: Gym is a Wednesday habit, but the row describes a real day.
    s.checkins = [checkin({ subgoal_id: 1, date: '2026-08-25', status: 'done' })]
    const item = buildDayDetail(s, '2026-08-25', TODAY).items.find((i) => i.title === 'Gym')!
    expect(item.status).toBe('done')
    expect(item.wasDue).toBe(false)
  })

  it('is editable within 182 days and never in the future', () => {
    expect(buildDayDetail(twoAreas(), addDays(TODAY, -182), TODAY).editable).toBe(true)
    expect(buildDayDetail(twoAreas(), addDays(TODAY, -183), TODAY).editable).toBe(false)
    expect(buildDayDetail(twoAreas(), addDays(TODAY, 1), TODAY).editable).toBe(false)
  })
})

describe('tombstones and orphans', () => {
  it('drops tombstoned rows from every view', () => {
    const s = twoAreas()
    s.areas[1]!.deleted = true // Work is gone, and so is the habit inside it
    const star = buildStar(s, TODAY)
    expect(star.vertices.map((v) => v.name)).toEqual(['Health', 'Money'])
    expect(buildToday(s, TODAY).items.map((i) => i.title)).toEqual(['Gym'])
  })

  it('drops a task whose area is gone — an area is the one thing it must have', () => {
    const s = twoAreas()
    s.areas[0]!.deleted = true
    expect(buildIndex(s, TODAY).subgoalById.has(1)).toBe(false)
    expect(buildToday(s, TODAY).items.map((i) => i.title)).toEqual(['Deep work'])
  })

  it('drops goals whose area is gone, rather than crashing', () => {
    const s = twoAreas()
    s.goals.push(goal({ id: 9, area_id: 99, title: 'Orphan' }))
    expect(buildIndex(s, TODAY).goalById.has(9)).toBe(false)
  })

  it('drops check-ins belonging to a tombstoned habit', () => {
    const s = twoAreas()
    s.subgoals[0]!.deleted = true
    s.checkins = [checkin({ subgoal_id: 1, date: '2026-08-19', status: 'done' })]
    const idx = buildIndex(s, TODAY)
    expect(areaTally(idx, 1)).toEqual({ earned: 0, available: 0 })
    expect(areaScore(idx, 1)).toBeNull()
  })

  it('gives an empty snapshot a null score everywhere', () => {
    const empty = snapshot({ areas: AREAS(), goals: [] })
    const star = buildStar(empty, TODAY)
    expect(star.vertices.every((v) => v.score === null)).toBe(true)
    expect(buildToday(empty, TODAY).total).toBe(0)
    expect(buildTodos(empty, TODAY).items).toEqual([])
    expect(buildWeeklyStrip(empty, TODAY).every((b) => b.rate === null)).toBe(true)
  })
})
