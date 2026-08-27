/** View 2 — the star, and the areas beneath it (SPEC.md §6). */

import {
  actionRate,
  buildStar,
  goalRate,
  taskRepeatLabel,
  type Goal,
} from '../core'
import { useSnapshot } from './DataContext'
import { RadarChart } from './charts'
import { ListLink, Percent, ScoreBadge, Stripe, TopBar } from './bits'
import { navigate } from './router'

export function StarScreen() {
  const { snapshot, index, today } = useSnapshot()
  const star = buildStar(snapshot, today)

  return (
    <div className="screen">
      <TopBar title="Where you stand" sub="last 28 days" />

      <div className="card card-pad">
        <RadarChart star={star} onSelect={(id) => navigate(`/areas/${id}`)} />
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
  // Tasks hanging straight off the area, with no goal above them (§3).
  const loose = (index.subgoalsByArea.get(areaId) ?? []).filter((t) => t.goal_id == null)

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
          <p className="empty">
            No goals in {area.name} yet — goals are created here, tasks from the Tasks screen.
          </p>
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

      {loose.length > 0 ? (
        <>
          <p className="section-label">Tasks with no goal</p>
          <div className="card">
            {loose.map((task) => (
              <button
                key={task.id}
                type="button"
                className="row row-button"
                onClick={() => navigate(`/tasks/${task.id}`)}
              >
                <Stripe importance={task.importance} />
                <div className="row-body">
                  <div className="row-title">{task.title}</div>
                  <div className="row-meta">
                    <span>{taskRepeatLabel(task, { short: true })}</span>
                  </div>
                </div>
                <Percent rate={actionRate(index, task)} />
              </button>
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
  const tasks = index.subgoalsByGoal.get(goal.id) ?? []

  return (
    <ListLink to={`/goals/${goal.id}`} ariaLabel={`${goal.title}, open goal`}>
      {/* A goal has no priority of its own to advertise — the stripe only
          marks it as live or frozen (§3). */}
      <span className={`row-stripe ${frozen ? 'bg-frozen' : 'bg-goal'}`} aria-hidden="true" />
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
          {tasks.length} task{tasks.length === 1 ? '' : 's'}
          {frozen ? ' · frozen' : null}
        </span>
      </span>
      <Percent rate={rate} />
    </ListLink>
  )
}
