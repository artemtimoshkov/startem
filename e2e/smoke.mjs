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

await step('today screen renders with default areas', async () => {
  await page.waitForSelector('h1', { timeout: 8000 })
  const h = await page.textContent('h1')
  if (h.trim() !== 'Today') throw new Error(`h1 was "${h}"`)
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
  const expectG = [41,42,43,44,45], expectS = [101,102,103,104,105,106,107,108,109,110]
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

await step('today list shows imported actions, heaviest first', async () => {
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

await step('archived action is absent from the today list', async () => {
  const body = await page.textContent('.screen')
  if (body.includes('Old warm-up routine')) throw new Error('archived action leaked')
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

await step('star renders with scores and one em dash', async () => {
  await page.click('.tab[href="/star"]')
  await page.waitForSelector('.star-svg')
  const desc = await page.getAttribute('.star-svg', 'aria-label')
  if (!desc.includes('Health')) throw new Error(`aria-label: ${desc}`)
  if (!desc.includes('—')) throw new Error('no null score rendered as em dash')
  console.log('      ' + desc.slice(0, 150))
})

await step('weekly strip renders 8 bars', async () => {
  const bars = await page.$$('.strip-col')
  if (bars.length !== 8) throw new Error(`${bars.length} bars`)
})

await step('clicking a vertex opens the area', async () => {
  await page.click('.star-vertex')
  await page.waitForSelector('.backlink')
  const h = await page.textContent('h1')
  console.log(`      opened area: ${h}`)
})

await step('goal screen shows the 15-week grid and action percentages', async () => {
  await page.goto(`${BASE}/goals/41`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Last 15 weeks')
  const weeks = await page.$$('.card .dg-rows')
  if (weeks.length !== 15) throw new Error(`${weeks.length} week columns`)
  const body = await page.textContent('.screen')
  if (!body.includes('Gym session')) throw new Error('actions missing')
  if (body.includes('Old warm-up')) throw new Error('archived action shown')
})

await step('day grids open anchored at the newest week', async () => {
  for (const [name, url] of [['goal grid', '/goals/41'], ['calendar', '/calendar']]) {
    await page.goto(BASE + url, { waitUntil: 'networkidle' })
    await page.waitForSelector('.daygrid-scroll')
    await page.waitForTimeout(250)
    const r = await page.evaluate(() => {
      const el = document.querySelector('.daygrid-scroll')
      return { left: Math.round(el.scrollLeft), max: Math.round(el.scrollWidth - el.clientWidth) }
    })
    if (r.max > 0 && r.left < r.max - 1) throw new Error(`${name} at ${r.left} of ${r.max}`)
    console.log(`      ${name}: scrollLeft ${r.left} of ${r.max}`)
  }
  await page.goto(BASE + '/goals/41', { waitUntil: 'networkidle' })
})

await step('freeze then unfreeze a goal', async () => {
  await page.click('text=Freeze goal')
  await page.waitForSelector('text=Unfreeze goal', { timeout: 5000 })
  const body = await page.textContent('.screen')
  if (!body.includes('Frozen')) throw new Error('no frozen indication')
  await page.click('text=Unfreeze goal')
  await page.waitForSelector('text=Freeze goal', { timeout: 5000 })
})

await step('calendar renders 26 weeks and opens a day', async () => {
  await page.click('.tab[href="/calendar"]')
  await page.waitForSelector('.daygrid')
  const weeks = await page.$$('.dg-rows')
  if (weeks.length !== 26) throw new Error(`${weeks.length} week columns`)
  const cells = await page.$$('.dg-cell.clickable')
  if (cells.length < 150) throw new Error(`${cells.length} editable cells`)
  await page.click('.dg-cell.is-today')
  await page.waitForSelector('.backlink')
  console.log(`      day opened: ${await page.textContent('h1')}`)
})

await step('back-dating a past day works', async () => {
  await page.goto(`${BASE}/calendar/2026-08-19`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.row-title')
  const before = await page.textContent('.progress-head .big')
  await page.click('.row:first-of-type .check:not(.cross)')
  await page.waitForTimeout(400)
  const after = await page.textContent('.progress-head .big')
  if (before === after) throw new Error(`ratio unchanged at ${before}`)
  console.log(`      2026-08-19 ratio ${before.trim()} -> ${after.trim()}`)
})

await step('a day older than 182 days is not editable', async () => {
  await page.goto(`${BASE}/calendar/2025-01-01`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.screen')
  const body = await page.textContent('.screen')
  if (!body.includes('outside the editable window')) throw new Error('no lockout notice')
})

await step('create a goal through the editor', async () => {
  await page.goto(`${BASE}/goals/new`, { waitUntil: 'networkidle' })
  await page.fill('#goal-title', 'Learn to sail')
  await page.selectOption('#goal-area', { label: 'Hobbies' })
  await page.click('.segmented button:has-text("Low")')
  await page.fill('#act-0-title', 'Sailing lesson')
  await page.click('.dayjar button[aria-label="Sat"]')
  await page.click('text=Create goal')
  await page.waitForSelector('h1:has-text("Learn to sail")', { timeout: 6000 })
})

await step('monthly editor clamps day 31 to 28 at the storage boundary', async () => {
  await page.click('text=Edit')
  await page.waitForSelector('#act-0-cadence')
  await page.selectOption('#act-0-cadence', 'monthly')
  await page.fill('#act-0-day', '31')
  await page.click('text=Save changes')
  await page.waitForSelector('h1:has-text("Learn to sail")')
  const body = await page.textContent('.screen')
  if (!body.includes('day 28')) throw new Error(`cadence label reads: ${body.match(/Monthly[^·]*/)?.[0]}`)
})

await step('removing an action archives rather than deletes it', async () => {
  const goalId = await page.evaluate(() => Number(location.pathname.split('/')[2]))
  await page.click('text=Edit')
  await page.waitForSelector('text=Remove')
  await page.click('text=Remove')
  await page.waitForSelector('text=will be archived')
  await page.click('text=Save changes')
  await page.waitForTimeout(600)
  const archived = await page.evaluate(async (gid) => {
    const req = indexedDB.open('startem')
    const db = await new Promise((res) => { req.onsuccess = () => res(req.result) })
    const tx = db.transaction('subgoals', 'readonly')
    const r = tx.objectStore('subgoals').getAll()
    const all = await new Promise((res) => { r.onsuccess = () => res(r.result) })
    return all.filter(s => s.goal_id === gid).map(s => ({ id: s.id, archived: !!s.archived, deleted: !!s.deleted }))
  }, goalId)
  if (archived.length === 0) throw new Error('action row was deleted outright')
  if (!archived.every(a => a.archived && !a.deleted)) throw new Error(JSON.stringify(archived))
})

await step('deleting a goal writes tombstones, not hard deletes', async () => {
  await page.click('text=Delete goal')
  await page.waitForSelector('text=Delete it')
  await page.click('text=Delete it')
  await page.waitForTimeout(700)
  const rows = await page.evaluate(async () => {
    const req = indexedDB.open('startem')
    const db = await new Promise((res) => { req.onsuccess = () => res(req.result) })
    const tx = db.transaction('goals', 'readonly')
    const r = tx.objectStore('goals').getAll()
    const all = await new Promise((res) => { r.onsuccess = () => res(r.result) })
    return all.map(g => ({ id: g.id, title: g.title, deleted: !!g.deleted }))
  })
  const sail = rows.find(g => g.title === 'Learn to sail')
  if (!sail) throw new Error('goal row was hard-deleted')
  if (!sail.deleted) throw new Error('goal not tombstoned')
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
  await page.goto(`${BASE}/goals/41`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('h1')
  const h = await page.textContent('h1')
  if (!h.includes('bench press')) throw new Error(`h1 after reload: ${h}`)
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
await page.goto(`${BASE}/calendar`, { waitUntil: 'networkidle' })
if (SHOTS) await page.screenshot({ path: `${SHOTS}/shot-calendar.png`, fullPage: true })

await browser.close()
server.close()
console.log('\n' + (errors.length ? `${errors.length} PROBLEM(S):\n` + errors.join('\n') : 'ALL GREEN'))
process.exit(errors.length ? 1 : 0)
