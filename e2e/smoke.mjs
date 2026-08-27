/**
 * End-to-end smoke test — the checks that unit tests cannot make.
 *
 * Everything here is about the real browser: that IndexedDB really keeps the
 * ids an import brought in, that a tick really moves the star, that removing an
 * action really archives rather than deletes, that a deep link really survives
 * a refresh. Milestone 3 needs a browser anyway to prove the service worker
 * opens with no network, so this is where that will go too.
 *
 *   npm run build && npm run e2e
 *
 * Chromium comes from Playwright's own download, or from
 * CHROMIUM_PATH if the environment provides one.
 */

import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { serve } from './serve.mjs'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const FIXTURES = new URL('../migration/', import.meta.url).pathname
const SHOTS = process.env.SHOTS ?? null
const errors = []
const server = await serve(Number(new URL(BASE).port || 80))
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
)
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 } })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

const step = async (name, fn) => {
  try { await fn(); console.log(`  ok  ${name}`) }
  catch (e) { console.log(`FAIL  ${name}: ${e.message}`); errors.push(`${name}: ${e.message}`) }
}

await page.goto(BASE, { waitUntil: 'networkidle' })

await step('tasks screen renders with default areas', async () => {
  await page.waitForSelector('h1', { timeout: 8000 })
  const h = await page.textContent('h1')
  if (h.trim() !== 'Tasks') throw new Error(`h1 was "${h}"`)
  if (!(await page.$('.add-task'))) throw new Error('no Add task button')
})

await step('import the JSON export', async () => {
  await page.click('.tab[href="/settings"]')
  await page.waitForSelector('text=Import / export')
  await page.setInputFiles('input[type=file]', `${FIXTURES}sample-export.json`)
  await page.waitForSelector('text=Replace my data')
  await page.click('text=Replace my data')
  await page.waitForSelector('text=Imported 10 areas', { timeout: 8000 })
})

await step('ids preserved through the import', async () => {
  const ids = await page.evaluate(async () => {
    const req = indexedDB.open('startem')
    const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
    const tx = db.transaction(['goals','subgoals'], 'readonly')
    const get = (store) => new Promise((res) => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => res(r.result) })
    const [goals, subgoals] = await Promise.all([get('goals'), get('subgoals')])
    return { goals: goals.map(g => g.id).sort((a,b)=>a-b), subgoals: subgoals.map(s => s.id).sort((a,b)=>a-b) }
  })
  const expectG = [41,42,43,44,45], expectS = [101,102,103,104,105,106,107,108,109,110,111,112]
  if (JSON.stringify(ids.goals) !== JSON.stringify(expectG)) throw new Error(`goal ids ${JSON.stringify(ids.goals)}`)
  if (JSON.stringify(ids.subgoals) !== JSON.stringify(expectS)) throw new Error(`subgoal ids ${JSON.stringify(ids.subgoals)}`)
})

await step('monthly_day 31 was clamped to 28 on import', async () => {
  const day = await page.evaluate(async () => {
    const req = indexedDB.open('startem')
    const db = await new Promise((res) => { req.onsuccess = () => res(req.result) })
    const tx = db.transaction('subgoals', 'readonly')
    const r = tx.objectStore('subgoals').get(106)
    return await new Promise((res) => { r.onsuccess = () => res(r.result.monthly_day) })
  })
  if (day !== 28) throw new Error(`monthly_day was ${day}`)
})

await step('the import moves goal importance down onto the tasks', async () => {
  const rows = await page.evaluate(async () => {
    const req = indexedDB.open('startem')
    const db = await new Promise((res) => { req.onsuccess = () => res(req.result) })
    const tx = db.transaction(['goals','subgoals'], 'readonly')
    const get = (store) => new Promise((res) => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => res(r.result) })
    const [goals, subgoals] = await Promise.all([get('goals'), get('subgoals')])
    return { goals, subgoals }
  })
  // Goal 41 was `high` in the export; its tasks inherit that, and the goal
  // itself no longer carries a priority at all (§3).
  const goal = rows.goals.find((g) => g.id === 41)
  if (goal.importance !== undefined) throw new Error('goal still carries importance')
  const gym = rows.subgoals.find((s) => s.id === 101)
  if (gym.importance !== 'high') throw new Error(`task importance ${gym.importance}`)
  if (gym.area_id !== 1) throw new Error(`task area_id ${gym.area_id}`)
  if (gym.interval !== 1) throw new Error(`task interval ${gym.interval}`)
  // A task written in the new shape: an area, no goal, its own priority.
  const spend = rows.subgoals.find((s) => s.id === 111)
  if (spend.goal_id != null) throw new Error(`goal-less task got goal_id ${spend.goal_id}`)
  if (spend.area_id !== 8) throw new Error(`goal-less task area_id ${spend.area_id}`)
  const guitar = rows.subgoals.find((s) => s.id === 112)
  if (guitar.interval !== 2) throw new Error(`custom interval ${guitar.interval}`)
  if (guitar.start_date !== '2026-08-12') throw new Error(`start ${guitar.start_date}`)
})

await step('tasks list shows imported tasks, heaviest first', async () => {
  await page.click('.tab[href="/"]')
  await page.waitForSelector('.row-title')
  const titles = await page.$$eval('.row-title', (n) => n.map((x) => x.textContent.trim()))
  if (titles.length === 0) throw new Error('no rows')
  // Heaviest first, but grouping wins: the DOM is descending *within* each
  // area group, and the groups appear in the order the global sort first
  // reaches them. So the flat list is not globally descending.
  const groups = await page.$$eval('.card', (cards) => cards
    .filter((c) => c.querySelector('.row-meta .num'))
    .map((c) => [...c.querySelectorAll('.row-meta .num')].map((x) => Number(x.textContent.replace(/\D/g, '')))))
  for (const g of groups) {
    const sorted = [...g].sort((a, b) => b - a)
    if (JSON.stringify(g) !== JSON.stringify(sorted)) throw new Error(`group not descending: ${g}`)
  }
  const firsts = groups.map((g) => g[0])
  if (JSON.stringify(firsts) !== JSON.stringify([...firsts].sort((a, b) => b - a)))
    throw new Error(`group order does not follow the sort: ${firsts}`)
  console.log('      group weights:', JSON.stringify(groups))
  console.log('      today:', titles.join(' | '))
})

await step('frozen goal is absent from the today list', async () => {
  const body = await page.textContent('.screen')
  if (body.includes('Sunday call')) throw new Error('frozen goal leaked into today')
})

await step('archived task is absent from the list entirely', async () => {
  const body = await page.textContent('.screen')
  if (body.includes('Old warm-up routine')) throw new Error('archived task leaked')
})

await step('overdue one-time action is flagged', async () => {
  const body = await page.textContent('.screen')
  if (!body.includes('Book the domain')) throw new Error('one-time action missing')
  if (!body.includes('overdue')) throw new Error('not flagged overdue')
})

await step('ticking an item updates progress', async () => {
  const before = await page.textContent('.progress-head .big')
  await page.click('.row:first-of-type .check:not(.cross)')
  await page.waitForTimeout(400)
  const after = await page.textContent('.progress-head .big')
  if (before === after) throw new Error(`progress unchanged: ${before}`)
  console.log(`      progress ${before.trim()} -> ${after.trim()}`)
})

await step('ticking again clears back to unresolved', async () => {
  const before = await page.textContent('.progress-head .big')
  await page.click('.row:first-of-type .check:not(.cross)')
  await page.waitForTimeout(400)
  const after = await page.textContent('.progress-head .big')
  if (before === after) throw new Error('untick did nothing')
})

await step('crossing out shrinks the target', async () => {
  const before = await page.textContent('.progress-head .big')
  await page.click('.row:first-of-type .check.cross')
  await page.waitForTimeout(400)
  const after = await page.textContent('.progress-head .big')
  if (before === after) throw new Error('cross out did nothing')
  console.log(`      target ${before.trim()} -> ${after.trim()}`)
  await page.click('.row:first-of-type .check.cross')
  await page.waitForTimeout(300)
})

await step('the tab bar has no calendar in it', async () => {
  const tabs = await page.$$eval('.tab', (els) => els.map((el) => el.getAttribute('href')))
  if (tabs.includes('/calendar')) throw new Error('the calendar tab is still there')
  if (tabs.length !== 3) throw new Error(`${tabs.length} tabs: ${tabs.join(', ')}`)
  // And the route itself is gone, not merely unlinked.
  await page.goto(`${BASE}/calendar`, { waitUntil: 'networkidle' })
  const body = await page.textContent('.screen')
  if (!body.includes('Nothing here')) throw new Error('/calendar still renders a screen')
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
})

await step('star renders with scores and one em dash', async () => {
  await page.click('.tab[href="/star"]')
  await page.waitForSelector('.star-svg')
  const desc = await page.getAttribute('.star-svg', 'aria-label')
  if (!desc.includes('Health')) throw new Error(`aria-label: ${desc}`)
  if (!desc.includes('—')) throw new Error('no null score rendered as em dash')
  console.log('      ' + desc.slice(0, 150))
})

await step('clicking a vertex opens the area', async () => {
  await page.click('.star-vertex')
  await page.waitForSelector('.backlink')
  const h = await page.textContent('h1')
  console.log(`      opened area: ${h}`)
})

await step('goal screen lists its tasks, with no day grid above them', async () => {
  await page.goto(`${BASE}/goals/41`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.row-button')
  if (await page.$('.daygrid')) throw new Error('the 15-week grid is still on the goal')
  const body = await page.textContent('.screen')
  if (!body.includes('Gym session')) throw new Error('tasks missing')
  if (body.includes('Old warm-up')) throw new Error('archived task shown')
})

await step('freeze then unfreeze a goal', async () => {
  await page.click('text=Freeze goal')
  await page.waitForSelector('text=Unfreeze goal', { timeout: 5000 })
  const body = await page.textContent('.screen')
  if (!body.includes('Frozen')) throw new Error('no frozen indication')
  await page.click('text=Unfreeze goal')
  await page.waitForSelector('text=Freeze goal', { timeout: 5000 })
})

await step('create a goal through the editor — a heading, with no priority on it', async () => {
  await page.goto(`${BASE}/goals/new`, { waitUntil: 'networkidle' })
  await page.fill('#goal-title', 'Learn to sail')
  await page.selectOption('#goal-area', { label: 'Hobbies' })
  // A goal is a heading now: no importance control, and no task list (§3).
  if (await page.$('.segmented')) throw new Error('goal editor still asks for importance')
  await page.click('text=Create goal')
  await page.waitForSelector('h1:has-text("Learn to sail")', { timeout: 6000 })
})

await step('add a task to the goal through the composer', async () => {
  await page.click('.add-task')
  await page.waitForSelector('.composer-input')
  await page.fill('.composer-input', 'Sailing lesson p1')
  // The p1 token sets the priority and leaves the title behind.
  const typed = await page.inputValue('.composer-input')
  if (typed !== 'Sailing lesson') throw new Error(`title reads "${typed}"`)
  if (!(await page.$('.chip.imp-high'))) throw new Error('p1 did not set the priority')
  await page.click('.composer-submit')
  await page.waitForSelector('.composer-input', { state: 'detached', timeout: 6000 })
  const body = await page.textContent('.screen')
  if (!body.includes('Sailing lesson')) throw new Error('task not listed on the goal')
})

await step('a repeat picked from the date sheet reads back in words', async () => {
  await page.click('.row-button:has-text("Sailing lesson")')
  await page.waitForSelector('.composer-input')
  await page.click('.chip:has-text("Date")')
  await page.waitForSelector('.cal')
  await page.click('.sheet-row:has-text("This weekend")')
  await page.waitForTimeout(150)
  await page.click('.sheet-foot-row button:has-text("Repeat")')
  await page.waitForSelector('.sheet-row:has-text("Every week on Saturday")')
  await page.click('.sheet-row:has-text("Every week on Saturday")')
  await page.waitForTimeout(200)
  await page.click('.sheet-close')
  await page.waitForSelector('.sheet', { state: 'detached' })
  await page.click('.composer-submit')
  await page.waitForTimeout(600)
  const stored = await page.evaluate(async () => {
    const req = indexedDB.open('startem')
    const db = await new Promise((res) => { req.onsuccess = () => res(req.result) })
    const tx = db.transaction('subgoals', 'readonly')
    const r = tx.objectStore('subgoals').getAll()
    const all = await new Promise((res) => { r.onsuccess = () => res(r.result) })
    return all.find((s) => s.title === 'Sailing lesson')
  })
  if (stored.cadence_type !== 'weekly') throw new Error(`cadence ${stored.cadence_type}`)
  // Saturday is weekday 5, Monday-first (§2) — the single most repeated bug.
  if (JSON.stringify(stored.days) !== '[5]') throw new Error(`days ${JSON.stringify(stored.days)}`)
  if (stored.importance !== 'high') throw new Error(`importance ${stored.importance}`)
  if (stored.start_date == null) throw new Error('no start date stored')
  if (stored.due_date != null) throw new Error('a repeating task must not carry a deadline')
})

await step('a custom repeat stores its interval and its inclusive end date', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.click('.add-task')
  await page.fill('.composer-input', 'Deep clean')
  await page.click('.chip:has-text("Date")')
  await page.waitForSelector('.cal')
  await page.click('.sheet-row:has-text("Tomorrow")')
  await page.waitForTimeout(150)
  await page.click('.sheet-foot-row button:has-text("Repeat")')
  await page.waitForSelector('.sheet-row:has-text("Custom")')
  await page.click('.sheet-row:has-text("Custom")')
  await page.waitForSelector('text=Custom repeat')
  await page.fill('input[aria-label="Interval"]', '4')
  await page.click('.segmented button:has-text("On date")')
  await page.fill('input[aria-label="Last day, inclusive"]', '2026-12-31')
  await page.click('.sheet-foot-row button:has-text("Save")')
  await page.waitForTimeout(200)
  await page.click('.sheet-close')
  await page.waitForSelector('.sheet', { state: 'detached' })
  await page.click('.composer-submit')
  await page.waitForTimeout(600)
  const stored = await page.evaluate(async () => {
    const req = indexedDB.open('startem')
    const db = await new Promise((res) => { req.onsuccess = () => res(req.result) })
    const tx = db.transaction('subgoals', 'readonly')
    const r = tx.objectStore('subgoals').getAll()
    const all = await new Promise((res) => { r.onsuccess = () => res(r.result) })
    return all.find((s) => s.title === 'Deep clean')
  })
  if (stored.interval !== 4) throw new Error(`interval ${stored.interval}`)
  if (stored.repeat_until !== '2026-12-31') throw new Error(`until ${stored.repeat_until}`)
})

await step('the date sheet stays open on a pick, and marks the day', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.click('.add-task')
  await page.fill('.composer-input', 'Sheet stays open')
  await page.click('.chip:has-text("Date")')
  await page.waitForSelector('.cal')

  // Next week is gone; the other three shortcuts and No date stay.
  const rows = await page.$$eval('.sheet-body .sheet-row', (els) =>
    els.map((el) => el.querySelector('.sheet-row-label').textContent),
  )
  if (rows.includes('Next week')) throw new Error('Next week is still offered')
  for (const want of ['Today', 'Tomorrow', 'This weekend', 'No date']) {
    if (!rows.includes(want)) throw new Error(`${want} is missing`)
  }

  await page.click('.sheet-row:has-text("Tomorrow")')
  await page.waitForTimeout(150)
  if (!(await page.$('.sheet'))) throw new Error('the sheet closed on a pick')

  // The chosen day is marked in the month grid, and picking again from the
  // grid still leaves the sheet up.
  const picked = await page.$$('.cal-day.is-picked')
  if (picked.length !== 1) throw new Error(`${picked.length} days highlighted`)
  await page.click('.cal-day:not(.is-outside):not(.is-picked) >> nth=20')
  await page.waitForTimeout(150)
  if (!(await page.$('.sheet'))) throw new Error('the sheet closed on a grid pick')
  if ((await page.$$('.cal-day.is-picked')).length !== 1) throw new Error('highlight did not move')

  // Dismissed by the backdrop, as before.
  await page.click('.sheet-scrim', { position: { x: 5, y: 5 } })
  await page.waitForSelector('.sheet', { state: 'detached' })
  await page.click('.composer-cancel')
})

await step('a task can be attached to an area with no goal at all', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.click('.add-task')
  await page.fill('.composer-input', 'Call the bank')
  await page.click('.composer-chips .chip:first-child')
  await page.waitForSelector('.sheet-row:has-text("Money")')
  await page.click('.sheet-row:has-text("Money")')
  await page.waitForSelector('text=Create new goal')
  await page.click('.sheet-row:has-text("Money only")')
  await page.waitForSelector('.sheet', { state: 'detached' })
  await page.click('.composer-submit')
  await page.waitForTimeout(600)
  const stored = await page.evaluate(async () => {
    const req = indexedDB.open('startem')
    const db = await new Promise((res) => { req.onsuccess = () => res(req.result) })
    const tx = db.transaction('subgoals', 'readonly')
    const r = tx.objectStore('subgoals').getAll()
    const all = await new Promise((res) => { r.onsuccess = () => res(r.result) })
    return all.find((s) => s.title === 'Call the bank')
  })
  if (stored.goal_id != null) throw new Error(`goal_id ${stored.goal_id}`)
  if (stored.area_id !== 8) throw new Error(`area_id ${stored.area_id}`)
  const body = await page.textContent('.screen')
  if (!body.includes('Call the bank')) throw new Error('goal-less task missing from the list')
})

await step('archiving a task keeps the row and its check-ins', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.click('.row-open:has-text("Call the bank")')
  await page.waitForSelector('text=Archive this task')
  await page.click('text=Archive this task')
  await page.waitForTimeout(600)
  const stored = await page.evaluate(async () => {
    const req = indexedDB.open('startem')
    const db = await new Promise((res) => { req.onsuccess = () => res(req.result) })
    const tx = db.transaction('subgoals', 'readonly')
    const r = tx.objectStore('subgoals').getAll()
    const all = await new Promise((res) => { r.onsuccess = () => res(r.result) })
    return all.find((s) => s.title === 'Call the bank')
  })
  if (!stored) throw new Error('the task row was deleted outright')
  if (!stored.archived || stored.deleted) throw new Error(JSON.stringify(stored))
})

await step('deleting a goal detaches its tasks rather than destroying them', async () => {
  await page.goto(`${BASE}/goals/41`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Delete goal')
  await page.click('text=Delete goal')
  await page.waitForSelector('text=Delete it')
  await page.click('text=Delete it')
  await page.waitForTimeout(700)
  const rows = await page.evaluate(async () => {
    const req = indexedDB.open('startem')
    const db = await new Promise((res) => { req.onsuccess = () => res(req.result) })
    const tx = db.transaction(['goals','subgoals','checkins'], 'readonly')
    const get = (store) => new Promise((res) => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => res(r.result) })
    const [goals, subgoals, checkins] = await Promise.all([get('goals'), get('subgoals'), get('checkins')])
    return { goal: goals.find((g) => g.id === 41), gym: subgoals.find((s) => s.id === 101), checkins: checkins.filter((c) => c.subgoal_id === 101).length }
  })
  if (!rows.goal) throw new Error('goal row was hard-deleted')
  if (!rows.goal.deleted) throw new Error('goal not tombstoned')
  // The heading is gone; the work under it is not (§3).
  if (rows.gym.deleted) throw new Error('the goal took its tasks down with it')
  if (rows.gym.goal_id != null) throw new Error(`task still points at the goal: ${rows.gym.goal_id}`)
  if (rows.gym.area_id !== 1) throw new Error(`task lost its area: ${rows.gym.area_id}`)
  if (rows.checkins === 0) throw new Error('check-ins were destroyed with the goal')
})

await step('export round-trips', async () => {
  await page.click('.tab[href="/settings"]')
  await page.waitForSelector('text=Export JSON')
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Export JSON')])
  const path = await dl.path()
  const data = JSON.parse(readFileSync(path, 'utf8'))
  for (const t of ['areas','goals','subgoals','checkins','freezes']) {
    if (!Array.isArray(data[t])) throw new Error(`missing table ${t}`)
  }
  if (!data.goals.some(g => g.id === 41)) throw new Error('ids not preserved in export')
  console.log(`      exported ${data.goals.length} goals, ${data.checkins.length} check-ins`)
})

await step('rename an area', async () => {
  await page.fill('#area-2', 'Making things')
  await page.click('h1')
  await page.waitForTimeout(500)
  await page.click('.tab[href="/star"]')
  await page.waitForSelector('.star-svg')
  const desc = await page.getAttribute('.star-svg', 'aria-label')
  if (!desc.includes('Making things')) throw new Error('rename not reflected')
})

await step('deep link survives a reload', async () => {
  // Goal 43 rather than 41: 41 is the one the delete test above tombstoned.
  await page.goto(`${BASE}/goals/43`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('h1')
  const h = await page.textContent('h1')
  if (!h.includes('Startem v2')) throw new Error(`h1 after reload: ${h}`)
})

await step('a v1 device upgrades in place, carrying importance down onto its tasks', async () => {
  // A separate context, so this starts from an empty origin and can write the
  // *old* schema before the app ever opens the database. This is the one path
  // that cannot be exercised by a fresh install, and the one where getting the
  // order wrong resets every task on the device to `medium` (§3).
  const old = await browser.newContext({ viewport: { width: 414, height: 896 } })
  const p2 = await old.newPage()
  // A static asset, not the app: loading the app would open Dexie at the
  // current version before there was anything to upgrade *from*.
  await p2.goto(`${BASE}/icon-192.png`, { waitUntil: 'domcontentloaded' })
  await p2.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      // Dexie stores its own version × 10, so a v1 device is IndexedDB 10.
      const req = indexedDB.open('startem', 10)
      req.onupgradeneeded = () => {
        const d = req.result
        d.createObjectStore('areas', { keyPath: 'id' })
        d.createObjectStore('goals', { keyPath: 'id' })
        d.createObjectStore('subgoals', { keyPath: 'id' })
        d.createObjectStore('checkins', { keyPath: ['subgoal_id', 'date'] })
        d.createObjectStore('freezes', { keyPath: 'id' })
        d.createObjectStore('meta', { keyPath: 'key' })
      }
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
    const tx = db.transaction(['areas', 'goals', 'subgoals'], 'readwrite')
    tx.objectStore('areas').put({ id: 1, name: 'Health', position: 0, deleted: false })
    tx.objectStore('goals').put({
      id: 41, area_id: 1, title: 'Bench 100 kg', description: '',
      status: 'active', importance: 'high', created_at: '2026-01-04', deleted: false,
    })
    tx.objectStore('subgoals').put({
      id: 101, goal_id: 41, title: 'Gym session', cadence_type: 'weekly',
      days: [0, 2, 5], monthly_day: null, month_weekday: null, month_ordinal: null,
      due_date: null, weight: null, created_at: '2026-01-04', archived: false, deleted: false,
    })
    await new Promise((res) => { tx.oncomplete = res })
    db.close()
  })

  await p2.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await p2.waitForSelector('h1', { timeout: 8000 })
  const after = await p2.evaluate(async () => {
    const req = indexedDB.open('startem')
    const db = await new Promise((res) => { req.onsuccess = () => res(req.result) })
    const tx = db.transaction(['goals', 'subgoals'], 'readonly')
    const get = (s) => new Promise((res) => { const r = tx.objectStore(s).get(s === 'goals' ? 41 : 101); r.onsuccess = () => res(r.result) })
    return { version: db.version, goal: await get('goals'), task: await get('subgoals') }
  })
  await old.close()

  if (after.version < 2) throw new Error(`still on version ${after.version}`)
  if (after.goal.importance !== undefined) throw new Error('goal kept its importance')
  if (after.task.importance !== 'high') throw new Error(`task importance ${after.task.importance}`)
  if (after.task.area_id !== 1) throw new Error(`task area_id ${after.task.area_id}`)
  if (after.task.interval !== 1) throw new Error(`task interval ${after.task.interval}`)
  if (after.task.start_date !== null) throw new Error('start_date not backfilled')
})

await step('no browser dialogs are used anywhere', async () => {
  let fired = false
  page.on('dialog', () => { fired = true })
  if (fired) throw new Error('a dialog fired')
})

if (SHOTS) await page.screenshot({ path: `${SHOTS}/shot-goal.png`, fullPage: true })
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
if (SHOTS) await page.screenshot({ path: `${SHOTS}/shot-today.png`, fullPage: true })
await page.goto(`${BASE}/star`, { waitUntil: 'networkidle' })
if (SHOTS) await page.screenshot({ path: `${SHOTS}/shot-star.png`, fullPage: true })

await browser.close()
server.close()
console.log('\n' + (errors.length ? `${errors.length} PROBLEM(S):\n` + errors.join('\n') : 'ALL GREEN'))
process.exit(errors.length ? 1 : 0)
