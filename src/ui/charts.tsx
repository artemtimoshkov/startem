/** The star, and the two small charts beside it (SPEC.md §6, §8). */

import type { HabitGridView, StarView, WeekBar } from '../core'
import { WEEKDAY_INITIALS } from './bits'

/**
 * The radar chart — the app's one picture of itself (§6, §8).
 *
 * One vertex per area, the first at twelve o'clock and going clockwise, on
 * faint rings at 2/4/6/8/10. The shape is filled with a soft radial wash of
 * the accent and outlined in it; every vertex carries its area's name and
 * score, and tapping one opens that area — which is the only way in, now that
 * the screen no longer repeats the areas as a list underneath.
 *
 * The mean of the scored areas is the one number the chart resolves to, and it
 * is drawn in the header rather than in the middle of the ring: a low mean
 * makes a small shape, and a number in the centre would sit on top of exactly
 * the shape it is describing.
 *
 * A null score draws at the midpoint with a hollow dot and an em-dash label.
 * The chart is the app's main data display, so it carries a text description
 * as well (§8).
 */
export function RadarChart({
  star,
  onSelect,
}: {
  star: StarView
  onSelect: (areaId: number) => void
}) {
  // The box is wider than the ring by roughly the width of a label: the names
  // sit outside the outer circle, and a chart that fills its box edge to edge
  // is a chart with its side labels cut off.
  const width = 460
  const height = 376
  const cx = width / 2
  const cy = 188
  const R = 130
  const rad = (deg: number) => (deg * Math.PI) / 180
  const at = (angle: number, radius: number) => ({
    x: cx + Math.cos(rad(angle)) * radius,
    y: cy + Math.sin(rad(angle)) * radius,
  })
  const point = (angle: number, radius: number) => {
    const p = at(angle, radius)
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
  }

  const vertices = star.vertices
  const scored = vertices.filter((v) => v.score != null)
  const shape = vertices.map((v) => point(v.angle, R * v.radiusRatio)).join(' ')

  return (
    <div className="star-wrap">
      <svg
        className="star-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={star.description}
      >
        <defs>
          {/* Densest in the middle, so the shape reads as a glow off the
              centre rather than as a ring. */}
          <radialGradient id="star-fill" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.07" />
          </radialGradient>
        </defs>

        {/* The rings, faintest first. The outermost is a touch stronger: it is
            the ten, and the shape is read against it. */}
        {star.rings.map((ring) => (
          <circle
            key={ring}
            cx={cx}
            cy={cy}
            r={(R * ring) / 10}
            fill="none"
            stroke={ring === 10 ? 'var(--hairline-strong)' : 'var(--hairline)'}
            strokeWidth="1"
            pointerEvents="none"
          />
        ))}

        {vertices.map((v) => {
          const from = at(v.angle, 0)
          const to = at(v.angle, R)
          return (
            <line
              key={`spoke-${v.area_id}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="var(--hairline)"
              strokeWidth="1"
              pointerEvents="none"
            />
          )
        })}

        {/* Three scored areas make a shape; two make a line; one makes only its
            own dot. Nothing here special-cases a count of ten. */}
        {scored.length >= 3 ? (
          <polygon
            points={shape}
            fill="url(#star-fill)"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinejoin="round"
            pointerEvents="none"
          />
        ) : scored.length === 2 ? (
          <line
            x1={at(scored[0]!.angle, R * scored[0]!.radiusRatio).x}
            y1={at(scored[0]!.angle, R * scored[0]!.radiusRatio).y}
            x2={at(scored[1]!.angle, R * scored[1]!.radiusRatio).x}
            y2={at(scored[1]!.angle, R * scored[1]!.radiusRatio).y}
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            pointerEvents="none"
          />
        ) : null}

        {vertices.map((v) => {
          const p = at(v.angle, R * v.radiusRatio)
          const label = at(v.angle, R + 17)
          const inner = at(v.angle, 44)
          const outer = at(v.angle, R + 28)
          const anchor =
            Math.abs(Math.cos(rad(v.angle))) < 0.25
              ? 'middle'
              : Math.cos(rad(v.angle)) > 0
                ? 'start'
                : 'end'
          return (
            <g
              key={v.area_id}
              className="star-vertex"
              role="button"
              tabIndex={0}
              aria-label={`${v.name}, score ${v.label} out of 10. Open area.`}
              onClick={() => onSelect(v.area_id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(v.area_id)
                }
              }}
            >
              {/*
                The dots are 5px and the labels are 11.5px, so the target is a
                wide transparent strip running along the spoke and out past the
                label — invisible itself, because a 40px band lighting up on
                hover reads as a smear across the chart.
              */}
              <line
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
                stroke="transparent"
                strokeWidth="40"
                strokeLinecap="round"
              />
              {/* Hover and focus land here instead: a ring around the dot. */}
              <circle className="star-halo" cx={p.x} cy={p.y} r="11" fill="none" />
              {/* The dot wears a ring of the page colour so it stays legible
                  where the outline of the shape runs under it. */}
              <circle
                cx={p.x}
                cy={p.y}
                r="5"
                fill={v.score == null ? 'var(--surface)' : 'var(--accent)'}
                stroke="var(--surface)"
                strokeWidth="2.5"
              />
              {v.score == null ? (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r="5"
                  fill="none"
                  stroke="var(--text-tertiary)"
                  strokeWidth="1.6"
                />
              ) : null}
              <text className="star-name" x={label.x} y={label.y - 5} textAnchor={anchor}>
                {shortName(v.name)}
              </text>
              <text
                className={`star-score${v.score == null ? ' is-null' : ''}`}
                x={label.x}
                y={label.y + 11}
                textAnchor={anchor}
              >
                {v.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/**
 * A chart label is a way in, not the name itself — the area screen behind the
 * vertex carries that in full. Anything longer than this pushes its label off
 * the side of a phone, so it is cut rather than allowed to.
 */
function shortName(name: string): string {
  return name.length > 14 ? `${name.slice(0, 13).trimEnd()}…` : name
}

// ---------------------------------------------------------------------------
// The per-habit tracker grid (§6)
// ---------------------------------------------------------------------------

const CELL_TITLE: Record<string, string> = {
  done: 'kept',
  partial: 'partly kept',
  missed: 'missed',
  today: 'due today',
  none: 'not due',
  frozen: 'paused',
  future: '',
}

/**
 * Fifteen weeks of one habit, Monday-aligned rows, oldest column first.
 *
 * Weeks run down the columns rather than across, which is what lets fifteen of
 * them fit the width of a phone without scrolling: seven rows, one per
 * weekday, is a fixed height whatever the span.
 */
export function DayGrid({ view }: { view: HabitGridView }) {
  const kept = view.weeks.flatMap((w) => w.days).filter((d) => d.state === 'done').length
  const missed = view.weeks.flatMap((w) => w.days).filter((d) => d.state === 'missed').length

  return (
    <div>
      <div
        className="daygrid"
        role="img"
        aria-label={`Fifteen weeks: ${kept} days kept, ${missed} missed.`}
      >
        <div className="daygrid-days" aria-hidden="true">
          {WEEKDAY_INITIALS.map((initial, i) => (
            <span key={i}>{i % 2 === 0 ? initial : ''}</span>
          ))}
        </div>
        <div className="daygrid-weeks">
          {view.weeks.map((week) => (
            <div key={week.weekStart} className="daygrid-week">
              {week.days.map((day) => (
                <span
                  key={day.date}
                  className={`daycell is-${day.state}`}
                  title={`${day.date}${CELL_TITLE[day.state] ? ` — ${CELL_TITLE[day.state]}` : ''}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="daygrid-key" aria-hidden="true">
        <span className="daycell is-missed" /> missed
        <span className="daycell is-today" /> today
        <span className="daycell is-done" /> kept
        <span className="daycell is-frozen" /> paused
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Eight-week history strip (§6)
// ---------------------------------------------------------------------------

/**
 * One bar per calendar week, in range mode — only what genuinely came due
 * inside each week (§5). A week with nothing due draws as a hairline rather
 * than as a zero: nothing owed is not the same as nothing done.
 */
export function WeekStrip({ bars }: { bars: WeekBar[] }) {
  const described = bars
    .map((b) => `${b.weekStart}: ${b.rate == null ? 'nothing due' : `${Math.round(b.rate * 100)}%`}`)
    .join(', ')

  return (
    <div className="weekstrip" role="img" aria-label={`Last ${bars.length} weeks — ${described}.`}>
      {bars.map((bar) => (
        <span key={bar.weekStart} className={`weekbar${bar.isCurrent ? ' is-current' : ''}`}>
          <span
            className={bar.rate == null ? 'weekbar-empty' : 'weekbar-fill'}
            style={bar.rate == null ? undefined : { height: `${Math.max(4, bar.rate * 100)}%` }}
          />
        </span>
      ))}
    </div>
  )
}
