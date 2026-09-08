# Startem Build Spec — v3.0, 8 September 2026

Everything needed to rebuild the app from nothing: every field, every scheduling rule, the scoring maths, the mistakes already paid for once — and the decided stack it ships on.

Canonical styled copy: https://claude.ai/code/artifact/0ca4ef8a-35f0-40d4-ba83-01971ffdcc44

---

## 1. What the app is

A personal habit tracker built on one idea: life splits into a handful of **areas**, and each area is only as healthy as the habits you actually keep in it.

The structure is **two levels**, not three:

| Level | What it is | Example |
|---|---|---|
| **Area** | A vertex on the radar chart. Added, renamed, reordered and removed by the user. | Health |
| **Habit** | A repeating task, hanging straight off its area. This is what gets ticked, and the only thing scored. | Wake up at 7 am, every day |

Beside the habits, an area also holds a list of **goals** — and a goal is an *aim*, not a container:

| | Goal | Habit |
|---|---|---|
| What it is | Where you are trying to get to | What you do about it |
| Example | "Reach 100 kg bench press" | "Gym session, Mon / Wed / Sat" |
| Owns tasks | No | — |
| Has a cadence | No | Yes |
| Moves the score | **Never** | It *is* the score |
| Where you see it | The area screen | The day's list, every morning |

> **A goal owns nothing.** In v2 a task hung off a goal which hung off an area, so adding "wake up at 7 am" to Health meant first inventing a goal to put it under. That tier is gone. A habit belongs to an **area**, full stop; a goal is a line you write down on the area screen and tick when you get there. The two are read in different places on purpose: the day's list is nothing but habits, and the aims are there when you go looking for them.

### Habits and to-dos

The other thing an area holds is the odd **to-do** — a one-time task, kept here because this is where you already are:

| | Habit | To-do |
|---|---|---|
| Stored as | any repeating `cadence_type` | `cadence_type: 'once'` |
| Where it lives | the Today tab | the To-dos tab |
| Counts towards the star | **Yes** | **No** |
| Has a streak, a rate, a tracker grid | Yes | No |
| Can be paused | Yes | No |

> **To-dos are tracked, never scored.** The star is a statement about how well you are keeping your habits. An errand jotted down and dropped is not evidence about that, and letting it drag Health down made the number mean something no one wanted. The one place the two lists touch is the day screen, which surfaces a to-do that is due today or already late — under its own heading, and never in the day's count.

> **There is no `kind` column, and there must not be one.** Habit or to-do is read off `cadence_type`, which is already load-bearing for scheduling. A second field saying the same thing is a field that can disagree with the one the cadence rules actually walk.

Completing habits, weighted by each habit's own priority, is the only thing that moves an area's score.

Three screens: **Today** (the habits due, ticked as you go), **To-dos** (the errands, in deadline piles) and the **star** (where you stand, and where the areas themselves are edited).

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

> **Ids are `bigint`, and new ones are minted per device.** Every id is
> `deviceKey * 2^20 + counter`, where each install draws a random 20-bit
> `deviceKey` once. A shared auto-increment counter cannot work here: §10
> upserts rows between devices *by primary key*, so two devices that both
> allocate `47` while offline do not produce two goals — they produce one that
> last-write-wins silently merges, losing an edit. For an offline-first app that
> is the normal case, not an edge case. Partitioning the space removes the
> collision rather than making it unlikely, and the result stays under 2^40, so
> it is exact in a JS number. Imported ids keep whatever values they arrive
> with; `deviceKey` starts at 1 so small legacy ids can never be re-minted.

### areas

| Field | Type | Notes |
|---|---|---|
| id | bigint, pk | — |
| name | text | The user's, from the first run onwards. |
| position | int | Order around the chart, clockwise from the top. Compacted on every removal, so the ring never has a gap. |

A fresh install starts on ten: Health, Hobbies, Work, Business, Friends, Family, Purpose, Money, Relationship, Other. **They are the user's from then on** — added, renamed, reordered and removed from the star's edit mode (§7). The chart adapts to any count, because its geometry is `360° / count` and nothing anywhere assumes ten. One is the floor (a star with no spokes has nothing to draw); twenty is the ceiling, which is where the labels around the rim stop being readable on a phone.

> **Removing an area archives its habits; it does not delete them.** Their check-ins still describe real days, which is the same rule that governs retiring a single habit. Its goals *are* tombstoned — an aim with nowhere to live is a stray row.

### goals

| Field | Type | Notes |
|---|---|---|
| id | bigint, pk | — |
| area_id | bigint, fk | → areas.id |
| title | text | — |
| description | text | Optional. Free text — used for definitions of done, prompts. |
| status | enum | `active` / `achieved` |
| position | int | Order inside its area. |
| achieved_on | date, null | The day it was reached. Set when `status` becomes `achieved`, **cleared** when it is reopened. |
| created_at | date | — |

A goal carries **no importance**, **no tasks** and **no percentage**. It is a sentence you are aiming at. Deleting one tombstones it and moves nothing else: it held none of the work in the first place.

> **`frozen` is not a goal status any more.** Freezing was how you took a whole line of work out of scoring, and it only worked because the goal owned the tasks. It now lives where the work does — see `freezes` below.

### subgoals — the tasks

Stored as `subgoals` for continuity with the original schema; everywhere else they are called tasks — a **habit** when it repeats, a **to-do** when it does not.

| Field | Type | Notes |
|---|---|---|
| id | bigint, pk | — |
| area_id | bigint, fk | → areas.id. **Required, and the only parent a task has.** |
| title | text | — |
| importance | enum | `high` / `medium` / `low`. Sets the weight of every occurrence. A row that arrives without one is repaired to `medium`; the composer opens a **new** task on `low` (P3) — see §7. |
| cadence_type | enum | `daily` / `weekly` / `monthly` / `quarterly` / `once`. **`once` is the to-do; everything else is a habit.** |
| interval | int | Every N units of the cadence. `1` for everything but a custom repeat. |
| days | json int[] | Weekly only. Weekday numbers, e.g. `[0,2,5]`. Empty for other cadences. |
| monthly_day | int, null | Monthly/quarterly, fixed-date mode. **Held to 1–28.** |
| month_weekday | int, null | Monthly/quarterly, weekday mode. `0–6`. Non-null selects this mode. |
| month_ordinal | int, null | `1–4`, or `-1` for last. Pairs with month_weekday. |
| due_date | date, null | To-dos only. Optional — a to-do can have no deadline at all. |
| start_date | date, null | Habits only: the first day it can come due, and the interval's anchor. |
| repeat_until | date, null | Habits only: the last day it can come due. **Inclusive.** |
| time | time, null | Optional `HH:MM` local wall-clock time. Display only — scoring is per day (§2). |
| weight | int, null | Overrides the importance weight for this task alone. |
| created_at | date | Nothing is scheduled before this date. |
| archived | bool | Removed from the interface, but its history stays meaningful. |

> **`repeat_until` is inclusive, unlike a freeze's exclusive `end_date`.** The repeat editor says "on date (inclusive)" out loud, and a task that ends on the 30th has to come due on the 30th. The two asymmetries are deliberate and different: a freeze is a period you come *out* of, a repeat is a run of days you are *in*.

> **Archive, never delete:** When a user removes a task, set `archived` rather than deleting the row. Its past check-ins still exist and still describe real days; deleting the task would orphan them and silently rewrite history.

### checkins

| Field | Type | Notes |
|---|---|---|
| subgoal_id | bigint, fk | → subgoals.id |
| date | date | Unique together with subgoal_id. This pair is the real key. |
| status | enum | `done` / `skipped` |

**No row means unresolved**, which is different from missed. A past day with no row is a miss; today with no row is still pending. `skipped` is the user saying "not doing this today" — an explicit, immediate miss.

### freezes — pausing one habit

| Field | Type | Notes |
|---|---|---|
| id | bigint, pk | — |
| subgoal_id | bigint, fk | → subgoals.id. A **habit**, not a goal. |
| start_date | date | — |
| end_date | date, null | Null means still paused. |

> **Why a pause hangs off the habit.** It used to hang off the goal, because the goal owned the tasks and pausing it paused them all. A goal owns nothing now, so freezing one would pause nothing at all. "I am away for a fortnight, stop counting the gym" is a statement about the habit, and that is where the period belongs.

> **Why pauses are periods, not a flag:** a flag would tell you a habit is paused *now*, but not that it was paused last March. Without the periods, resuming would retroactively fill its dormant weeks with misses. A date is paused when a period covers it:
>
> ```
> paused(date) = any period where
>   start_date <= date AND (end_date IS NULL OR date < end_date)
> ```
>
> Note the asymmetry — `end_date` is exclusive, so resuming makes that same day live again.

For sync, every row in every table additionally carries `updated_at` (timestamp) and `deleted` (bool tombstone) — see §10. They are sync plumbing, invisible to all the logic above.

## 4. Repeats: when a task comes due

The user-facing word is **repeat**; `cadence_type` is the storage name and stays. One predicate underpins everything. A task comes due on a date if all the guards pass and its repeat matches:

```
isScheduled(task, date):
  if task.archived                       -> false
  if task.created_at > date              -> false   // did not exist yet
  if task.start_date > date              -> false   // has not started
  if task.repeat_until < date            -> false   // inclusive end
  if paused(date, the habit's periods)   -> false   // its own, and no one else's
  if not onIntervalStep(task, date)      -> false

  daily     -> true
  weekly    -> task.days includes dow(date)
  monthly   -> monthPattern(task, date)
  quarterly -> monthPattern(task, date) AND month(date) in [1,4,7,10]
  once      -> false                                // never recurs

onIntervalStep(task, date):                         // always true when interval == 1
  anchor = task.start_date ?? task.created_at
  daily   -> daysBetween(anchor, date)   % interval == 0
  weekly  -> weeksBetween(anchor, date)  % interval == 0   // Monday-start weeks
  monthly -> monthsBetween(anchor, date) % interval == 0
```

> **The interval anchors on a stored date, never on today.** A drifting anchor would silently reschedule "every 4 weeks" on every read, so the task would land on different weeks tomorrow than it does today.

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

If neither mode is configured — `month_weekday` and `monthly_day` both null — the task never comes due. Normalisation keeps the two modes mutually exclusive on write, so a stored row cannot reach that state.

The "last" test: a date is the last of its weekday in the month exactly when seven days later lands in a different month. And `ceil(day / 7)` gives the ordinal because the 1st–7th always hold the first of every weekday, the 8th–14th the second, and so on.

> **Why fixed days stop at 28:** Days 29–31 don't exist in every month. A task on "day 31" would silently never come due in February, April, June, September or November — no error, just five months a year where a commitment quietly vanishes. So fixed days are clamped to 1–28 *both* on write and on read, and **"last Friday" is the only correct way to express genuine month-end.**

### The named repeats are presets over these fields

The composer offers a short list of repeats plus a custom builder. Each one is only a way of filling in the fields above, read off the date the task is on — so "every week" on a task dated Sunday means every Sunday, and "every month" means that day of the month, clamped.

| Repeat | Fields |
|---|---|
| No repeat | `once`, the date becomes `due_date` |
| Every day | `weekly`, days `[0,1,2,3,4,5,6]` |
| Every weekday | `weekly`, days `[0,1,2,3,4]` |
| Every week on X | `weekly`, days `[dow(date)]` |
| Every month | `monthly`, `monthly_day = clamp(dayOfMonth(date))` |
| Every quarter | `quarterly`, `monthly_day = clamp(dayOfMonth(date))` |
| Custom | `interval` × (days / weeks / months), plus the weekday set or month pattern, plus an optional inclusive end |

The single date field means two different things depending on the repeat, and the composer is the one place that decides which: with no repeat it is the **deadline**, with one it is the **start**. Moving the date moves what a preset repeat means — dragging a weekly task from Sunday to Thursday makes it every Thursday, because a repeat on a day the task no longer has is a repeat nobody asked for. A custom repeat is left alone: its interval and day set were set by hand.

### To-dos

A to-do never recurs — `isScheduled` is false for it on every date. It is one thing, done once, and it is **not scored at all** (§5): ticking it moves nothing on the star, and blowing its deadline drags nothing down. With no `due_date` it sits on the list indefinitely until done.

It still needs a date to be *displayed* against, though — the to-do list sorts into five piles from the deadline alone, and the piles are recomputed on every read rather than filed into:

| Pile | Rule |
|---|---|
| Overdue | open, `due_date < today` |
| Today | open, `due_date == today` |
| Upcoming | open, `due_date > today` |
| No date | open, `due_date` is null |
| Finished | resolved within the last **14 days**, then it drops off on its own |

Since a to-do has no cadence to walk, its history is still one occurrence on one effective date — the day it was actually logged. That is what the finished pile sorts on, and what the day-detail checklist reads:

```
onceOccurrence(action, today):
  if logged (a check-in exists)   -> { date: the check-in's date, resolved }
  if due_date != null AND due_date < today
                                  -> { date: due_date, unresolved }
  otherwise                       -> none
```

> **Why the piles are derived, not stored.** A to-do moves from Upcoming to Today to Overdue overnight, on its own, with nothing to tidy and nothing that can go stale. Storing the pile would mean a nightly job the app does not have and cannot run offline.

## 5. Scoring

The model is a **weighted pool of occurrences**. Every time a habit comes due it is worth its weight. An area's score is the weight completed over the weight that came due.

> **Only habits are scored.** To-dos are excluded from every tally: the area score, the star, the weekly strip, the calendar bands and the day detail all walk the habits alone (§1). The star is a statement about how well the habits are being kept, and nothing else may move it.

### Weights

| Importance | Weight | Meaning |
|---|---|---|
| high | 4 | Each occurrence counts four times a low one. |
| medium | 2 | The repair value for a row that arrives with no priority at all. |
| low | 1 | **What a new task opens on** (§7). |

A habit's weight comes from **its own** priority, unless `subgoals.weight` overrides it with an explicit number. Nothing is inherited: a habit hangs off an area, and an area has no priority.

> **Frequency multiplies weight:** A daily low task generates 7 × 1 = 7 per week; a weekly high task generates 1 × 4 = 4. The daily trivial habit outweighs the weekly critical one. That is deliberate — it measures total weighted effort delivered — but it is the first thing to revisit if the scores ever feel wrong. Widening the spread (say 10/3/1) shifts the balance toward importance over frequency.

### The window is 28 days, and the number matters

Over 28 days every weekday falls *exactly* four times. Over 30 days, two weekdays fall five times and five fall four — and which ones drifts with the calendar.

> **Do not "round up" to 30:** With a 30-day window a Wednesday task gets 4 or 5 chances depending on today's date, so the calendar silently re-weights tasks underneath the weights the user set. Verified across a year: 28 days gives a fixed count, 30 does not. A 30-day window can also contain the same monthly date *twice* (1 Feb and 1 Mar are 28 days apart), double-counting one commitment.

### What counts as a resolved occurrence

1. Walk each day in the window. Skip days the task wasn't due.
2. **If the day is today and has no check-in, skip it.** Today is pending, not failed.
3. Otherwise it counts toward the denominator; if `status == done` it counts toward the numerator too.

So `skipped` and a past unlogged day behave identically in the maths — both are misses. The difference is only that crossing out registers immediately rather than waiting for midnight.

To-dos are not walked at all — they are filtered out before any tally begins (§1). `tallyRange` and `tallyStanding` still handle a `once` task correctly as pure functions, because the day-detail checklist and the finished pile read them; nothing that produces a *score* ever passes one in.

### Rare cadences need two different readings

A 28-day window can miss a monthly task's date entirely (a 28-day span inside a 31-day month may contain no 1st). Left alone, a monthly commitment would drop out of the score at random. So:

| Mode | Rule | Used by |
|---|---|---|
| standing | The habit's *most recent* due instance represents it, found by scanning back day by day until the first hit. An unresolved **today** is skipped and the scan continues, so last month's result stands in until today is logged rather than the habit dropping out for a day. | The star, area and habit percentages |
| range | Only what genuinely came due inside the range. | Weekly history, calendar days |

Which reading a habit gets is decided by its **period** — roughly how many days sit between two occurrences (`interval` for daily, `interval × 7` for weekly, `interval × 31` for monthly, 97 for quarterly). A period that fits inside 28 days reads the plain window; anything longer scans. So weekly habits read the window as they always did, while a custom "every 8 weeks" scans like a monthly one rather than falling out of the score entirely.

Look-backs for standing mode: **45 days** monthly, **115 days** quarterly, and for a long custom repeat two whole periods. Consecutive "last Sunday" dates can sit 35 days apart and quarterly ones about 97, so the reach must exceed that comfortably. Scanning further is harmless — the scan stops at the first match, which is by definition the latest one.

### The formula

```
rate  = earned / available          // null if available == 0
score = round((1 + rate * 9) * 10) / 10
```

So 0% → **1.0** and 100% → **10.0**. The floor is 1 because a 1–10 chart cannot draw a zero-length spoke. When `available` is 0 the score is **null**, rendered as an em dash — an area with nothing scheduled has no opinion, which is different from scoring badly.

### Two levels of percentage

| Shown on | Computed as |
|---|---|
| Area (the chart) | Weighted pool across every live **habit** in the area, standing mode, 28 days. |
| Habit (next to it) | *Unweighted* — occurrences done ÷ occurrences resolved. Weight is irrelevant when comparing a habit to itself. |

There is deliberately **no goal percentage**. A goal owns no tasks (§1), so any number attached to one would have to be invented out of habits it does not hold.

### Streaks

The one number that makes a habit feel like a habit: consecutive kept occurrences, counting back from the last day it came due.

- **Today does not break a streak.** An unticked today is pending, not failed (§5), so the walk steps over it and carries on.
- **Paused days do not break a streak** either — that is the whole point of a pause.
- It counts *occurrences*, not days: three kept Wednesdays in a row is a streak of three.
- It is displayed from the second one. One kept day is not a run of anything.

### Paused habits

A paused habit is excluded from every score and absent from the day's list, and its paused days count as neither kept nor missed. History is preserved and resuming restores everything. An area whose habits are *all* paused scores null, not zero.

## 6. The derived views

All of them are pure functions of the stored rows plus today's date. None of them needs storing.

Two of them are **built but not surfaced** as of v3.0 — the weekly strip is drawn on the area screen but nowhere else, and the day-by-day calendar has no screen at all. Their builders and tests stay in `src/core` untouched, because the rules below are the expensive part and none of them changed; what was removed is the screens that drew them. Anything reading this to rebuild the app should treat those as specified and shelved, not as deleted.

### The day's list — habits only

Every live **habit** due today, **sorted heaviest first** so the day's most important work is at the top. Grouped by area in the order the groups first appear, which follows from the sort. Progress reads `done of (total − crossed out)`, so crossing something out removes it from the target rather than making the day unwinnable.

A to-do is **never** in this list, pending or done (§1). The screen carries one red affordance — **Add habit**, which opens the composer in place, on Habit (§7) — and below the day's groups sits a collapsed **Not due today** list of every other habit that exists. Without it, a habit set to "every Monday" and added on a Wednesday would vanish the instant it was saved, since the day's list is the only list.

Under all of that, and only when there is something to show, sits a separate **To-dos** block: the open to-dos that are due today or already overdue. It is the one place the two lists touch, it is visibly its own section, and it never touches the day's count.

An empty day draws **nothing** — no card explaining that there is nothing due. "Add habit" is on screen either way, and it says everything the paragraph did (§8).

### The to-do list

Every to-do, in the five piles of §4, with the piles derived from the deadline on every read. Inside a pile: soonest deadline first, then heaviest, then oldest — except the finished pile, which reads most recently finished first. A habit is never in this list.

The to-do tab carries a **badge with the overdue count**, because that tab is the only place a deadline is visible and a silent one would be missed.

### The star

A radar chart, one vertex per area, first at twelve o'clock and going clockwise. Faint rings at 2, 4, 6, 8, 10, the outermost a shade stronger because the shape is read against it. The shape is filled with a radial wash of the accent, densest in the middle, and outlined in it. Vertices are interactive — tapping one opens that area. A null score draws at the midpoint with a hollow dot and an em-dash label.

```
angle(i) = -90° + (360° / count) * i
radius(i) = R * score(i) / 10
```

The count is whatever the user has left it at (§3, §7) — the geometry is derived from it, so adding or removing a spoke simply redraws the chart. It must hold at one spoke and at twenty, not only at ten. Three scored areas make a polygon; two make a line between them; one makes only its own dot.

**The chart is the whole screen.** The areas are *not* repeated as a list underneath it — the list said the same thing twice and pushed the picture off the top — so a vertex is the only way into an area, and each one carries its area's name and score beside the dot. A name longer than fourteen characters is cut with an ellipsis in the chart only: at ten spokes on a phone, a long label runs off the side. There is no caption naming the window either; twenty-eight days is what every number in the app means (§5).

`buildStar` also returns a **mean** of the *scored* areas — an unscored area is left out rather than counted as a zero, because nothing scheduled has no opinion (§5). It is drawn beside the screen title, where the area screen keeps its own score, and deliberately not in the middle of the ring: a low mean makes a small shape, and a number in the centre would sit on top of the very shape it describes.

### The area screen

The one screen where goals are read, and the order on it is the argument the redesign rests on:

1. the area's score, beside the title, and its eight-week strip;
2. **Goals** — active first, reached below, each written and retired inline;
3. **Habits** — every habit in the area with its cadence, its rate and its streak;
4. the open to-dos parked in this area, last and unscored.

### Weekly history strip

`buildWeeklyStrip` computes it, and the area screen draws it. **8** calendar weeks, Monday-start, one bar per week, using *range* mode, habits only. The current week is scored on the days resolved so far. Weeks with nothing due render as a hairline rather than a zero, so a gap is visibly different from a failure. Passing an `areaId` narrows it to one area.

### Per-habit tracker grid

`buildHabitGrid` computes it, and the habit screen draws it. **15** weeks of day cells for a **single habit**, weeks running down the columns so the whole span fits a phone's width without scrolling. Cell states:

| State | When |
|---|---|
| done | The habit was kept that day. |
| partial | Unreachable for a single habit; kept for the shape's sake. |
| missed | It was due, it was not done, the day is past. |
| today | Today, still unresolved. |
| none | Nothing was due. |
| frozen | The habit was paused that day. |
| future | Hasn't happened. |

> **The grid used to hang off a goal**, where it averaged unrelated work into one colour and a half-shaded cell told you nothing about what you had actually failed to do. The habit is the thing with a cadence, so it is the only thing whose day cells can mean "kept" or "missed".

### Day-by-day calendar — *shelved, not surfaced*

`buildCalendar`, `buildDayDetail` and `canEditDay` still compute it; there is no `/calendar` route. **26** weeks across every live habit, Monday-aligned columns, ending with the week containing today. Each day carries weighted totals: `total`, `done`, `skipped`, `count`, `doneCount`, `ratio`. Colour runs in five bands from "nothing logged" through to "everything logged".

> **One deliberate inconsistency:** A day cell's `ratio` counts *all* weight due, including today's unresolved items — so today reads as progress so far. The star excludes unresolved items instead. Both are right for their purpose: a calendar is a record of a day, the star is a judgement about a standing. Don't "fix" one to match the other.

The day detail view includes pending items — it's a checklist, so it must show what was owed as well as what was logged — and an item **logged** that day even if the cadence has since moved off it, because the row describes a real day. Like every other score-shaped view, it walks habits alone.

## 7. What the user can do

| Action | Effect |
|---|---|
| Tick an item | Writes `done`. Ticking again clears the row back to unresolved. |
| Cross out an item | Writes `skipped` — an immediate miss. Reversible; restoring returns it to pending. |
| Back-date | **No surface as of v3.0** — the day screen was the only one, and it went with the calendar. The rule it enforced still stands in `canEditDay` for whatever brings it back: any day within **182 days** (26 weeks) is correctable, and a future day never is. |
| Pause / resume a habit | Opens or closes a pause period on **that habit** (§3). One switch, on the habit screen. |
| Add a task | The composer: a **Habit / To-do switch**, a line to type into, and chips for **which area**, **when** (date → calendar, shortcuts, time, repeat) and **priority**. Typing `p1` / `p2` / `p3` sets the priority and leaves the title. |
| Habit or to-do | One switch at the top of the composer, and it writes **nothing but the repeat** — the distinction *is* the repeat (§3). Turning a to-do into a habit with no repeat set gives it **every day**; turning a habit into a to-do clears it and keeps the date as the deadline. The composer opens on **Habit** everywhere except the to-do screen, because this is a habit tracker and the common case should cost no taps. |
| Priority of a new task | Opens on **P3 / low** (weight 1), not the middle of the scale. Most of what gets typed in is ordinary, and defaulting to P2 quietly counted every routine task double a genuinely small one until it was corrected by hand. Starting at the floor makes *raising* the priority the deliberate act. Editing an existing task still opens on whatever it already carries. |
| Pick a date | The date sheet offers **Today**, **Tomorrow**, **This weekend** (the coming Saturday, or today when today is a Saturday or a Sunday) and **No date**, then a month grid. Picking a day **does not close the sheet** — it turns that day red and leaves Time and Repeat, which live in the same sheet's footer, one tap away. The sheet closes on the backdrop, the ✕ or Escape. |
| Pick a repeat | The repeat sheet opens from the date sheet's footer and lists the presets. Picking one **is** the whole answer — "every day" or "every week on Monday" says when the habit lands without a day out of the calendar as well — so it commits and **closes the pickers outright**, unlike picking a date. **Back**, bottom-left in the footer and in thumb reach on a phone, returns to the date sheet; the ✕, the backdrop and Escape close the stack. **Custom…** opens a sub-sheet with the same bottom-left Back, and its Save commits and closes the same way. |
| Edit a task | The same composer, opened on the task from its own screen. There is no second form to keep in step with the first. |
| Archive a task | Removes it from the interface; the row and its check-ins stay. |
| Write a goal | One line on the **area screen**, under **Goals**. A goal has no screen of its own, because there is nothing to put on one. |
| Reach a goal | One tap on its tick: `status` becomes `achieved` and `achieved_on` is set to today. Reopening it clears that date — a goal put back in play must not still claim it was reached in March. |
| Edit / remove a goal | Tap it to expand: title, description, and Remove. Removing tombstones it and moves nothing else. Confirm inline — never with a browser dialog. |
| Add an area | The **pencil** on the star, then a name. It lands at the end of the ring and the chart redraws around it. Ceiling of **20**. |
| Rename an area | The same edit mode, in place. Committed on blur rather than on every keystroke: each write re-reads the whole store and rebuilds the star, and a name is not worth doing that once per letter. A blank name is refused. |
| Reorder an area | Two arrows per row, not a drag. Dragging a list item on a touch screen needs either a library — every kilobyte of which is precached for offline use (§9) — or a hand-rolled gesture that fights the page scroll. Arrows always work, including for a keyboard and a screen reader. |
| Remove an area | Tombstones it, **archives** its habits and tombstones its goals, then compacts the positions behind it so the ring has no gap. The confirmation says out loud what goes with it. The **last** area cannot be removed: a star with no spokes has nothing to draw. |
| Sign in / out | Magic-link email sign-in. Signing out keeps local data on the device; signing in merges it up. See §10. |
| Import / export JSON | **Removed in v2.6**, along with the settings screen that held it. `importSnapshot` survives as the sample dataset's loader and as the shape §11's one-off migration would arrive in; there is no export, and no screen. |

> **Deliberately not built — a minimum-sample gate.** Without it, the first check-in on a brand-new goal reads as 10.0, because it is genuinely 100% of one resolved obligation. This was considered and rejected — it self-corrects within a week or two of real history. If the early days ever feel meaningless, the fix is to hide a score until some number of weighted occurrences have resolved, rather than to fudge the arithmetic.

## 8. Design system

Flat, typographic, hairline-ruled — and quiet. Rows sit on white with rules between them rather than in a page of bordered cards; one ink carries the text and the primary controls, one accent carries the data. System font stack — on Apple hardware that is SF, which suits the aesthetic and costs nothing to load.

### Palette

| Token | Value | Use |
|---|---|---|
| --bg / --surface | #ffffff | Page ground and rows. The app is white; separation comes from rules and washes. |
| --sunken | #f5f6f8 | The one filled tone: soft panels, chips, buttons, pressed rows. |
| --sunken-strong | #eceef1 | Its hover. |
| --text | #0d1117 | Text, and every primary control — a filled button is ink, not colour. |
| --text-secondary | #5b6472 | — |
| --text-tertiary | #98a1ae | Labels, quiet meta. |
| --hairline | rgba(13,17,23,.08) | Nearly every division in the app. |
| --hairline-strong | rgba(13,17,23,.14) | An unticked check ring, the outer ring of the star. |
| --accent | #3b5bdb | Data only — the star, the tracker grid, a ticked row. |
| --imp-high | #e0483d | Semantic priority colours, separate from the accent. |
| --imp-medium | #d5901c | Priority reads as red / amber / green on the tick's ring, |
| --imp-low | #2f9159 | the meta dot and the composer's chip. |
| --frozen | #b6bcc5 | A paused habit. |
| --cell-done / --cell-missed | accent / rgba(224,72,61,.26) | The tracker grid's kept and missed cells. |

The tracker grid is read as a **texture**, at a glance, so its kept cells are the accent and its missed ones a wash of the priority red — two saturated hues fighting at 13px reads as noise rather than as a pattern.

Greys are all tinted slightly toward the accent so nothing reads as a stray warm neutral. Shadows are kept for things that genuinely float — the composer, a sheet, a toast; a flat surface gets a wash or a hairline instead. Radii step by depth: 20px containers, 14px default, 10px inner elements, and anything button-shaped is a pill.

### Nothing needs explaining that a control already says

The app's rule about its own text: **an affordance beats a sentence about the affordance.** In practice —

- **No empty states.** Not on the day with nothing due, not on an empty to-do list, not on an area with no goals written. "Add habit" and "Add to-do" are on those screens either way, and they say the same thing in two words.
- **No prose under a control** explaining what the control just did, what a to-do is, or what pausing means. What is left is a handful of hints inside pickers that state a real constraint (a monthly day is 1–28), and the one place with no affordance to point at: iOS has no install button, so **Add to home screen** spells out the two taps that do work (§9).
- **Icons where an icon is unambiguous**: the tab bar is three glyphs with no captions, Edit is a pencil, Back is an arrow. Each carries a real `aria-label`, because "unambiguous" is about the eye and a screen reader has neither.
- **The screen says what it is once**, in its title, and nothing repeats it.

### Non-negotiables

- **No pinch- or double-tap zoom.** `user-scalable=no` plus `maximum-scale=1` in the viewport meta, `touch-action: manipulation` and `text-size-adjust: 100%` in CSS. This is installed to a home screen and has to behave like an app, not a page; the page is designed at one scale and every control is thumb-sized already. The page does not rubber-band either (`overscroll-behavior-y: none`).
- **Priority lives on the tick**, as the colour of its ring — not on a stripe down the edge of the row and not on a dot beside the title. It belongs on the thing you tap. Crossing out sits at the *far* end of the row: two rings side by side made every row ask its question twice.
- **Paused habits show a neutral grey**, not their priority colour — advertising urgency for something excluded from scoring is a lie.
- **A streak is shown from the second one.** One kept day is not a run of anything, and a flame beside a zero congratulates you on nothing.
- **Tabular figures** on every number that sits in a column with another number.
- **A visible focus ring** on everything interactive, and real `aria-label`s on icon-only buttons — of which there are now many. The chart needs a text description; it is the main data display.
- **No browser dialogs.** Confirmation happens inline.
- **The header is sticky**, and a back arrow lives *inside* it rather than above it: an arrow that scrolls away while the title stays put reads as a web page.
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

`freezes.subgoal_id` points at a subgoal, not at a goal (§3) — a schema written against v2 needs that foreign key moved before it will take a v3 device's rows.

Day-type columns (`date`, `created_at` on goals/subgoals, `achieved_on`, `start_date` / `repeat_until`, pause bounds) are Postgres `date`, never `timestamptz` — the §2 convention survives the round trip untouched. `subgoals.time` is a bare Postgres `time`, for the same reason: 07:30 means half seven wherever the phone is, not an instant that moves when it crosses a border.

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

- **Last-write-wins** by `updated_at` is the entire conflict policy. For one person's habit data, the newer edit is simply the right one. This is exactly why ids are minted per device (§3): last-write-wins on a colliding primary key does not merge two rows safely, it destroys one of them.
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
    ui/            # React: Tasks, Star, Goal
  public/          # icons 180/192/512 + maskable (all PNG)
  scripts/         # make-icons.mjs — rasterises the icons, so the PNGs
                   # are generated from one definition rather than hand-made
  e2e/             # browser checks: the offline boot, the SPA rewrite, the
                   # store's real behaviour — none of which unit tests can see
  migration/       # sample-export.json: the sample dataset, and the
                   # documented shape a one-off migration would arrive in
  supabase/
    migrations/    # cloud schema + RLS policies, checked in
  index.html
  vite.config.ts   # includes vite-plugin-pwa
  vercel.json      # SPA rewrite: all routes -> /index.html
```

Vercel checks the filesystem *before* applying rewrites, so a blanket
`/(.*) → /index.html` still serves real files — `sw.js`, the manifest, the
icons, everything under `/assets` — and only unmatched routes fall through to
the shell. `assets/*` is immutable for a year (the filenames are hashed);
`sw.js` and the manifest must be `max-age=0`, or a stale worker keeps serving a
bundle that has already been replaced.

No monorepo, no workspaces — one `package.json`, one install, one build. The §12 monorepo trap cannot recur if there is no monorepo.

### Wiring the three services

| Service | Setup, once |
|---|---|
| **Vercel** | Import the GitHub repo; framework preset Vite. Every push to `main` deploys. Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (the anon key is safe to ship — RLS is the security boundary). |
| **Supabase** | One project. Apply `supabase/migrations`; enable magic-link email auth; add the site URL to the auth redirect allowlist. |
| **Cloudflare** | CNAME `life` → `cname.vercel-dns.com`, **DNS-only (grey cloud)**. Add the domain in Vercel so it issues the certificate. |

### Build order — each milestone is usable on its own

1. **Core, pure.** Port §2–§6 into `src/core` with unit tests on the cadence and window rules. No UI yet; this is where all the subtle bugs live, so it gets tests first.
2. **Local-only app.** UI on Dexie, full feature set, zero network. Any one-off import of existing data happens through `importSnapshot`, not through a screen — the settings screen and its JSON import/export were removed in v2.6.
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
| **A 30-day scoring window** | Silently re-weights tasks as the calendar shifts. Use 28. |
| **Fixed monthly days above 28** | The task vanishes in short months with no error. Clamp on write *and* on read. |
| **An SVG `apple-touch-icon`** | iOS ignores it entirely and shows a screenshot instead. It must be PNG. |
| **A zoomable viewport on an installed app** | A double-tap near a tick zooms the page instead of ticking, and the layout is left at a scale nothing else in the app expects. Lock the scale in the viewport meta *and* set `touch-action: manipulation` — the meta alone still leaves the double-tap gesture on some builds. |
| **Composer text under 16px** | iOS zooms the page the instant the field takes focus, and never zooms back. Every input the composer opens with is 16px or more. |
| **Deleting a task on edit** | Orphans its check-ins and rewrites history. Archive instead. |
| **Deleting a goal's tasks with it** | A goal owns no tasks (§1); removing an aim must not touch a habit. |
| **Deleting an area's habits with it** | Their check-ins describe real days. Archive them, exactly as for a single habit, and tombstone only the area and its goals. |
| **Leaving a gap in `areas.position`** | The ring is drawn from the *order*, but a later insert lands on `last + 1`; a gap left by a removal eventually collides. Compact on every removal. |
| **Scoring to-dos** | An errand jotted down and dropped drags an area's number below what its habits deserve, and the star stops meaning anything. Filter them out before any tally begins. |
| **A `kind` column beside `cadence_type`** | Two fields saying habit-or-to-do can disagree, and the cadence fields are the ones the scheduling rules actually walk. Derive it. |
| **Anchoring a repeat interval on "today"** | "Every 4 weeks" silently lands on different weeks tomorrow than it does today. Anchor on `start_date ?? created_at`. |
| **A repeat whose end date precedes its start** | The task looks live in the editor and can never come due. Drop the end date at the storage boundary. |
| **A paused flag with no periods** | Resuming back-fills the dormant weeks with misses. |
| **Dropping a pause when it moves between tables** | The v2 → v3 upgrade re-points a goal's period onto every habit that hung off it. Losing one back-fills months of deliberate absence as failure — the exact outcome periods exist to prevent. |
| **Serverless hosting plus a file database** | No persistent disk. The data disappears on every deploy, quietly. The new shape avoids this by construction: device + Supabase, nothing stored on Vercel. |
| **A monorepo where the host installs only the root** | The build fails with `exit 127`, command not found. Avoided here by having one package, full stop. |
| **Number inputs and the mouse wheel** | Scrolling over a focused number field silently changes its value, and `max` does not prevent it. Validate at the storage boundary. |
| **Cloudflare's proxy in front of Vercel** | Orange-clouding the record puts two certificate/caching layers in an argument — redirect loops and stale deploys. The record must be DNS-only. |
| **Missing SPA rewrite on Vercel** | Deep links and refresh on any route but `/` return 404. One rewrite rule in `vercel.json` sends every path to `index.html`. |
| **Supabase free tier pauses idle projects** | A project untouched for about a week is paused until manually resumed; sync fails quietly meanwhile. Daily use keeps it warm — but the sync indicator must surface failures rather than swallow them. |

---

**Migration:** Existing data moves across as JSON — the five tables dumped whole, loaded into the device store at milestone 2 with row ids preserved, because the tables reference each other by id. The first sync after login then seeds Supabase from the device, so the migration is one import, not two. Read the destination's column list when loading, so a dump taken before a schema change still loads. There is no import screen — `importSnapshot` is the whole surface, and `migration/sample-export.json` is the worked example of the shape.

**Moving priority onto the task (v2.4):** an export or a device written before this carries `goals.importance` and no `subgoals.area_id`. Both the JSON importer and the IndexedDB upgrade hand each goal's importance *down* to its tasks and fill `area_id` from the goal, **before** dropping the column. Doing it in the other order would reset every task on the device to `medium` and silently re-weight the whole star.

**Flattening the goal tier (v3.0):** an export or a device written before this carries `subgoals.goal_id`, `goals.status = 'frozen'` and `freezes.goal_id`. Three things happen on the way in, and each of them loses data if skipped:

1. a task takes its `area_id` from the goal it hung off, when its own row never got one, **before** `goal_id` is dropped;
2. one goal-level pause becomes **N task-level ones**, one per habit that hung off it. The first keeps the original id so a device that already synced it sees no churn (§10); the rest are minted from the same device-partitioned counter, inside the same transaction;
3. only then does `frozen` become `active`, because the periods it stood for now live on the habits.

Both paths are covered: `normaliseSnapshot` does it for a JSON dump arriving from anywhere, and the Dexie v3 upgrade does it for the store already on the phone. The upgrade is the one path that runs exactly once, offline, with no way to retry — `src/db/migrate.test.ts` builds a genuine v2 database through raw IndexedDB and opens Dexie on top of it, and the browser smoke test does the same again for real.
