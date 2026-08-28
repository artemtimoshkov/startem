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
import { DEVICE_KEY_META, db } from './db'
import {
  archiveTask,
  createGoal,
  deleteGoal,
  ensureSeeded,
  freezeGoal,
  importSnapshot,
  loadSnapshot,
  moveTask,
  renameArea,
  saveGoal,
  saveTask,
  setCheckin,
  toggleDone,
  toggleSkipped,
  unfreezeGoal,
  type TaskDraft,
} from './repo'

/** A task draft with everything filled in, so each test states only its point. */
function draft(over: Partial<TaskDraft> = {}): TaskDraft {
  return {
    area_id: 1,
    goal_id: null,
    title: 'Gym session',
    importance: 'medium',
    cadence_type: 'weekly',
    interval: 1,
    days: [2],
    monthly_day: null,
    month_weekday: null,
    month_ordinal: null,
    due_date: null,
    start_date: null,
    repeat_until: null,
    time: null,
    weight: null,
    ...over,
  }
}

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

  it('creates a heading — an area, a title, some prose, and nothing else', async () => {
    const id = await saveGoal(
      { area_id: 1, title: '  Reach 100 kg bench press ', description: 'Progressive overload.' },
      TODAY,
    )
    const goal = await db.goals.get(id)
    expect(goal?.title).toBe('Reach 100 kg bench press')
    expect(goal?.status).toBe('active')
    expect(goal?.created_at).toBe(TODAY)
    // Priority is the task's now; a goal must not carry one at all (§3).
    expect('importance' in (goal as object)).toBe(false)
  })

  it('keeps created_at and status when editing an existing goal', async () => {
    const id = await saveGoal({ area_id: 1, title: 'X', description: '' }, '2026-01-01')
    await freezeGoal(id, '2026-06-01')
    await saveGoal({ id, area_id: 2, title: 'X renamed', description: 'd' }, TODAY)
    const goal = await db.goals.get(id)
    expect(goal?.created_at).toBe('2026-01-01')
    expect(goal?.status).toBe('frozen')
    expect(goal?.area_id).toBe(2)
  })

  it('creates one from the composer with a title alone', async () => {
    const id = await createGoal(2, 'Learn to sail', TODAY)
    expect(await db.goals.get(id)).toMatchObject({ area_id: 2, title: 'Learn to sail' })
  })
})

describe('saving a task', () => {
  beforeEach(ensureSeeded)

  it('attaches to an area with no goal at all', async () => {
    const id = await saveTask(draft({ area_id: 3, goal_id: null, title: 'Call the bank' }), TODAY)
    const task = await db.subgoals.get(id)
    expect(task).toMatchObject({ area_id: 3, goal_id: null, archived: false })
    expect(task?.created_at).toBe(TODAY)
    // It scores against its area even though nothing groups it.
    expect(buildIndex(await loadSnapshot(), TODAY).subgoalsByArea.get(3)?.map((t) => t.id)).toEqual([id])
  })

  it('carries its own priority, so two tasks under one goal differ', async () => {
    const goalId = await createGoal(1, 'Fitness', TODAY)
    const heavy = await saveTask(draft({ goal_id: goalId, importance: 'high' }), TODAY)
    const light = await saveTask(draft({ goal_id: goalId, importance: 'low', title: 'Stretch' }), TODAY)
    expect((await db.subgoals.get(heavy))?.importance).toBe('high')
    expect((await db.subgoals.get(light))?.importance).toBe('low')
  })

  it('clamps a fixed monthly day to 28 on write', async () => {
    const id = await saveTask(
      draft({ cadence_type: 'monthly', days: [], monthly_day: 31 }),
      TODAY,
    )
    expect((await db.subgoals.get(id))?.monthly_day).toBe(28)
  })

  it('keeps a custom repeat: every 4 weeks, ending on a date', async () => {
    const id = await saveTask(
      draft({
        cadence_type: 'weekly',
        interval: 4,
        days: [3],
        start_date: '2026-08-27',
        repeat_until: '2026-12-31',
      }),
      TODAY,
    )
    expect(await db.subgoals.get(id)).toMatchObject({
      interval: 4,
      start_date: '2026-08-27',
      repeat_until: '2026-12-31',
    })
  })

  it('keeps a time of day as a bare HH:MM, never a timestamp', async () => {
    const id = await saveTask(draft({ time: '07:30' }), TODAY)
    expect((await db.subgoals.get(id))?.time).toBe('07:30')
    const junk = await saveTask(draft({ time: 'half seven' as string }), TODAY)
    expect((await db.subgoals.get(junk))?.time).toBeNull()
  })

  it('never rewrites created_at on an edit', async () => {
    const id = await saveTask(draft(), '2026-01-01')
    await saveTask(draft({ id, title: 'Renamed' }), TODAY)
    const task = await db.subgoals.get(id)
    expect(task?.created_at).toBe('2026-01-01')
    expect(task?.title).toBe('Renamed')
  })

  it('archives rather than deletes, keeping the check-ins that describe real days', async () => {
    const id = await saveTask(draft(), '2026-01-01')
    await setCheckin(id, '2026-08-19', 'done')
    await archiveTask(id)
    expect(await db.subgoals.get(id)).toMatchObject({ archived: true, deleted: false })
    expect(await db.checkins.get([id, '2026-08-19'])).toBeDefined()
    // Gone from the interface, still in the history.
    expect(buildIndex(await loadSnapshot(), TODAY).subgoalById.has(id)).toBe(false)
  })

  it('moves between areas and on and off a goal', async () => {
    const goalId = await createGoal(2, 'Ship v2', TODAY)
    const id = await saveTask(draft(), TODAY)
    await moveTask(id, 2, goalId)
    expect(await db.subgoals.get(id)).toMatchObject({ area_id: 2, goal_id: goalId })
    await moveTask(id, 2, null)
    expect((await db.subgoals.get(id))?.goal_id).toBeNull()
  })
})

describe('freezing', () => {
  let goalId = 0
  beforeEach(async () => {
    await ensureSeeded()
    goalId = await saveGoal({ area_id: 1, title: 'Call parents', description: '' }, '2026-01-01')
    await saveTask(draft({ goal_id: goalId, title: 'Sunday call', days: [6] }), '2026-01-01')
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
  it('tombstones the heading and its periods, and detaches the work under it', async () => {
    await ensureSeeded()
    const goalId = await saveGoal({ area_id: 1, title: 'Doomed', description: '' }, '2026-01-01')
    const taskId = await saveTask(draft({ goal_id: goalId, title: 'Thing' }), '2026-01-01')
    await setCheckin(taskId, '2026-08-19', 'done')
    await freezeGoal(goalId, '2026-03-01')

    await deleteGoal(goalId)

    // The heading goes as a tombstone, so the removal can propagate (§10).
    expect(await db.goals.get(goalId)).toMatchObject({ deleted: true })
    expect((await db.freezes.where('goal_id').equals(goalId).toArray())[0]).toMatchObject({
      deleted: true,
    })

    // The task survives, on the area it was already scoring against, with its
    // history intact: deleting a heading must not delete the work under it.
    const task = await db.subgoals.get(taskId)
    expect(task).toMatchObject({ deleted: false, archived: false, goal_id: null, area_id: 1 })
    expect(await db.checkins.get([taskId, '2026-08-19'])).toMatchObject({ status: 'done' })

    const idx = buildIndex(await loadSnapshot(), TODAY)
    expect(idx.goalById.has(goalId)).toBe(false)
    expect(idx.subgoalById.has(taskId)).toBe(true)
    expect(buildToday(await loadSnapshot(), TODAY).items.map((i) => i.goalTitle)).toEqual([null])
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

describe('the snapshot importer — the sample loader\'s engine', () => {
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
    await saveGoal({ area_id: 1, title: 'Old', description: '' }, TODAY)
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

  it('round-trips through a dump of the store', async () => {
    await importSnapshot(exported, TODAY)
    const dumped = await loadSnapshot()
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

describe('id allocation', () => {
  beforeEach(ensureSeeded)

  const mint = () => saveGoal({ area_id: 1, title: 'g', description: '' }, TODAY)

  it('never repeats an id on one device', async () => {
    const ids = new Set<number>()
    for (let i = 0; i < 40; i++) ids.add(await mint())
    expect(ids.size).toBe(40)
  })

  it('carries a stable device key in the high bits of every id', async () => {
    const a = await mint()
    const b = await mint()
    const SPACE = 2 ** 20
    expect(Math.floor(a / SPACE)).toBe(Math.floor(b / SPACE))
    expect(Math.floor(a / SPACE)).toBeGreaterThanOrEqual(1)
    expect((await db.meta.get(DEVICE_KEY_META))?.value).toBe(Math.floor(a / SPACE))
  })

  it('stays exact in a JS number and inside a Postgres bigint', async () => {
    const id = await mint()
    expect(Number.isSafeInteger(id)).toBe(true)
    expect(id).toBeLessThan(2 ** 40)
  })

  it('gives two devices disjoint id ranges', async () => {
    // Two installs = two device keys. Simulate the second by swapping the key.
    const first = await mint()
    const firstKey = Math.floor(first / 2 ** 20)
    await db.meta.put({ key: DEVICE_KEY_META, value: firstKey === 1 ? 2 : firstKey - 1 })
    await db.meta.delete('id_counter')
    const second = await mint()
    expect(Math.floor(second / 2 ** 20)).not.toBe(firstKey)
    expect(second).not.toBe(first)
  })

  it('does not re-mint ids that a reload brought back from this device', async () => {
    const goalId = await mint()
    const dumped = await loadSnapshot()
    await importSnapshot(dumped, TODAY)
    const next = await mint()
    expect(next).not.toBe(goalId)
    expect(await db.goals.get(goalId)).toBeDefined()
  })

  it('leaves small imported ids alone — device keys start at 1', async () => {
    await importSnapshot(
      { areas: [{ id: 3, name: 'Work', position: 2 }], goals: [{ id: 41, area_id: 3, title: 'x' }] },
      TODAY,
    )
    const minted = await saveGoal({ area_id: 3, title: 'new', description: '' }, TODAY)
    expect(minted).toBeGreaterThan(2 ** 20)
    expect(await db.goals.get(41)).toBeDefined()
  })
})
