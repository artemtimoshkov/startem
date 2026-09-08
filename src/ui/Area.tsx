/**
 * One area of life — SPEC.md §6, §7.
 *
 * The order on this screen is the argument the whole redesign rests on. The
 * **aims** come first, because that is what the area is *for*; the **habits**
 * follow, because they are how the aims get reached and they are the only
 * thing scored (§5); the to-dos come last, because they are just parked here.
 *
 * The daily screen never shows any of the goals. This is the screen you come
 * to occasionally to remember what all the ticking is in aid of.
 */

import { useState } from 'react'
import {
  buildStar,
  buildWeeklyStrip,
  habitRate,
  habitStreak,
  isPaused,
  taskRepeatLabel,
  type Goal,
} from '../core'
import { createGoal, deleteGoal, saveGoal, setGoalStatus } from '../db/repo'
import { useSnapshot } from './DataContext'
import { WeekStrip } from './charts'
import {
  Flame,
  ImportanceDot,
  InlineConfirm,
  Percent,
  Plus,
  ScoreBadge,
  Stripe,
  TopBar,
  Target,
  Tick,
  formatDate,
} from './bits'
import { TaskComposer } from './TaskComposer'
import { TodoLine } from './Today'
import { navigate } from './router'

export function AreaScreen({ areaId }: { areaId: number }) {
  const { snapshot, index, today } = useSnapshot()
  const area = index.areaById.get(areaId)
  const [composing, setComposing] = useState(false)

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

  const star = buildStar(snapshot, today)
  const vertex = star.vertices.find((v) => v.area_id === areaId)
  const strip = buildWeeklyStrip(snapshot, today, 8, areaId)
  const habits = index.habitsByArea.get(areaId) ?? []
  const todos = (index.todosByArea.get(areaId) ?? []).filter((t) => {
    const checkins = index.checkinsBySubgoal.get(t.id)
    return !checkins || checkins.size === 0
  })

  return (
    <div className="screen">
      <TopBar title={area.name} backTo="/star" />

      <div className="card card-pad">
        <div className="progress-head">
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Last 28 days · {habits.length} habit{habits.length === 1 ? '' : 's'}
          </span>
          <ScoreBadge score={vertex?.score ?? null} />
        </div>
        <WeekStrip bars={strip} />
      </div>

      <Goals areaId={areaId} />

      <p className="section-label section-label-row">
        Habits
        {habits.length > 0 ? <span className="section-more">{habits.length}</span> : null}
      </p>

      {composing ? (
        <TaskComposer
          initial={{ area_id: areaId }}
          onSaved={() => setComposing(false)}
          onCancel={() => setComposing(false)}
        />
      ) : (
        <button type="button" className="add-task" onClick={() => setComposing(true)}>
          <span className="add-task-plus">
            <Plus />
          </span>
          Add habit to {area.name}
        </button>
      )}

      {habits.length > 0 ? (
        <div className="card">
          {habits.map((task) => {
            const paused = isPaused(index, task)
            const streak = habitStreak(index, task)
            return (
              <button
                key={task.id}
                type="button"
                className="row row-button"
                onClick={() => navigate(`/tasks/${task.id}`)}
              >
                <Stripe importance={task.importance} frozen={paused} />
                <div className="row-body">
                  <div className="row-title">{task.title}</div>
                  <div className="row-meta">
                    <ImportanceDot importance={task.importance} frozen={paused} />
                    <span>{taskRepeatLabel(task, { short: true })}</span>
                    {paused ? (
                      <>
                        <span>·</span>
                        <span>paused</span>
                      </>
                    ) : null}
                    {streak > 1 ? (
                      <>
                        <span>·</span>
                        <span className="streak">
                          <Flame />
                          {streak}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
                <Percent rate={paused ? null : habitRate(index, task)} />
              </button>
            )
          })}
        </div>
      ) : null}

      {todos.length > 0 ? (
        <>
          <p className="section-label">To-dos here · not scored</p>
          <div className="card">
            {todos.map((task) => (
              <TodoLine
                key={task.id}
                today={today}
                item={{
                  subgoal_id: task.id,
                  area_id: areaId,
                  title: task.title,
                  areaName: area.name,
                  importance: task.importance,
                  due_date: task.due_date,
                  time: task.time,
                  status: null,
                  resolved_on: null,
                  bucket: 'someday',
                }}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Goals — the aims, and nothing under them (§3, §7)
// ---------------------------------------------------------------------------

/**
 * "What are you aiming for?" — the first thing on the area screen.
 *
 * A goal is written, read and retired inline. There is no goal *screen* any
 * more, because there is nothing to put on one: a goal owns no tasks, carries
 * no cadence and has no percentage of its own (§5). A title, some prose and a
 * tick when you get there is the whole of it, and all three fit in a row.
 */
function Goals({ areaId }: { areaId: number }) {
  const { index, today } = useSnapshot()
  const goals = index.goalsByArea.get(areaId) ?? []
  const active = goals.filter((g) => g.status === 'active')
  const achieved = goals
    .filter((g) => g.status === 'achieved')
    .sort((a, b) => (b.achieved_on ?? '').localeCompare(a.achieved_on ?? ''))

  const [adding, setAdding] = useState('')
  const [open, setOpen] = useState<number | null>(null)

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    const title = adding.trim()
    if (!title) return
    setAdding('')
    void createGoal(areaId, title, today)
  }

  return (
    <>
      <p className="section-label">What are you aiming for?</p>

      <div className="card">
        {active.length === 0 && achieved.length === 0 ? (
          <p className="empty" style={{ padding: '16px 16px 10px' }}>
            No aims written down yet. &ldquo;Bench 100 kg&rdquo;, &ldquo;sleep before
            midnight&rdquo;, &ldquo;wake at the same time every day&rdquo; — the habits below are
            how you get there.
          </p>
        ) : null}

        {active.map((goal) => (
          <GoalRow
            key={goal.id}
            goal={goal}
            open={open === goal.id}
            onToggle={() => setOpen(open === goal.id ? null : goal.id)}
          />
        ))}

        <form className="goal-add" onSubmit={add}>
          <span className="goal-add-icon" aria-hidden="true">
            <Target />
          </span>
          <input
            className="goal-add-input"
            value={adding}
            aria-label="New goal"
            placeholder="Add a goal…"
            enterKeyHint="done"
            onChange={(e) => setAdding(e.target.value)}
          />
          {adding.trim() ? (
            <button type="submit" className="btn btn-sm btn-primary">
              Add
            </button>
          ) : null}
        </form>
      </div>

      {achieved.length > 0 ? (
        <>
          <p className="section-label">Reached · {achieved.length}</p>
          <div className="card">
            {achieved.map((goal) => (
              <GoalRow
                key={goal.id}
                goal={goal}
                open={open === goal.id}
                onToggle={() => setOpen(open === goal.id ? null : goal.id)}
              />
            ))}
          </div>
        </>
      ) : null}
    </>
  )
}

function GoalRow({
  goal,
  open,
  onToggle,
}: {
  goal: Goal
  open: boolean
  onToggle: () => void
}) {
  const { today } = useSnapshot()
  const done = goal.status === 'achieved'
  const [draft, setDraft] = useState({ title: goal.title, description: goal.description })
  const [confirming, setConfirming] = useState(false)

  const save = () => {
    if (draft.title.trim() === goal.title && draft.description.trim() === goal.description) return
    void saveGoal(
      {
        id: goal.id,
        area_id: goal.area_id,
        title: draft.title.trim() || goal.title,
        description: draft.description,
      },
      today,
    )
  }

  return (
    <div className={`goal-row${done ? ' is-done' : ''}`}>
      <div className="goal-head">
        <button
          type="button"
          className={`check goal-check${done ? ' on' : ''}`}
          aria-pressed={done}
          aria-label={done ? `Reopen ${goal.title}` : `Mark ${goal.title} reached`}
          onClick={() => void setGoalStatus(goal.id, done ? 'active' : 'achieved', today)}
        >
          {done ? <Tick /> : null}
        </button>
        <button type="button" className="goal-title" onClick={onToggle} aria-expanded={open}>
          {goal.title}
          {done && goal.achieved_on ? (
            <span className="goal-when">reached {formatDate(goal.achieved_on)}</span>
          ) : goal.description && !open ? (
            <span className="goal-when">{goal.description}</span>
          ) : null}
        </button>
      </div>

      {open ? (
        <div className="goal-body">
          <input
            className="input input-sm"
            value={draft.title}
            aria-label="Goal"
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            onBlur={save}
          />
          <textarea
            className="textarea"
            value={draft.description}
            aria-label="What reaching it looks like"
            placeholder="What reaching it looks like."
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            onBlur={save}
          />
          {confirming ? (
            <InlineConfirm
              question={`Remove “${goal.title}”? The habits in this area are untouched — a goal holds none of them.`}
              confirmLabel="Remove it"
              onConfirm={() => void deleteGoal(goal.id)}
              onCancel={() => setConfirming(false)}
            />
          ) : (
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => setConfirming(true)}
              >
                Remove goal
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
