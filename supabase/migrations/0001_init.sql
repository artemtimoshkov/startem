-- Startem cloud schema — SPEC.md §10.
--
-- The five tables mirror the device store: same table names, same column
-- names, so a row moves between IndexedDB and Postgres without translation.
-- Each carries the three sync columns (§10):
--
--   user_id     uuid        defaults to auth.uid(); the RLS boundary
--   updated_at  timestamptz set by the writing device; orders conflicting writes
--   deleted     bool        tombstone; nothing is ever hard-deleted by sync
--
-- Two conventions from §2 survive the round trip and must not be "improved":
--
--   * every lived day is `date`, never `timestamptz`. A check-in on the 19th
--     is the 19th in Lisbon and in Tokyo. `updated_at` is the only timestamp
--     in the schema, and it describes a write, not a day.
--   * `subgoals."time"` is a bare `time`. 07:30 means half seven wherever the
--     phone is, not an instant that shifts when it crosses a border.
--
-- Ids are device-minted bigints (`deviceKey * 2^20 + counter`), so the primary
-- key is `(user_id, id)`: unique per device by construction, and scoped to the
-- account so two users can never collide.
--
-- There are deliberately **no foreign keys**. The device is the source of
-- truth and already enforces every relationship; Postgres here is a sync
-- target. A push that arrived a moment before the row it references would fail
-- an FK check and wedge that entry in the outbox with no good way out, which
-- trades a real failure for a theoretical one. Push order (areas, then goals
-- and tasks, then check-ins and periods) keeps the data coherent anyway.

-- ---------------------------------------------------------------------------
-- areas
-- ---------------------------------------------------------------------------
create table if not exists public.areas (
  user_id    uuid        not null default auth.uid(),
  id         bigint      not null,
  name       text        not null,
  "position" integer     not null default 0,
  updated_at timestamptz not null default now(),
  deleted    boolean     not null default false,
  primary key (user_id, id)
);

-- ---------------------------------------------------------------------------
-- goals — an aim, owning nothing (§3)
-- ---------------------------------------------------------------------------
create table if not exists public.goals (
  user_id     uuid        not null default auth.uid(),
  id          bigint      not null,
  area_id     bigint      not null,
  title       text        not null,
  description text        not null default '',
  status      text        not null default 'active' check (status in ('active', 'achieved')),
  "position"  integer     not null default 0,
  achieved_on date,
  created_at  date        not null,
  updated_at  timestamptz not null default now(),
  deleted     boolean     not null default false,
  primary key (user_id, id)
);

-- ---------------------------------------------------------------------------
-- subgoals — the tasks; the only thing that is ever ticked (§3)
-- ---------------------------------------------------------------------------
create table if not exists public.subgoals (
  user_id       uuid        not null default auth.uid(),
  id            bigint      not null,
  area_id       bigint      not null,
  title         text        not null,
  importance    text        not null default 'medium'
                            check (importance in ('high', 'medium', 'low')),
  -- Habit vs to-do is derived from this and nothing else: `once` is a to-do.
  -- There is no `kind` column and there must not be one (§12).
  cadence_type  text        not null
                            check (cadence_type in ('daily', 'weekly', 'monthly', 'quarterly', 'once')),
  "interval"    integer     not null default 1 check ("interval" >= 1),
  -- Monday-first, zero-indexed: 0 = Monday … 6 = Sunday (§2).
  days          integer[]   not null default '{}',
  -- Clamped to 1–28. Days 29–31 make a task vanish in short months (§12).
  monthly_day   integer     check (monthly_day between 1 and 28),
  month_weekday integer     check (month_weekday between 0 and 6),
  month_ordinal integer     check (month_ordinal between -1 and 4 and month_ordinal <> 0),
  due_date      date,
  start_date    date,
  -- Inclusive, unlike a pause's end_date (§3).
  repeat_until  date,
  "time"        time,
  weight        real,
  created_at    date        not null,
  archived      boolean     not null default false,
  updated_at    timestamptz not null default now(),
  deleted       boolean     not null default false,
  primary key (user_id, id)
);

-- ---------------------------------------------------------------------------
-- checkins — no row means unresolved, which is not the same as missed (§5)
-- ---------------------------------------------------------------------------
--
-- `(user_id, subgoal_id, date)` is the natural key and the primary key, which
-- is what makes two devices editing the same day *upsert into one row* and
-- converge, rather than duplicating it.
create table if not exists public.checkins (
  user_id    uuid        not null default auth.uid(),
  subgoal_id bigint      not null,
  date       date        not null,
  status     text        not null check (status in ('done', 'skipped')),
  updated_at timestamptz not null default now(),
  deleted    boolean     not null default false,
  primary key (user_id, subgoal_id, date)
);

-- ---------------------------------------------------------------------------
-- freezes — a pause on one habit; a period, not a flag (§3)
-- ---------------------------------------------------------------------------
--
-- Keyed on `subgoal_id`, not `goal_id`: a goal owns no work, so freezing one
-- would pause nothing. A schema written against v2 needs this column moved
-- before it will take a v3 device's rows (§10).
create table if not exists public.freezes (
  user_id    uuid        not null default auth.uid(),
  id         bigint      not null,
  subgoal_id bigint      not null,
  start_date date        not null,
  -- Null means still paused. **Exclusive** when set, unlike repeat_until.
  end_date   date,
  updated_at timestamptz not null default now(),
  deleted    boolean     not null default false,
  primary key (user_id, id)
);

-- ---------------------------------------------------------------------------
-- Pull indexes
-- ---------------------------------------------------------------------------
-- Every pull is `where user_id = auth.uid() and updated_at > last_pulled_at`,
-- so that pair is the index each table needs and the only one it needs.
create index if not exists areas_pull_idx    on public.areas    (user_id, updated_at);
create index if not exists goals_pull_idx    on public.goals    (user_id, updated_at);
create index if not exists subgoals_pull_idx on public.subgoals (user_id, updated_at);
create index if not exists checkins_pull_idx on public.checkins (user_id, updated_at);
create index if not exists freezes_pull_idx  on public.freezes  (user_id, updated_at);

-- ---------------------------------------------------------------------------
-- Row-level security is the whole authorisation model (§10)
-- ---------------------------------------------------------------------------
--
-- With these in place the browser talks to Postgres directly using the
-- publishable anon key: the database itself refuses to return or accept anyone
-- else's rows, so there is no API of ours to write or to secure. The anon key
-- shipping inside the bundle is by design — RLS is the boundary, not the key.
--
-- `with check` matters as much as `using`: without it a client could write a
-- row belonging to someone else even though it could never read one back.

alter table public.areas    enable row level security;
alter table public.goals    enable row level security;
alter table public.subgoals enable row level security;
alter table public.checkins enable row level security;
alter table public.freezes  enable row level security;

drop policy if exists own_rows on public.areas;
create policy own_rows on public.areas
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_rows on public.goals;
create policy own_rows on public.goals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_rows on public.subgoals;
create policy own_rows on public.subgoals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_rows on public.checkins;
create policy own_rows on public.checkins
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_rows on public.freezes;
create policy own_rows on public.freezes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
