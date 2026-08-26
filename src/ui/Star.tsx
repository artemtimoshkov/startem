/** Views 2 and 3 — the star and the weekly history strip (SPEC.md §6). */

import {
  buildStar,
  buildWeeklyStrip,
  goalRate,
  type Goal,
} from '../core'
import { useSnapshot } from './DataContext'
import { CalendarGrid, GoalGrid, RadarChart, WeeklyStrip } from './charts'
import { ImportanceDot, ListLink, Percent, ScoreBadge, TopBar } from './bits'
import { navigate } from './router'

export function StarScreen() {
  const { snapshot, index, today } = useSnapshot()
  const star = buildStar(snapshot, today)
  const bars = buildWeeklyStrip(snapshot, today)

  return (
    <div className="screen">
      <TopBar title="Where you stand" sub="last 28 days" />

      <div className="card card-pad">
        <RadarChart star={star} onSelect={(id) => navigate(`/areas/${id}`)} />
      </div>

      <div className="card card-pad">
        <p className="card-title">Last 8 weeks</p>
        <WeeklyStrip bars={bars} />
      </div>

      <p className="section-label">Areas</p>
      <div className="card">
        {star.vertices.map((v) => {
          const goals = (index.goalsByArea.get(v.area_id) ?? []).filter((g) => !g.deleted)
          const active = goals.filter((g) => g.status === 'active').length
          return (
            <ListLink
              key={v.area_id}
              to={`/areas/${v.area_id}`}
              ariaLabel={`${v.name}, score ${v.label} out of 10, ${active} active goals`}
            >
              <span style={{ flex: 1 }}>
                {v.name}
                <span
                  style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)' }}
                >
                  {goals.length === 0
                    ? 'No goals yet'
                    : `${active} active${
                        goals.length - active > 0 ? `, ${goals.length - active} frozen` : ''
                      }`}
                </span>
              </span>
              <ScoreBadge score={v.score} />
            </ListLink>
          )
        })}
      </div>
    </div>
  )
}

export function AreaScreen({ areaId }: { areaId: number }) {
  const { snapshot, index, today } = useSnapshot()
  const area = index.areaById.get(areaId)
  const star = buildStar(snapshot, today)
  const vertex = star.vertices.find((v) => v.area_id === areaId)

  if (!area) {
    return (
      <div className="screen">
        <TopBar title="Area" backTo="/star" />
        <div className="card">
          <p className="empty">That area no longer exists.</p>
        </div>
      </div>
    )
  }

  const goals = index.goalsByArea.get(areaId) ?? []
  const activeGoals = goals.filter((g) => g.status === 'active')
  const frozenGoals = goals.filter((g) => g.status === 'frozen')

  return (
    <div className="screen">
      <TopBar
        title={area.name}
        sub={vertex ? `${vertex.label} / 10` : undefined}
        backTo="/star"
        right={
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => navigate(`/areas/${areaId}/goals/new`)}
          >
            New goal
          </button>
        }
      />

      {goals.length === 0 ? (
        <div className="card">
          <p className="empty">No goals in {area.name} yet.</p>
        </div>
      ) : null}

      {activeGoals.length > 0 ? (
        <div className="card">
          {activeGoals.map((goal) => (
            <GoalRow key={goal.id} goal={goal} />
          ))}
        </div>
      ) : null}

      {frozenGoals.length > 0 ? (
        <>
          <p className="section-label">Frozen</p>
          <div className="card">
            {frozenGoals.map((goal) => (
              <GoalRow key={goal.id} goal={goal} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

function GoalRow({ goal }: { goal: Goal }) {
  const { index } = useSnapshot()
  const frozen = goal.status === 'frozen'
  const rate = frozen ? null : goalRate(index, goal)
  const actions = index.subgoalsByGoal.get(goal.id) ?? []

  return (
    <ListLink to={`/goals/${goal.id}`} ariaLabel={`${goal.title}, open goal`}>
      <span className={`row-stripe ${frozen ? 'bg-frozen' : `bg-${goal.importance}`}`} aria-hidden="true" />
      <span style={{ flex: 1, paddingLeft: 6 }}>
        {goal.title}
        <span
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            fontSize: 12,
            color: 'var(--text-secondary)',
            marginTop: 2,
          }}
        >
          <ImportanceDot importance={goal.importance} frozen={frozen} />
          {actions.length} action{actions.length === 1 ? '' : 's'}
          {frozen ? ' · frozen' : null}
        </span>
      </span>
      <Percent rate={rate} />
    </ListLink>
  )
}

export { GoalGrid, CalendarGrid }
