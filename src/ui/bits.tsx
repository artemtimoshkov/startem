/** Small shared pieces. Accessibility rules from SPEC.md §8 live here. */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { CheckinStatus, Importance } from '../core'
import { back } from './router'
import { playCompleteSound } from './sound'

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
 * The tick. It wears the item's priority as the colour of its ring, which is
 * what the rows lost their left-edge stripe and their priority dot to:
 * priority belongs on the thing you tap, not beside it.
 *
 * Ticking again clears the row back to unresolved (§7).
 *
 * The chime lives here rather than at the call sites so that every way of
 * marking something done sounds the same, and so that only *marking* it does:
 * clearing the row is silent (§8).
 */
export function TickButton({
  status,
  label,
  importance,
  disabled,
  onTick,
}: {
  status: CheckinStatus | null
  label: string
  importance?: Importance
  disabled?: boolean
  onTick: () => void
}) {
  return (
    <button
      type="button"
      className={`check${importance ? ` imp-${importance}` : ''}${status === 'done' ? ' on' : ''}`}
      aria-pressed={status === 'done'}
      aria-label={status === 'done' ? `Untick ${label}` : `Tick ${label}`}
      disabled={disabled}
      onClick={() => {
        if (status !== 'done') playCompleteSound()
        onTick()
      }}
    >
      {status === 'done' ? <Tick /> : null}
    </button>
  )
}

/**
 * Crossing out: an immediate miss, and equally reversible (§7).
 *
 * It sits at the far end of the row rather than beside the tick. Two rings
 * side by side made every row ask a question twice; the one you mean is the
 * tick, and the other belongs out of the way.
 */
export function CrossButton({
  status,
  label,
  disabled,
  onCross,
}: {
  status: CheckinStatus | null
  label: string
  disabled?: boolean
  onCross: () => void
}) {
  return (
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

/** The back arrow. Icon only: an arrow pointing left needs no caption. */
function BackButton({ to }: { to: string }) {
  return (
    <button type="button" className="backlink" aria-label="Back" onClick={() => back(to)}>
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <path
          d="M11.5 4.5L6 10l5.5 5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

/**
 * The screen header: a back arrow if there is somewhere to go, the title, and
 * whatever one control the screen needs on the right.
 *
 * It is sticky, and the back arrow lives inside it rather than above it — an
 * arrow that scrolls away while the title stays is the sort of thing that only
 * reads as a web page.
 */
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
    <div className="topbar">
      {backTo !== undefined ? <BackButton to={backTo} /> : null}
      <h1>{title}</h1>
      {sub ? <span className="sub">{sub}</span> : null}
      <span className="spacer" />
      {right}
    </div>
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

/** The priority flag, the way the composer and the rows both show it. */
export function Flag({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d="M4 2v12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M4.9 2.6h7l-1.6 2.7 1.6 2.7h-7z" fill="currentColor" />
    </svg>
  )
}

/** A streak. Small, because a streak is encouragement, not a headline. */
export function Flame({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path
        d="M8 1.6c.5 2.2-.6 3.1-1.7 4.2C5 7.1 4 8.2 4 10a4 4 0 108 0c0-1.6-.7-2.6-1.4-3.5-.3.6-.7 1-1.2 1.2.5-2-.2-4.3-1.4-6.1z"
        fill="currentColor"
      />
    </svg>
  )
}

/** A goal: an aim, drawn as one. */
export function Target({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor">
      <circle cx="8" cy="8" r="5.6" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="2.2" strokeWidth="1.4" />
    </svg>
  )
}

/** Editing, as an icon: the areas editor hangs off this on the star. */
export function Pencil({ size = 17 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.4 3.4l3.2 3.2-9 9-4 .8.8-4z" />
      <path d="M11.6 5.2l3.2 3.2" />
    </svg>
  )
}

export function Plus({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true">
      <path
        d="M10 4.5v11M4.5 10h11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** `P1` / `P2` / `P3`, in the order a person ranks things. */
export const PRIORITY_LABEL: Record<Importance, string> = {
  high: 'P1',
  medium: 'P2',
  low: 'P3',
}

export const PRIORITY_NAME: Record<Importance, string> = {
  high: 'P1 · High',
  medium: 'P2 · Medium',
  low: 'P3 · Low',
}

export const PRIORITIES: Importance[] = ['high', 'medium', 'low']

/**
 * A bottom sheet: the app's one overlay.
 *
 * Every picker in the composer is one of these rather than a native dialog —
 * `alert` and `confirm` are blocking, unstyleable, and read as browser
 * artefacts rather than as part of the app (§7, §8). Escape and a tap on the
 * backdrop both close it, and focus moves into the panel so a keyboard can
 * reach the options.
 */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  onBack,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  onBack?: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    panel.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sheet-scrim" onClick={onClose} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          {onBack ? (
            <button type="button" className="sheet-back" aria-label="Back" onClick={onBack}>
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path
                  d="M10 3.5L5 8l5 4.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : null}
          <span className="sheet-title">{title}</span>
          <span className="spacer" />
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
            <Cross size={14} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

/** One tappable line inside a sheet. */
export function SheetRow({
  icon,
  label,
  hint,
  selected,
  onClick,
  danger,
}: {
  icon?: ReactNode
  label: ReactNode
  hint?: ReactNode
  selected?: boolean
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      className={`sheet-row${selected ? ' is-selected' : ''}${danger ? ' is-danger' : ''}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      {icon ? <span className="sheet-row-icon">{icon}</span> : null}
      <span className="sheet-row-label">{label}</span>
      {hint ? <span className="sheet-row-hint">{hint}</span> : null}
      {selected ? <Tick size={13} /> : null}
    </button>
  )
}
