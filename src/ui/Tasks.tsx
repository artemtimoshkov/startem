/** View 1 — the day's tasks (SPEC.md §6). */

import { useState } from 'react'
import { buildToday, isTaskActive, taskRepeatLabel, type TodayItem } from '../core'
import { toggleDone, toggleSkipped } from '../db/repo'
import { useSnapshot } from './DataContext'
import {
  CheckControls,
  Chevron,
  ImportanceDot,
  Percent,
  Plus,
  Stripe,
  TopBar,
  formatDate,
} from './bits'
import { InstallCard } from './install'
import { TaskComposer, fromTask } from './TaskComposer'
import { Link, back, navigate } from './router'

export function TasksScreen() {
  const { snapshot, index, today } = useSnapshot()
  const view = buildToday(snapshot, today)
  const pct = view.target === 0 ? null : view.doneCount / view.target
  const [composing, setComposing] = useState(false)

  return (
    <div className="screen">
      <TopBar title="Tasks" sub={formatDate(today, { year: undefined })} />

      {view.total > 0 ? (
        <div className="card card-pad">
          <div className="progress-head">
            <span className="big num">
              {view.doneCount}
              <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>
                {' '}
                / {view.target}
              </span>
            </span>
            <Percent rate={pct} />
          </div>
          <div className="bar">
            <span style={{ width: `${(pct ?? 0) * 100}%` }} />
          </div>
          {view.skippedCount > 0 ? (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
              {view.skippedCount} crossed out — removed from the target, not counted against you.
            </p>
          ) : null}
        </div>
      ) : null}

      {composing ? (
        <TaskComposer onSaved={() => setComposing(false)} onCancel={() => setComposing(false)} />
      ) : (
        <button type="button" className="add-task" onClick={() => setComposing(true)}>
          <span className="add-task-plus">
            <Plus />
          </span>
          Add task
        </button>
      )}

      {view.groups.length === 0 && !composing ? (
        <div className="card">
          <p className="empty">
            Nothing due today.
            <br />
            Add a task above, or set up a goal from{' '}
            <Link to="/star">the star</Link>.
          </p>
        </div>
      ) : null}

      {view.groups.map((group) => (
        <div key={group.area_id}>
          <p className="section-label">{group.areaName}</p>
          <div className="card">
            {group.items.map((item) => (
              <Row key={item.subgoal_id} item={item} today={today} />
            ))}
          </div>
        </div>
      ))}

      <NotToday due={new Set(view.items.map((i) => i.subgoal_id))} />

      {index.tasks.length > 0 ? (
        <p style={{ marginTop: 20, fontSize: 13 }}>
          <Link to="/star">See where you stand →</Link>
        </p>
      ) : null}

      <InstallCard />
    </div>
  )
}

/**
 * Everything that exists but is not owed today.
 *
 * A task set to "every Monday" and added on a Wednesday would otherwise
 * vanish the instant it was saved — the day's list is the only list, so it has
 * to admit to what it is not showing.
 */
function NotToday({ due }: { due: Set<number> }) {
  const { index } = useSnapshot()
  const rest = index.tasks.filter((t) => !due.has(t.id) && isTaskActive(index, t))
  const [open, setOpen] = useState(false)
  if (rest.length === 0) return null

  return (
    <>
      <button type="button" className="section-toggle" onClick={() => setOpen(!open)}>
        <span className="section-label" style={{ margin: 0 }}>
          Not due today · {rest.length}
        </span>
        <span className={`section-caret${open ? ' is-open' : ''}`}>
          <Chevron />
        </span>
      </button>
      {open ? (
        <div className="card">
          {rest.map((task) => {
            const area = index.areaById.get(task.area_id)
            const goal = task.goal_id == null ? null : index.goalById.get(task.goal_id)
            return (
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
                    <span>{goal ? `${area?.name} › ${goal.title}` : (area?.name ?? '')}</span>
                    <span>·</span>
                    <span>{taskRepeatLabel(task, { short: true })}</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      ) : null}
    </>
  )
}

function Row({ item, today }: { item: TodayItem; today: string }) {
  const { index } = useSnapshot()
  const task = index.subgoalById.get(item.subgoal_id)
  const cls = item.status === 'done' ? ' is-done' : item.status === 'skipped' ? ' is-skipped' : ''

  return (
    <div className={`row${cls}`}>
      <Stripe importance={item.importance} />
      <CheckControls
        status={item.status}
        label={item.title}
        onTick={() => void toggleDone(item.subgoal_id, today, item.status)}
        onCross={() => void toggleSkipped(item.subgoal_id, today, item.status)}
      />
      <div className="row-body">
        <button
          type="button"
          className="row-title row-open"
          onClick={() => navigate(`/tasks/${item.subgoal_id}`)}
        >
          {item.title}
        </button>
        <div className="row-meta">
          <ImportanceDot importance={item.importance} />
          {item.goal_id != null ? (
            <Link to={`/goals/${item.goal_id}`}>{item.goalTitle}</Link>
          ) : (
            <Link to={`/areas/${item.area_id}`}>{item.areaName}</Link>
          )}
          <span>·</span>
          <span>{task ? taskRepeatLabel(task, { short: true }) : ''}</span>
          {item.time ? (
            <>
              <span>·</span>
              <span className="num">{item.time}</span>
            </>
          ) : null}
          <span>·</span>
          <span className="num">weight {item.weight}</span>
          {item.overdue ? (
            <>
              <span>·</span>
              <span className="overdue-tag">
                overdue {item.due_date ? formatDate(item.due_date) : ''}
              </span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * The task editor: the same composer, opened on a task that already exists.
 * There is no second form to keep in step with the first one.
 */
export function TaskScreen({ taskId }: { taskId: number }) {
  const { index } = useSnapshot()
  const task = index.subgoalById.get(taskId)

  if (!task) {
    return (
      <div className="screen">
        <TopBar title="Task" backTo="/" />
        <div className="card">
          <p className="empty">That task is archived, or no longer exists.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="screen">
      <TopBar title="Edit task" backTo="/" />
      <TaskComposer
        taskId={taskId}
        initial={fromTask(task)}
        submitLabel="Save task"
        onSaved={() => back('/')}
        onCancel={() => back('/')}
      />
    </div>
  )
}
