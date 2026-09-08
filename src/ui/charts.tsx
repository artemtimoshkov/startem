/** The star, and the two small charts beside it (SPEC.md §6, §8). */

import type { HabitGridView, StarView, WeekBar } from '../core'
import { WEEKDAY_INITIALS } from './bits'

/**
 * The radar chart: one vertex per area, first at twelve o'clock and going
 * clockwise, faint rings at 2/4/6/8/10. Vertices are interactive; a null
 * score draws at the midpoint with a hollow dot and an em-dash label.
 *
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
  const width = 400
  const height = 330
  const cx = width / 2
  const cy = 158
  const R = 100
  const rad = (deg: number) => (deg * Math.PI) / 180
  const at = (angle: number, radius: number) => ({
    x: cx + Math.cos(rad(angle)) * radius,
    y: cy + Math.sin(rad(angle)) * radius,
  })

  const vertices = star.vertices
  const scored = vertices.filter((v) => v.score != null)
  const polygon = vertices
    .map((v) => {
      const p = at(v.angle, R * v.radiusRatio)
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
    })
    .join(' ')

  return (
    <div className="star-wrap">
      <svg
        className="star-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={star.description}
      >
        {star.rings.map((ring) => (
          <circle
            key={ring}
            cx={cx}
            cy={cy}
            r={(R * ring) / 10}
            fill="none"
            stroke="var(--hairline)"
            strokeWidth="1"
            pointerEvents="none"
          />
        ))}
        {vertices.map((v) => {
          const end = at(v.angle, R)
          return (
            <line
              key={`spoke-${v.area_id}`}
              x1={cx}
              y1={cy}
              x2={end.x}
              y2={end.y}
              stroke="var(--hairline)"
              strokeWidth="1"
              pointerEvents="none"
            />
          )
        })}

        {scored.length >= 3 ? (
          <polygon
            points={polygon}
            fill="rgba(61,106,143,.16)"
            stroke="var(--accent)"
            strokeWidth="1.6"
            strokeLinejoin="round"
            pointerEvents="none"
          />
        ) : null}

        {vertices.map((v) => {
          const p = at(v.angle, R * v.radiusRatio)
          const label = at(v.angle, R + 20)
          const inner = at(v.angle, 42)
          const outer = at(v.angle, R + 24)
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
                The dots are 4px and the labels are 9.5px, so the target is a
                transparent strip running along the outer half of the spoke and
                out past the label. It also has to cover the group's own bounding
                box centre, or a pointer aimed at the middle of the vertex lands
                on the decorative spoke behind it.
              */}
              <line
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
                stroke="transparent"
                strokeWidth="34"
                strokeLinecap="round"
              />
              <circle cx={label.x} cy={label.y} r="24" fill="transparent" />
              <circle
                cx={p.x}
                cy={p.y}
                r="4"
                fill={v.score == null ? 'var(--bg)' : 'var(--accent)'}
                stroke="var(--accent)"
                strokeWidth="1.6"
              />
              <text
                className="star-label"
                x={label.x}
                y={label.y - 3}
                textAnchor={anchor}
              >
                {v.name}
              </text>
              <text
                className="star-label"
                x={label.x}
                y={label.y + 9}
                textAnchor={anchor}
              >
                <tspan className="score">{v.label}</tspan>
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
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
