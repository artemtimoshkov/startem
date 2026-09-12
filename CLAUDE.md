# Startem

Personal habit tracker: areas → habits, scored on a radar chart. Goals are aims written on the area screen and own nothing; one-time to-dos live on their own tab and are never scored. Offline-first PWA installed on an iPhone home screen + the same build signed in on the web. Single user (Artem).

**SPEC.md is the source of truth.** Read it before changing scheduling, scoring, or sync behaviour. If code and SPEC.md disagree, the spec wins; if a change is deliberate, update SPEC.md in the same commit.

## Stack (decided — do not relitigate)

TypeScript + React + Vite SPA · vite-plugin-pwa · Dexie (IndexedDB) on device · Supabase (Postgres, magic-link Auth, RLS) · hand-rolled outbox sync, last-write-wins · Vercel static hosting · Cloudflare DNS-only subdomain. No Next.js, no CRDTs, no sync frameworks, no monorepo.

## Invariants that break silently if violated

- Weekdays are **Monday-first, zero-indexed** (0=Mon … 6=Sun). `getDay()` always needs `(d+6)%7`.
- Dates are **local-time `YYYY-MM-DD` strings** everywhere, compared lexicographically. Postgres columns are `date`, never `timestamptz` (only sync's `updated_at` is a timestamp).
- Scoring window is **28 days**, never 30. Standing-mode look-backs: 45 days monthly, 115 quarterly.
- Fixed monthly days are clamped to **1–28 on write and read**.
- **Archive, never delete** tasks — including when an area is removed; habits pause via **periods** (freezes table, keyed on `subgoal_id`), not a flag; sync deletes are **tombstones** (`deleted` flag), never hard deletes.
- **A goal owns nothing.** There is no `goal_id` on a task. A goal is an aim on the area screen with `status: active | achieved`; deleting one moves nothing else. Priority lives on the **task**.
- **Habit vs to-do is derived from `cadence_type`** (`once` = to-do) — never add a `kind` column. Only habits are scored: to-dos are filtered out before any tally.
- A task's `area_id` is its only parent and is **nullable** — null is *unfiled*: listed and ticked like any other task, on no spoke, scored by nothing. Zero is not an area; never repair a missing area to `0`. A new task starts unfiled. `repeat_until` is **inclusive**; a pause's `end_date` is **exclusive**. Repeat intervals anchor on `start_date ?? created_at`, never on today.
- Areas are user-managed (add / rename / reorder / remove, 1–20). The chart is `360° / count` — nothing may assume ten. Compact `position` on every removal.
- Today with no check-in is **pending**, not missed — excluded from the star's denominator, included in the calendar day's ratio. That inconsistency is deliberate (SPEC §6).
- `src/core` is **pure**: it must import nothing — no Dexie, no Supabase, no React. Plain rows in, plain values out.

## Working rules

- Every change to `src/core` needs unit tests (Vitest); cadence and window rules are where all past bugs lived.
- A Dexie schema change needs a test in `src/db/migrate.test.ts`: it builds a real old-version store through raw IndexedDB, so the upgrade runs for real. That path executes once, offline, with no retry.
- No browser dialogs (`alert`/`confirm`) — confirmation is inline UI.
- `100dvh`, never `100vh`. PNG icons only for iOS (SVG apple-touch-icon is ignored).
- Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. The anon key is public by design; RLS is the security boundary.
- `npm run dev` / `npm test` / `npm run build`. One package.json at the root.
