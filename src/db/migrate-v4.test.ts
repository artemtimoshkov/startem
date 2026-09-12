/**
 * The v3 → v4 upgrade — SPEC.md §10, §12.
 *
 * v4 adds the outbox and repairs tasks stranded on an area that does not
 * exist. The repair is the part worth testing: an earlier build of the v2/v3
 * upgrades fell back to `area_id: 0` when a task's area could not be worked
 * out, and nothing is ever area 0. §6 drops a task whose area is missing, so
 * those rows sat on the device, intact and completely invisible — the failure
 * mode that looks exactly like data loss without being it.
 *
 * As with the v2 test, a genuine v3 database is built through raw IndexedDB
 * and Dexie is opened on top, so the upgrade runs for real.
 */
import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'

const NAME = 'startem'

/** The v3 schema, exactly as `StartemDB` declared it. */
function createV3(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 3)
    req.onupgradeneeded = () => {
      const db = req.result
      db.createObjectStore('areas', { keyPath: 'id' }).createIndex('position', 'position')
      const goals = db.createObjectStore('goals', { keyPath: 'id' })
      goals.createIndex('area_id', 'area_id')
      goals.createIndex('status', 'status')
      goals.createIndex('deleted', 'deleted')
      const subgoals = db.createObjectStore('subgoals', { keyPath: 'id' })
      subgoals.createIndex('area_id', 'area_id')
      subgoals.createIndex('archived', 'archived')
      subgoals.createIndex('deleted', 'deleted')
      const checkins = db.createObjectStore('checkins', { keyPath: ['subgoal_id', 'date'] })
      checkins.createIndex('subgoal_id', 'subgoal_id')
      checkins.createIndex('date', 'date')
      db.createObjectStore('freezes', { keyPath: 'id' }).createIndex('subgoal_id', 'subgoal_id')
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

const task = (id: number, area_id: number, title: string) => ({
  id,
  area_id,
  title,
  importance: 'medium',
  cadence_type: 'daily',
  interval: 1,
  days: [],
  monthly_day: null,
  month_weekday: null,
  month_ordinal: null,
  due_date: null,
  start_date: null,
  repeat_until: null,
  time: null,
  weight: null,
  created_at: '2026-01-04',
  archived: false,
  deleted: false,
})

/** A v3 store holding two healthy tasks and two stranded on area 0. */
async function seedV3(): Promise<void> {
  const db = await createV3()
  await put(db, 'meta', [
    { key: 'device_key', value: 7 },
    { key: 'id_counter', value: 40 },
  ])
  await put(db, 'areas', [
    { id: 3, name: 'Health', position: 0, deleted: false },
    { id: 4, name: 'Work', position: 1, deleted: false },
    { id: 9, name: 'Retired', position: 2, deleted: true },
  ])
  await put(db, 'subgoals', [
    task(101, 3, 'Gym'),
    task(102, 4, 'Deep work'),
    task(103, 0, 'Stranded'),
    task(104, 0, 'Also stranded'),
  ])
  await put(db, 'checkins', [
    { subgoal_id: 103, date: '2026-08-19', status: 'done', deleted: false },
  ])
  db.close()
}

let store: typeof import('./db')
let repo: typeof import('./repo')

beforeAll(async () => {
  await seedV3()
  store = await import('./db')
  repo = await import('./repo')
  await store.db.open()
})

describe('upgrading a v3 store', () => {
  it('re-homes tasks stranded on an area that does not exist', async () => {
    const rows = await store.db.subgoals.toArray()
    const byId = new Map(rows.map((r) => [r.id, r.area_id]))
    expect(byId.get(101)).toBe(3)
    expect(byId.get(102)).toBe(4)
    // Onto the lowest *live* area — 3, not the tombstoned 9.
    expect(byId.get(103)).toBe(3)
    expect(byId.get(104)).toBe(3)
  })

  it('makes the recovered tasks visible to the core again', async () => {
    const { buildIndex } = await import('../core')
    const idx = buildIndex(await repo.loadSnapshot(), '2026-08-26')
    const titles = idx.habitsByArea.get(3)?.map((t) => t.title).sort()
    expect(titles).toEqual(['Also stranded', 'Gym', 'Stranded'])
  })

  it('keeps the stranded task’s history intact', async () => {
    expect(await store.db.checkins.get([103, '2026-08-19'])).toMatchObject({ status: 'done' })
  })

  it('leaves a healthy task where it was', async () => {
    const { buildIndex } = await import('../core')
    const idx = buildIndex(await repo.loadSnapshot(), '2026-08-26')
    expect(idx.habitsByArea.get(4)?.map((t) => t.title)).toEqual(['Deep work'])
  })

  it('opens the outbox, empty — an upgrade is not a local edit to push', async () => {
    expect(await store.db.outbox.count()).toBe(0)
  })

  it('queues a row the moment one is actually written', async () => {
    await repo.setCheckin(101, '2026-08-26', 'done')
    const queued = await store.db.outbox.toArray()
    expect(queued.map((q) => q.key)).toEqual(['checkins:101|2026-08-26'])
  })
})
