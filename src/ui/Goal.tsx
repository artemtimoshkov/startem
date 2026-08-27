/** The goal screen — its tasks and freeze history — plus the goal editor (SPEC.md §6, §7). */

import { useState } from 'react'
import {
  actionRate,
  goalRate,
  isFrozenOn,
  taskRepeatLabel,
  weightOf,
} from '../core'
import { deleteGoal, freezeGoal, saveGoal, unfreezeGoal } from '../db/repo'
import { useSnapshot } from './DataContext'
import {
  ImportanceDot,
  InlineConfirm,
  Percent,
  Plus,
  TopBar,
  formatDate,
} from './bits'
import { TaskComposer } from './TaskComposer'
import { navigate } from './router'

export function GoalScreen({ goalId }: { goalId: number }) {
  const { index, today } = useSnapshot()
  const goal = index.goalById.get(goalId)
  const [confirming, setConfirming] = useState(false)
  const [composing, setComposing] = useState(false)

  if (!goal) {
    return (
      <div className="screen">
        <TopBar title="Goal" backTo="/star" />
        <div className="card">
          <p className="empty">That goal no longer exists.</p>
        </div>
      </div>
    )
  }

  const area = index.areaById.get(goal.area_id)
  const frozen = goal.status === 'frozen'
  const rate = goalRate(index, goal)
  const tasks = index.subgoalsByGoal.get(goalId) ?? []
  const periods = (index.freezesByGoal.get(goalId) ?? []).filter((f) => !f.deleted)
  const frozenToday = isFrozenOn(today, periods)

  return (
    <div className="screen">
      <TopBar
        title={goal.title}
        backTo={area ? `/areas/${area.id}` : '/star'}
        right={
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => navigate(`/goals/${goalId}/edit`)}
          >
            Edit
          </button>
        }
      />

      <div className="card card-pad">
        <div className="progress-head">
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {area?.name}
            {frozen ? ' · frozen' : ''}
          </span>
          <span className="big num">
            {rate == null ? '—' : `${Math.round(rate * 100)}%`}
          </span>
        </div>
        <div className="bar">
          <span style={{ width: `${(rate ?? 0) * 100}%` }} />
        </div>
        {goal.description ? (
          <p style={{ marginTop: 12, marginBottom: 0, fontSize: 14, color: 'var(--text-secondary)' }}>
            {goal.description}
          </p>
        ) : null}
        {frozen ? (
          <p style={{ marginTop: 12, marginBottom: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            Frozen — out of scoring entirely, and these days will never count as misses.
          </p>
        ) : null}
      </div>

      <p className="section-label">Tasks</p>
      {composing ? (
        <TaskComposer
          initial={{ area_id: goal.area_id, goal_id: goalId }}
          onSaved={() => setComposing(false)}
          onCancel={() => setComposing(false)}
        />
      ) : (
        <button type="button" className="add-task" onClick={() => setComposing(true)}>
          <span className="add-task-plus">
            <Plus />
          </span>
          Add task
        </button>
      )}

      {tasks.length > 0 ? (
        <div className="card">
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className="row row-button"
              onClick={() => navigate(`/tasks/${task.id}`)}
            >
              <div className="row-body">
                <div className="row-title">{task.title}</div>
                <div className="row-meta">
                  <ImportanceDot importance={task.importance} />
                  <span>{taskRepeatLabel(task, { short: true })}</span>
                  <span>·</span>
                  <span className="num">weight {weightOf(task)}</span>
                  {task.weight != null ? <span>(override)</span> : null}
                </div>
              </div>
              <Percent rate={actionRate(index, task)} />
            </button>
          ))}
        </div>
      ) : null}

      {periods.length > 0 ? (
        <>
          <p className="section-label">Freeze history</p>
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
                        : 'still frozen'}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </>
      ) : null}

      <div className="btn-row" style={{ marginTop: 20 }}>
        <button
          type="button"
          className="btn"
          onClick={() =>
            void (frozenToday || frozen ? unfreezeGoal(goalId, today) : freezeGoal(goalId, today))
          }
        >
          {frozen || frozenToday ? 'Unfreeze goal' : 'Freeze goal'}
        </button>
        {!confirming ? (
          <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>
            Delete goal
          </button>
        ) : null}
      </div>

      {confirming ? (
        <div style={{ marginTop: 12 }}>
          <InlineConfirm
            question={`Delete “${goal.title}”? Its ${tasks.length} task${
              tasks.length === 1 ? '' : 's'
            } stay in ${area?.name ?? 'the area'}, with every check-in intact.`}
            confirmLabel="Delete it"
            onConfirm={() => {
              void deleteGoal(goalId).then(() => navigate(area ? `/areas/${area.id}` : '/star'))
            }}
            onCancel={() => setConfirming(false)}
          />
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The editor (§7)
// ---------------------------------------------------------------------------

/**
 * A goal is a heading: an area, a title, some prose.
 *
 * It carries no priority — that belongs to the task, because two tasks under
 * one goal are rarely equally urgent — and it does not edit its tasks either.
 * Tasks are written in the composer and point at a goal, which is what lets a
 * task exist without one (§3, §7).
 */
export function GoalEditorScreen({
  goalId,
  presetAreaId,
}: {
  goalId: number | null
  presetAreaId?: number
}) {
  const { index, today } = useSnapshot()
  const existing = goalId == null ? undefined : index.goalById.get(goalId)

  const [draft, setDraft] = useState(() => ({
    area_id:
      existing?.area_id ??
      (presetAreaId != null && index.areaById.has(presetAreaId)
        ? presetAreaId
        : (index.areas[0]?.id ?? 1)),
    title: existing?.title ?? '',
    description: existing?.description ?? '',
  }))
  const [saving, setSaving] = useState(false)

  const canSave = draft.title.trim().length > 0 && !saving
  const backTo = existing
    ? `/goals/${existing.id}`
    : presetAreaId != null
      ? `/areas/${presetAreaId}`
      : '/star'

  const submit = () => {
    if (!canSave) return
    setSaving(true)
    void saveGoal(
      {
        ...(goalId == null ? {} : { id: goalId }),
        area_id: draft.area_id,
        title: draft.title,
        description: draft.description,
      },
      today,
    ).then((id) => navigate(`/goals/${id}`, true))
  }

  return (
    <div className="screen">
      <TopBar title={existing ? 'Edit goal' : 'New goal'} backTo={backTo} />

      <div className="card card-pad">
        <div className="field">
          <label htmlFor="goal-title">Title</label>
          <input
            id="goal-title"
            className="input"
            value={draft.title}
            placeholder="Reach 100 kg bench press"
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          />
        </div>

        <div className="field">
          <label htmlFor="goal-area">Area</label>
          <select
            id="goal-area"
            className="select"
            value={draft.area_id}
            onChange={(e) => setDraft((d) => ({ ...d, area_id: Number(e.target.value) }))}
          >
            {index.areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="goal-desc">Description</label>
          <textarea
            id="goal-desc"
            className="textarea"
            value={draft.description}
            placeholder="Definition of done, prompts, anything useful."
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          />
        </div>
      </div>

      <p className="empty" style={{ textAlign: 'left', padding: '14px 2px 0' }}>
        {existing
          ? 'Tasks are added from the goal itself, or from the Tasks screen.'
          : 'Save the goal, then add tasks to it — a task can also sit straight on an area.'}
      </p>

      <div className="btn-row" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-primary" disabled={!canSave} onClick={submit}>
          {existing ? 'Save changes' : 'Create goal'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => navigate(backTo)}>
          Cancel
        </button>
      </div>
    </div>
  )
}
