/** View 2 — the to-do list (SPEC.md §6). */

import { useState } from 'react'
import { buildTodos, noRepeat, type TodoSection } from '../core'
import { useSnapshot } from './DataContext'
import { Fab, TopBar, dayHeading } from './bits'
import { TaskComposer } from './TaskComposer'
import { TodoLine } from './Today'

/**
 * The heading over a run of to-dos.
 *
 * A dated section is headed by its day, which is the only thing the list is
 * ordered by; "Overdue" is a word on the day rather than a pile of its own,
 * because a pile hid *when*. The two runs with no day — undated and finished —
 * keep a name, since there is no date to print.
 */
function sectionTitle(section: TodoSection, today: string): string {
  if (section.kind === 'someday') return 'No date'
  if (section.kind === 'done') return 'Finished'
  const heading = dayHeading(section.date!, today)
  return section.overdue ? `${heading} · Overdue` : heading
}

export function TodosScreen() {
  const { snapshot, today } = useSnapshot()
  const view = buildTodos(snapshot, today)
  const [composing, setComposing] = useState(false)

  return (
    <div className="screen">
      <TopBar title="To-dos" />

      {composing ? (
        <TaskComposer
          /* A to-do is a task with no repeat, so the composer opens on one
             rather than making the switch the first thing to remember (§7). */
          initial={{ repeat: noRepeat() }}
          onSaved={() => setComposing(false)}
          onCancel={() => setComposing(false)}
        />
      ) : null}

      {view.sections.map((section) => (
        <div key={`${section.kind}-${section.date ?? ''}`}>
          <p className={`day-head${section.overdue ? ' is-late' : ''}`}>
            {sectionTitle(section, today)}
          </p>
          <div className="card">
            {section.items.map((item) => (
              <TodoLine key={item.subgoal_id} item={item} today={today} hideDate />
            ))}
          </div>
        </div>
      ))}

      {composing ? null : <Fab label="Add to-do" onClick={() => setComposing(true)} />}
    </div>
  )
}
