/** The star — the app's one chart (SPEC.md §6, §8). */

import type { StarView } from '../core'

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
