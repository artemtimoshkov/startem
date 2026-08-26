/**
 * The repeat vocabulary — SPEC.md §4.
 *
 * The composer offers a handful of named repeats ("every week on Sunday")
 * plus a custom builder, and every one of them is only ever a preset over the
 * cadence fields in §3. Building and reading those presets lives here, in the
 * pure core, so the picker, the row subtitle and the tests can never drift
 * apart on what "every quarter" means.
 *
 * Pure: imports nothing but `./score` and `./types`.
 */

import { clampMonthlyDay, dayOfMonth, dow } from './score'
import type { CadenceType, ISODate, Subgoal } from './types'

/** The named repeats the picker offers, in the order it offers them. */
export type RepeatKind =
  | 'none'
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'custom'

/** The units a custom repeat counts in. */
export type RepeatUnit = 'day' | 'week' | 'month'

/** Just the scheduling fields — the part of a task a repeat decides. */
export interface RepeatSpec {
  cadence_type: CadenceType
  interval: number
  days: number[]
  monthly_day: number | null
  month_weekday: number | null
  month_ordinal: number | null
  repeat_until: ISODate | null
}

export const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]
const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const ORDINALS: Record<number, string> = {
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
  [-1]: 'last',
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS = [0, 1, 2, 3, 4]

function sameDays(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  return a.every((d, i) => d === b[i])
}

/** A repeat of nothing: the task happens once, on its date or whenever. */
export function noRepeat(): RepeatSpec {
  return {
    cadence_type: 'once',
    interval: 1,
    days: [],
    monthly_day: null,
    month_weekday: null,
    month_ordinal: null,
    repeat_until: null,
  }
}

/**
 * The spec behind a named repeat.
 *
 * `date` is the task's chosen day and it is what makes the presets read the
 * way the user picked them: "every week" on a task dated Sunday means every
 * Sunday, and "every month" means that day of the month.
 */
export function buildRepeat(
  kind: RepeatKind,
  date: ISODate | null,
  previous?: Partial<RepeatSpec>,
): RepeatSpec {
  const base = noRepeat()
  const weekday = date ? dow(date) : 0
  const monthDay = date ? clampMonthlyDay(dayOfMonth(date)) : 1
  const until = previous?.repeat_until ?? null

  switch (kind) {
    case 'none':
      return base
    case 'daily':
      return { ...base, cadence_type: 'weekly', days: [...EVERY_DAY], repeat_until: until }
    case 'weekdays':
      return { ...base, cadence_type: 'weekly', days: [...WEEKDAYS], repeat_until: until }
    case 'weekly':
      return { ...base, cadence_type: 'weekly', days: [weekday], repeat_until: until }
    case 'monthly':
      return { ...base, cadence_type: 'monthly', monthly_day: monthDay, repeat_until: until }
    case 'quarterly':
      return { ...base, cadence_type: 'quarterly', monthly_day: monthDay, repeat_until: until }
    case 'custom':
      // Opens on "every 1 week on <the task's day>", which is the shortest
      // distance from the presets the user has just walked past.
      return {
        ...base,
        cadence_type: previous?.cadence_type === 'once' ? 'weekly' : (previous?.cadence_type ?? 'weekly'),
        interval: Math.max(1, previous?.interval ?? 1),
        days: previous?.days?.length ? [...previous.days] : [weekday],
        monthly_day: previous?.monthly_day ?? monthDay,
        month_weekday: previous?.month_weekday ?? null,
        month_ordinal: previous?.month_ordinal ?? null,
        repeat_until: until,
      }
  }
}

/** Which named repeat a stored task matches, or `custom` when none of them do. */
export function classifyRepeat(spec: RepeatSpec): RepeatKind {
  if (spec.cadence_type === 'once') return 'none'
  if (spec.interval > 1) return 'custom'
  if (spec.cadence_type === 'weekly') {
    const days = [...spec.days].sort((a, b) => a - b)
    if (sameDays(days, EVERY_DAY)) return 'daily'
    if (sameDays(days, WEEKDAYS)) return 'weekdays'
    if (days.length === 1) return 'weekly'
    return 'custom'
  }
  if (spec.cadence_type === 'daily') return spec.interval === 1 ? 'daily' : 'custom'
  if (spec.cadence_type === 'monthly') return spec.month_weekday == null ? 'monthly' : 'custom'
  if (spec.cadence_type === 'quarterly') return spec.month_weekday == null ? 'quarterly' : 'custom'
  return 'custom'
}

function plural(n: number, unit: string): string {
  return n === 1 ? unit : `${n} ${unit}s`
}

function monthDayPhrase(spec: RepeatSpec): string {
  if (spec.month_weekday != null) {
    const ord = ORDINALS[spec.month_ordinal ?? -1] ?? 'last'
    return `the ${ord} ${WEEKDAY_NAMES[spec.month_weekday]}`
  }
  return `day ${spec.monthly_day ?? 1}`
}

/** The repeat in words — "Every 4 weeks on Thu", "Every quarter on day 5". */
export function describeRepeat(spec: RepeatSpec, opts: { short?: boolean } = {}): string {
  const names = opts.short ? SHORT : WEEKDAY_NAMES
  const until = spec.repeat_until ? `, until ${spec.repeat_until}` : ''

  switch (spec.cadence_type) {
    case 'once':
      return 'No repeat'
    case 'daily': {
      const n = Math.max(1, spec.interval)
      return `${n === 1 ? 'Every day' : `Every ${n} days`}${until}`
    }
    case 'weekly': {
      const days = [...spec.days].sort((a, b) => a - b)
      const n = Math.max(1, spec.interval)
      if (days.length === 0) return 'No days set'
      const on = sameDays(days, EVERY_DAY)
        ? null
        : sameDays(days, WEEKDAYS)
          ? 'weekdays'
          : days.map((d) => names[d]).join(', ')
      if (n === 1) {
        if (on == null) return `Every day${until}`
        if (on === 'weekdays') return `Every weekday${until}`
        return `Every week on ${on}${until}`
      }
      return `Every ${n} weeks on ${on ?? 'every day'}${until}`
    }
    case 'monthly': {
      const n = Math.max(1, spec.interval)
      const every = n === 1 ? 'Every month' : `Every ${plural(n, 'month')}`
      return `${every} on ${monthDayPhrase(spec)}${until}`
    }
    case 'quarterly':
      return `Every quarter on ${monthDayPhrase(spec)}${until}`
    default:
      return ''
  }
}

/** The repeat of a stored task, in words. */
export function taskRepeatLabel(task: Subgoal, opts: { short?: boolean } = {}): string {
  return describeRepeat(task, opts)
}
