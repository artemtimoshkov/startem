/**
 * The v2 → v3 upgrade — SPEC.md §3, §12.
 *
 * The phone already holds a store in the old three-tier shape, so this is not
 * a hypothetical path: it is the one every existing install takes exactly
 * once, offline, with no way to retry if it drops something. The three things
 * it must not lose are each checked here.
 *
 * It builds a genuine v2 database through raw IndexedDB first, then opens
 * Dexie on top of it, so the upgrade runs for real rather than against a
 * hand-written fixture of what v2 was assumed to look like.
 */
import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'

const NAME = 'startem'

/** The v2 schema, exactly as `StartemDB` declared it. */
function createV2(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 2)
    req.onupgradeneeded = () => {
      const db = req.result
      db.createObjectStore('areas', { keyPath: 'id' }).createIndex('position', 'position')
      const goals = db.createObjectStore('goals', { keyPath: 'id' })
      goals.createIndex('area_id', 'area_id')
      goals.createIndex('status', 'status')
      goals.createIndex('deleted', 'deleted')
      const subgoals = db.createObjectStore('subgoals', { keyPath: 'id' })
      subgoals.createIndex('area_id', 'area_id')
      subgoals.createIndex('goal_id', 'goal_id')
      subgoals.createIndex('archived', 'archived')
      subgoals.createIndex('deleted', 'deleted')
      const checkins = db.createObjectStore('checkins', { keyPath: ['subgoal_id', 'date'] })
      checkins.createIndex('subgoal_id', 'subgoal_id')
      checkins.createIndex('date', 'date')
      db.createObjectStore('freezes', { keyPath: 'id' }).createIndex('goal_id', 'goal_id')
      db.createObjectStore('meta', { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function put(db: IDBDatabase, store: string, rows: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    for (const row of rows) tx.objectStore(store).put(row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

const DEVICE_KEY = 7
const COUNTER_SPACE = 2 ** 20

/** A live v2 store: two areas, a frozen goal with two tasks, and a history. */
async function seedV2(): Promise<void> {
  const db = await createV2()
  await put(db, 'meta', [
    { key: 'device_key', value: DEVICE_KEY },
    { key: 'id_counter', value: 40 },
  ])
  await put(db, 'areas', [
    { id: 1, name: 'Health', position: 0 },
    { id: 2, name: 'Work', position: 1 },
  ])
  await put(db, 'goals', [
    { id: 41, area_id: 1, title: 'Bench 100 kg', description: '', status: 'active', created_at: '2026-01-04' },
    { id: 42, area_id: 1, title: 'Sleep well', description: '', status: 'frozen', created_at: '2026-01-04' },
    { id: 43, area_id: 2, title: 'Ship v2', description: '', status: 'active', created_at: '2026-01-04' },
  ])
  await put(db, 'subgoals', [
    // Under the live goal, and carrying no area of its own — the shape a row
    // written before v2 has.
    { id: 101, goal_id: 41, title: 'Gym', importance: 'high', cadence_type: 'weekly', days: [2], created_at: '2026-01-04', archived: false },
    // Two under the frozen goal: its one period has to reach both.
    { id: 102, goal_id: 42, area_id: 1, title: 'Lights out', importance: 'medium', cadence_type: 'daily', days: [], created_at: '2026-01-04', archived: false },
    { id: 103, goal_id: 42, area_id: 1, title: 'No screens', importance: 'low', cadence_type: 'daily', days: [], created_at: '2026-01-04', archived: false },
    // Already goal-less: the v2 shape for a task hung straight off an area.
    { id: 104, goal_id: null, area_id: 2, title: 'Deep work', importance: 'high', cadence_type: 'weekly', days: [2], created_at: '2026-01-04', archived: false },
  ])
  await put(db, 'checkins', [{ subgoal_id: 101, date: '2026-08-19', status: 'done' }])
  await put(db, 'freezes', [{ id: 7, goal_id: 42, start_date: '2026-06-01', end_date: null }])
  db.close()
}

let store: typeof import('./db')
let repo: typeof import('./repo')

beforeAll(async () => {
  await seedV2()
  store = await import('./db')
  repo = await import('./repo')
  await store.db.open()
})

describe('upgrading a v2 store', () => {
  it('gives every task the area it was already scoring against', async () => {
    const rows = await store.db.subgoals.toArray()
    expect(rows.map((r) => [r.id, r.area_id]).sort()).toEqual([
      [101, 1], // taken from goal 41, which its own row never carried
      [102, 1],
      [103, 1],
      [104, 2],
    ])
  })

  it('drops goal_id from the row entirely, rather than leaving it to rot', async () => {
    for (const row of await store.db.subgoals.toArray()) {
      expect('goal_id' in (row as object)).toBe(false)
    }
  })

  it('keeps every check-in, keyed as before', async () => {
    expect(await store.db.checkins.get([101, '2026-08-19'])).toMatchObject({ status: 'done' })
  })

  /**
   * The one that actually loses data if it is got wrong. A frozen goal's
   * period is what stops its dormant weeks reading as misses; dropping it
   * would back-fill three months of failure onto a habit that was
   * deliberately paused (§3).
   */
  it("re-points a frozen goal's period onto each habit it was pausing", async () => {
    const periods = await store.db.freezes.toArray()
    expect(periods.map((p) => p.subgoal_id).sort()).toEqual([102, 103])
    for (const p of periods) {
      expect(p).toMatchObject({ start_date: '2026-06-01', end_date: null })
      expect('goal_id' in (p as object)).toBe(false)
    }
    // The first keeps the id it already had, so a device that synced it once
    // does not see a delete and an insert (§10).
    expect(periods.map((p) => p.id)).toContain(7)
  })

  it('mints the extra period id from this device, past the counter', async () => {
    const periods = await store.db.freezes.toArray()
    const minted = periods.find((p) => p.id !== 7)!
    expect(Math.floor(minted.id / COUNTER_SPACE)).toBe(DEVICE_KEY)
    expect(minted.id % COUNTER_SPACE).toBeGreaterThan(40)
    // And the counter moved with it, so the next id does not collide.
    const next = await repo.saveGoal({ area_id: 1, title: 'After', description: '' }, '2026-08-26')
    expect(next).toBeGreaterThan(minted.id)
  })

  it('brings a frozen goal back as active — the state no longer exists', async () => {
    const goals = await store.db.goals.toArray()
    expect(goals.every((g) => g.status === 'active')).toBe(true)
    expect(goals.every((g) => g.achieved_on === null)).toBe(true)
    expect(goals.every((g) => typeof g.position === 'number')).toBe(true)
  })

  it('leaves the upgraded store readable by the pure core', async () => {
    const { buildIndex, buildToday, isPaused } = await import('../core')
    const snapshot = await repo.loadSnapshot()
    const idx = buildIndex(snapshot, '2026-08-26')

    expect(idx.habitsByArea.get(1)?.map((t) => t.title).sort()).toEqual([
      'Gym',
      'Lights out',
      'No screens',
    ])
    // The pause survived the move, so neither nightly habit is owed today.
    expect(isPaused(idx, idx.subgoalById.get(102)!)).toBe(true)
    expect(buildToday(snapshot, '2026-08-26').items.map((i) => i.title).sort()).toEqual([
      'Deep work',
      'Gym',
    ])
  })
})
