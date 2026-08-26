/** View 4 — the per-goal tracker grid — plus the goal editor (SPEC.md §6, §7). */

import { useMemo, useState } from 'react'
import {
  actionRate,
  buildGoalGrid,
  goalRate,
  isFrozenOn,
  weightOf,
  type Importance,
  type Subgoal,
} from '../core'
import { deleteGoal, freezeGoal, saveGoal, unfreezeGoal, type ActionDraft } from '../db/repo'
import { useSnapshot } from './DataContext'
import { GoalGrid } from './charts'
import {
  ImportancePill,
  InlineConfirm,
  Percent,
  TopBar,
  WEEKDAY_INITIALS,
  WEEKDAY_LABELS,
  cadenceLabel,
  formatDate,
} from './bits'
import { navigate } from './router'

export function GoalScreen({ goalId }: { goalId: number }) {
  const { snapshot, index, today } = useSnapshot()
  const goal = index.goalById.get(goalId)
  const [confirming, setConfirming] = useState(false)

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
  const grid = buildGoalGrid(snapshot, goalId, today)
  const rate = goalRate(index, goal)
  const actions = index.subgoalsByGoal.get(goalId) ?? []
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
          <span>
            <ImportancePill importance={goal.importance} frozen={frozen} />{' '}
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {area?.name}
            </span>
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

      <div className="card card-pad">
        <p className="card-title">Last 15 weeks</p>
        <GoalGrid grid={grid} />
      </div>

      <p className="section-label">Actions</p>
      <div className="card">
        {actions.length === 0 ? (
          <p className="empty">No actions yet — edit the goal to add one.</p>
        ) : (
          actions.map((action) => (
            <div key={action.id} className="row">
              <div className="row-body">
                <div className="row-title">{action.title}</div>
                <div className="row-meta">
                  <span>{cadenceLabel(action)}</span>
                  <span>·</span>
                  <span className="num">weight {weightOf(goal, action)}</span>
                  {action.weight != null ? <span>(override)</span> : null}
                </div>
              </div>
              <Percent rate={actionRate(index, action)} />
            </div>
          ))
        )}
      </div>

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
            question={`Delete “${goal.title}”? Its actions, check-ins and freeze periods go with it.`}
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

interface Draft {
  area_id: number
  title: string
  description: string
  importance: Importance
  actions: ActionDraft[]
}

function blankAction(): ActionDraft {
  return {
    title: '',
    cadence_type: 'weekly',
    days: [0],
    monthly_day: null,
    month_weekday: null,
    month_ordinal: null,
    due_date: null,
    weight: null,
  }
}

function toDraft(action: Subgoal): ActionDraft {
  return {
    id: action.id,
    title: action.title,
    cadence_type: action.cadence_type,
    days: action.days,
    monthly_day: action.monthly_day,
    month_weekday: action.month_weekday,
    month_ordinal: action.month_ordinal,
    due_date: action.due_date,
    weight: action.weight,
  }
}

export function GoalEditorScreen({ goalId }: { goalId: number | null }) {
  const { index, today } = useSnapshot()
  const existing = goalId == null ? undefined : index.goalById.get(goalId)
  const presetArea = Number(new URLSearchParams(window.location.search).get('area'))

  const [draft, setDraft] = useState<Draft>(() => {
    if (existing) {
      return {
        area_id: existing.area_id,
        title: existing.title,
        description: existing.description,
        importance: existing.importance,
        actions: (index.subgoalsByGoal.get(existing.id) ?? []).map(toDraft),
      }
    }
    return {
      area_id: Number.isFinite(presetArea) && presetArea > 0 ? presetArea : (index.areas[0]?.id ?? 1),
      title: '',
      description: '',
      importance: 'medium',
      actions: [blankAction()],
    }
  })
  const [saving, setSaving] = useState(false)
  const [removedCount, setRemovedCount] = useState(0)

  const canSave = draft.title.trim().length > 0 && !saving

  const patchAction = (i: number, patch: Partial<ActionDraft>) =>
    setDraft((d) => ({
      ...d,
      actions: d.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)),
    }))

  const removeAction = (i: number) =>
    setDraft((d) => {
      const action = d.actions[i]
      if (action?.id != null) setRemovedCount((n) => n + 1)
      return { ...d, actions: d.actions.filter((_, j) => j !== i) }
    })

  const submit = () => {
    if (!canSave) return
    setSaving(true)
    void saveGoal(
      {
        id: goalId ?? undefined,
        area_id: draft.area_id,
        title: draft.title.trim(),
        description: draft.description.trim(),
        importance: draft.importance,
        actions: draft.actions.filter((a) => a.title.trim().length > 0),
      },
      today,
    ).then((id) => navigate(`/goals/${id}`, true))
  }

  return (
    <div className="screen">
      <TopBar
        title={existing ? 'Edit goal' : 'New goal'}
        backTo={existing ? `/goals/${existing.id}` : '/star'}
      />

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

        <div className="field">
          <span className="field-label" id="imp-label">
            Importance
          </span>
          <div className="segmented" role="group" aria-labelledby="imp-label">
            {(['high', 'medium', 'low'] as Importance[]).map((imp) => (
              <button
                key={imp}
                type="button"
                aria-pressed={draft.importance === imp}
                className={`imp-${imp}`}
                style={draft.importance === imp ? { color: `var(--imp-${imp})` } : undefined}
                onClick={() => setDraft((d) => ({ ...d, importance: imp }))}
              >
                {imp === 'high' ? 'High · 4' : imp === 'medium' ? 'Medium · 2' : 'Low · 1'}
              </button>
            ))}
          </div>
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

      <p className="section-label">Actions</p>
      <div className="card card-pad">
        {draft.actions.map((action, i) => (
          <ActionEditor
            key={action.id ?? `new-${i}`}
            action={action}
            index={i}
            onPatch={(patch) => patchAction(i, patch)}
            onRemove={() => removeAction(i)}
          />
        ))}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setDraft((d) => ({ ...d, actions: [...d.actions, blankAction()] }))}
        >
          + Add action
        </button>
        {removedCount > 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 0 }}>
            {removedCount} removed action{removedCount === 1 ? '' : 's'} will be archived, not
            deleted — their past check-ins still describe real days.
          </p>
        ) : null}
      </div>

      <div className="btn-row" style={{ marginTop: 20 }}>
        <button type="button" className="btn btn-primary" disabled={!canSave} onClick={submit}>
          {existing ? 'Save changes' : 'Create goal'}
        </button>
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => navigate(existing ? `/goals/${existing.id}` : '/star')}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function ActionEditor({
  action,
  index: i,
  onPatch,
  onRemove,
}: {
  action: ActionDraft
  index: number
  onPatch: (patch: Partial<ActionDraft>) => void
  onRemove: () => void
}) {
  const isMonthly = action.cadence_type === 'monthly' || action.cadence_type === 'quarterly'
  const weekdayMode = action.month_weekday != null
  const ids = useMemo(
    () => ({
      title: `act-${i}-title`,
      cadence: `act-${i}-cadence`,
      day: `act-${i}-day`,
      ord: `act-${i}-ord`,
      wd: `act-${i}-wd`,
      due: `act-${i}-due`,
      weight: `act-${i}-weight`,
    }),
    [i],
  )

  return (
    <div className="action-card">
      <div className="action-card-head">
        <input
          id={ids.title}
          className="input input-sm"
          value={action.title}
          placeholder="Gym session"
          aria-label={`Action ${i + 1} title`}
          onChange={(e) => onPatch({ title: e.target.value })}
        />
        <button
          type="button"
          className="btn btn-sm btn-quiet"
          aria-label={`Remove action ${i + 1}`}
          onClick={onRemove}
        >
          Remove
        </button>
      </div>

      <div className="field">
        <label htmlFor={ids.cadence}>Cadence</label>
        <select
          id={ids.cadence}
          className="select input-sm"
          value={action.cadence_type}
          onChange={(e) => {
            const next = e.target.value as ActionDraft['cadence_type']
            onPatch({
              cadence_type: next,
              days: next === 'weekly' ? (action.days.length ? action.days : [0]) : [],
              monthly_day:
                next === 'monthly' || next === 'quarterly' ? (action.monthly_day ?? 1) : null,
              month_weekday: null,
              month_ordinal: null,
              due_date: next === 'once' ? action.due_date : null,
            })
          }}
        >
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
          <option value="once">One time</option>
        </select>
      </div>

      {action.cadence_type === 'weekly' ? (
        <div className="field">
          <span className="field-label" id={`${ids.day}-label`}>
            Days
          </span>
          <div className="dayjar" role="group" aria-labelledby={`${ids.day}-label`}>
            {WEEKDAY_INITIALS.map((initial, d) => {
              const on = action.days.includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  aria-label={WEEKDAY_LABELS[d]}
                  onClick={() =>
                    onPatch({
                      days: on
                        ? action.days.filter((x) => x !== d)
                        : [...action.days, d].sort((a, b) => a - b),
                    })
                  }
                >
                  {initial}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {isMonthly ? (
        <>
          <div className="field">
            <span className="field-label" id={`${ids.ord}-mode`}>
              Pattern
            </span>
            <div className="segmented" role="group" aria-labelledby={`${ids.ord}-mode`}>
              <button
                type="button"
                aria-pressed={!weekdayMode}
                onClick={() => onPatch({ month_weekday: null, month_ordinal: null, monthly_day: action.monthly_day ?? 1 })}
              >
                Day of month
              </button>
              <button
                type="button"
                aria-pressed={weekdayMode}
                onClick={() => onPatch({ month_weekday: 4, month_ordinal: -1, monthly_day: null })}
              >
                Weekday
              </button>
            </div>
          </div>

          {!weekdayMode ? (
            <div className="field">
              <label htmlFor={ids.day}>Day (1–28)</label>
              <input
                id={ids.day}
                className="input input-sm"
                type="number"
                min={1}
                max={28}
                inputMode="numeric"
                value={action.monthly_day ?? 1}
                /* Scrolling over a focused number field silently changes its
                   value and `max` does not prevent it (§12) — so the field
                   surrenders focus, and rows.ts clamps on write regardless. */
                onWheel={(e) => e.currentTarget.blur()}
                onChange={(e) => onPatch({ monthly_day: Number(e.target.value) })}
              />
              <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                Held to 1–28: days 29–31 don't exist in every month, so an action on “31” would
                quietly vanish for five months a year. For real month-end, use{' '}
                <strong>last</strong> weekday.
              </p>
            </div>
          ) : (
            <div className="inline-fields field">
              <div>
                <label className="field-label" htmlFor={ids.ord}>
                  Which
                </label>
                <select
                  id={ids.ord}
                  className="select input-sm"
                  value={action.month_ordinal ?? -1}
                  onChange={(e) => onPatch({ month_ordinal: Number(e.target.value) })}
                >
                  <option value={1}>1st</option>
                  <option value={2}>2nd</option>
                  <option value={3}>3rd</option>
                  <option value={4}>4th</option>
                  <option value={-1}>Last</option>
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor={ids.wd}>
                  Weekday
                </label>
                <select
                  id={ids.wd}
                  className="select input-sm"
                  value={action.month_weekday ?? 0}
                  onChange={(e) => onPatch({ month_weekday: Number(e.target.value) })}
                >
                  {WEEKDAY_LABELS.map((label, d) => (
                    <option key={d} value={d}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {action.cadence_type === 'quarterly' ? (
            <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', margin: '-6px 0 12px' }}>
              Quarterly fires in January, April, July and October only.
            </p>
          ) : null}
        </>
      ) : null}

      {action.cadence_type === 'once' ? (
        <div className="field">
          <label htmlFor={ids.due}>Deadline (optional)</label>
          <input
            id={ids.due}
            className="input input-sm"
            type="date"
            value={action.due_date ?? ''}
            onChange={(e) => onPatch({ due_date: e.target.value || null })}
          />
          <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
            With no deadline it sits in the list until done and never counts against you. With one,
            it becomes a miss once that day passes.
          </p>
        </div>
      ) : null}

      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor={ids.weight}>Weight override (optional)</label>
        <input
          id={ids.weight}
          className="input input-sm"
          type="number"
          min={1}
          inputMode="numeric"
          placeholder="inherit from importance"
          value={action.weight ?? ''}
          onWheel={(e) => e.currentTarget.blur()}
          onChange={(e) =>
            onPatch({ weight: e.target.value === '' ? null : Number(e.target.value) })
          }
        />
      </div>
    </div>
  )
}
