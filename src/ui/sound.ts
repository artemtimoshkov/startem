/**
 * The one sound the app makes — SPEC.md §8.
 *
 * A short chime on the tick that marks something done, and nowhere else: not
 * on untick, not on a cross-out, not on a save. Ticking a habit off is the
 * gesture the whole app exists for, and it is the only one worth a noise.
 *
 * An `<audio>` element rather than the Web Audio API, deliberately: on iOS an
 * element's output follows the ring/silent switch, so a phone flicked to
 * silent silences the app too — which is what flicking it to silent means.
 * There is no in-app toggle for the same reason.
 *
 * Every call is wrapped: a browser with no audio output, a blocked autoplay
 * policy or a failed decode costs the chime and nothing else. The tick itself
 * is a database write and must never ride on whether a speaker answered.
 */

import chimeUrl from './complete.mp3'

let chime: HTMLAudioElement | null = null
/** Set once construction has failed, so it is not retried on every tick. */
let unavailable = false

/**
 * The element, made on first use. `prime` calls this at boot so the file is
 * fetched and decoded before the first tick needs it; the tick itself is the
 * user gesture iOS requires, and only `play` is gated on that.
 */
function element(): HTMLAudioElement | null {
  if (chime || unavailable) return chime
  if (typeof Audio === 'undefined') {
    unavailable = true
    return null
  }
  try {
    chime = new Audio(chimeUrl)
    chime.preload = 'auto'
  } catch {
    unavailable = true
  }
  return chime
}

/** Warms the chime at boot, so the first tick of a session is not the slow one. */
export function primeCompleteSound(): void {
  element()
}

/**
 * Plays the completion chime. Never throws.
 *
 * Two ticks in quick succession restart it rather than stacking two copies —
 * a chord of chimes from a fast run down the list is worse than one.
 */
export function playCompleteSound(): void {
  const el = element()
  if (!el) return
  try {
    el.currentTime = 0
    void el.play().catch(() => {})
  } catch {
    /* No sound is not a failure worth surfacing. */
  }
}
