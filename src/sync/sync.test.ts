/**
 * The sync loop's merge rules — SPEC.md §10.
 *
 * These run against a fake Supabase holding rows in memory, so the actual
 * push/pull code is exercised rather than a description of it. What is being
 * checked is the part that loses data when it is wrong: which side wins, what
 * a tombstone does on arrival, and whether a fresh install can overwrite a
 * real account with the ten areas it seeded four seconds ago.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const USER = '00000000-0000-4000-8000-000000000001'

/** Rows the fake cloud holds, keyed by table. */
let cloud: Record<string, Record<string, unknown>[]>

function keyOf(table: string, row: Record<string, unknown>): string {
  return table === 'checkins' ? `${row['subgoal_id']}|${row['date']}` : String(row['id'])
}

const from = (table: string) => ({
  upsert(rows: Record<string, unknown>[]) {
    const bucket = (cloud[table] ??= [])
    for (const row of rows) {
      const i = bucket.findIndex((r) => keyOf(table, r) === keyOf(table, row))
      if (i >= 0) bucket[i] = { ...row }
      else bucket.push({ ...row })
    }
    return Promise.resolve({ error: null })
  },
  select() {
    let since = ''
    const chain = {
      gt(_col: string, value: string) {
        since = value
        return chain
      },
      order() {
        return chain
      },
      range(lo: number, hi: number) {
        const rows = (cloud[table] ?? [])
          .filter((r) => Date.parse(String(r['updated_at'])) > Date.parse(since))
          .sort((a, b) => Date.parse(String(a['updated_at'])) - Date.parse(String(b['updated_at'])))
        return Promise.resolve({ data: rows.slice(lo, hi + 1), error: null })
      },
    }
    return chain
  },
})

vi.mock('./client', () => ({
  supabase: { from: (t: string) => from(t) },
  isCloudConfigured: () => true,
}))

vi.mock('./session', () => ({
  currentSession: () => Promise.resolve({ user: { id: USER, email: 'a@b.c' } }),
  onSessionChange: () => () => {},
}))

const { db } = await import('../db/db')
const repo = await import('../db/repo')
const { runSync } = await import('./sync')

const TODAY = '2026-08-26'

async function wipe() {
  await Promise.all([
    db.areas.clear(),
    db.goals.clear(),
    db.subgoals.clear(),
    db.checkins.clear(),
    db.freezes.clear(),
    db.meta.clear(),
    db.outbox.clear(),
  ])
}

function task(over: Record<string, unknown> = {}) {
  return {
    area_id: 1,
    title: 'Gym',
    importance: 'medium' as const,
    cadence_type: 'daily' as const,
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
    ...over,
  }
}

beforeEach(async () => {
  cloud = {}
  await db.open()
  await wipe()
})

describe('push', () => {
  it('sends queued rows and empties the queue', async () => {
    await repo.ensureSeeded()
    const id = await repo.saveTask(task(), TODAY)
    expect(await db.outbox.count()).toBeGreaterThan(0)

    await runSync()

    expect(await db.outbox.count()).toBe(0)
    expect(cloud['subgoals']?.map((r) => r['id'])).toEqual([id])
    expect(cloud['areas']).toHaveLength(10)
  })

  it('stamps every row with the signed-in user', async () => {
    await repo.ensureSeeded()
    await repo.saveTask(task(), TODAY)
    await runSync()
    for (const rows of Object.values(cloud)) {
      for (const row of rows) expect(row['user_id']).toBe(USER)
    }
  })

  it('sends an untick as a tombstone, not as an absence', async () => {
    await repo.ensureSeeded()
    const id = await repo.saveTask(task(), TODAY)
    await repo.setCheckin(id, TODAY, 'done')
    await runSync()
    expect(cloud['checkins']?.[0]).toMatchObject({ status: 'done', deleted: false })

    await repo.setCheckin(id, TODAY, null)
    await runSync()
    // The row is still there and still says which day it was — that is the
    // only thing that can carry the clearing to the other device.
    expect(cloud['checkins']).toHaveLength(1)
    expect(cloud['checkins']?.[0]).toMatchObject({ deleted: true })
  })

  it('keeps the queue intact when the network fails mid-push', async () => {
    await repo.ensureSeeded()
    await repo.saveTask(task(), TODAY)
    const before = await db.outbox.count()

    const boom = vi.spyOn(await import('./client'), 'supabase', 'get')
    boom.mockReturnValue({
      from: () => ({ upsert: () => Promise.resolve({ error: { message: 'offline' } }) }),
    } as never)

    await expect(runSync()).rejects.toThrow(/offline/)
    // Nothing was cleared: an offline edit that disappears is the one failure
    // this whole design exists to prevent.
    expect(await db.outbox.count()).toBe(before)
    boom.mockRestore()
  })
})

describe('pull, last-write-wins', () => {
  beforeEach(async () => {
    await repo.ensureSeeded()
    // Twice: the first run on a pristine device adopts the (empty) account and
    // deliberately pushes nothing, so the seeded areas go up on the second.
    await runSync()
    await runSync()
    await db.outbox.clear()
  })

  it('takes the remote row when it is newer', async () => {
    cloud['areas']![0] = {
      ...cloud['areas']![0],
      name: 'Renamed elsewhere',
      updated_at: '2099-01-01T00:00:00.000Z',
    }
    await runSync()
    expect((await db.areas.get(1))?.name).toBe('Renamed elsewhere')
  })

  it('keeps the local row when it is newer', async () => {
    await repo.renameArea(1, 'Renamed here')
    // Dropped from the queue so the merge itself is what decides this, rather
    // than the push simply overwriting the remote row on the way past.
    await db.outbox.clear()
    cloud['areas']![0] = {
      ...cloud['areas']![0],
      name: 'Stale',
      updated_at: '2000-01-01T00:00:00.000Z',
    }
    await runSync()
    expect((await db.areas.get(1))?.name).toBe('Renamed here')
  })

  it('compares timestamps as instants, so an offset cannot outrank a newer row', async () => {
    // The two sides format timestamps differently: `toISOString()` always
    // writes UTC with a `Z`, while Postgres writes an offset — and that offset
    // is not always `+00:00`. Sorted as text, an offset row reads as whatever
    // its local wall clock says, so this remote row (23:41 UTC) sorts *above* a
    // local one written 49 minutes later (00:30 UTC) and would win a
    // string comparison outright, taking a newer edit with it.
    const area = (await db.areas.get(1))!
    await db.areas.put({ ...area, name: 'Local', updated_at: '2026-09-13T00:30:00.000Z' })
    await db.outbox.clear()

    const remoteStamp = '2026-09-13T01:41:00+02:00'
    expect(remoteStamp > '2026-09-13T00:30:00.000Z').toBe(true) // as text
    expect(Date.parse(remoteStamp) < Date.parse('2026-09-13T00:30:00.000Z')).toBe(true) // in fact

    cloud['areas']![0] = { ...cloud['areas']![0], name: 'Remote', updated_at: remoteStamp }
    await runSync()
    expect((await db.areas.get(1))?.name).toBe('Local')
  })

  it('applies an incoming tombstone so the core stops seeing the row', async () => {
    const id = await repo.saveTask(task({ title: 'Gym' }), TODAY)
    await repo.setCheckin(id, TODAY, 'done')
    await runSync()

    // The other device unticks it.
    cloud['checkins']![0] = {
      ...cloud['checkins']![0],
      deleted: true,
      updated_at: '2099-01-01T00:00:00.000Z',
    }
    await runSync()

    const { buildIndex } = await import('../core')
    const idx = buildIndex(await repo.loadSnapshot(), TODAY)
    expect(idx.checkinsBySubgoal.get(id)?.get(TODAY)).toBeUndefined()
  })

  it('does not re-queue what it pulls', async () => {
    cloud['areas']![0] = {
      ...cloud['areas']![0],
      name: 'From the laptop',
      updated_at: '2099-01-01T00:00:00.000Z',
    }
    await runSync()
    // A pulled row that re-entered the outbox would be pushed straight back,
    // and the two devices would trade it forever.
    expect(await db.outbox.count()).toBe(0)
  })

  it('advances its watermark to the newest row it has seen', async () => {
    cloud['areas']![0] = {
      ...cloud['areas']![0],
      name: 'Newer',
      updated_at: '2030-05-05T10:00:00.000Z',
    }
    await runSync()
    const mark = await db.meta.get('last_pulled_at')
    expect(mark?.value).toBe('2030-05-05T10:00:00.000Z')
  })

  it('re-reads a window either side of the watermark, so nothing slips through', async () => {
    await runSync()
    const mark = (await db.meta.get('last_pulled_at'))!.value as string
    // A row written a few seconds *before* the watermark — the gap a bare
    // `updated_at > watermark` would step straight over.
    cloud['areas']!.push({
      user_id: USER,
      id: 99,
      name: 'Slipped in',
      position: 99,
      updated_at: new Date(Date.parse(mark) - 5_000).toISOString(),
      deleted: false,
    })
    await runSync()
    expect((await db.areas.get(99))?.name).toBe('Slipped in')
  })
})

describe('the first sign-in on a new device', () => {
  /** A populated account, as the laptop would have left it. */
  function seedCloud() {
    cloud = {
      areas: [
        { user_id: USER, id: 1, name: 'Health', position: 0, updated_at: '2026-01-01T00:00:00.000Z', deleted: false },
        { user_id: USER, id: 2, name: 'Work', position: 1, updated_at: '2026-01-01T00:00:00.000Z', deleted: false },
      ],
      subgoals: [
        { user_id: USER, ...task({ id: 500, title: 'Real habit' }), created_at: '2026-01-01', archived: false, updated_at: '2026-01-01T00:00:00.000Z', deleted: false },
      ],
      goals: [],
      checkins: [],
      freezes: [],
    }
  }

  it('adopts the account rather than overwriting it with fresh defaults', async () => {
    seedCloud()
    // A fresh install: ten default areas seeded seconds ago, nothing else.
    await repo.ensureSeeded()
    expect(await repo.isPristine()).toBe(true)

    await runSync()

    const areas = await db.areas.toArray()
    expect(areas.map((a) => a.name).sort()).toEqual(['Health', 'Work'])
    expect((await db.subgoals.toArray()).map((t) => t.title)).toEqual(['Real habit'])
    // And the defaults did not go up on the way back.
    expect(cloud['areas']).toHaveLength(2)
  })

  it('merges instead of adopting when the device was used offline first', async () => {
    seedCloud()
    await repo.ensureSeeded()
    const mine = await repo.saveTask(task({ title: 'Written on the plane' }), TODAY)
    expect(await repo.isPristine()).toBe(false)

    await runSync()

    const titles = (await db.subgoals.toArray()).map((t) => t.title).sort()
    expect(titles).toEqual(['Real habit', 'Written on the plane'])
    // The offline work reached the cloud rather than being swallowed by it.
    expect(cloud['subgoals']?.map((r) => r['id'])).toContain(mine)
  })
})
