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
import { Percent, Flame, TopBar, TopBarBack, formatDate } from './bits'
import { TaskComposer, fromTask } from './TaskComposer'
import { back } from './router'

export function TaskScreen({ taskId }: { taskId: number }) {
  const { snapshot, index, today } = useSnapshot()
  const task = index.subgoalById.get(taskId)
  const [editing, setEditing] = useState(false)

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

  const area = index.areaById.get(task.area_id)
  const habit = isHabit(task)
  const paused = isPaused(index, task)
  const periods = (index.freezesBySubgoal.get(task.id) ?? []).filter((f) => !f.deleted)
  const streak = habit ? habitStreak(index, task) : 0

  if (editing) {
    return (
      <div className="screen">
        <TopBarBack to={`/tasks/${taskId}`} />
        <TopBar title={habit ? 'Edit habit' : 'Edit to-do'} />
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
          <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
            Edit
          </button>
        }
      />

      {habit ? (
        <>
          <div className="card card-pad">
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

          <p className="section-label">Last 15 weeks</p>
          <div className="card card-pad">
            <DayGrid view={buildHabitGrid(snapshot, taskId, today)} />
          </div>

          <div className="btn-row" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="btn"
              onClick={() => void setTaskPaused(taskId, !paused, today)}
            >
              {paused ? 'Resume habit' : 'Pause habit'}
            </button>
          </div>
          <p className="empty" style={{ textAlign: 'left', padding: '10px 2px 0' }}>
            {paused
              ? 'Paused days are outside scoring — neither kept nor missed. Resuming makes today live again.'
              : 'Pausing stops the misses accruing while you are away, without rewriting what came before.'}
          </p>

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
                            ? `${p.end_date} is live again — the end date is exclusive`
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
      ) : (
        <div className="card card-pad">
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>
            A to-do happens once, so there is no cadence to track and nothing here counts towards{' '}
            {area?.name ?? 'the area'}&rsquo;s score.
            {task.due_date ? ` Due ${formatDate(task.due_date)}.` : ' No deadline set.'}
          </p>
        </div>
      )}

      <p style={{ marginTop: 20, fontSize: 13 }}>
        <button type="button" className="linkish" onClick={() => back('/')}>
          ← Back
        </button>
      </p>
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
