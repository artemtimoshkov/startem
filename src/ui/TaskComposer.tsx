/**
 * The task composer — SPEC.md §7.
 *
 * One card, and one switch at the top of it: a **habit** repeats and is what
 * the star scores; a **to-do** happens once and is not scored at all (§5).
 * That switch is the only place the two are chosen between, and it writes
 * nothing but the repeat — the distinction *is* the repeat (§3).
 *
 * Under it, a line to type the task into and the three things a task needs
 * before it can be scheduled or scored: which area it belongs to, when it
 * lands, and how much it matters. Everything else — the calendar, the time,
 * the repeat — hangs off the date chip, because that is the only one of them
 * that has any meaning without it.
 *
 * The pickers are bottom sheets rather than browser dialogs (§8), and the
 * repeat presets come from the pure core so that the words here and the
 * scheduling rules there cannot drift apart (§4).
 */

import { useMemo, useRef, useState } from 'react'
import {
  addDays,
  buildRepeat,
  classifyRepeat,
  clampMonthlyDay,
  dayOfMonth,
  describeRepeat,
  dow,
  month as monthOf,
  noRepeat,
  parseISO,
  toISO,
  weekStart,
  year as yearOf,
  type Importance,
  type ISODate,
  type RepeatKind,
  type RepeatSpec,
  type Subgoal,
} from '../core'
import { archiveTask, saveTask, type TaskDraft } from '../db/repo'
import { useSnapshot } from './DataContext'
import {
  Cross,
  Flag,
  PRIORITIES,
  PRIORITY_LABEL,
  PRIORITY_NAME,
  Sheet,
  SheetRow,
  Tick,
  WEEKDAY_INITIALS,
  WEEKDAY_LABELS,
  formatDate,
} from './bits'

// ---------------------------------------------------------------------------
// The value the composer edits
// ---------------------------------------------------------------------------

export interface ComposerValue {
  title: string
  area_id: number
  importance: Importance
  /** A one-time task's deadline, or a repeating one's start. Optional either way. */
  date: ISODate | null
  time: string | null
  repeat: RepeatSpec
}

/**
 * The composer's value as a row the store can take.
 *
 * The single date field means two different things depending on the repeat,
 * and this is the one place that decides which: with no repeat it is the
 * deadline, with one it is the day the repeat starts counting from (§4).
 */
export function toTaskDraft(value: ComposerValue, id?: number): TaskDraft {
  const recurring = value.repeat.cadence_type !== 'once'
  return {
    ...(id == null ? {} : { id }),
    area_id: value.area_id,
    title: value.title.trim(),
    importance: value.importance,
    cadence_type: value.repeat.cadence_type,
    interval: value.repeat.interval,
    days: value.repeat.days,
    monthly_day: value.repeat.monthly_day,
    month_weekday: value.repeat.month_weekday,
    month_ordinal: value.repeat.month_ordinal,
    due_date: recurring ? null : value.date,
    start_date: recurring ? value.date : null,
    repeat_until: recurring ? value.repeat.repeat_until : null,
    time: value.time,
    weight: null,
  }
}

/** A stored task read back into the composer. */
export function fromTask(task: Subgoal): ComposerValue {
  return {
    title: task.title,
    area_id: task.area_id,
    importance: task.importance,
    date: task.cadence_type === 'once' ? task.due_date : task.start_date,
    time: task.time,
    repeat: {
      cadence_type: task.cadence_type,
      interval: task.interval,
      days: task.days,
      monthly_day: task.monthly_day,
      month_weekday: task.month_weekday,
      month_ordinal: task.month_ordinal,
      repeat_until: task.repeat_until,
    },
  }
}

/**
 * `p1` / `p2` / `p3` typed into the line sets the priority and leaves the
 * title. It is the one shorthand worth having: priority is the field most
 * often set and the one most awkward to reach for mid-sentence.
 */
const PRIORITY_TOKEN = /(^|\s)p([123])(?=\s|$)/i
const TOKEN_TO_IMPORTANCE: Record<string, Importance> = { 1: 'high', 2: 'medium', 3: 'low' }

export function readPriorityToken(
  title: string,
): { title: string; importance: Importance } | null {
  const hit = PRIORITY_TOKEN.exec(title)
  if (!hit) return null
  return {
    title: title.replace(PRIORITY_TOKEN, '$1').replace(/\s{2,}/g, ' ').trim(),
    importance: TOKEN_TO_IMPORTANCE[hit[2]!]!,
  }
}

// ---------------------------------------------------------------------------
// The composer
// ---------------------------------------------------------------------------

/**
 * What a new task opens on.
 *
 * P3, not the middle of the scale: most of what gets typed in is ordinary, and
 * a default of P2 (weight 2) meant every routine task quietly counted double a
 * genuinely small one until it was corrected by hand. Starting at the floor
 * makes raising the priority the deliberate act, which is the one worth a tap.
 * Editing an existing task still opens on whatever that task already carries.
 */
const DEFAULT_IMPORTANCE: Importance = 'low'

type Picker = 'where' | 'date' | 'repeat' | 'time' | 'priority'

/**
 * What "make this a habit" means when there is no repeat to keep.
 *
 * Daily, because a habit typed in without a thought is almost always a daily
 * one, and because it is the cadence that reads back most obviously wrong if
 * it was not what was meant — which is what makes it safe to guess.
 */
const HABIT_FALLBACK: RepeatKind = 'daily'

export function TaskComposer({
  taskId,
  initial,
  onSaved,
  onCancel,
  submitLabel,
}: {
  taskId?: number
  initial?: Partial<ComposerValue>
  onSaved: (id: number) => void
  onCancel: () => void
  submitLabel?: string
}) {
  const { index, today } = useSnapshot()
  const [value, setValue] = useState<ComposerValue>(() => ({
    title: '',
    area_id: initial?.area_id ?? index.areas[0]?.id ?? 1,
    importance: initial?.importance ?? DEFAULT_IMPORTANCE,
    date: initial?.date ?? null,
    time: initial?.time ?? null,
    /* A habit unless the caller says otherwise. This is a habit tracker:
       the to-do screen is the one place that opens on `noRepeat()`, and
       everywhere else the common case should cost no taps (§7). */
    repeat: initial?.repeat ?? buildRepeat(HABIT_FALLBACK, initial?.date ?? null),
    ...initial,
  }))
  // A stack, so the Repeat sheet opened from inside the date sheet comes back
  // to the date sheet rather than dumping the user out of both.
  const [stack, setStack] = useState<Picker[]>([])
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const open = stack[stack.length - 1] ?? null
  const push = (p: Picker) => setStack((s) => [...s, p])
  const pop = () => setStack((s) => s.slice(0, -1))
  const closeAll = () => setStack([])

  const patch = (p: Partial<ComposerValue>) => setValue((v) => ({ ...v, ...p }))

  const area = index.areaById.get(value.area_id)
  const habit = value.repeat.cadence_type !== 'once'
  const canSave = value.title.trim().length > 0 && !saving

  /**
   * The habit / to-do switch. It sets the repeat and nothing else: a habit
   * with no repeat is a contradiction, and a to-do with one is a habit (§3).
   * Turning a habit into a to-do keeps the date as its deadline, which is what
   * "do this once, by then" already meant.
   */
  const setKind = (toHabit: boolean) => {
    if (toHabit === habit) return
    patch({ repeat: toHabit ? buildRepeat(HABIT_FALLBACK, value.date) : noRepeat() })
  }

  const setTitle = (raw: string) => {
    const token = readPriorityToken(raw)
    if (token) patch({ title: token.title, importance: token.importance })
    else patch({ title: raw })
  }

  /**
   * Moving the date moves what the repeat means — "every week" on a task
   * dragged from Sunday to Thursday has to become every Thursday, not stay on
   * a Sunday the task no longer has (§4).
   */
  const setDate = (date: ISODate | null) => {
    const kind = classifyRepeat(value.repeat)
    const repeat =
      kind === 'custom' || kind === 'none'
        ? value.repeat
        : buildRepeat(kind, date, value.repeat)
    patch({ date, repeat })
  }

  const submit = () => {
    if (!canSave) return
    setSaving(true)
    void saveTask(toTaskDraft(value, taskId), today)
      .then((id) => onSaved(id))
      .finally(() => setSaving(false))
  }

  return (
    <div className="composer">
      <div className="kindswitch" role="group" aria-label="What kind of task">
        <button
          type="button"
          className="kindswitch-btn"
          aria-pressed={habit}
          onClick={() => setKind(true)}
        >
          <RepeatIcon />
          Habit
        </button>
        <button
          type="button"
          className="kindswitch-btn"
          aria-pressed={!habit}
          onClick={() => setKind(false)}
        >
          <Tick size={13} />
          To-do
        </button>
      </div>

      <input
        ref={input}
        className="composer-input"
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the composer only
        // exists because the user just asked to type a task.
        autoFocus
        value={value.title}
        aria-label={habit ? 'Habit' : 'To-do'}
        placeholder={habit ? 'e.g. Wake up at 7 am' : 'e.g. Book the dentist'}
        enterKeyHint="done"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') onCancel()
        }}
      />

      <div className="composer-chips">
        <button
          type="button"
          className="chip"
          onClick={() => push('where')}
          aria-label={`Area: ${area?.name ?? 'none'}`}
        >
          <InboxIcon />
          {area?.name ?? 'Area'}
        </button>

        <button
          type="button"
          className={`chip${value.date ? ' is-set' : ''}`}
          onClick={() => push('date')}
        >
          <CalendarIcon />
          {dateChipLabel(value, today)}
        </button>
        {/* Clears the date and time only — never the repeat. Dropping the
            repeat would turn a habit into a to-do behind the user's back, and
            that decision belongs to the switch above (§7). */}
        {value.date || value.time ? (
          <button
            type="button"
            className="chip-clear"
            aria-label="Clear the date"
            onClick={() => patch({ date: null, time: null })}
          >
            <Cross size={11} />
          </button>
        ) : null}

        <button
          type="button"
          className={`chip imp-${value.importance}`}
          onClick={() => push('priority')}
          aria-label={`Priority ${PRIORITY_NAME[value.importance]}`}
        >
          <Flag />
          {PRIORITY_LABEL[value.importance]}
        </button>

        {/* Grouped, and pushed right with `margin-left: auto` rather than a
            flex spacer: a spacer is a flex item, so when the chips wrap it
            claims a line of its own and strands the send button below it. */}
        <span className="composer-actions">
          <button type="button" className="composer-cancel" aria-label="Cancel" onClick={onCancel}>
            <Cross size={15} />
          </button>
          <button
            type="button"
            className="composer-submit"
            aria-label={submitLabel ?? 'Add task'}
            disabled={!canSave}
            onClick={submit}
          >
            <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
              <path
                d="M10 16V4.5M4.8 9.6L10 4.2l5.2 5.4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </span>
      </div>

      {open === 'where' ? (
        <AreaPicker
          area_id={value.area_id}
          onPick={(area_id) => {
            patch({ area_id })
            closeAll()
          }}
          onClose={pop}
        />
      ) : null}

      {open === 'date' ? (
        <DatePicker
          value={value}
          today={today}
          onPick={setDate}
          onClose={pop}
          onTime={() => push('time')}
          onRepeat={() => push('repeat')}
        />
      ) : null}

      {open === 'repeat' ? (
        <RepeatPicker
          repeat={value.repeat}
          date={value.date}
          onPick={(repeat) => {
            patch({ repeat })
            closeAll()
          }}
          onBack={pop}
          onClose={closeAll}
        />
      ) : null}

      {open === 'time' ? (
        <TimePicker
          time={value.time}
          onPick={(time) => {
            patch({ time })
            pop()
          }}
          onClose={pop}
        />
      ) : null}

      {open === 'priority' ? (
        <Sheet title="Priority" onClose={pop}>
          {PRIORITIES.map((imp) => (
            <SheetRow
              key={imp}
              icon={
                <span className={`imp-${imp}`}>
                  <Flag size={15} />
                </span>
              }
              label={PRIORITY_NAME[imp]}
              hint={`weight ${imp === 'high' ? 4 : imp === 'medium' ? 2 : 1}`}
              selected={value.importance === imp}
              onClick={() => {
                patch({ importance: imp })
                pop()
              }}
            />
          ))}
        </Sheet>
      ) : null}

      {taskId != null ? (
        <div className="composer-foot">
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => void archiveTask(taskId).then(() => onSaved(taskId))}
          >
            Archive
          </button>
        </div>
      ) : null}
    </div>
  )
}

function dateChipLabel(value: ComposerValue, today: ISODate): string {
  if (value.repeat.cadence_type !== 'once') {
    return describeRepeat(value.repeat, { short: true })
  }
  if (!value.date) return 'Date'
  const day =
    value.date === today
      ? 'Today'
      : value.date === addDays(today, 1)
        ? 'Tomorrow'
        : formatDate(value.date, { weekday: undefined })
  return value.time ? `${day} ${value.time}` : day
}

// ---------------------------------------------------------------------------
// Where the task lives: an area, and nothing below it
// ---------------------------------------------------------------------------

/**
 * One flat list of areas — no second level, because there is no longer one.
 *
 * A habit hangs straight off "Health"; the goals inside Health are aims, not
 * folders, and putting them here would recreate exactly the tier §3 removed.
 * Areas themselves are added and removed from the star's edit mode (§7), so
 * this sheet only ever chooses between what is already there.
 */
function AreaPicker({
  area_id,
  onPick,
  onClose,
}: {
  area_id: number
  onPick: (area_id: number) => void
  onClose: () => void
}) {
  const { index } = useSnapshot()

  return (
    <Sheet title="Area" onClose={onClose}>
      {index.areas.map((a) => {
        const habits = (index.habitsByArea.get(a.id) ?? []).length
        return (
          <SheetRow
            key={a.id}
            label={a.name}
            hint={habits === 0 ? 'no habits yet' : `${habits} habit${habits === 1 ? '' : 's'}`}
            selected={a.id === area_id}
            onClick={() => onPick(a.id)}
          />
        )
      })}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// The date: shortcuts, a month, and the two things that hang off a date
// ---------------------------------------------------------------------------

/** The coming Saturday, or today when today *is* Saturday. */
function thisWeekend(today: ISODate): ISODate {
  // Sunday is still the weekend, so on a Sunday the shortcut means today —
  // not a Saturday six days out. Every other day walks forward to Saturday.
  return dow(today) === 6 ? today : addDays(today, (5 - dow(today) + 7) % 7)
}

function DatePicker({
  value,
  today,
  onPick,
  onClose,
  onTime,
  onRepeat,
}: {
  value: ComposerValue
  today: ISODate
  onPick: (date: ISODate | null) => void
  onClose: () => void
  onTime: () => void
  onRepeat: () => void
}) {
  const [cursor, setCursor] = useState<ISODate>(value.date ?? today)
  const grid = useMemo(() => monthGrid(cursor), [cursor])
  const [y, m] = parseISO(cursor)
  const monthName = new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })

  /**
   * Picking a date does **not** close the sheet.
   *
   * The date is usually only half the answer — a time or a repeat follows, and
   * both of those live in this sheet's footer. Closing on the first tap threw
   * the other two away and made the user reopen the chip to get back. The
   * chosen day turns red instead, and the sheet waits to be dismissed (§7).
   */
  const shortcut = (label: string, date: ISODate | null, hint: string) => (
    <SheetRow label={label} hint={hint} selected={value.date === date} onClick={() => onPick(date)} />
  )

  return (
    <Sheet
      title={value.date ? formatDate(value.date) : 'No date'}
      onClose={onClose}
      footer={
        <div className="sheet-foot-row">
          {/* The labels read back what is already set, so the aria-label
              carries the fixed name of the control instead (§8). */}
          <button type="button" className="btn btn-sm" aria-label="Time" onClick={onTime}>
            <ClockIcon />
            {value.time ?? 'Time'}
          </button>
          <button type="button" className="btn btn-sm" aria-label="Repeat" onClick={onRepeat}>
            <RepeatIcon />
            {value.repeat.cadence_type === 'once'
              ? 'Repeat'
              : describeRepeat(value.repeat, { short: true })}
          </button>
        </div>
      }
    >
      {shortcut('Today', today, formatDate(today, { day: undefined, month: undefined }))}
      {shortcut('Tomorrow', addDays(today, 1), formatDate(addDays(today, 1), { day: undefined, month: undefined }))}
      {shortcut(
        'This weekend',
        thisWeekend(today),
        formatDate(thisWeekend(today), { day: undefined, month: undefined }),
      )}
      {shortcut('No date', null, '')}

      <div className="cal">
        <div className="cal-head">
          <strong>{monthName}</strong>
          <span className="spacer" />
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setCursor(shiftMonth(cursor, -1))}
          >
            ‹
          </button>
          <button type="button" aria-label="This month" onClick={() => setCursor(today)}>
            ·
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setCursor(shiftMonth(cursor, 1))}
          >
            ›
          </button>
        </div>
        {/* Monday-first, like every other grid in the app (§2). */}
        <div className="cal-weekdays">
          {WEEKDAY_INITIALS.map((initial, i) => (
            <span key={i}>{initial}</span>
          ))}
        </div>
        <div className="cal-grid">
          {grid.map((date) => {
            const outside = monthOf(date) !== m || yearOf(date) !== y
            const cls = [
              'cal-day',
              outside ? 'is-outside' : '',
              date === value.date ? 'is-picked' : '',
              date === today ? 'is-today' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <button
                key={date}
                type="button"
                className={cls}
                aria-pressed={date === value.date}
                aria-label={formatDate(date, { year: 'numeric' })}
                onClick={() => onPick(date)}
              >
                {dayOfMonth(date)}
              </button>
            )
          })}
        </div>
      </div>
    </Sheet>
  )
}

/** Six Monday-start weeks covering the month `date` sits in. */
function monthGrid(date: ISODate): ISODate[] {
  const [y, m] = parseISO(date)
  const first = weekStart(toISO(y, m, 1))
  return Array.from({ length: 42 }, (_, i) => addDays(first, i))
}

function shiftMonth(date: ISODate, by: number): ISODate {
  const [y, m] = parseISO(date)
  // Day 1, so that stepping from the 31st does not skip a month.
  return toISO(y, m + by, 1)
}

// ---------------------------------------------------------------------------
// Time of day — stored as a bare HH:MM, never a timestamp (§2)
// ---------------------------------------------------------------------------

function TimePicker({
  time,
  onPick,
  onClose,
}: {
  time: string | null
  onPick: (time: string | null) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(time ?? '09:00')
  return (
    <Sheet
      title="Time"
      onClose={onClose}
      footer={
        <div className="sheet-foot-row">
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => onPick(null)}>
            No time
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-sm btn-primary" onClick={() => onPick(draft)}>
            Save
          </button>
        </div>
      }
    >
      <div className="field" style={{ padding: '4px 2px 0' }}>
        <label htmlFor="task-time">Time of day</label>
        <input
          id="task-time"
          className="input"
          type="time"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Repeat
// ---------------------------------------------------------------------------

const PRESETS: RepeatKind[] = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'quarterly']

/**
 * The repeat sheet — SPEC.md §7.
 *
 * Unlike the date sheet, picking here *is* the whole answer: "every day" and
 * "every week on Monday" say when the task lands without needing a day out of
 * the calendar as well. So a preset commits and dismisses the pickers outright
 * (`onPick`), and the way back to the calendar is the explicit Back button in
 * the footer — bottom-left, in thumb reach on a phone, rather than a chevron
 * up in the corner. The header's × closes the stack, as it does everywhere.
 */
function RepeatPicker({
  repeat,
  date,
  onPick,
  onBack,
  onClose,
}: {
  repeat: RepeatSpec
  date: ISODate | null
  onPick: (repeat: RepeatSpec) => void
  /** Back to the date sheet this one was opened from. */
  onBack: () => void
  onClose: () => void
}) {
  const current = classifyRepeat(repeat)
  const [custom, setCustom] = useState<RepeatSpec | null>(
    current === 'custom' ? repeat : null,
  )

  if (custom) {
    return (
      <CustomRepeat
        spec={custom}
        onChange={setCustom}
        onSave={() => onPick(custom)}
        onBack={() => setCustom(null)}
        onClose={onClose}
      />
    )
  }

  return (
    <Sheet
      title="Repeat"
      onClose={onClose}
      footer={
        <div className="sheet-foot-row">
          <button type="button" className="btn btn-sm btn-quiet" onClick={onBack}>
            <ChevronLeft />
            Back
          </button>
          <span className="spacer" />
        </div>
      }
    >
      {PRESETS.map((kind) => {
        const spec = buildRepeat(kind, date, repeat)
        return (
          <SheetRow
            key={kind}
            label={describeRepeat(spec)}
            selected={current === kind}
            onClick={() => onPick(spec)}
          />
        )
      })}
      <SheetRow
        label="Custom…"
        selected={current === 'custom'}
        onClick={() => setCustom(buildRepeat('custom', date, repeat))}
      />
    </Sheet>
  )
}

const UNITS: { value: RepeatSpec['cadence_type']; label: string }[] = [
  { value: 'daily', label: 'Days' },
  { value: 'weekly', label: 'Weeks' },
  { value: 'monthly', label: 'Months' },
]

function CustomRepeat({
  spec,
  onChange,
  onSave,
  onBack,
  onClose,
}: {
  spec: RepeatSpec
  onChange: (spec: RepeatSpec) => void
  onSave: () => void
  /** Back to the preset list, discarding the custom spec being built. */
  onBack: () => void
  onClose: () => void
}) {
  const weekly = spec.cadence_type === 'weekly'
  const monthly = spec.cadence_type === 'monthly'

  return (
    <Sheet
      title="Custom repeat"
      onClose={onClose}
      footer={
        <div className="sheet-foot-row">
          <button type="button" className="btn btn-sm btn-quiet" onClick={onBack}>
            <ChevronLeft />
            Back
          </button>
          <span className="sheet-foot-note">{describeRepeat(spec)}</span>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={weekly && spec.days.length === 0}
            onClick={onSave}
          >
            Save
          </button>
        </div>
      }
    >
      <div className="field">
        <span className="field-label" id="every-label">
          Every
        </span>
        <div className="inline-fields" role="group" aria-labelledby="every-label">
          <input
            className="input input-sm"
            type="number"
            min={1}
            max={99}
            inputMode="numeric"
            aria-label="Interval"
            value={spec.interval}
            /* Scrolling over a focused number field silently changes its value
               and `max` does not stop it (§12), so it surrenders focus. */
            onWheel={(e) => e.currentTarget.blur()}
            onChange={(e) =>
              onChange({ ...spec, interval: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })
            }
          />
          <select
            className="select input-sm"
            aria-label="Unit"
            value={spec.cadence_type}
            onChange={(e) => {
              const next = e.target.value as RepeatSpec['cadence_type']
              onChange({
                ...spec,
                cadence_type: next,
                days: next === 'weekly' ? (spec.days.length ? spec.days : [0]) : [],
                monthly_day: next === 'monthly' ? (spec.monthly_day ?? 1) : null,
                month_weekday: null,
                month_ordinal: null,
              })
            }}
          >
            {UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {weekly ? (
        <div className="field">
          <span className="field-label" id="on-label">
            On
          </span>
          <div className="dayjar" role="group" aria-labelledby="on-label">
            {WEEKDAY_INITIALS.map((initial, d) => {
              const on = spec.days.includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  aria-label={WEEKDAY_LABELS[d]}
                  onClick={() =>
                    onChange({
                      ...spec,
                      days: on
                        ? spec.days.filter((x) => x !== d)
                        : [...spec.days, d].sort((a, b) => a - b),
                    })
                  }
                >
                  {initial}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {monthly ? (
        <>
          <div className="field">
            <span className="field-label" id="pattern-label">
              Pattern
            </span>
            <div className="segmented" role="group" aria-labelledby="pattern-label">
              <button
                type="button"
                aria-pressed={spec.month_weekday == null}
                onClick={() =>
                  onChange({
                    ...spec,
                    month_weekday: null,
                    month_ordinal: null,
                    monthly_day: spec.monthly_day ?? 1,
                  })
                }
              >
                Day of month
              </button>
              <button
                type="button"
                aria-pressed={spec.month_weekday != null}
                onClick={() =>
                  onChange({ ...spec, month_weekday: 4, month_ordinal: -1, monthly_day: null })
                }
              >
                Weekday
              </button>
            </div>
          </div>
          {spec.month_weekday == null ? (
            <div className="field">
              <label htmlFor="custom-monthday">Day (1–28)</label>
              <input
                id="custom-monthday"
                className="input input-sm"
                type="number"
                min={1}
                max={28}
                inputMode="numeric"
                value={spec.monthly_day ?? 1}
                onWheel={(e) => e.currentTarget.blur()}
                onChange={(e) =>
                  onChange({ ...spec, monthly_day: clampMonthlyDay(Number(e.target.value) || 1) })
                }
              />
              <p className="sheet-note" style={{ padding: '6px 0 0' }}>
                1–28. For month-end, use <strong>last</strong> weekday.
              </p>
            </div>
          ) : (
            <div className="inline-fields field">
              <div>
                <label className="field-label" htmlFor="custom-ord">
                  Which
                </label>
                <select
                  id="custom-ord"
                  className="select input-sm"
                  value={spec.month_ordinal ?? -1}
                  onChange={(e) => onChange({ ...spec, month_ordinal: Number(e.target.value) })}
                >
                  <option value={1}>1st</option>
                  <option value={2}>2nd</option>
                  <option value={3}>3rd</option>
                  <option value={4}>4th</option>
                  <option value={-1}>Last</option>
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="custom-wd">
                  Weekday
                </label>
                <select
                  id="custom-wd"
                  className="select input-sm"
                  value={spec.month_weekday ?? 0}
                  onChange={(e) => onChange({ ...spec, month_weekday: Number(e.target.value) })}
                >
                  {WEEKDAY_LABELS.map((label, d) => (
                    <option key={d} value={d}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </>
      ) : null}

      <div className="field" style={{ marginBottom: 0 }}>
        <span className="field-label" id="ends-label">
          Ends
        </span>
        <div className="segmented" role="group" aria-labelledby="ends-label">
          <button
            type="button"
            aria-pressed={spec.repeat_until == null}
            onClick={() => onChange({ ...spec, repeat_until: null })}
          >
            Never
          </button>
          <button
            type="button"
            aria-pressed={spec.repeat_until != null}
            onClick={() =>
              onChange({ ...spec, repeat_until: spec.repeat_until ?? '' })
            }
          >
            On date
          </button>
        </div>
        {spec.repeat_until != null ? (
          <>
            <input
              className="input input-sm"
              style={{ marginTop: 8 }}
              type="date"
              aria-label="Last day, inclusive"
              value={spec.repeat_until}
              onChange={(e) => onChange({ ...spec, repeat_until: e.target.value })}
            />
          </>
        ) : null}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Chip glyphs
// ---------------------------------------------------------------------------

function InboxIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M2 9.5h3l1 1.5h4l1-1.5h3" strokeLinejoin="round" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
      <path d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2" strokeLinecap="round" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3.2l2 1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function RepeatIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M3 7a5 5 0 018.6-3.4M13 9a5 5 0 01-8.6 3.4" strokeLinecap="round" />
      <path d="M11.6 1.4v2.4h-2.4M4.4 14.6v-2.4h2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M10 3.5L5.5 8l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
