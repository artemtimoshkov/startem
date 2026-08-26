/** The visual displays — SPEC.md §6, §8. */

import { useEffect, useRef } from 'react'
import { WEEKDAY_INITIALS, formatDate } from './bits'
import type { CalendarView, GoalGridView, StarView, WeekBar } from '../core'

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

/**
 * Eight calendar weeks, one bar per week, range mode. Weeks with nothing due
 * render **flat rather than empty**, so a gap is visibly different from a
 * zero (§6).
 */
export function WeeklyStrip({ bars }: { bars: WeekBar[] }) {
  return (
    <div>
      <div className="strip">
        {bars.map((bar) => {
          const pct = bar.rate == null ? 0 : Math.max(0.04, bar.rate)
          return (
            <div key={bar.weekStart} className="strip-col">
              <div
                className={`strip-bar${bar.rate == null ? ' flat' : ''}${
                  bar.isCurrent ? ' current' : ''
                }`}
                style={bar.rate == null ? undefined : { height: `${pct * 100}%` }}
                title={
                  bar.rate == null
                    ? `Week of ${formatDate(bar.weekStart)}: nothing due`
                    : `Week of ${formatDate(bar.weekStart)}: ${Math.round(bar.rate * 100)}%`
                }
              />
            </div>
          )
        })}
      </div>
      <div className="strip-axis" aria-hidden="true">
        {bars.map((bar) => (
          <span key={bar.weekStart}>{bar.weekStart.slice(8)}</span>
        ))}
      </div>
      <p className="sr-only">
        {bars
          .map(
            (b) =>
              `Week of ${formatDate(b.weekStart)}: ${
                b.rate == null ? 'nothing due' : `${Math.round(b.rate * 100)} percent`
              }`,
          )
          .join('. ')}
      </p>
    </div>
  )
}


/**
 * Both day grids run oldest-to-newest, and on a phone the newest weeks start
 * off the right edge. The interesting end is "now", so the scroller opens
 * there.
 */
function useScrolledToEnd<T extends HTMLElement>(deps: unknown[]) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollLeft = el.scrollWidth
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return ref
}

const STATE_TEXT: Record<string, string> = {
  done: 'all done',
  partial: 'partly done',
  missed: 'missed',
  today: 'today, unresolved',
  none: 'nothing due',
  frozen: 'frozen',
  future: 'upcoming',
}

/** Fifteen weeks of day cells for one goal: weekday rows, week columns (§6). */
export function GoalGrid({ grid }: { grid: GoalGridView }) {
  const scroller = useScrolledToEnd<HTMLDivElement>([grid.goal_id, grid.weeks.length])
  return (
    <div>
      <div style={{ display: 'flex' }}>
        <div className="dg-weekdays" aria-hidden="true">
          {WEEKDAY_INITIALS.map((w, i) => (
            <span key={i}>{i % 2 === 0 ? w : ''}</span>
          ))}
        </div>
        <div className="daygrid-scroll" ref={scroller}>
          <div className="daygrid">
            {grid.weeks.map((week) => (
              <div key={week.weekStart} className="dg-rows">
                {week.days.map((day) => (
                  <span
                    key={day.date}
                    className={`dg-cell s-${day.state}`}
                    title={`${formatDate(day.date)} — ${STATE_TEXT[day.state]}${
                      day.due ? ` (${day.done}/${day.due})` : ''
                    }`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="dg-legend">
        <span className="swatch s-missed dg-cell" />
        <span>missed</span>
        <span className="swatch s-partial dg-cell" />
        <span>partial</span>
        <span className="swatch s-done dg-cell" />
        <span>done</span>
        <span className="swatch s-frozen dg-cell" />
        <span>frozen</span>
      </div>
    </div>
  )
}

/**
 * Twenty-six weeks across all active goals. Colour runs in five bands from
 * "nothing logged" through to "everything logged"; clicking a day opens it as
 * an editable checklist (§6).
 */
export function CalendarGrid({
  calendar,
  onPick,
}: {
  calendar: CalendarView
  onPick: (date: string) => void
}) {
  const scroller = useScrolledToEnd<HTMLDivElement>([calendar.date, calendar.weeks.length])
  return (
    <div>
      <div style={{ display: 'flex' }}>
        <div className="dg-weekdays" aria-hidden="true">
          {WEEKDAY_INITIALS.map((w, i) => (
            <span key={i}>{i % 2 === 0 ? w : ''}</span>
          ))}
        </div>
        <div className="daygrid-scroll" ref={scroller}>
          <div className="daygrid">
            {calendar.weeks.map((week) => (
              <div key={week.weekStart} className="dg-rows">
                {week.days.map((day) => {
                  const summary = day.isFuture
                    ? 'upcoming'
                    : day.count === 0
                      ? 'nothing due'
                      : `${day.doneCount} of ${day.count} logged, ${day.done} of ${day.total} weight`
                  return (
                    <button
                      key={day.date}
                      type="button"
                      className={`dg-cell b${day.band ?? 'null'}${
                        day.isToday ? ' is-today' : ''
                      }${day.editable ? ' clickable' : ''}`}
                      aria-label={`${formatDate(day.date, { year: 'numeric' })} — ${summary}`}
                      aria-disabled={!day.editable}
                      title={`${formatDate(day.date)} — ${summary}`}
                      onClick={() => {
                        if (day.editable) onPick(day.date)
                      }}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="dg-legend">
        <span>less</span>
        <span className="swatch dg-cell b0" />
        <span className="swatch dg-cell b1" />
        <span className="swatch dg-cell b2" />
        <span className="swatch dg-cell b3" />
        <span className="swatch dg-cell b4" />
        <span>more</span>
        <span style={{ flex: 1 }} />
        <span className="swatch dg-cell bnull" />
        <span>nothing due</span>
      </div>
    </div>
  )
}
