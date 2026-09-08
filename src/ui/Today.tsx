/** View 1 — the day's habits (SPEC.md §6). */

import { useState } from 'react'
import {
  buildToday,
  buildTodos,
  isPaused,
  taskRepeatLabel,
  type TodayItem,
  type TodoItem,
} from '../core'
import { toggleDone, toggleSkipped } from '../db/repo'
import { useSnapshot } from './DataContext'
import {
  CrossButton,
  TickButton,
  Chevron,
  Flame,
  Percent,
  Plus,
  TopBar,
  formatDate,
} from './bits'
import { InstallCard } from './install'
import { TaskComposer } from './TaskComposer'
import { Link, navigate } from './router'

/**
 * The daily screen is **habits only**.
 *
 * That is the whole point of the split (§3): the thing you open every morning
 * and tick your way down should be the repeating work, not an inbox of
 * errands. To-dos have a screen of their own — with the one exception below,
 * which is that an errand already overdue has earned a line here.
 */
export function TodayScreen() {
  const { snapshot, today } = useSnapshot()
  const view = buildToday(snapshot, today)
  const todos = buildTodos(snapshot, today)
  const pct = view.target === 0 ? null : view.doneCount / view.target
  const [composing, setComposing] = useState(false)

  const dueTodos = todos.items.filter(
    (i) => i.status == null && (i.bucket === 'overdue' || i.bucket === 'today'),
  )

  return (
    <div className="screen">
      <TopBar title="Today" sub={formatDate(today, { year: undefined })} />

      {view.total > 0 ? (
        <div className="card-pad">
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
        </div>
      ) : null}

      {composing ? (
        <TaskComposer onSaved={() => setComposing(false)} onCancel={() => setComposing(false)} />
      ) : (
        <button type="button" className="add-task" onClick={() => setComposing(true)}>
          <span className="add-task-plus">
            <Plus size={15} />
          </span>
          Add habit
        </button>
      )}

      {view.groups.map((group) => (
        <div key={group.area_id}>
          <p className="section-label">
            <Link to={`/areas/${group.area_id}`}>{group.areaName}</Link>
          </p>
          <div className="card">
            {group.items.map((item) => (
              <HabitRow key={item.subgoal_id} item={item} today={today} />
            ))}
          </div>
        </div>
      ))}

      {/*
        The one place the two lists touch. An errand due today or already late
        is worth a line here — the alternative is missing it because you never
        opened the other tab — but it is a separate, quieter block rather than
        another row in the habit list, and it never touches the count above.
      */}
      {dueTodos.length > 0 ? (
        <>
          <p className="section-label">To-dos</p>
          <div className="card">
            {dueTodos.map((item) => (
              <TodoLine key={item.subgoal_id} item={item} today={today} />
            ))}
          </div>
        </>
      ) : null}

      <NotToday due={new Set(view.items.map((i) => i.subgoal_id))} />

      <InstallCard />
    </div>
  )
}

/**
 * Every habit that exists but is not owed today.
 *
 * A habit set to "every Monday" and added on a Wednesday would otherwise
 * vanish the instant it was saved — the day's list is the only list, so it has
 * to admit to what it is not showing.
 */
function NotToday({ due }: { due: Set<number> }) {
  const { index } = useSnapshot()
  const rest = index.habits.filter((t) => !due.has(t.id))
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
            const paused = isPaused(index, task)
            return (
              <button
                key={task.id}
                type="button"
                className="row row-button"
                onClick={() => navigate(`/tasks/${task.id}`)}
              >
                <div className="row-body">
                  <div className="row-title">{task.title}</div>
                  <div className="row-meta">
                    <span>{area?.name ?? ''}</span>
                    <span>·</span>
                    <span>{taskRepeatLabel(task, { short: true })}</span>
                    {paused ? (
                      <>
                        <span>·</span>
                        <span>paused</span>
                      </>
                    ) : null}
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

function HabitRow({ item, today }: { item: TodayItem; today: string }) {
  const { index } = useSnapshot()
  const task = index.subgoalById.get(item.subgoal_id)
  const cls = item.status === 'done' ? ' is-done' : item.status === 'skipped' ? ' is-skipped' : ''

  return (
    <div className={`row${cls}`}>
      <TickButton
        status={item.status}
        label={item.title}
        importance={item.importance}
        onTick={() => void toggleDone(item.subgoal_id, today, item.status)}
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
          <span>{task ? taskRepeatLabel(task, { short: true }) : ''}</span>
          {item.time ? (
            <>
              <span>·</span>
              <span className="num">{item.time}</span>
            </>
          ) : null}
          {/* A streak is the one number that makes a habit feel like a habit,
              so it is shown as soon as there is one rather than at a
              milestone. */}
          {/* From the second day: one kept day is not a run of anything. */}
          {item.streak > 1 ? (
            <>
              <span>·</span>
              <span className="streak">
                <Flame />
                {item.streak}
              </span>
            </>
          ) : null}
        </div>
      </div>
      <CrossButton
        status={item.status}
        label={item.title}
        onCross={() => void toggleSkipped(item.subgoal_id, today, item.status)}
      />
    </div>
  )
}

/** A to-do, as it appears on the habit screen: no weight, no streak, no score. */
export function TodoLine({ item, today }: { item: TodoItem; today: string }) {
  const cls = item.status === 'done' ? ' is-done' : item.status === 'skipped' ? ' is-skipped' : ''
  const late = item.status == null && item.due_date != null && item.due_date < today

  return (
    <div className={`row${cls}`}>
      <TickButton
        status={item.status}
        label={item.title}
        importance={item.importance}
        onTick={() => void toggleDone(item.subgoal_id, today, item.status)}
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
          <Link to={`/areas/${item.area_id}`}>{item.areaName}</Link>
          {item.due_date ? (
            <>
              <span>·</span>
              <span className={late ? 'overdue-tag' : undefined}>
                {late ? 'overdue ' : ''}
                {formatDate(item.due_date, { year: undefined })}
              </span>
            </>
          ) : null}
          {item.time ? (
            <>
              <span>·</span>
              <span className="num">{item.time}</span>
            </>
          ) : null}
        </div>
      </div>
      <CrossButton
        status={item.status}
        label={item.title}
        onCross={() => void toggleSkipped(item.subgoal_id, today, item.status)}
      />
    </div>
  )
}
