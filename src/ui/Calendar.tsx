/** View 5 — the day-by-day calendar, and a day opened as a checklist (§6, §7). */

import { buildCalendar, buildDayDetail, canEditDay } from '../core'
import { toggleDone, toggleSkipped } from '../db/repo'
import { useSnapshot } from './DataContext'
import { CalendarGrid } from './charts'
import {
  CheckControls,
  ImportanceDot,
  Percent,
  Stripe,
  TopBar,
  formatDate,
} from './bits'
import { Link, navigate } from './router'

export function CalendarScreen() {
  const { snapshot, today } = useSnapshot()
  const calendar = buildCalendar(snapshot, today)

  const logged = calendar.weeks
    .flatMap((w) => w.days)
    .filter((d) => !d.isFuture && d.count > 0)
  const totalWeight = logged.reduce((n, d) => n + d.total, 0)
  const doneWeight = logged.reduce((n, d) => n + d.done, 0)

  return (
    <div className="screen">
      <TopBar title="Calendar" sub="last 26 weeks" />

      <div className="card card-pad">
        <div className="progress-head">
          <span className="big num">
            {totalWeight === 0 ? '—' : `${Math.round((doneWeight / totalWeight) * 100)}%`}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {doneWeight} of {totalWeight} weight logged
          </span>
        </div>
        <CalendarGrid calendar={calendar} onPick={(date) => navigate(`/calendar/${date}`)} />
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '10px 0 0' }}>
          Any day here can be corrected — tap one to open it.
        </p>
      </div>
    </div>
  )
}

export function DayScreen({ date }: { date: string }) {
  const { snapshot, index, today } = useSnapshot()
  const view = buildDayDetail(snapshot, date, today)
  const editable = canEditDay(date, today)
  const isToday = date === today

  return (
    <div className="screen">
      <TopBar
        title={isToday ? 'Today' : formatDate(date, { year: 'numeric' })}
        sub={isToday ? formatDate(date, { year: undefined }) : undefined}
        backTo="/calendar"
      />

      <div className="card card-pad">
        <div className="progress-head">
          <span className="big num">
            {view.ratio == null ? '—' : `${Math.round(view.ratio * 100)}%`}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {view.doneCount} of {view.count} · {view.done} of {view.total} weight
            {view.skipped > 0 ? ` · ${view.skipped} crossed out` : ''}
          </span>
        </div>
        <div className="bar">
          <span style={{ width: `${(view.ratio ?? 0) * 100}%` }} />
        </div>
        {!editable ? (
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '10px 0 0' }}>
            {date > today
              ? 'A future day cannot be logged.'
              : 'Older than 26 weeks — outside the editable window.'}
          </p>
        ) : null}
      </div>

      {view.items.length === 0 ? (
        <div className="card">
          <p className="empty">Nothing was due on this day.</p>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 12 }}>
          {view.items.map((item) => {
            const cls =
              item.status === 'done' ? ' is-done' : item.status === 'skipped' ? ' is-skipped' : ''
            const task = index.subgoalById.get(item.subgoal_id)
            return (
              <div key={item.subgoal_id} className={`row${cls}`}>
                <Stripe importance={item.importance} />
                <CheckControls
                  status={item.status}
                  label={`${item.title} on ${formatDate(date)}`}
                  disabled={!editable}
                  onTick={() => void toggleDone(item.subgoal_id, date, item.status)}
                  onCross={() => void toggleSkipped(item.subgoal_id, date, item.status)}
                />
                <div className="row-body">
                  <div className="row-title">{item.title}</div>
                  <div className="row-meta">
                    <ImportanceDot importance={item.importance} />
                    {item.goal_id != null ? (
                      <>
                        <Link to={`/goals/${item.goal_id}`}>{item.goalTitle}</Link>
                        <span>·</span>
                      </>
                    ) : null}
                    <Link to={`/areas/${item.area_id}`}>{item.areaName}</Link>
                    <span>·</span>
                    <span className="num">weight {item.weight}</span>
                    {!item.wasDue ? (
                      <>
                        <span>·</span>
                        <span style={{ color: 'var(--text-tertiary)' }}>
                          {item.once ? 'pending one-off' : 'logged, not scheduled'}
                        </span>
                      </>
                    ) : null}
                    {task?.cadence_type === 'once' && item.wasDue && item.status == null ? (
                      <>
                        <span>·</span>
                        <span className="overdue-tag">deadline passed</span>
                      </>
                    ) : null}
                  </div>
                </div>
                <Percent rate={item.status === 'done' ? 1 : item.status === 'skipped' ? 0 : null} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
