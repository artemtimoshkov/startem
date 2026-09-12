/** View 1 — the day's habits (SPEC.md §6). */

import { useState } from 'react'
import {
  buildAgenda,
  buildToday,
  buildTodos,
  taskRepeatLabel,
  type AgendaItem,
  type TodayItem,
  type TodoItem,
} from '../core'
import { toggleDone, toggleSkipped } from '../db/repo'
import { useSnapshot } from './DataContext'
import {
  CrossButton,
  TickButton,
  Chevron,
  Fab,
  Flame,
  Percent,
  TopBar,
  dayHeading,
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
 *
 * One flat list, not one card per area: the day is the heading, and an area is
 * a word on the row. The sort already puts the heaviest work at the top, and
 * area headings only chopped a short list into shorter ones (§6).
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
      ) : null}

      {view.items.length > 0 ? (
        <>
          <p className="day-head">{dayHeading(today, today)}</p>
          <div className="card">
            {view.items.map((item) => (
              <HabitRow key={item.subgoal_id} item={item} today={today} />
            ))}
          </div>
        </>
      ) : null}

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

      <NotToday />

      <InstallCard />

      {composing ? null : <Fab label="Add habit" onClick={() => setComposing(true)} />}
    </div>
  )
}

/**
 * Everything that exists but is not owed today, **by the day it next lands**.
 *
 * A habit set to "every Monday" and added on a Wednesday would otherwise
 * vanish the instant it was saved — the day's list is the only list, so it has
 * to admit to what it is not showing. A flat roll-call of those habits said
 * *that* they existed and never *when*, so the agenda answers the question the
 * section is actually opened to ask: only the days something comes due on get
 * a heading, and anything rarer than the window sits under Later (§6).
 */
function NotToday() {
  const { snapshot, today } = useSnapshot()
  const agenda = buildAgenda(snapshot, today)
  const [open, setOpen] = useState(false)
  if (agenda.habitCount === 0) return null

  return (
    <>
      <button type="button" className="section-toggle" onClick={() => setOpen(!open)}>
        <span className="section-label" style={{ margin: 0 }}>
          Not due today · {agenda.habitCount}
        </span>
        <span className={`section-caret${open ? ' is-open' : ''}`}>
          <Chevron />
        </span>
      </button>
      {open ? (
        <>
          {agenda.days.map((day) => (
            <div key={day.date}>
              <p className="day-head">{dayHeading(day.date, today)}</p>
              <div className="card">
                {day.items.map((item) => (
                  <AgendaRow key={item.subgoal_id} item={item} />
                ))}
              </div>
            </div>
          ))}
          {agenda.later.length > 0 ? (
            <>
              <p className="day-head is-quiet">Later</p>
              <div className="card">
                {agenda.later.map((item) => (
                  <AgendaRow key={item.subgoal_id} item={item} />
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </>
  )
}

/** One upcoming occurrence: what it is, where it lives, and how often. */
function AgendaRow({ item }: { item: AgendaItem }) {
  const { index } = useSnapshot()
  const task = index.subgoalById.get(item.subgoal_id)

  return (
    <button
      type="button"
      className="row row-button"
      onClick={() => navigate(`/tasks/${item.subgoal_id}`)}
    >
      <div className="row-body">
        <div className="row-title">{item.title}</div>
        <div className="row-meta">
          {item.areaName ? (
            <>
              <span>{item.areaName}</span>
              <span>·</span>
            </>
          ) : null}
          <span>{task ? taskRepeatLabel(task, { short: true }) : ''}</span>
          {item.time ? (
            <>
              <span>·</span>
              <span className="num">{item.time}</span>
            </>
          ) : null}
          {item.paused ? (
            <>
              <span>·</span>
              <span>paused</span>
            </>
          ) : null}
        </div>
      </div>
    </button>
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
          {/* The area is a word on the row now that the day is the heading.
              An unfiled task simply has none, and says nothing about it. */}
          {item.area_id != null && item.areaName ? (
            <>
              <Link to={`/areas/${item.area_id}`}>{item.areaName}</Link>
              <span>·</span>
            </>
          ) : null}
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

/**
 * A to-do, as it appears on the habit screen: no weight, no streak, no score.
 *
 * `hideDate` is for the to-do screen, where the day is already the heading
 * over the row and printing it again on the row says it twice.
 */
export function TodoLine({
  item,
  today,
  hideDate,
}: {
  item: TodoItem
  today: string
  hideDate?: boolean
}) {
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
          {item.area_id != null && item.areaName ? (
            <Link to={`/areas/${item.area_id}`}>{item.areaName}</Link>
          ) : null}
          {item.due_date && !hideDate ? (
            <>
              {item.area_id != null && item.areaName ? <span>·</span> : null}
              <span className={late ? 'overdue-tag' : undefined}>
                {late ? 'overdue ' : ''}
                {formatDate(item.due_date, { year: undefined })}
              </span>
            </>
          ) : null}
          {item.time ? (
            <>
              {item.areaName || (item.due_date && !hideDate) ? <span>·</span> : null}
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
