# Startem Build Spec — v2.1, 26 August 2026

Everything needed to rebuild the app from nothing: every field, every scheduling rule, the scoring maths, the mistakes already paid for once — and the decided stack it ships on.

Canonical styled copy: https://claude.ai/code/artifact/0ca4ef8a-35f0-40d4-ba83-01971ffdcc44

---

## 1. What the app is

A personal goal tracker built on one idea: life splits into a handful of **areas**, and each area is only as healthy as the habits you actually keep in it.

The structure is three levels deep:

| Level | What it is | Example |
|---|---|---|
| **Area** | A vertex on the radar chart. Fixed set, renameable. | Health |
| **Goal** | An ambition. Carries importance. Never directly checked off. | Reach 100 kg bench press |
| **Action** | A recurring thing you do. This is what gets ticked. | Gym session, Mon/Wed/Sat |

Completing actions, weighted by the importance of the goal they serve, is the only thing that moves an area's score. Goals themselves are never "done" — they are directions, not tasks.

Two views: the **star** (where you stand now) and a **day-by-day grid** (what actually happened, and a way to fix a day you forgot to log).

It runs in two places off one codebase: **installed on the iPhone home screen** as an offline-first web app, and **signed in on the web** at a subdomain. Both are the same deployed site; the phone install simply keeps its own copy of the data and syncs it.

## 2. Conventions that everything depends on

Get these two wrong and every date calculation in the app is subtly broken.

### Weekdays are Monday-first, zero-indexed

`0` = Monday through `6` = Sunday. JavaScript's `getDay()` is Sunday-first, so it always needs converting:

```
dow(date) = (new Date(y, m-1, d).getDay() + 6) % 7
```

### Dates are local-time `YYYY-MM-DD` strings, never timestamps

Every date in the system is a plain string. They sort and compare lexicographically, which is why `date > today` works directly.

> **Why this matters:** If dates were UTC timestamps, ticking something off at 23:50 would land on tomorrow for anyone west of Greenwich — the user would tick a box and watch it appear on the wrong day. Local-time strings mean a check-in always belongs to the day the person actually lived.

This convention survives the round trip to the server: in Postgres these columns are `date` (or text), **never** `timestamptz`. Only sync metadata (`updated_at`) is a real timestamp, because it orders writes rather than describing a lived day.

## 3. Data model

Five tables. Field names below are the storage names — the same shapes work in SQLite, Postgres or IndexedDB.

### areas

| Field | Type | Notes |
|---|---|---|
| id | int, pk | — |
| name | text | Renameable by the user. |
| position | int | Order around the chart, clockwise from the top. |

Default set of ten: Health, Hobbies, Work, Business, Friends, Family, Purpose, Money, Relationship, Other. The chart adapts to any count — it divides 360° by however many there are.

### goals

| Field | Type | Notes |
|---|---|---|
| id | int, pk | — |
| area_id | int, fk | → areas.id |
| title | text | — |
| description | text | Optional. Free text — used for definitions of done, prompts. |
| status | enum | `active` / `frozen` — frozen goals leave scoring entirely. |
| importance | enum | `high` / `medium` / `low`, default `medium`. Sets the weight of every occurrence. |
| created_at | date | Nothing is scheduled before this date. |

### subgoals — the recurring actions

| Field | Type | Notes |
|---|---|---|
| id | int, pk | — |
| goal_id | int, fk | → goals.id |
| title | text | — |
| cadence_type | enum | `weekly` / `monthly` / `quarterly` / `once` |
| days | json int[] | Weekly only. Weekday numbers, e.g. `[0,2,5]`. Empty for other cadences. |
| monthly_day | int, null | Monthly/quarterly, fixed-date mode. **Held to 1–28.** |
| month_weekday | int, null | Monthly/quarterly, weekday mode. `0–6`. Non-null selects this mode. |
| month_ordinal | int, null | `1–4`, or `-1` for last. Pairs with month_weekday. |
| due_date | date, null | One-time only. Optional — a one-time action can have no deadline. |
| weight | int, null | Overrides the goal's importance weight for this action alone. |
| created_at | date | Nothing is scheduled before this date. |
| archived | bool | Removed from the interface, but its history stays meaningful. |

> **Archive, never delete:** When a user removes an action while editing a goal, set `archived` rather than deleting the row. Its past check-ins still exist and still describe real days; deleting the action would orphan them and silently rewrite history.

### checkins

| Field | Type | Notes |
|---|---|---|
| subgoal_id | int, fk | → subgoals.id |
| date | date | Unique together with subgoal_id. This pair is the real key. |
| status | enum | `done` / `skipped` |

**No row means unresolved**, which is different from missed. A past day with no row is a miss; today with no row is still pending. `skipped` is the user saying "not doing this today" — an explicit, immediate miss.

### freezes

| Field | Type | Notes |
|---|---|---|
| id | int, pk | — |
| goal_id | int, fk | → goals.id |
| start_date | date | — |
| end_date | date, null | Null means still frozen. |

> **Why freezes are periods, not a flag:** `goals.status` alone would tell you a goal is frozen *now*, but not that it was frozen last March. Without the periods, unfreezing a goal would retroactively fill its dormant weeks with misses. A date is frozen when a period covers it:
>
> ```
> frozen(date) = any period where
>   start_date <= date AND (end_date IS NULL OR date < end_date)
> ```
>
> Note the asymmetry — `end_date` is exclusive, so unfreezing makes that same day live again.

For sync, every row in every table additionally carries `updated_at` (timestamp) and `deleted` (bool tombstone) — see §10. They are sync plumbing, invisible to all the logic above.

## 4. Cadences: when an action comes due

One predicate underpins everything. An action comes due on a date if all the guards pass and its cadence matches:

```
isScheduled(action, date):
  if action.archived                 -> false
  if action.created_at > date        -> false      // did not exist yet
  if frozen(date, goal's periods)    -> false

  weekly    -> action.days includes dow(date)
  monthly   -> monthPattern(action, date)
  quarterly -> monthPattern(action, date) AND month(date) in [1,4,7,10]
  once      -> false                               // never recurs
```

### Monthly and quarterly have two modes

```
monthPattern(action, date):
  if action.month_weekday is null:
      return dayOfMonth(date) == clamp(action.monthly_day, 1, 28)

  if dow(date) != action.month_weekday: return false
  ordinal = action.month_ordinal ?? -1
  if ordinal == -1:                              // "last"
      return month(date + 7 days) != month(date)
  return ceil(dayOfMonth(date) / 7) == ordinal
```

If neither mode is configured — `month_weekday` and `monthly_day` both null — the action never comes due. Normalisation keeps the two modes mutually exclusive on write, so a stored row cannot reach that state.

The "last" test: a date is the last of its weekday in the month exactly when seven days later lands in a different month. And `ceil(day / 7)` gives the ordinal because the 1st–7th always hold the first of every weekday, the 8th–14th the second, and so on.

> **Why fixed days stop at 28:** Days 29–31 don't exist in every month. An action on "day 31" would silently never come due in February, April, June, September or November — no error, just five months a year where a commitment quietly vanishes. So fixed days are clamped to 1–28 *both* on write and on read, and **"last Friday" is the only correct way to express genuine month-end.**

### One-time actions

They never recur — `isScheduled` is false for them on every date. A one-time action is a win once completed, a standing miss once its deadline passes, and simply not yet owed before then. With no `due_date` it sits in the list indefinitely until done, and never counts against anything.

They do still score, though, so ticking one moves the calendar and the star. Since they have no cadence to walk, each gets **exactly one occurrence, on one effective date**:

```
onceOccurrence(action, today):
  if logged (a check-in exists)   -> { date: the check-in's date, resolved }
  if due_date != null AND due_date < today
                                  -> { date: due_date, unresolved }   // standing miss
  otherwise                       -> none    // due today is pending; no deadline never counts
```

Credit lands on the day the work actually happened rather than on the deadline, because that is the day the calendar is a record of. The occurrence is then windowed like every other one, so a win ages out of the star after 28 days instead of propping it up forever — and an overdue one stops dragging after 28 days too, while remaining in the todo list until it is done or archived.

> **Why the effective date and not the deadline:** a one-time action with no `due_date` has no other date to attach to, and the spec still wants it to count as a win once done. Keying the occurrence to the check-in covers both cases with one rule.



## 5. Scoring

The model is a **weighted pool of occurrences**. Every time an action comes due it is worth its weight. An area's score is the weight completed over the weight that came due.

### Weights

| Importance | Weight | Meaning |
|---|---|---|
| high | 4 | Each occurrence counts four times a low one. |
| medium | 2 | Default. |
| low | 1 | — |

An action inherits its goal's weight unless `subgoals.weight` overrides it.

> **Frequency multiplies weight:** A daily low action generates 7 × 1 = 7 per week; a weekly high action generates 1 × 4 = 4. The daily trivial habit outweighs the weekly critical one. That is deliberate — it measures total weighted effort delivered — but it is the first thing to revisit if the scores ever feel wrong. Widening the spread (say 10/3/1) shifts the balance toward importance over frequency.

### The window is 28 days, and the number matters

Over 28 days every weekday falls *exactly* four times. Over 30 days, two weekdays fall five times and five fall four — and which ones drifts with the calendar.

> **Do not "round up" to 30:** With a 30-day window a Wednesday action gets 4 or 5 chances depending on today's date, so the calendar silently re-weights actions underneath the weights the user set. Verified across a year: 28 days gives a fixed count, 30 does not. A 30-day window can also contain the same monthly date *twice* (1 Feb and 1 Mar are 28 days apart), double-counting one commitment.

### What counts as a resolved occurrence

1. Walk each day in the window. Skip days the action wasn't due.
2. **If the day is today and has no check-in, skip it.** Today is pending, not failed.
3. Otherwise it counts toward the denominator; if `status == done` it counts toward the numerator too.

So `skipped` and a past unlogged day behave identically in the maths — both are misses. The difference is only that crossing out registers immediately rather than waiting for midnight.

One-time actions have no days to walk, so their single occurrence (§4) is counted directly: it contributes if its effective date falls inside the range being scored.

### Rare cadences need two different readings

A 28-day window can miss a monthly action's date entirely (a 28-day span inside a 31-day month may contain no 1st). Left alone, a monthly commitment would drop out of the score at random. So:

| Mode | Rule | Used by |
|---|---|---|
| standing | The action's *most recent* due instance represents it, found by scanning back day by day until the first hit. An unresolved **today** is skipped and the scan continues, so last month's result stands in until today is logged rather than the action dropping out for a day. | The star, goal percentages |
| range | Only what genuinely came due inside the range. | Weekly history, calendar days |

Weekly actions, and the single occurrence of a one-time one, need none of this — they read the plain 28-day window. Look-backs for standing mode: **45 days** monthly, **115 days** quarterly. Consecutive "last Sunday" dates can sit 35 days apart and quarterly ones about 97, so the reach must exceed that comfortably. Scanning further is harmless — the scan stops at the first match, which is by definition the latest one.

### The formula

```
rate  = earned / available          // null if available == 0
score = round((1 + rate * 9) * 10) / 10
```

So 0% → **1.0** and 100% → **10.0**. The floor is 1 because a 1–10 chart cannot draw a zero-length spoke. When `available` is 0 the score is **null**, rendered as an em dash — an area with nothing scheduled has no opinion, which is different from scoring badly.

### Three levels of percentage

| Shown on | Computed as |
|---|---|
| Area (the chart) | Weighted pool across all *active* goals in the area, standing mode, 28 days. |
| Goal (card header) | Same pool, restricted to that one goal. |
| Action (next to it) | *Unweighted* — occurrences done ÷ occurrences resolved. Weight is irrelevant when comparing an action to itself. |

### Frozen goals

Excluded from every score, absent from the todo list, and their frozen days never count as misses. History is preserved, importance is remembered, and unfreezing restores everything. An area whose goals are *all* frozen scores null, not zero.

## 6. The five derived views

All five are pure functions of the stored rows plus today's date. None of them needs storing.

### Today's list

Every action due today across active goals, **sorted heaviest first** so the day's most important work is at the top. Grouped by area in the order the groups first appear, which follows from the sort.

One-time actions are the exception: they appear while pending regardless of date, plus on the day they were completed. Progress reads `done of (total − crossed out)`, so crossing something out removes it from the target rather than making the day unwinnable.

### The star

A radar chart, one vertex per area, first at twelve o'clock and going clockwise. Faint rings at 2, 4, 6, 8, 10. Vertices are interactive — clicking one opens that area. A null score draws at the midpoint with a hollow dot and an em-dash label.

```
angle(i) = -90° + (360° / count) * i
radius(i) = R * score(i) / 10
```

### Weekly history strip

**8** calendar weeks, Monday-start, one bar per week, using *range* mode. The current week is scored on the days resolved so far. Weeks with nothing due render flat rather than empty, so a gap is visibly different from a zero.

### Per-goal tracker grid

**15** weeks of day cells for a single goal. Cell states:

| State | When |
|---|---|
| done | Every action due that day was completed. |
| partial | Some but not all, and the day is past. |
| missed | Something was due, none of it done, day is past. |
| today | Today, with anything still unresolved. |
| none | Nothing was due. |
| frozen | The goal was frozen that day. |
| future | Hasn't happened. |

### Day-by-day calendar

**26** weeks across all active goals, Monday-aligned columns, ending with the week containing today. Each day carries weighted totals: `total`, `done`, `skipped`, `count`, `doneCount`, `ratio`. Colour runs in five bands from "nothing logged" through to "everything logged".

Hovering a day shows tasks completed and the weighted amount. Clicking opens that day as an editable checklist.

> **One deliberate inconsistency:** A day cell's `ratio` counts *all* weight due, including today's unresolved items — so today reads as progress so far. The star excludes unresolved items instead. Both are right for their purpose: a calendar is a record of a day, the star is a judgement about a standing. Don't "fix" one to match the other.

The day detail view includes pending items — it's a checklist, so it must show what was owed as well as what was logged. For **today** it also includes pending one-time actions so it matches the Today list exactly; for a **past** day it does not, because a task due next week was not owed back then — with one exception: a one-time action whose own occurrence lands on that day (it was logged then, or that day was the deadline it blew past) *was* owed then, and shows.

## 7. What the user can do

| Action | Effect |
|---|---|
| Tick an item | Writes `done`. Ticking again clears the row back to unresolved. |
| Cross out an item | Writes `skipped` — an immediate miss. Reversible; restoring returns it to pending. |
| Back-date | Any day within **182 days** (26 weeks) can be edited. Anything visible in the calendar is correctable; future dates never are. |
| Freeze / unfreeze a goal | Opens or closes a freeze period, and flips `status`. |
| Create / edit a goal | Title, area, description, importance, and any number of actions each with its own cadence and optional weight override. |
| Delete a goal | Removes the goal, its actions, their check-ins and its freeze periods. Confirm inline — never with a browser dialog. |
| Rename an area | Name only. Areas are not created or destroyed by the user. |
| Sign in / out | Magic-link email sign-in. Signing out keeps local data on the device; signing in merges it up. See §10. |

> **Deliberately not built — a minimum-sample gate.** Without it, the first check-in on a brand-new goal reads as 10.0, because it is genuinely 100% of one resolved obligation. This was considered and rejected — it self-corrects within a week or two of real history. If the early days ever feel meaningless, the fix is to hide a score until some number of weighted occurrences have resolved, rather than to fudge the arithmetic.

## 8. Design system

Restrained, typographic, hairline-ruled. System font stack — on Apple hardware that is SF, which suits the aesthetic and costs nothing to load.

### Palette

| Token | Value | Use |
|---|---|---|
| --bg | #f7f8fa | Page ground. Cool-biased, never neutral grey. |
| --surface | #ffffff | Panels, cards. |
| --text | #191c21 | — |
| --text-secondary | #767e8a | — |
| --text-tertiary | #adb4bd | Labels, empty states. |
| --hairline | rgba(25,28,33,.09) | Nearly all borders. |
| --accent | #3d6a8f | Structural only — the chart, progress, selection. |
| --imp-high | #c8443a | Semantic priority colours, separate from the accent. |
| --imp-medium | #cf8c22 | Priority reads as red / amber / green on the card stripe, |
| --imp-low | #3a8f5c | the dot, the Today bar and the editor. |

Greys are all tinted slightly toward the accent so nothing reads as a stray warm neutral. Shadows carry the palette's hue rather than flat black. Radii step by depth: 16px containers, 12px default, 8px inner elements.

### Non-negotiables

- **Frozen goals show a neutral grey stripe**, not their priority colour — advertising urgency for something excluded from scoring is a lie.
- **Tabular figures** on every number that sits in a column with another number.
- **A visible focus ring** on everything interactive, and real `aria-label`s on icon-only buttons. The chart needs a text description; it is the main data display.
- **No browser dialogs.** Confirmation happens inline.
- `100dvh`, never `100vh` — mobile Safari's toolbar makes the difference visible.
- Respect `prefers-reduced-motion`.

## 9. Architecture: the decided stack

The target is an app on a phone that works with no signal, and the same thing in a browser behind a login. That single requirement decides the shape: **the device holds the data and does the thinking**, and the server is a sync target rather than a dependency. Every choice below is settled.

| Layer | Decision | Why, in one line |
|---|---|---|
| **iPhone delivery** | PWA, Add to Home Screen | No App Store, no developer account, no TestFlight re-signing. Installs from Safari's share sheet and runs full-screen. |
| **Language** | TypeScript | One language across UI, core logic and sync; the row shapes in §3 become checked types. |
| **Framework** | React + Vite, SPA | No SEO need, purely client-interactive. One bundle to precache — the offline story stays trivial. Not Next.js: a server framework buys nothing here. |
| **PWA plumbing** | vite-plugin-pwa | Generates the manifest and the precaching service worker from config instead of by hand. |
| **On-device store** | IndexedDB via Dexie | Same five tables, same field names. Dexie gives typed tables, compound keys and transactions without ceremony. |
| **Backend** | Supabase | Postgres + Auth + row-level security in one. No server code of ours at all — the client talks to Supabase directly. |
| **Hosting** | Vercel, static | The Vite build output is static files; Vercel deploys them on every push to main. |
| **Domain** | Cloudflare DNS, grey-cloud | A subdomain (e.g. `life.<domain>`) CNAMEd to Vercel, **DNS-only** — never proxied (§12). |

> **Why not a native app:** Every native path fails the "no App Store" constraint expensively: sideloading with a free Apple ID expires every 7 days, TestFlight builds expire in 90 and need a paid account, and Capacitor inherits both problems while adding a build toolchain. The PWA has none of these costs, and since iOS 16.4 an installed PWA can even do push notifications and app badges if reminders are ever wanted.

### Keep the core platform-free

The scoring and view-building code must import *nothing* — no database, no network, no framework. Give it plain row objects, get plain values back. That single discipline is what lets the identical file run against IndexedDB on the phone and against a Postgres dump in a test, and it means the two can never disagree.

Three modules, all pure:

| Module | Holds |
|---|---|
| score | Date helpers, cadence rules, weights, windows, tallies, the grids. |
| state | Turns a snapshot of all five tables into the view payloads. |
| rows | Normalises values on the way in, so a goal created offline becomes the same row as one created anywhere else. |

### Storage on the device

IndexedDB, one store per table, same field names. Key check-ins on the compound `[subgoal_id, date]` — it is the natural key and it makes double-logging a day impossible. Multi-table writes go in one transaction so they cannot half-apply.

Call `navigator.storage.persist()` on boot. An installed home-screen PWA is already exempt from Safari's 7-day storage eviction that applies to ordinary websites, but the explicit request costs nothing and protects the in-browser session too — and sync (§10) is the real backup regardless.

### Installability

A manifest with `display: standalone`, PNG icons at 180/192/512 plus a maskable variant with a safe margin, and a service worker that precaches the whole bundle so it opens on a plane first try.

Two install paths are needed: browsers that fire `beforeinstallprompt` get a button, and iOS — which has no programmatic install — gets "Share, then Add to Home Screen" instructions.

Updates: the service worker uses `registerType: 'autoUpdate'` so a new deploy replaces the cached bundle on next launch. Show a quiet "updated" toast rather than a blocking prompt — this app has one user, not a fleet to migrate carefully.

## 10. Sync and auth, concretely

One user, a couple of devices. The design goal is a sync layer small enough to read in one sitting — roughly a hundred lines — not a distributed system. **No CRDTs, no sync framework.** (PowerSync and Replicache both solve this properly, and both were considered; for a single user they are more machinery than the problem.)

### The cloud schema mirrors the local one

The same five tables in Supabase Postgres, each with three extra columns:

| Column | Type | Purpose |
|---|---|---|
| user_id | uuid | Defaults to `auth.uid()`. The RLS boundary. |
| updated_at | timestamptz | Set by the writing device. Orders conflicting writes. |
| deleted | bool | Tombstone, so a delete can propagate. Nothing is ever hard-deleted by sync. |

Check-ins are unique on `(user_id, subgoal_id, date)` — the same natural key as locally, so two devices editing the same day *upsert into one row* and converge instead of duplicating. "Untick" is not a row deletion on the wire: it writes the tombstone, which is what lets the clearing propagate to the other device.

Day-type columns (`date`, `created_at` on goals/subgoals, freeze bounds) are Postgres `date`, never `timestamptz` — the §2 convention survives the round trip untouched.

### Row-level security is the whole authorisation model

```sql
alter table checkins enable row level security;

create policy own_rows on checkins
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());
-- same policy on all five tables
```

With this in place the browser client can talk to Postgres directly with the publishable anon key: the database itself refuses to return or accept anyone else's rows. There is no API of ours to write or secure.

### The sync loop

```
on every local write:  also append {table, pk} to an outbox store
on app open, on regaining network, and after each write (debounced):

  push:  for each outbox entry, upsert the current local row
         (with its updated_at) to Supabase; on success, clear entry
  pull:  fetch rows where updated_at > last_pulled_at; for each,
         keep whichever side has the newer updated_at
         (applying tombstones); then advance last_pulled_at
```

- **Last-write-wins** by `updated_at` is the entire conflict policy. For one person's habit data, the newer edit is simply the right one.
- Sync runs in the background. Nothing in the interface ever waits on it — the only visible trace is a small "synced / pending / offline" indicator.
- The outbox lives in IndexedDB alongside the data, so changes made across several offline days all push when the network returns.

> **Sync is not optional.** Offline-only, with storage an OS may in principle reclaim, is a data-loss risk. Treat sync as the backup that makes the whole design safe rather than a nice-to-have for multi-device.

### Auth: magic link, cached session

Supabase Auth with **email magic links** — no password to manage for a single-user app. The session persists in local storage and auto-refreshes, so the phone app signs in once and then works offline indefinitely; sync simply resumes whenever a connection and a valid session coincide. The website is the same build doing the same thing.

**Data already on the device** is protected by the phone itself. An app PIN is a speed bump for someone holding an unlocked handset — worth having, but it is not encryption, and saying otherwise would be dishonest. Encrypting the local store is possible at the cost that a forgotten passphrase means the data is gone.

## 11. Repo, hosting and the build plan

### One repository

```
startem/
  src/
    core/          # score, state, rows — pure, imports nothing
    db/            # Dexie schema, one store per table
    sync/          # outbox, push/pull loop, session handling
    ui/            # React: Today, Star, Calendar, Goal editor
  public/          # icons 180/192/512 + maskable (all PNG)
  supabase/
    migrations/    # cloud schema + RLS policies, checked in
  index.html
  vite.config.ts   # includes vite-plugin-pwa
  vercel.json      # SPA rewrite: all routes -> /index.html
```

No monorepo, no workspaces — one `package.json`, one install, one build. The §12 monorepo trap cannot recur if there is no monorepo.

### Wiring the three services

| Service | Setup, once |
|---|---|
| **Vercel** | Import the GitHub repo; framework preset Vite. Every push to `main` deploys. Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (the anon key is safe to ship — RLS is the security boundary). |
| **Supabase** | One project. Apply `supabase/migrations`; enable magic-link email auth; add the site URL to the auth redirect allowlist. |
| **Cloudflare** | CNAME `life` → `cname.vercel-dns.com`, **DNS-only (grey cloud)**. Add the domain in Vercel so it issues the certificate. |

### Build order — each milestone is usable on its own

1. **Core, pure.** Port §2–§6 into `src/core` with unit tests on the cadence and window rules. No UI yet; this is where all the subtle bugs live, so it gets tests first.
2. **Local-only app.** UI on Dexie, full feature set, zero network. Import the existing JSON export here and live on it.
3. **Install it.** Manifest + service worker; deploy to Vercel; Add to Home Screen on the iPhone; verify it opens in airplane mode.
4. **Cloud.** Supabase schema, RLS, magic-link login screen.
5. **Sync.** Outbox, push/pull, tombstones, the sync indicator. Test the two-device case: phone and laptop editing the same day offline.
6. **Polish.** Update toast, install instructions, PIN if still wanted.

Milestone 2 already beats the current app; everything after it is durability. Total running cost on the free tiers of all three services: zero, at this scale.

## 12. Traps already paid for

Each of these cost real debugging the first time — plus three known ones added for the new stack.

| Trap | What happens |
|---|---|
| **Copying a live SQLite file** | In WAL mode recent writes sit in the `-wal` sidecar. Copying the main file alone can yield an almost-empty database with no error. Use `VACUUM INTO`, or copy all three files. |
| **A 30-day scoring window** | Silently re-weights actions as the calendar shifts. Use 28. |
| **Fixed monthly days above 28** | The action vanishes in short months with no error. Clamp on write *and* on read. |
| **An SVG `apple-touch-icon`** | iOS ignores it entirely and shows a screenshot instead. It must be PNG. |
| **Deleting an action on edit** | Orphans its check-ins and rewrites history. Archive instead. |
| **A frozen flag with no periods** | Unfreezing back-fills the dormant weeks with misses. |
| **Serverless hosting plus a file database** | No persistent disk. The data disappears on every deploy, quietly. The new shape avoids this by construction: device + Supabase, nothing stored on Vercel. |
| **A monorepo where the host installs only the root** | The build fails with `exit 127`, command not found. Avoided here by having one package, full stop. |
| **Number inputs and the mouse wheel** | Scrolling over a focused number field silently changes its value, and `max` does not prevent it. Validate at the storage boundary. |
| **Cloudflare's proxy in front of Vercel** | Orange-clouding the record puts two certificate/caching layers in an argument — redirect loops and stale deploys. The record must be DNS-only. |
| **Missing SPA rewrite on Vercel** | Deep links and refresh on any route but `/` return 404. One rewrite rule in `vercel.json` sends every path to `index.html`. |
| **Supabase free tier pauses idle projects** | A project untouched for about a week is paused until manually resumed; sync fails quietly meanwhile. Daily use keeps it warm — but the sync indicator must surface failures rather than swallow them. |

---

**Migration:** Existing data moves across as JSON — the five tables dumped whole, imported into the device store at milestone 2 with row ids preserved, because the tables reference each other by id. The first sync after login then seeds Supabase from the device, so the migration is one import, not two. Read the destination's column list when importing, so an export taken before a schema change still loads.
