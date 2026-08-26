/**
 * The store's own invariants — SPEC.md §3, §7, §9.
 *
 * These run against `fake-indexeddb`, so `npm test` covers the boundary where
 * "archive, never delete" and the tombstones actually get written, rather than
 * trusting the UI to have done it.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildIndex, buildToday, isFrozenOn } from '../core'
import { db } from './db'
import {
  deleteGoal,
  ensureSeeded,
  exportSnapshot,
  freezeGoal,
  importSnapshot,
  loadSnapshot,
  renameArea,
  saveGoal,
  setCheckin,
  toggleDone,
  toggleSkipped,
  unfreezeGoal,
} from './repo'

const TODAY = '2026-08-26' // a Wednesday

async function wipe() {
  await Promise.all([
    db.areas.clear(),
    db.goals.clear(),
    db.subgoals.clear(),
    db.checkins.clear(),
    db.freezes.clear(),
    db.meta.clear(),
  ])
}

beforeEach(async () => {
  await db.open()
  await wipe()
})

describe('a fresh install', () => {
  it('seeds the ten default areas exactly once', async () => {
    await ensureSeeded()
    await ensureSeeded()
    const areas = await db.areas.toArray()
    expect(areas).toHaveLength(10)
    expect(areas.map((a) => a.name)).toContain('Health')
    expect(areas.map((a) => a.position).sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ])
  })
})

describe('check-ins', () => {
  it('keys on (subgoal_id, date), so a day cannot be double-logged', async () => {
    await setCheckin(1, TODAY, 'done')
    await setCheckin(1, TODAY, 'skipped')
    const rows = await db.checkins.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('skipped')
  })

  it('ticks, then clears back to unresolved on a second tick', async () => {
    await toggleDone(1, TODAY, null)
    expect((await db.checkins.get([1, TODAY]))?.status).toBe('done')
    await toggleDone(1, TODAY, 'done')
    expect(await db.checkins.get([1, TODAY])).toBeUndefined()
  })

  it('crosses out, and restores to pending', async () => {
    await toggleSkipped(1, TODAY, null)
    expect((await db.checkins.get([1, TODAY]))?.status).toBe('skipped')
    await toggleSkipped(1, TODAY, 'skipped')
    expect(await db.checkins.get([1, TODAY])).toBeUndefined()
  })

  it('switches straight from crossed out to ticked', async () => {
    await toggleSkipped(1, TODAY, null)
    await toggleDone(1, TODAY, 'skipped')
    expect((await db.checkins.get([1, TODAY]))?.status).toBe('done')
  })

  it('stamps updated_at, so §10 has something to order writes by', async () => {
    await setCheckin(1, TODAY, 'done')
    expect((await db.checkins.get([1, TODAY]))?.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('saving a goal', () => {
  beforeEach(ensureSeeded)

  it('creates the goal and its actions in one go', async () => {
    const id = await saveGoal(
      {
        area_id: 1,
        title: 'Reach 100 kg bench press',
        description: 'Progressive overload.',
        importance: 'high',
        actions: [
          {
            title: 'Gym session',
            cadence_type: 'weekly',
            days: [0, 2, 5],
            monthly_day: null,
            month_weekday: null,
            month_ordinal: null,
            due_date: null,
            weight: null,
          },
        ],
      },
      TODAY,
    )
    const goal = await db.goals.get(id)
    expect(goal?.title).toBe('Reach 100 kg bench press')
    expect(goal?.status).toBe('active')
    expect(goal?.created_at).toBe(TODAY)
    const actions = await db.subgoals.where('goal_id').equals(id).toArray()
    expect(actions).toHaveLength(1)
    expect(actions[0]!.days).toEqual([0, 2, 5])
  })

  it('clamps a fixed monthly day to 28 on write', async () => {
    const id = await saveGoal(
      {
        area_id: 1,
        title: 'Finances',
        description: '',
        importance: 'low',
        actions: [
          {
            title: 'Reconcile',
            cadence_type: 'monthly',
            days: [],
            monthly_day: 31,
            month_weekday: null,
            month_ordinal: null,
            due_date: null,
            weight: null,
          },
        ],
      },
      TODAY,
    )
    const action = (await db.subgoals.where('goal_id').equals(id).toArray())[0]!
    expect(action.monthly_day).toBe(28)
  })

  it('archives a removed action rather than deleting it, keeping its history', async () => {
    const id = await saveGoal(
      {
        area_id: 1,
        title: 'Fitness',
        description: '',
        importance: 'medium',
        actions: [
          { title: 'A', cadence_type: 'weekly', days: [2], monthly_day: null, month_weekday: null, month_ordinal: null, due_date: null, weight: null },
          { title: 'B', cadence_type: 'weekly', days: [2], monthly_day: null, month_weekday: null, month_ordinal: null, due_date: null, weight: null },
        ],
      },
      TODAY,
    )
    const [a, b] = await db.subgoals.where('goal_id').equals(id).sortBy('id')
    await setCheckin(b!.id, '2026-08-19', 'done')

    // Save again with only A listed.
    await saveGoal(
      {
        id,
        area_id: 1,
        title: 'Fitness',
        description: '',
        importance: 'medium',
        actions: [{ id: a!.id, title: 'A', cadence_type: 'weekly', days: [2], monthly_day: null, month_weekday: null, month_ordinal: null, due_date: null, weight: null }],
      },
      TODAY,
    )

    const rows = await db.subgoals.where('goal_id').equals(id).sortBy('id')
    expect(rows).toHaveLength(2) // nothing was removed
    expect(rows.find((r) => r.id === b!.id)?.archived).toBe(true)
    expect(rows.find((r) => r.id === b!.id)?.deleted).toBe(false)
    // Its check-in still exists and still describes a real day.
    expect(await db.checkins.get([b!.id, '2026-08-19'])).toBeDefined()
  })

  it('keeps created_at and status when editing an existing goal', async () => {
    const id = await saveGoal(
      { area_id: 1, title: 'X', description: '', importance: 'low', actions: [] },
      '2026-01-01',
    )
    await freezeGoal(id, '2026-06-01')
    await saveGoal(
      { id, area_id: 2, title: 'X renamed', description: 'd', importance: 'high', actions: [] },
      TODAY,
    )
    const goal = await db.goals.get(id)
    expect(goal?.created_at).toBe('2026-01-01')
    expect(goal?.status).toBe('frozen')
    expect(goal?.area_id).toBe(2)
    expect(goal?.importance).toBe('high')
  })
})

describe('freezing', () => {
  let goalId = 0
  beforeEach(async () => {
    await ensureSeeded()
    goalId = await saveGoal(
      {
        area_id: 1,
        title: 'Call parents',
        description: '',
        importance: 'medium',
        actions: [
          { title: 'Sunday call', cadence_type: 'weekly', days: [6], monthly_day: null, month_weekday: null, month_ordinal: null, due_date: null, weight: null },
        ],
      },
      '2026-01-01',
    )
  })

  it('opens a period and flips status', async () => {
    await freezeGoal(goalId, '2026-06-01')
    expect((await db.goals.get(goalId))?.status).toBe('frozen')
    const periods = await db.freezes.where('goal_id').equals(goalId).toArray()
    expect(periods).toHaveLength(1)
    expect(periods[0]).toMatchObject({ start_date: '2026-06-01', end_date: null })
  })

  it('does not open a second period while one is open', async () => {
    await freezeGoal(goalId, '2026-06-01')
    await freezeGoal(goalId, '2026-07-01')
    expect(await db.freezes.where('goal_id').equals(goalId).count()).toBe(1)
  })

  it('closes with an exclusive end date, so that day is live again', async () => {
    await freezeGoal(goalId, '2026-06-01')
    await unfreezeGoal(goalId, '2026-08-10')
    const period = (await db.freezes.where('goal_id').equals(goalId).toArray())[0]!
    expect(period.end_date).toBe('2026-08-10')
    expect(isFrozenOn('2026-08-09', [period])).toBe(true)
    expect(isFrozenOn('2026-08-10', [period])).toBe(false)
    expect((await db.goals.get(goalId))?.status).toBe('active')
  })

  it('discards a period that covers no days at all', async () => {
    await freezeGoal(goalId, TODAY)
    await unfreezeGoal(goalId, TODAY)
    const periods = await db.freezes.where('goal_id').equals(goalId).toArray()
    expect(periods.every((p) => p.deleted)).toBe(true)
    const snapshot = await loadSnapshot()
    expect(isFrozenOn(TODAY, snapshot.freezes.filter((f) => !f.deleted))).toBe(false)
  })

  it('keeps the frozen goal out of the todo list, then restores it', async () => {
    const sunday = '2026-08-30'
    expect(buildToday(await loadSnapshot(), sunday).total).toBe(1)
    await freezeGoal(goalId, '2026-08-01')
    expect(buildToday(await loadSnapshot(), sunday).total).toBe(0)
    await unfreezeGoal(goalId, '2026-08-25')
    expect(buildToday(await loadSnapshot(), sunday).total).toBe(1)
  })
})

describe('deleting a goal', () => {
  it('tombstones the goal, its actions, their check-ins and its periods', async () => {
    await ensureSeeded()
    const goalId = await saveGoal(
      {
        area_id: 1,
        title: 'Doomed',
        description: '',
        importance: 'medium',
        actions: [
          { title: 'Thing', cadence_type: 'weekly', days: [2], monthly_day: null, month_weekday: null, month_ordinal: null, due_date: null, weight: null },
        ],
      },
      '2026-01-01',
    )
    const action = (await db.subgoals.where('goal_id').equals(goalId).toArray())[0]!
    await setCheckin(action.id, '2026-08-19', 'done')
    await freezeGoal(goalId, '2026-03-01')

    await deleteGoal(goalId)

    // Nothing is hard deleted — a delete has to be able to propagate (§10).
    expect(await db.goals.get(goalId)).toMatchObject({ deleted: true })
    expect(await db.subgoals.get(action.id)).toMatchObject({ deleted: true })
    expect(await db.checkins.get([action.id, '2026-08-19'])).toMatchObject({ deleted: true })
    expect((await db.freezes.where('goal_id').equals(goalId).toArray())[0]).toMatchObject({
      deleted: true,
    })

    // And the pure core treats every one of them as absent.
    const idx = buildIndex(await loadSnapshot(), TODAY)
    expect(idx.goalById.has(goalId)).toBe(false)
    expect(idx.subgoalById.has(action.id)).toBe(false)
    expect(buildToday(await loadSnapshot(), TODAY).total).toBe(0)
  })
})

describe('areas', () => {
  it('renames, and refuses to blank a name', async () => {
    await ensureSeeded()
    await renameArea(1, '  Fitness  ')
    expect((await db.areas.get(1))?.name).toBe('Fitness')
    await renameArea(1, '   ')
    expect((await db.areas.get(1))?.name).toBe('Fitness')
  })
})

describe('the migration import', () => {
  const exported = {
    areas: [{ id: 3, name: 'Work', position: 2 }],
    goals: [
      { id: 41, area_id: 3, title: 'Ship v2', importance: 'high', created_at: '2026-01-04' },
    ],
    subgoals: [
      {
        id: 108,
        goal_id: 41,
        title: 'Month-end review',
        cadence_type: 'monthly',
        monthly_day: 31,
        created_at: '2026-01-04',
      },
    ],
    checkins: [{ subgoal_id: 108, date: '2026-07-28', status: 'done' }],
    freezes: [{ id: 2, goal_id: 41, start_date: '2026-05-01', end_date: '2026-06-01' }],
  }

  it('preserves every id, because the tables reference each other by id', async () => {
    const result = await importSnapshot(exported, TODAY)
    expect(result).toEqual({ areas: 1, goals: 1, subgoals: 1, checkins: 1, freezes: 1 })
    expect((await db.goals.toArray()).map((g) => g.id)).toEqual([41])
    expect((await db.subgoals.toArray()).map((s) => s.id)).toEqual([108])
    expect((await db.subgoals.get(108))?.goal_id).toBe(41)
    expect((await db.checkins.toArray())[0]?.subgoal_id).toBe(108)
    expect((await db.freezes.get(2))?.goal_id).toBe(41)
  })

  it('repairs an out-of-range monthly day on the way in', async () => {
    await importSnapshot(exported, TODAY)
    expect((await db.subgoals.get(108))?.monthly_day).toBe(28)
  })

  it('replaces whatever was there before', async () => {
    await ensureSeeded()
    await saveGoal({ area_id: 1, title: 'Old', description: '', importance: 'low', actions: [] }, TODAY)
    await importSnapshot(exported, TODAY)
    expect((await db.goals.toArray()).map((g) => g.title)).toEqual(['Ship v2'])
    expect(await db.areas.count()).toBe(1)
  })

  it('falls back to the default areas when the export has none', async () => {
    await importSnapshot({ goals: [], subgoals: [] }, TODAY)
    expect(await db.areas.count()).toBe(10)
  })

  it('does not choke on junk', async () => {
    await expect(importSnapshot(null, TODAY)).resolves.toMatchObject({ goals: 0 })
    await expect(
      importSnapshot({ areas: [null, 'nope', { id: 5, name: 'Kept' }] }, TODAY),
    ).resolves.toMatchObject({ areas: 1 })
  })

  it('round-trips through the export', async () => {
    await importSnapshot(exported, TODAY)
    const dumped = await exportSnapshot()
    await importSnapshot(dumped, TODAY)
    expect((await db.goals.toArray()).map((g) => g.id)).toEqual([41])
    expect((await db.subgoals.get(108))?.monthly_day).toBe(28)
    expect(await db.checkins.count()).toBe(1)
  })

  it('leaves the store readable by the pure core, with ids intact', async () => {
    await importSnapshot(exported, TODAY)
    const idx = buildIndex(await loadSnapshot(), TODAY)
    expect(idx.goalById.get(41)?.title).toBe('Ship v2')
    expect(idx.subgoalsByGoal.get(41)?.map((s) => s.id)).toEqual([108])
  })
})
