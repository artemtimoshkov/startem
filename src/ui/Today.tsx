/** View 1 — Today's list (SPEC.md §6). */

import { buildToday, type TodayItem } from '../core'
import { toggleDone, toggleSkipped } from '../db/repo'
import { useSnapshot } from './DataContext'
import {
  CheckControls,
  ImportanceDot,
  Percent,
  Stripe,
  TopBar,
  cadenceLabel,
  formatDate,
} from './bits'
import { Link } from './router'

export function TodayScreen() {
  const { snapshot, index, today } = useSnapshot()
  const view = buildToday(snapshot, today)
  const pct = view.target === 0 ? null : view.doneCount / view.target

  return (
    <div className="screen">
      <TopBar title="Today" sub={formatDate(today, { year: undefined })} />

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

      {view.groups.length === 0 ? (
        <div className="card">
          <p className="empty">
            Nothing due today.
            <br />
            <Link to="/goals/new">Add a goal</Link> to get started.
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

      {index.goals.length > 0 ? (
        <p style={{ marginTop: 20, fontSize: 13 }}>
          <Link to="/star">See where you stand →</Link>
        </p>
      ) : null}
    </div>
  )
}

function Row({ item, today }: { item: TodayItem; today: string }) {
  const { index } = useSnapshot()
  const action = index.subgoalById.get(item.subgoal_id)
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
        <div className="row-title">{item.title}</div>
        <div className="row-meta">
          <ImportanceDot importance={item.importance} />
          <Link to={`/goals/${item.goal_id}`}>{item.goalTitle}</Link>
          <span>·</span>
          <span>{action ? cadenceLabel(action) : ''}</span>
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
