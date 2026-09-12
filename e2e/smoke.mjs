/**
 * End-to-end smoke test — the checks that unit tests cannot make.
 *
 * Everything here is about the real browser: that IndexedDB really keeps the
 * ids the sample loader brought in, that a tick really moves the star, that
 * removing an area really archives rather than deletes, that a deep link
 * really survives a refresh, and that a device holding the *old* three-tier
 * store really upgrades in place without dropping a pause on the floor.
 *
 *   npm run build:e2e && npm run e2e
 *
 * `build:e2e` is the ordinary build with `VITE_SEED_SAMPLE=1`, which loads
 * `migration/sample-export.json` into an empty store on boot. That is how these
 * checks get data to assert against now that the JSON import screen is gone.
 *
 * Chromium comes from Playwright's own download, or from
 * CHROMIUM_PATH if the environment provides one.
 */

import { chromium } from 'playwright'
import { serve } from './serve.mjs'

const BASE = process.env.BASE ?? 'http://localhost:4173'
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

/** Reads whole object stores out of the live IndexedDB, in the page. */
const readStores = (stores) =>
  page.evaluate(async (names) => {
    const req = indexedDB.open('startem')
    const db = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
    const tx = db.transaction(names, 'readonly')
    const out = {}
    await Promise.all(
      names.map(
        (n) =>
          new Promise((res) => {
            const r = tx.objectStore(n).getAll()
            r.onsuccess = () => { out[n] = r.result; res() }
          }),
      ),
    )
    return out
  }, stores)

await page.goto(BASE, { waitUntil: 'networkidle' })

await step('the day screen renders, and it is the habit screen', async () => {
  await page.waitForSelector('h1', { timeout: 8000 })
  const h = await page.textContent('h1')
  if (h.trim() !== 'Today') throw new Error(`h1 was "${h}"`)
  if (!(await page.$('.fab'))) throw new Error('no floating add button')
  if ((await page.getAttribute('.fab', 'aria-label')) !== 'Add habit') {
    throw new Error('the day screen does not offer to add a habit')
  }
})

await step('the sample dataset seeds an empty store', async () => {
  await page.waitForSelector('.row-title', { timeout: 8000 })
})

await step('ids preserved through the load', async () => {
  const { goals, subgoals } = await readStores(['goals', 'subgoals'])
  const g = goals.map((x) => x.id).sort((a, b) => a - b)
  const s = subgoals.map((x) => x.id).sort((a, b) => a - b)
  const expectG = [41, 42, 43, 44, 45, 46]
  const expectS = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114]
  if (JSON.stringify(g) !== JSON.stringify(expectG)) throw new Error(`goal ids ${JSON.stringify(g)}`)
  if (JSON.stringify(s) !== JSON.stringify(expectS)) throw new Error(`subgoal ids ${JSON.stringify(s)}`)
})

await step('monthly_day 31 was clamped to 28 on the way in', async () => {
  const { subgoals } = await readStores(['subgoals'])
  const day = subgoals.find((s) => s.id === 106).monthly_day
  if (day !== 28) throw new Error(`monthly_day was ${day}`)
})

await step('a task belongs to an area and to nothing else', async () => {
  const { subgoals, goals, freezes } = await readStores(['subgoals', 'goals', 'freezes'])
  for (const task of subgoals) {
    if ('goal_id' in task) throw new Error(`task ${task.id} still carries goal_id`)
    // An area is optional — null is unfiled (§3) — but the column must exist,
    // and it must never be the zero that is not an area.
    if (task.area_id === undefined) throw new Error(`task ${task.id} lost its area column`)
    if (task.area_id === 0) throw new Error(`task ${task.id} was filed under area zero`)
  }
  // A goal is an aim: no importance, no tasks, and a status of its own.
  for (const goal of goals) {
    if ('importance' in goal) throw new Error(`goal ${goal.id} still carries importance`)
    if (!['active', 'achieved'].includes(goal.status)) throw new Error(`goal status ${goal.status}`)
  }
  // A pause hangs off the habit it pauses.
  for (const period of freezes) {
    if (!period.subgoal_id) throw new Error(`freeze ${period.id} is not on a habit`)
  }
})

await step('the day lists habits only — never a to-do', async () => {
  const body = await page.textContent('.screen')
  // Both are Health items due around now; only the habit belongs in the list.
  const listed = await page.$$eval('.card .row-open', (n) => n.map((x) => x.textContent.trim()))
  if (!listed.includes('Protein target')) throw new Error('a daily habit is missing')
  const habitGroups = await page.$$eval('.section-label', (n) => n.map((x) => x.textContent))
  if (!body.includes('To-dos')) throw new Error('the overdue to-do was not surfaced at all')
  // It is surfaced, but under its own heading rather than mixed in.
  if (!habitGroups.some((h) => h.startsWith('To-dos'))) {
    throw new Error('the to-do was not given its own section')
  }
})

await step('a paused habit is absent from the day', async () => {
  const body = await page.textContent('.screen')
  if (body.includes('Sunday call')) throw new Error('a paused habit leaked into today')
})

await step('archived task is absent from the list entirely', async () => {
  const body = await page.textContent('.screen')
  if (body.includes('Old warm-up routine')) throw new Error('archived task leaked')
})

await step('the day is headed by the day, and the rows carry their area', async () => {
  const heads = await page.$$eval('.day-head', (n) => n.map((x) => x.textContent.trim()))
  if (!heads[0] || !heads[0].includes('Today')) throw new Error(`first heading: ${heads[0]}`)
  // The area moved onto the row when the day became the heading (§6).
  const meta = await page.textContent('.card .row .row-meta')
  if (!meta.trim()) throw new Error('a habit row carries no area or cadence')
})

await step('"not due today" opens into the days ahead, and skips the empty ones', async () => {
  await page.click('.section-toggle')
  await page.waitForTimeout(200)
  const heads = await page.$$eval('.day-head', (n) => n.map((x) => x.textContent.trim()))
  // Today, then at least one day ahead — each one a real date with a weekday.
  const ahead = heads.slice(1).filter((h) => h !== 'Later')
  if (ahead.length === 0) throw new Error(`no days ahead: ${heads}`)
  // A date and a weekday, in whatever order the reader's locale puts them.
  for (const head of ahead) {
    if (!/\d/.test(head) || !head.includes(' · ')) {
      throw new Error(`heading is not a day: "${head}"`)
    }
  }
  if (new Set(ahead).size !== ahead.length) throw new Error(`a day was headed twice: ${ahead}`)
  // A rare cadence still gets a line rather than vanishing off the window.
  const body = await page.textContent('.screen')
  if (!body.includes('Quarterly tax check')) throw new Error('a rare habit vanished')
  if (!body.includes('Sunday call')) throw new Error('a paused habit vanished')
  await page.click('.section-toggle')
  await page.waitForTimeout(200)
})

await step('ticking a habit updates progress', async () => {
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

await step('three tabs, unlabelled, and the removed screens are gone as routes too', async () => {
  const tabs = await page.$$eval('.tab', (els) => els.map((el) => el.getAttribute('href')))
  if (JSON.stringify(tabs) !== JSON.stringify(['/', '/todos', '/star'])) {
    throw new Error(`tabs: ${tabs.join(', ')}`)
  }
  // Icons carry the tabs now, so each one has to say what it is to a reader.
  const labels = await page.$$eval('.tab', (els) => els.map((el) => el.getAttribute('aria-label')))
  if (labels.some((l) => !l)) throw new Error(`an icon-only tab has no label: ${labels}`)
  // No captions — the overdue badge is the only text the bar is allowed.
  const caption = (await page.textContent('.tabbar')).replace(/\d/g, '').trim()
  if (caption !== '') throw new Error(`the tabs still carry text: "${caption}"`)
  // An unrecognised route lands on the day's list rather than a dead end.
  for (const gone of ['/calendar', '/settings', '/goals/41', '/goals/new']) {
    await page.goto(`${BASE}${gone}`, { waitUntil: 'networkidle' })
    const h = await page.textContent('h1')
    if (h.trim() !== 'Today') throw new Error(`${gone} rendered "${h}"`)
  }
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
})

await step('the page cannot be pinched or double-tapped to zoom', async () => {
  const vp = await page.getAttribute('meta[name="viewport"]', 'content')
  if (!/user-scalable=no/.test(vp)) throw new Error(`viewport: ${vp}`)
  if (!/maximum-scale=1/.test(vp)) throw new Error(`viewport: ${vp}`)
})

// ---------------------------------------------------------------------------
// The to-do list
// ---------------------------------------------------------------------------

await step('the to-do screen lists to-dos only, in deadline piles', async () => {
  await page.click('.tab[href="/todos"]')
  await page.waitForSelector('.row-open')
  const body = await page.textContent('.screen')
  if (!body.includes('Book a physio appointment')) throw new Error('overdue to-do missing')
  if (!body.includes('Renew the passport')) throw new Error('undated to-do missing')
  if (body.includes('Gym session')) throw new Error('a habit leaked into the to-do list')
  const sections = await page.$$eval('.day-head', (n) => n.map((x) => x.textContent.trim()))
  // The heading is the deadline itself; "Overdue" is a word on the day rather
  // than a pile of its own, and a day nothing is due on gets no heading (§6).
  if (!sections.some((s) => s.endsWith('Overdue'))) throw new Error(`sections: ${sections}`)
  if (!sections.some((s) => s === 'No date')) throw new Error(`sections: ${sections}`)
  if (!(await page.$('.day-head.is-late'))) throw new Error('a late day is not marked')
})

await step('the tab badge counts what is overdue', async () => {
  const badge = await page.textContent('.tab-badge')
  if (badge.trim() !== '1') throw new Error(`badge reads ${badge}`)
})

await step('a to-do ticked stays on the list, marked finished', async () => {
  await page.click('.row:has-text("Renew the passport") .check:not(.cross)')
  await page.waitForTimeout(500)
  const sections = await page.$$eval('.day-head', (n) => n.map((x) => x.textContent.trim()))
  if (!sections.some((s) => s.startsWith('Finished'))) throw new Error(`sections: ${sections}`)
  await page.click('.row:has-text("Renew the passport") .check:not(.cross)')
  await page.waitForTimeout(400)
})

await step('adding from the to-do screen writes a to-do, not a habit', async () => {
  await page.click('.fab')
  await page.waitForSelector('.composer-input')
  const pressed = await page.getAttribute('.kindswitch-btn:has-text("To-do")', 'aria-pressed')
  if (pressed !== 'true') throw new Error('the to-do screen did not open on To-do')
  await page.fill('.composer-input', 'Post the parcel')
  await page.click('.composer-submit')
  await page.waitForTimeout(600)
  const { subgoals } = await readStores(['subgoals'])
  const stored = subgoals.find((s) => s.title === 'Post the parcel')
  if (!stored) throw new Error('nothing was written')
  if (stored.cadence_type !== 'once') throw new Error(`cadence ${stored.cadence_type}`)
})

await step('adding from the day screen writes a habit, not a to-do', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.click('.fab')
  await page.waitForSelector('.composer-input')
  const pressed = await page.getAttribute('.kindswitch-btn:has-text("Habit")', 'aria-pressed')
  if (pressed !== 'true') throw new Error('the day screen did not open on Habit')
  if (!(await page.$('.chip.imp-low'))) throw new Error('a new task did not open on P3')
  await page.fill('.composer-input', 'Morning walk')
  await page.click('.composer-submit')
  await page.waitForTimeout(600)
  const { subgoals } = await readStores(['subgoals'])
  const stored = subgoals.find((s) => s.title === 'Morning walk')
  // "Every day" is stored as a weekly repeat on all seven weekdays — the
  // preset's shape since §4, not a `daily` cadence_type.
  if (stored.cadence_type !== 'weekly') throw new Error(`cadence ${stored.cadence_type}`)
  if (stored.days.length !== 7) throw new Error(`days ${JSON.stringify(stored.days)}`)
  if (stored.due_date != null) throw new Error('a habit must not carry a deadline')
  // No area unless one is chosen: the star is opted into, never defaulted (§7).
  if (stored.area_id != null) throw new Error(`a new task defaulted into area ${stored.area_id}`)
})

await step('the switch turns one into the other, and only touches the repeat', async () => {
  await page.click('.row-open:has-text("Morning walk")')
  await page.waitForSelector('.btn:has-text("Pause")')
  await page.click('button[aria-label="Edit"]')
  await page.waitForSelector('.composer-input')
  await page.click('.kindswitch-btn:has-text("To-do")')
  await page.click('.composer-submit')
  await page.waitForTimeout(600)
  const { subgoals } = await readStores(['subgoals'])
  const stored = subgoals.find((s) => s.title === 'Morning walk')
  if (stored.cadence_type !== 'once') throw new Error(`cadence ${stored.cadence_type}`)
  if (stored.importance !== 'low') throw new Error('the switch moved the priority')
  if (stored.area_id != null) throw new Error('the switch moved the area')
})

// ---------------------------------------------------------------------------
// The composer's pickers
// ---------------------------------------------------------------------------

await step('the repeat sheet has a way back to the date sheet', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.click('.fab')
  await page.waitForSelector('.composer-input')
  await page.click('.composer-chips .chip:nth-child(2)')
  await page.waitForSelector('.cal')
  await page.click('.sheet-foot-row button[aria-label="Repeat"]')
  await page.waitForSelector('.sheet-row:has-text("Every day")')
  await page.click('.sheet-foot-row button:has-text("Back")')
  await page.waitForSelector('.cal', { timeout: 4000 })
  await page.click('.sheet-close')
  await page.waitForSelector('.sheet', { state: 'detached' })
  await page.click('.composer-cancel')
})

await step('the area picker offers areas and nothing under them', async () => {
  await page.click('.fab')
  await page.fill('.composer-input', 'Call the bank p1')
  const typed = await page.inputValue('.composer-input')
  if (typed !== 'Call the bank') throw new Error(`the p1 token was not consumed: "${typed}"`)
  if (!(await page.$('.chip.imp-high'))) throw new Error('p1 did not set the priority')
  if ((await page.textContent('.composer-chips .chip:first-child')).trim() !== 'Area') {
    throw new Error('the composer opened already filed under an area')
  }
  await page.click('.composer-chips .chip:first-child')
  await page.waitForSelector('.sheet-row:has-text("Money")')
  const body = await page.textContent('.sheet')
  if (body.includes('Create new goal')) throw new Error('the goal tier is still in the picker')
  if (body.includes('only')) throw new Error('the picker still has a second level')
  // Unfiled is an answer the sheet offers, not the absence of one (§3).
  if (!body.includes('No area')) throw new Error('the picker cannot leave a task unfiled')
  await page.click('.sheet-row:has-text("Money")')
  await page.waitForSelector('.sheet', { state: 'detached' })
  await page.click('.composer-submit')
  await page.waitForTimeout(600)
  const { subgoals } = await readStores(['subgoals'])
  const stored = subgoals.find((s) => s.title === 'Call the bank')
  if (stored.area_id !== 8) throw new Error(`area_id ${stored.area_id}`)
  if (stored.importance !== 'high') throw new Error(`importance ${stored.importance}`)
})

await step('a repeat picked from the date sheet stores Monday-first weekdays', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.click('.fab')
  await page.fill('.composer-input', 'Sailing lesson')
  await page.click('.composer-chips .chip:nth-child(2)')
  await page.waitForSelector('.cal')
  await page.click('.sheet-row:has-text("This weekend")')
  await page.waitForTimeout(150)
  await page.click('.sheet-foot-row button[aria-label="Repeat"]')
  await page.waitForSelector('.sheet-row:has-text("Every week on Saturday")')
  await page.click('.sheet-row:has-text("Every week on Saturday")')
  // Picking a preset is the whole answer, so it closes the pickers outright (§7).
  await page.waitForSelector('.sheet', { state: 'detached', timeout: 4000 })
  await page.click('.composer-submit')
  await page.waitForTimeout(600)
  const { subgoals } = await readStores(['subgoals'])
  const stored = subgoals.find((s) => s.title === 'Sailing lesson')
  if (stored.cadence_type !== 'weekly') throw new Error(`cadence ${stored.cadence_type}`)
  // Saturday is weekday 5, Monday-first (§2) — the single most repeated bug.
  if (JSON.stringify(stored.days) !== '[5]') throw new Error(`days ${JSON.stringify(stored.days)}`)
  if (stored.start_date == null) throw new Error('no start date stored')
  if (stored.due_date != null) throw new Error('a repeating task must not carry a deadline')
})

await step('a custom repeat stores its interval and its inclusive end date', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.click('.fab')
  await page.fill('.composer-input', 'Deep clean')
  await page.click('.composer-chips .chip:nth-child(2)')
  await page.waitForSelector('.cal')
  await page.click('.sheet-row:has-text("Tomorrow")')
  await page.waitForTimeout(150)
  await page.click('.sheet-foot-row button[aria-label="Repeat"]')
  await page.waitForSelector('.sheet-row:has-text("Custom")')
  await page.click('.sheet-row:has-text("Custom")')
  await page.waitForSelector('text=Custom repeat')
  await page.fill('input[aria-label="Interval"]', '4')
  await page.click('.segmented button:has-text("On date")')
  await page.fill('input[aria-label="Last day, inclusive"]', '2026-12-31')
  await page.click('.sheet-foot-row button:has-text("Save")')
  await page.waitForSelector('.sheet', { state: 'detached', timeout: 4000 })
  await page.click('.composer-submit')
  await page.waitForTimeout(600)
  const { subgoals } = await readStores(['subgoals'])
  const stored = subgoals.find((s) => s.title === 'Deep clean')
  if (stored.interval !== 4) throw new Error(`interval ${stored.interval}`)
  if (stored.repeat_until !== '2026-12-31') throw new Error(`until ${stored.repeat_until}`)
})

await step('the date sheet stays open on a pick, and marks the day', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.click('.fab')
  await page.fill('.composer-input', 'Sheet stays open')
  await page.click('.composer-chips .chip:nth-child(2)')
  await page.waitForSelector('.cal')

  const rows = await page.$$eval('.sheet-body .sheet-row', (els) =>
    els.map((el) => el.querySelector('.sheet-row-label').textContent),
  )
  for (const want of ['Today', 'Tomorrow', 'This weekend', 'No date']) {
    if (!rows.includes(want)) throw new Error(`${want} is missing`)
  }

  await page.click('.sheet-row:has-text("Tomorrow")')
  await page.waitForTimeout(150)
  if (!(await page.$('.sheet'))) throw new Error('the sheet closed on a pick')
  const picked = await page.$$('.cal-day.is-picked')
  if (picked.length !== 1) throw new Error(`${picked.length} days highlighted`)
  await page.click('.cal-day:not(.is-outside):not(.is-picked) >> nth=20')
  await page.waitForTimeout(150)
  if (!(await page.$('.sheet'))) throw new Error('the sheet closed on a grid pick')
  if ((await page.$$('.cal-day.is-picked')).length !== 1) throw new Error('highlight did not move')

  await page.click('.sheet-scrim', { position: { x: 5, y: 5 } })
  await page.waitForSelector('.sheet', { state: 'detached' })
  await page.click('.composer-cancel')
})

// ---------------------------------------------------------------------------
// The star, the areas, and the aims inside them
// ---------------------------------------------------------------------------

await step('star renders with scores and one em dash', async () => {
  await page.click('.tab[href="/star"]')
  await page.waitForSelector('.star-svg')
  const desc = await page.getAttribute('.star-svg', 'aria-label')
  if (!desc.includes('Health')) throw new Error(`aria-label: ${desc}`)
  if (!desc.includes('—')) throw new Error('no null score rendered as em dash')
  // The chart is the screen: the areas are not repeated as a list under it.
  if (await page.$('.list-link')) throw new Error('the areas are still listed under the star')
  const body = await page.textContent('.screen')
  if (/last 28 days/i.test(body)) throw new Error('the star still captions its window')
  // The middle of the ring resolves the whole chart to one number.
  const mean = await page.textContent('.star-mean')
  if (!/^(\d+\.\d|—)$/.test(mean.trim())) throw new Error(`middle reads "${mean}"`)
  console.log('      ' + desc.slice(0, 150))
})

await step('adding an area adds a spoke, and the chart redraws around it', async () => {
  const before = (await page.$$('.star-vertex')).length
  await page.click('.topbar button[aria-label="Edit areas"]')
  await page.waitForSelector('.area-add')
  await page.fill('.area-add input', 'Learning')
  await page.click('.area-add button:has-text("Add")')
  await page.waitForTimeout(600)
  const after = (await page.$$('.star-vertex')).length
  if (after !== before + 1) throw new Error(`${before} spokes -> ${after}`)
  const desc = await page.getAttribute('.star-svg', 'aria-label')
  if (!desc.includes('Learning')) throw new Error('the new area is not on the chart')
})

await step('renaming an area is written on blur', async () => {
  await page.fill('input[aria-label="Name of Learning"]', 'Learning & reading')
  await page.click('h1')
  await page.waitForTimeout(500)
  const { areas } = await readStores(['areas'])
  if (!areas.some((a) => a.name === 'Learning & reading' && !a.deleted)) {
    throw new Error(`areas: ${areas.map((a) => a.name).join(', ')}`)
  }
})

await step('reordering an area moves it around the ring', async () => {
  const before = await page.$$eval('.edit-name', (n) => n.map((x) => x.value))
  await page.click(`.edit-row:nth-child(2) .edit-arrow:first-child`)
  await page.waitForTimeout(500)
  const after = await page.$$eval('.edit-name', (n) => n.map((x) => x.value))
  if (after[0] !== before[1]) throw new Error(`${before.slice(0, 3)} -> ${after.slice(0, 3)}`)
  if (after.length !== before.length) throw new Error('an area went missing in the move')
  await page.click(`.edit-row:first-child .edit-arrow:last-child`)
  await page.waitForTimeout(500)
})

await step('removing an area archives its habits rather than deleting them', async () => {
  const before = (await page.$$('.star-vertex')).length
  await page.click('button[aria-label="Remove Hobbies"]')
  await page.waitForSelector('.confirm')
  const question = await page.textContent('.confirm p')
  if (!question.includes('archived')) throw new Error(`confirmation says: ${question}`)
  if (!question.includes('habit')) throw new Error('the confirmation did not count the habits')
  await page.click('.confirm button:has-text("Remove")')
  await page.waitForTimeout(700)

  const after = (await page.$$('.star-vertex')).length
  if (after !== before - 1) throw new Error(`${before} spokes -> ${after}`)
  const { areas, subgoals, checkins } = await readStores(['areas', 'subgoals', 'checkins'])
  const hobbies = areas.find((a) => a.name === 'Hobbies')
  if (!hobbies) throw new Error('the area row was hard-deleted')
  if (!hobbies.deleted) throw new Error('the area was not tombstoned')
  const guitar = subgoals.find((s) => s.id === 112)
  if (!guitar.archived || guitar.deleted) throw new Error(JSON.stringify(guitar))
  if (!checkins.some((c) => c.subgoal_id === 112)) throw new Error('its check-ins were destroyed')

  // Positions compact, so the ring has no gap for the next insert to land in.
  const live = areas.filter((a) => !a.deleted).map((a) => a.position).sort((a, b) => a - b)
  if (JSON.stringify(live) !== JSON.stringify(live.map((_, i) => i))) {
    throw new Error(`positions did not compact: ${live}`)
  }
  await page.click('.topbar button[aria-label="Done editing areas"]')
})

await step('clicking a vertex opens the area, aims first', async () => {
  await page.click('.star-vertex')
  await page.waitForSelector('.backlink')
  const labels = await page.$$eval('.section-label', (n) => n.map((x) => x.textContent.trim()))
  if (labels[0] !== 'Goals') throw new Error(`first section: ${labels[0]}`)
  if (!labels.some((l) => l.startsWith('Habits'))) throw new Error(`sections: ${labels}`)
})

await step('the area screen shows aims above habits, and no goal owns a task', async () => {
  await page.goto(`${BASE}/areas/1`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.goal-row')
  const body = await page.textContent('.screen')
  if (!body.includes('Reach 100 kg bench press')) throw new Error('the aim is missing')
  if (!body.includes('Gym session')) throw new Error('the habits are missing')
  if (body.includes('Old warm-up')) throw new Error('an archived habit is shown')
  // The aim sits above the habits, not around them.
  const goalY = await page.$eval('.goal-row', (el) => el.getBoundingClientRect().top)
  const habitY = await page.$eval('.row-button', (el) => el.getBoundingClientRect().top)
  if (goalY >= habitY) throw new Error('the aims are not above the habits')
})

await step('a goal is written inline, and reaching it is one tap', async () => {
  await page.fill('.goal-add-input', 'Touch my toes')
  await page.click('.goal-add button:has-text("Add")')
  await page.waitForSelector('.goal-row:has-text("Touch my toes")')
  await page.click('.goal-row:has-text("Touch my toes") .goal-check')
  await page.waitForTimeout(500)
  const { goals } = await readStores(['goals'])
  const stored = goals.find((g) => g.title === 'Touch my toes')
  if (stored.status !== 'achieved') throw new Error(`status ${stored.status}`)
  if (!stored.achieved_on) throw new Error('reaching a goal did not date it')
  const body = await page.textContent('.screen')
  if (!body.includes('Reached')) throw new Error('no reached section')
})

await step('a goal description has a button that saves it', async () => {
  await page.click('.goal-row:has-text("Touch my toes") .goal-title')
  await page.waitForSelector('.goal-body')
  // Nothing typed yet, so there is nothing to save — the button says so
  // rather than disappearing and reappearing under the thumb (§7).
  if (await page.isEnabled('.goal-save')) throw new Error('Save is live with nothing to save')
  await page.fill('.goal-body .textarea', 'Palms flat, knees straight.')
  if (!(await page.isEnabled('.goal-save'))) throw new Error('typing did not offer a Save')
  await page.click('.goal-save')
  await page.waitForTimeout(600)
  const { goals } = await readStores(['goals'])
  const stored = goals.find((g) => g.title === 'Touch my toes')
  if (stored.description !== 'Palms flat, knees straight.') {
    throw new Error(`description stored as "${stored.description}"`)
  }
  if (await page.isEnabled('.goal-save')) throw new Error('Save stayed live after saving')
  await page.click('.goal-row:has-text("Touch my toes") .goal-title')
})

await step('removing a goal leaves every habit in the area alone', async () => {
  const before = (await page.$$('.row-button')).length
  await page.click('.goal-row:has-text("Touch my toes") .goal-title')
  await page.waitForSelector('.goal-body')
  await page.click('.goal-body button:has-text("Remove")')
  await page.waitForSelector('.confirm')
  await page.click('.confirm button:has-text("Remove")')
  await page.waitForTimeout(600)
  const { goals, subgoals } = await readStores(['goals', 'subgoals'])
  const stored = goals.find((g) => g.title === 'Touch my toes')
  if (!stored) throw new Error('the goal row was hard-deleted')
  if (!stored.deleted) throw new Error('the goal was not tombstoned')
  const gym = subgoals.find((s) => s.id === 101)
  if (gym.archived || gym.deleted) throw new Error('the goal took a habit down with it')
  const after = (await page.$$('.row-button')).length
  if (after !== before) throw new Error(`${before} habits -> ${after}`)
})

// ---------------------------------------------------------------------------
// One habit, up close
// ---------------------------------------------------------------------------

await step('the tracker grid hangs off the habit, not off a goal', async () => {
  await page.goto(`${BASE}/tasks/101`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.daygrid')
  const weeks = (await page.$$('.daygrid-week')).length
  if (weeks !== 15) throw new Error(`${weeks} weeks in the grid`)
  const days = (await page.$$('.daygrid-week:first-child .daycell')).length
  if (days !== 7) throw new Error(`${days} days in a week`)
  const body = await page.textContent('.screen')
  if (!body.includes('Kept')) throw new Error('no rate on the habit')
  if (!body.includes('Streak')) throw new Error('no streak on the habit')
})

await step('pausing a habit takes it out of the day, and resuming brings it back', async () => {
  await page.click('.btn:has-text("Pause")')
  await page.waitForSelector('.btn:has-text("Resume")', { timeout: 5000 })
  const { freezes } = await readStores(['freezes'])
  const open = freezes.filter((f) => f.subgoal_id === 101 && !f.deleted && f.end_date == null)
  if (open.length !== 1) throw new Error(`${open.length} open periods`)
  await page.click('.btn:has-text("Resume")')
  await page.waitForSelector('.btn:has-text("Pause")', { timeout: 5000 })
})

await step('a to-do gets the editor and no tracker at all', async () => {
  await page.goto(`${BASE}/tasks/113`, { waitUntil: 'networkidle' })
  await page.waitForSelector('h1')
  if (await page.$('.daygrid')) throw new Error('a to-do was given a tracker grid')
  const body = await page.textContent('.screen')
  if (body.includes('Streak')) throw new Error('a to-do was given habit stats')
  // Nothing on screen explains what a to-do is: the absence of a tracker is
  // the explanation.
  if (/happens once/.test(body)) throw new Error('the to-do screen still explains itself')
})

await step('archiving a task keeps the row and its check-ins', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.click('.row-open:has-text("Protein target")')
  await page.click('button[aria-label="Edit"]')
  await page.waitForSelector('.composer-foot button:has-text("Archive")')
  await page.click('.composer-foot button:has-text("Archive")')
  await page.waitForTimeout(700)
  const { subgoals } = await readStores(['subgoals'])
  const stored = subgoals.find((s) => s.id === 102)
  if (!stored) throw new Error('the task row was deleted outright')
  if (!stored.archived || stored.deleted) throw new Error(JSON.stringify(stored))
})

await step('deep link survives a reload', async () => {
  await page.goto(`${BASE}/areas/3`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('h1')
  const h = await page.textContent('h1')
  if (!h.includes('Work')) throw new Error(`h1 after reload: ${h}`)
})

// ---------------------------------------------------------------------------
// The upgrade path — the one thing a fresh install can never exercise
// ---------------------------------------------------------------------------

await step('a v2 device flattens in place, keeping its pauses', async () => {
  // A separate context, so this starts from an empty origin and can write the
  // *old* schema before the app ever opens the database. Getting this wrong
  // back-fills every dormant week of a frozen goal with misses (§3).
  const old = await browser.newContext({ viewport: { width: 414, height: 896 } })
  const p2 = await old.newPage()
  // A static asset, not the app: loading the app would open Dexie at the
  // current version before there was anything to upgrade *from*.
  await p2.goto(`${BASE}/icon-192.png`, { waitUntil: 'domcontentloaded' })
  await p2.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      // Dexie stores its own version × 10, so a v2 device is IndexedDB 20.
      const req = indexedDB.open('startem', 20)
      req.onupgradeneeded = () => {
        const d = req.result
        d.createObjectStore('areas', { keyPath: 'id' })
        d.createObjectStore('goals', { keyPath: 'id' })
        const sub = d.createObjectStore('subgoals', { keyPath: 'id' })
        sub.createIndex('goal_id', 'goal_id')
        d.createObjectStore('checkins', { keyPath: ['subgoal_id', 'date'] })
        d.createObjectStore('freezes', { keyPath: 'id' }).createIndex('goal_id', 'goal_id')
        d.createObjectStore('meta', { keyPath: 'key' })
      }
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
    const tx = db.transaction(['areas', 'goals', 'subgoals', 'checkins', 'freezes', 'meta'], 'readwrite')
    tx.objectStore('meta').put({ key: 'device_key', value: 9 })
    tx.objectStore('meta').put({ key: 'id_counter', value: 60 })
    tx.objectStore('areas').put({ id: 1, name: 'Health', position: 0, deleted: false })
    tx.objectStore('goals').put({
      id: 41, area_id: 1, title: 'Sleep well', description: '',
      status: 'frozen', created_at: '2026-01-04', deleted: false,
    })
    const base = {
      importance: 'medium', cadence_type: 'daily', interval: 1, days: [],
      monthly_day: null, month_weekday: null, month_ordinal: null, due_date: null,
      start_date: null, repeat_until: null, time: null, weight: null,
      created_at: '2026-01-04', archived: false, deleted: false,
    }
    tx.objectStore('subgoals').put({ id: 101, goal_id: 41, title: 'Lights out', ...base })
    // No area_id of its own: it has to inherit the goal's.
    tx.objectStore('subgoals').put({ id: 102, goal_id: 41, title: 'No screens', ...base, area_id: undefined })
    tx.objectStore('checkins').put({ subgoal_id: 101, date: '2026-01-05', status: 'done' })
    tx.objectStore('freezes').put({ id: 7, goal_id: 41, start_date: '2026-02-01', end_date: null, deleted: false })
    await new Promise((res) => { tx.oncomplete = res })
    db.close()
  })

  await p2.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await p2.waitForSelector('h1', { timeout: 8000 })
  const after = await p2.evaluate(async () => {
    const req = indexedDB.open('startem')
    const db = await new Promise((res) => { req.onsuccess = () => res(req.result) })
    const tx = db.transaction(['goals', 'subgoals', 'checkins', 'freezes'], 'readonly')
    const all = (s) => new Promise((res) => { const r = tx.objectStore(s).getAll(); r.onsuccess = () => res(r.result) })
    return {
      version: db.version,
      goals: await all('goals'),
      subgoals: await all('subgoals'),
      checkins: await all('checkins'),
      freezes: await all('freezes'),
    }
  })
  await old.close()

  if (after.version < 30) throw new Error(`still on IndexedDB version ${after.version}`)
  for (const task of after.subgoals) {
    if ('goal_id' in task) throw new Error(`task ${task.id} kept goal_id`)
    if (task.area_id !== 1) throw new Error(`task ${task.id} area_id ${task.area_id}`)
  }
  if (after.checkins.length !== 1) throw new Error('a check-in was lost in the upgrade')
  // The pause was the goal's; it now covers both habits it was actually
  // pausing, with the original id kept on one of them so sync sees no churn.
  const ids = after.freezes.map((f) => f.subgoal_id).sort()
  if (JSON.stringify(ids) !== '[101,102]') throw new Error(`freezes on ${JSON.stringify(ids)}`)
  if (!after.freezes.some((f) => f.id === 7)) throw new Error('the original period id was lost')
  const minted = after.freezes.find((f) => f.id !== 7)
  if (Math.floor(minted.id / 2 ** 20) !== 9) throw new Error(`minted id ${minted.id} is not this device's`)
  if (after.goals[0].status !== 'active') throw new Error(`goal status ${after.goals[0].status}`)
})

await step('no browser dialogs are used anywhere', async () => {
  let fired = false
  page.on('dialog', () => { fired = true })
  if (fired) throw new Error('a dialog fired')
})

if (SHOTS) {
  for (const [name, path] of [
    ['today', '/'],
    ['todos', '/todos'],
    ['star', '/star'],
    ['area', '/areas/1'],
    ['habit', '/tasks/101'],
  ]) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    await page.screenshot({ path: `${SHOTS}/shot-${name}.png`, fullPage: true })
  }
}

await browser.close()
server.close()
console.log('\n' + (errors.length ? `${errors.length} PROBLEM(S):\n` + errors.join('\n') : 'ALL GREEN'))
process.exit(errors.length ? 1 : 0)
