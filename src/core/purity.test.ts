/**
 * SPEC.md §9 — "Keep the core platform-free".
 *
 * The scoring and view-building code must import *nothing*: no database, no
 * network, no framework. That single discipline is what lets the identical
 * file run against IndexedDB on the phone and against a JSON dump in a test,
 * and it means the two can never disagree. This test is the guard rail.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CORE_DIR = new URL('.', import.meta.url).pathname

const sourceFiles = readdirSync(CORE_DIR).filter(
  (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'test-fixtures.ts',
)

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^\n]*?from\s+['"]([^'"]+)['"]/g

describe('src/core imports nothing', () => {
  it('has source files to check', () => {
    expect(sourceFiles.sort()).toEqual([
      'index.ts',
      'repeat.ts',
      'rows.ts',
      'score.ts',
      'state.ts',
      'types.ts',
    ])
  })

  for (const file of sourceFiles) {
    it(`${file} only imports its siblings`, () => {
      const src = readFileSync(join(CORE_DIR, file), 'utf8')
      const specifiers = [...src.matchAll(IMPORT_RE)].map((m) => m[1]!)
      for (const spec of specifiers) {
        expect(spec, `${file} imports ${spec}`).toMatch(/^\.\/[a-z-]+$/)
      }
      // No dynamic imports or requires either.
      expect(src).not.toMatch(/\brequire\s*\(/)
      expect(src).not.toMatch(/\bimport\s*\(/)
    })
  }

  it('touches no global platform APIs beyond Date and Math', () => {
    // Comments are stripped first: "a 30-day window" is prose, not a global.
    const strip = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const forbidden =
      /\b(window|document|localStorage|sessionStorage|indexedDB|navigator|fetch|XMLHttpRequest|process|globalThis|require)\b/

    for (const file of sourceFiles) {
      const code = strip(readFileSync(join(CORE_DIR, file), 'utf8'))
      const hit = forbidden.exec(code)
      expect(hit?.[0], `${file} reaches for ${hit?.[0]}`).toBeUndefined()
    }
  })
})
