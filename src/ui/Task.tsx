/**
 * One task, up close — SPEC.md §6, §7.
 *
 * For a **habit** this is the tracker: fifteen weeks of day cells, the streak,
 * the rate, and the one switch that pauses it. For a **to-do** there is
 * nothing to track — it happens once — so the screen is just the editor.
 *
 * The grid used to hang off a goal, where it averaged unrelated work into a
 * single colour. On the habit it means what it looks like it means: kept,
 * missed, or not owed.
 */

import { useState } from 'react'
import {
  areaOf,
  buildHabitGrid,
  habitRate,
  habitStreak,
  isFrozenOn,
  isHabit,
  isPaused,
  taskRepeatLabel,
  weightOf,
} from '../core'
import { setTaskPaused } from '../db/repo'
import { useSnapshot } from './DataContext'
import { DayGrid } from './charts'
import { Percent, Flame, Pencil, TopBar, formatDate } from './bits'
import { TaskComposer, fromTask } from './TaskComposer'

export function TaskScreen({ taskId }: { taskId: number }) {
  const { snapshot, index, today } = useSnapshot()
  const task = index.subgoalById.get(taskId)
  const [editing, setEditing] = useState(false)

  if (!task) {
    return (
      <div className="screen">
        <TopBar title="Task" backTo="/" />
      </div>
    )
  }

  const area = areaOf(index, task)
  const habit = isHabit(task)
  const paused = isPaused(index, task)
  const periods = (index.freezesBySubgoal.get(task.id) ?? []).filter((f) => !f.deleted)
  const streak = habit ? habitStreak(index, task) : 0

  if (editing) {
    return (
      <div className="screen">
        <TopBar title={habit ? 'Edit habit' : 'Edit to-do'} backTo={`/tasks/${taskId}`} />
        <TaskComposer
          taskId={taskId}
          initial={fromTask(task)}
          submitLabel="Save"
          onSaved={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </div>
    )
  }

  return (
    <div className="screen">
      <TopBar
        title={task.title}
        sub={area?.name}
        backTo="/"
        right={
          <button
            type="button"
            className="icon-btn"
            aria-label="Edit"
            onClick={() => setEditing(true)}
          >
            <Pencil />
          </button>
        }
      />

      {habit ? (
        <>
          <div className="card-pad">
            <div className="stat-row">
              <Stat
                label="Kept"
                value={<Percent rate={paused ? null : habitRate(index, task)} />}
              />
              <Stat
                label="Streak"
                value={
                  streak === 0 ? (
                    // A flame beside a zero congratulates you on nothing.
                    <span className="big num" style={{ color: 'var(--text-tertiary)' }}>
                      —
                    </span>
                  ) : (
                    <span className="streak big">
                      <Flame size={15} />
                      {streak}
                    </span>
                  )
                }
              />
              <Stat label="Weight" value={<span className="big num">{weightOf(task)}</span>} />
            </div>
            <p className="stat-note">
              {taskRepeatLabel(task)}
              {task.time ? ` · ${task.time}` : ''}
              {paused ? ' · paused' : ''}
            </p>
          </div>

          <div className="card-pad">
            <DayGrid view={buildHabitGrid(snapshot, taskId, today)} />
          </div>

          <div className="btn-row" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="btn"
              onClick={() => void setTaskPaused(taskId, !paused, today)}
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>

          {periods.length > 0 ? (
            <>
              <p className="section-label">Pauses</p>
              <div className="card">
                {periods
                  .slice()
                  .sort((a, b) => (a.start_date < b.start_date ? 1 : -1))
                  .map((p) => (
                    <div key={p.id} className="row">
                      <div className="row-body">
                        <div className="row-title" style={{ fontSize: 14 }}>
                          {formatDate(p.start_date)} —{' '}
                          {p.end_date ? formatDate(p.end_date) : 'now'}
                        </div>
                        <div className="row-meta">
                          {p.end_date
                            ? 'ended'
                            : isFrozenOn(today, [p])
                              ? 'still paused'
                              : 'scheduled'}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </>
          ) : null}
        </>
      ) : task.due_date ? (
        <div className="card-pad">
          <div className="stat-row">
            <Stat label="Due" value={<span className="num">{formatDate(task.due_date)}</span>} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      {value}
    </div>
  )
}
