/**
 * Installability and the airplane-mode test — SPEC.md §9, §12.
 *
 * The whole point of milestone 3 is that the app opens with no network. That is
 * not something unit tests can tell you, and it is not something to find out
 * on a plane, so it is checked here against the real service worker.
 *
 *   npm run build:e2e && npm run e2e
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { serve } from './serve.mjs'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const errors = []

const server = await serve(Number(new URL(BASE).port || 80))
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
)
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

const step = async (name, fn) => {
  try {
    await fn()
    console.log(`  ok  ${name}`)
  } catch (e) {
    console.log(`FAIL  ${name}: ${e.message}`)
    errors.push(`${name}: ${e.message}`)
  }
}

/** Waits until a service worker is actually controlling the page. */
const awaitController = () =>
  page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (navigator.serviceWorker.controller) return true
    return new Promise((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(true), {
        once: true,
      })
      setTimeout(() => resolve(Boolean(navigator.serviceWorker.controller)), 8000)
    })
  })

await page.goto(BASE, { waitUntil: 'networkidle' })

await step('the manifest is linked, and says standalone', async () => {
  const href = await page.getAttribute('link[rel=manifest]', 'href')
  if (!href) throw new Error('no manifest link')
  const manifest = await page.evaluate(async (h) => (await fetch(h)).json(), href)
  if (manifest.display !== 'standalone') throw new Error(`display is ${manifest.display}`)
  if (manifest.start_url !== '/') throw new Error(`start_url is ${manifest.start_url}`)
  for (const size of ['192x192', '512x512']) {
    if (!manifest.icons.some((i) => i.sizes === size)) throw new Error(`no ${size} icon`)
  }
  const maskable = manifest.icons.find((i) => i.purpose === 'maskable')
  if (!maskable) throw new Error('no maskable icon')
  console.log(`      ${manifest.icons.length} icons, maskable: ${maskable.src}`)
})

await step('every declared icon is a real PNG, including the iOS one', async () => {
  // The trap: iOS ignores an SVG apple-touch-icon entirely and shows a
  // screenshot of the page instead (§12). So the bytes get checked, not the
  // file extension.
  const apple = await page.getAttribute('link[rel=apple-touch-icon]', 'href')
  if (!apple) throw new Error('no apple-touch-icon')
  const paths = [apple, '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/favicon-32.png']
  for (const path of paths) {
    const head = await page.evaluate(async (p) => {
      const res = await fetch(p)
      if (!res.ok) return { status: res.status }
      const bytes = new Uint8Array((await res.arrayBuffer()).slice(0, 8))
      return { status: 200, magic: [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('') }
    }, path)
    if (head.status !== 200) throw new Error(`${path} → ${head.status}`)
    if (head.magic !== '89504e470d0a1a0a') throw new Error(`${path} is not PNG (${head.magic})`)
  }
  console.log(`      ${paths.length} PNGs verified by magic bytes`)
})

await step('the service worker takes control and precaches the bundle', async () => {
  if (!(await awaitController())) throw new Error('no controller after 8s')
  const cached = await page.evaluate(async () => {
    const names = await caches.keys()
    let total = 0
    const urls = []
    for (const n of names) {
      const keys = await (await caches.open(n)).keys()
      total += keys.length
      urls.push(...keys.map((r) => new URL(r.url).pathname))
    }
    return { names, total, urls }
  })
  if (cached.total < 5) throw new Error(`only ${cached.total} cached entries`)
  if (!cached.urls.some((u) => u.endsWith('.js'))) throw new Error('no JS precached')
  if (!cached.urls.some((u) => u === '/' || u.endsWith('index.html')))
    throw new Error('no shell precached')
  console.log(`      ${cached.total} entries in ${cached.names.join(', ')}`)
})

await step('the seeded sample gives us something to find offline', async () => {
  // `build:e2e` loads migration/sample-export.json into an empty store on boot.
  await page.waitForSelector('.row-title', { timeout: 8000 })
})

await step('AIRPLANE MODE: opens with the network cut', async () => {
  await ctx.setOffline(true)
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.row-title', { timeout: 12000 })
  const titles = await page.$$eval('.row-title', (n) => n.map((x) => x.textContent.trim()))
  if (titles.length === 0) throw new Error('no items rendered offline')
  console.log(`      offline today list: ${titles.join(' | ')}`)
})

await step('AIRPLANE MODE: the star still computes', async () => {
  await page.click('.tab[href="/star"]')
  await page.waitForSelector('.star-svg', { timeout: 8000 })
  const desc = await page.getAttribute('.star-svg', 'aria-label')
  if (!/\d\.\d/.test(desc)) throw new Error(`no scores offline: ${desc}`)
})

await step('AIRPLANE MODE: a deep link falls back to the cached shell', async () => {
  // The offline twin of §11's vercel.json rewrite: a navigation to a route that
  // was never a real file has to resolve to the shell.
  await page.goto(`${BASE}/goals/43`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('h1', { timeout: 8000 })
  const h = await page.textContent('h1')
  if (!h.includes('Startem v2')) throw new Error(`h1 offline: ${h}`)
})

await step('AIRPLANE MODE: ticking still writes', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.row .check')
  const before = await page.textContent('.progress-head .big')
  await page.click('.row:first-of-type .check:not(.cross)')
  await page.waitForTimeout(400)
  const after = await page.textContent('.progress-head .big')
  if (before.trim() === after.trim()) throw new Error('no change while offline')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.progress-head .big')
  const persisted = await page.textContent('.progress-head .big')
  if (persisted.trim() !== after.trim()) throw new Error(`lost on reload: ${persisted}`)
  console.log(`      wrote and reloaded offline at ${persisted.trim()}`)
  await ctx.setOffline(false)
})

await step('the SPA rewrite serves a deep link online too', async () => {
  const status = await page.evaluate(async (base) => (await fetch(`${base}/goals/43`)).status, BASE)
  if (status !== 200) throw new Error(`deep link → ${status}`)
})

await step('a new deploy lands quietly, without reloading the page', async () => {
  // §9 wants the update to replace the cached bundle for the *next* launch and
  // announce itself with a quiet toast — not to reload the page out from under
  // whatever is on screen. That behaviour hangs on two hand-wired details: the
  // `skipWaiting`/`clientsClaim` this config sets itself (the plugin only forces
  // them when it injects its own registration), and passing `onNeedReload`,
  // which is what suppresses the automatic location.reload().
  const swPath = new URL('../dist/sw.js', import.meta.url).pathname
  const original = readFileSync(swPath, 'utf8')
  try {
    await page.goto(BASE, { waitUntil: 'networkidle' })
    if (!(await awaitController())) throw new Error('no controller to update from')
    // A sentinel that a reload would wipe out.
    await page.evaluate(() => {
      window.__survived = true
    })

    // Any byte change makes the browser treat it as a new worker.
    appendFileSync(swPath, `\n// deploy ${Date.now()}\n`)
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      await reg?.update()
    })

    await page.waitForSelector('.toast', { timeout: 15000 })
    const toast = (await page.textContent('.toast')) ?? ''
    if (!/updated/i.test(toast)) throw new Error(`toast said: ${toast}`)
    const survived = await page.evaluate(() => window.__survived === true)
    if (!survived) throw new Error('the page reloaded instead of updating quietly')
    console.log(`      "${toast.trim()}" — and the page stayed put`)
  } finally {
    writeFileSync(swPath, original)
  }
})

await step('no browser dialog is ever used', async () => {
  let fired = false
  page.on('dialog', () => {
    fired = true
  })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  if (fired) throw new Error('a dialog fired')
})

await browser.close()
server.close()
console.log('\n' + (errors.length ? `${errors.length} PROBLEM(S):\n` + errors.join('\n') : 'OFFLINE OK'))
process.exit(errors.length ? 1 : 0)
