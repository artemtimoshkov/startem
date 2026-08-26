/**
 * Generates the app icons — SPEC.md §9, §12.
 *
 * They have to be **PNG**: iOS ignores an SVG `apple-touch-icon` entirely and
 * shows a screenshot of the page instead, which is the kind of failure you only
 * notice once the thing is already on your home screen.
 *
 * Rather than check in five opaque binaries, the mark is defined here and
 * rasterised on demand: `npm run icons`. No image library — a PNG is a zlib
 * stream of filtered scanlines, and Node has zlib.
 *
 * The mark is the app's own subject: concentric pentagons, an outer ring at
 * full reach and an uneven inner one, which is what the star on the home screen
 * actually looks like when some areas are doing better than others.
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const OUT = join(dirname(new URL(import.meta.url).pathname), '..', 'public')

// --- palette (SPEC.md §8) --------------------------------------------------
const ACCENT = [0x3d, 0x6a, 0x8f]
const WHITE = [0xff, 0xff, 0xff]

// --- PNG encoding ----------------------------------------------------------

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** `rgba` is a Uint8Array of size*size*4. */
function encodePNG(size, rgba) {
  const stride = size * 4
  // Filter type 0 (none) in front of every scanline.
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // 8 bits per channel
  ihdr[9] = 6 // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- geometry --------------------------------------------------------------

/** Vertices of a polygon, first at twelve o'clock and going clockwise — the
 *  same convention as the chart itself (§6). */
function polygon(cx, cy, radii) {
  const n = radii.length
  return radii.map((r, i) => {
    const a = (-90 + (360 / n) * i) * (Math.PI / 180)
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
  })
}

function inPolygon(x, y, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function distToPolygonEdge(x, y, pts) {
  let best = Infinity
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [x1, y1] = pts[j]
    const [x2, y2] = pts[i]
    const dx = x2 - x1
    const dy = y2 - y1
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2))
    const px = x1 + t * dx
    const py = y1 + t * dy
    best = Math.min(best, Math.hypot(x - px, y - py))
  }
  return best
}

// --- the mark --------------------------------------------------------------

/**
 * `reach` is the mark's radius as a fraction of the icon: smaller for the
 * maskable variant, whose safe zone is only the inner 80% circle, and for the
 * iOS icon, whose corners the system crops into a squircle.
 */
function drawIcon(size, reach) {
  const SS = 4 // supersample for antialiasing
  const n = size * SS
  const c = n / 2
  const R = c * reach

  const ring = polygon(c, c, Array(5).fill(R))
  // Deliberately uneven: this is a chart of a real week, not a logo mark.
  // Clearly inside the ring — the gap is what makes it read as a reading
  // against a scale rather than as one lumpy polygon.
  const inner = polygon(c, c, [0.58, 0.68, 0.38, 0.5, 0.44].map((f) => R * f))
  const stroke = Math.max(1.5 * SS, R * 0.085)

  const acc = new Float32Array(size * size * 4)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let colour = ACCENT
      let alpha = 1
      if (inPolygon(x + 0.5, y + 0.5, inner)) {
        colour = WHITE
      } else if (distToPolygonEdge(x + 0.5, y + 0.5, ring) <= stroke / 2) {
        colour = WHITE
      }
      const o = (Math.floor(y / SS) * size + Math.floor(x / SS)) * 4
      acc[o] += colour[0]
      acc[o + 1] += colour[1]
      acc[o + 2] += colour[2]
      acc[o + 3] += alpha * 255
    }
  }

  const out = new Uint8Array(size * size * 4)
  const per = SS * SS
  for (let i = 0; i < out.length; i++) out[i] = Math.round(acc[i] / per)
  return encodePNG(size, out)
}

// --- outputs ---------------------------------------------------------------

const ICONS = [
  // iOS crops the corners into a squircle, so the mark keeps clear of them.
  ['apple-touch-icon-180.png', 180, 0.6],
  ['icon-192.png', 192, 0.66],
  ['icon-512.png', 512, 0.66],
  // Maskable: the guaranteed-visible area is the inner 80% circle, so the mark
  // must sit inside radius 0.4 — anything wider can be shaved off by the mask.
  ['icon-maskable-512.png', 512, 0.5],
  ['favicon-32.png', 32, 0.72],
]

mkdirSync(OUT, { recursive: true })
for (const [name, size, reach] of ICONS) {
  const png = drawIcon(size, reach)
  writeFileSync(join(OUT, name), png)
  console.log(`${name.padEnd(26)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} kB`)
}
