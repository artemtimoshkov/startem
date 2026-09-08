/** View 2 — the to-do list (SPEC.md §6). */

import { useState } from 'react'
import { buildTodos, noRepeat, type TodoBucket } from '../core'
import { useSnapshot } from './DataContext'
import { Plus, TopBar } from './bits'
import { TaskComposer } from './TaskComposer'
import { TodoLine } from './Today'

/**
 * The five piles a to-do can be in, and what each is called on screen.
 *
 * They are not folders and nothing is filed into them: the pile is read off
 * the deadline every time the list is built (§6), so a to-do moves from
 * Upcoming to Today to Overdue on its own, overnight, with nothing to tidy.
 */
const BUCKET_TITLE: Record<TodoBucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Upcoming',
  someday: 'No date',
  done: 'Finished',
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
      ) : (
        <button type="button" className="add-task" onClick={() => setComposing(true)}>
          <span className="add-task-plus">
            <Plus size={15} />
          </span>
          Add to-do
        </button>
      )}

      {view.sections.map((section) => (
        <div key={section.bucket}>
          <p className={`section-label${section.bucket === 'overdue' ? ' is-late' : ''}`}>
            {BUCKET_TITLE[section.bucket]} · {section.items.length}
          </p>
          <div className="card">
            {section.items.map((item) => (
              <TodoLine key={item.subgoal_id} item={item} today={today} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
