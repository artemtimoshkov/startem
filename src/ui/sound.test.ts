/**
 * The chime is the one part of a tick that is allowed to fail — SPEC.md §8.
 *
 * A tick is a database write; whether a speaker answered is not the app's
 * business. So these tests are mostly about the ways audio goes wrong: a
 * browser with no `Audio` at all, a constructor that throws, a `play()` the
 * autoplay policy rejects. None of them may reach the caller.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeAudio {
  src: string
  preload: string
  currentTime: number
  play: () => Promise<void>
}

let made: FakeAudio[]
let plays: number

/** A stand-in for the browser's `Audio`, with a per-test construction count. */
function fakeAudio(play: () => Promise<void> = () => Promise.resolve()) {
  return function Audio(this: FakeAudio, src: string) {
    this.src = src
    this.preload = 'none'
    this.currentTime = 0
    this.play = () => {
      plays++
      return play()
    }
    made.push(this)
  } as unknown as typeof globalThis.Audio
}

/** Re-imports the module so its one cached element starts out unmade. */
async function load(Audio: unknown) {
  vi.resetModules()
  vi.stubGlobal('Audio', Audio)
  return import('./sound')
}

beforeEach(() => {
  made = []
  plays = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the completion chime', () => {
  it('plays on a tick', async () => {
    const { playCompleteSound } = await load(fakeAudio())
    playCompleteSound()
    expect(plays).toBe(1)
    expect(made).toHaveLength(1)
    expect(made[0]!.src).toMatch(/complete\.mp3/)
  })

  it('reuses one element and restarts it, rather than stacking copies', async () => {
    const { playCompleteSound } = await load(fakeAudio())
    playCompleteSound()
    made[0]!.currentTime = 1.2 // as it would be, mid-chime
    playCompleteSound()
    expect(plays).toBe(2)
    expect(made).toHaveLength(1)
    expect(made[0]!.currentTime).toBe(0)
  })

  it('is primed at boot, before any tick', async () => {
    const { primeCompleteSound } = await load(fakeAudio())
    primeCompleteSound()
    expect(made).toHaveLength(1)
    expect(made[0]!.preload).toBe('auto')
    expect(plays).toBe(0)
  })

  it('is a no-op where the browser has no Audio', async () => {
    const { primeCompleteSound, playCompleteSound } = await load(undefined)
    expect(() => {
      primeCompleteSound()
      playCompleteSound()
    }).not.toThrow()
    expect(plays).toBe(0)
  })

  it('gives up quietly, and once, on a constructor that throws', async () => {
    let attempts = 0
    const Throwing = function () {
      attempts++
      throw new Error('no audio device')
    } as unknown as typeof globalThis.Audio

    const { playCompleteSound } = await load(Throwing)
    expect(() => {
      playCompleteSound()
      playCompleteSound()
    }).not.toThrow()
    expect(attempts).toBe(1)
  })

  it('swallows a play() the browser refuses', async () => {
    const { playCompleteSound } = await load(
      fakeAudio(() => Promise.reject(new Error('NotAllowedError'))),
    )
    expect(() => playCompleteSound()).not.toThrow()
    // An unhandled rejection would fail the run on the next tick of the loop.
    await Promise.resolve()
    expect(plays).toBe(1)
  })

  it('swallows a play() that throws outright', async () => {
    const { playCompleteSound } = await load(
      fakeAudio(() => {
        throw new Error('InvalidStateError')
      }),
    )
    expect(() => playCompleteSound()).not.toThrow()
  })
})
