/**
 * The pure core — SPEC.md §2–§6, §9.
 *
 * Nothing in here imports Dexie, Supabase, React or anything else. Plain rows
 * in, plain values out, so the identical file runs against IndexedDB on the
 * phone and against a JSON dump in a test, and the two can never disagree.
 */

export * from './types'
export * from './score'
export * from './state'
export * from './rows'
export * from './repeat'
