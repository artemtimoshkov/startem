/** Small shared pieces. Accessibility rules from SPEC.md §8 live here. */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { CheckinStatus, Importance } from '../core'
import { Link, back } from './router'

export function Tick({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Cross({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Chevron() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="chev">
      <path
        d="M6 3.5l5 4.5-5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Tick / cross pair for one item. Ticking again clears the row back to
 * unresolved; crossing out writes `skipped`, an immediate miss, and is
 * equally reversible (§7).
 */
export function CheckControls({
  status,
  label,
  disabled,
  onTick,
  onCross,
}: {
  status: CheckinStatus | null
  label: string
  disabled?: boolean
  onTick: () => void
  onCross: () => void
}) {
  return (
    <>
      <button
        type="button"
        className={`check${status === 'done' ? ' on' : ''}`}
        aria-pressed={status === 'done'}
        aria-label={status === 'done' ? `Untick ${label}` : `Tick ${label}`}
        disabled={disabled}
        onClick={onTick}
      >
        {status === 'done' ? <Tick /> : null}
      </button>
      <button
        type="button"
        className={`check cross${status === 'skipped' ? ' on' : ''}`}
        aria-pressed={status === 'skipped'}
        aria-label={status === 'skipped' ? `Restore ${label}` : `Cross out ${label}`}
        disabled={disabled}
        onClick={onCross}
      >
        <Cross />
      </button>
    </>
  )
}

const IMPORTANCE_LABEL: Record<Importance, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

/** Priority reads as red / amber / green — and neutral grey when frozen (§8). */
export function ImportanceDot({ importance, frozen }: { importance: Importance; frozen?: boolean }) {
  return (
    <span
      className={`dot ${frozen ? 'bg-frozen' : `bg-${importance}`}`}
      role="img"
      aria-label={frozen ? 'Frozen' : `${IMPORTANCE_LABEL[importance]} importance`}
    />
  )
}

export function ImportancePill({ importance, frozen }: { importance: Importance; frozen?: boolean }) {
  return (
    <span className={`pill ${frozen ? 'imp-frozen' : `imp-${importance}`}`}>
      {frozen ? 'Frozen' : IMPORTANCE_LABEL[importance]}
    </span>
  )
}

export function Stripe({ importance, frozen }: { importance: Importance; frozen?: boolean }) {
  return <span className={`row-stripe ${frozen ? 'bg-frozen' : `bg-${importance}`}`} aria-hidden="true" />
}

/** A score out of 10, or an em dash for null — nothing scheduled has no opinion. */
export function ScoreBadge({ score }: { score: number | null }) {
  return (
    <span className={`score-badge score${score == null ? ' nullish' : ''}`}>
      {score == null ? '—' : score.toFixed(1)}
    </span>
  )
}

export function Percent({ rate }: { rate: number | null }) {
  return <span className="pct">{rate == null ? '—' : `${Math.round(rate * 100)}%`}</span>
}

export function TopBar({
  title,
  sub,
  right,
  backTo,
}: {
  title: string
  sub?: ReactNode
  right?: ReactNode
  backTo?: string
}) {
  return (
    <>
      {backTo !== undefined ? (
        <button type="button" className="backlink" onClick={() => back(backTo)}>
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path
              d="M10 3.5L5 8l5 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back
        </button>
      ) : null}
      <div className="topbar">
        <h1>{title}</h1>
        {sub ? <span className="sub">{sub}</span> : null}
        <span className="spacer" />
        {right}
      </div>
    </>
  )
}

/**
 * Inline confirmation. **No browser dialogs** — `confirm()` is a blocking,
 * unstyleable dialog that reads as a browser artefact rather than part of the
 * app (§7, §8).
 */
export function InlineConfirm({
  question,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  question: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="confirm" role="alertdialog" aria-label={question}>
      <p>{question}</p>
      <div className="btn-row">
        <button type="button" className="btn btn-sm btn-danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="btn btn-sm btn-quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/** A quiet, non-blocking status line. */
export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return
    const id = window.setTimeout(onDone, 2600)
    return () => window.clearTimeout(id)
  }, [message, onDone])
  if (!message) return null
  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  )
}

export function useToast() {
  const [message, setMessage] = useState<string | null>(null)
  return {
    message,
    show: setMessage,
    clear: () => setMessage(null),
  }
}

export function ListLink({
  to,
  children,
  ariaLabel,
}: {
  to: string
  children: ReactNode
  ariaLabel?: string
}) {
  return (
    <Link to={to} className="list-link" aria-label={ariaLabel}>
      {children}
      <Chevron />
    </Link>
  )
}

/** `Mon 24 Aug`, from a `YYYY-MM-DD` string — parsed as local, never UTC. */
export function formatDate(date: string, opts: Intl.DateTimeFormatOptions = {}): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...opts,
  })
}

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** Describes a cadence in words, for the row meta line. */
export function cadenceLabel(action: {
  cadence_type: string
  days: number[]
  monthly_day: number | null
  month_weekday: number | null
  month_ordinal: number | null
  due_date: string | null
}): string {
  const ordinals: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', [-1]: 'last' }
  switch (action.cadence_type) {
    case 'weekly': {
      if (action.days.length === 7) return 'Every day'
      if (action.days.length === 0) return 'No days set'
      return action.days.map((d) => WEEKDAY_LABELS[d]).join(', ')
    }
    case 'monthly':
    case 'quarterly': {
      const period = action.cadence_type === 'monthly' ? 'Monthly' : 'Quarterly'
      if (action.month_weekday != null) {
        const ord = ordinals[action.month_ordinal ?? -1] ?? 'last'
        return `${period}, ${ord} ${WEEKDAY_LABELS[action.month_weekday]}`
      }
      return `${period}, day ${action.monthly_day ?? '—'}`
    }
    case 'once':
      return action.due_date ? `Once, by ${formatDate(action.due_date)}` : 'Once, no deadline'
    default:
      return ''
  }
}
