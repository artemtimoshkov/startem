/** View 3 — the star, and the editor that decides how many spokes it has. */

import { useState } from 'react'
import { MAX_AREAS, MIN_AREAS, buildStar, type Area } from '../core'
import {
  AreaLimitError,
  addArea,
  areaContents,
  deleteArea,
  moveArea,
  renameArea,
  type AreaContents,
} from '../db/repo'
import { useSnapshot } from './DataContext'
import { RadarChart } from './charts'
import { Cross, InlineConfirm, Pencil, Plus, Toast, TopBar, useToast } from './bits'
import { navigate } from './router'

/**
 * The chart, and nothing under it.
 *
 * The areas used to be repeated as a list below the star, which said the same
 * thing twice and buried the picture. Every area is reachable by tapping its
 * own vertex, so the list is gone and the screen is the chart — and the mean
 * of the scored areas sits beside the title, where the area screen keeps its
 * own score.
 */
export function StarScreen() {
  const { snapshot, today } = useSnapshot()
  const star = buildStar(snapshot, today)
  const [editing, setEditing] = useState(false)

  return (
    <div className="screen screen-fill">
      <TopBar
        title="Star"
        sub={<span className="star-mean score">{star.meanLabel}</span>}
        right={
          <button
            type="button"
            className="icon-btn"
            aria-label={editing ? 'Done editing areas' : 'Edit areas'}
            aria-pressed={editing}
            onClick={() => setEditing(!editing)}
          >
            <Pencil />
          </button>
        }
      />

      <RadarChart star={star} onSelect={(id) => navigate(`/areas/${id}`)} />

      {editing ? <AreaEditor /> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Editing the ring (§7)
// ---------------------------------------------------------------------------

/**
 * Add, rename, reorder and remove the areas themselves.
 *
 * Ten was only ever a starting point (§3): the chart's geometry is
 * `360 / count`, so the star simply redraws at whatever number is left. The
 * editor lives behind the pencil rather than being always-on, because every
 * control here changes the shape of the one chart above it, and a stray thumb
 * on a phone should not be able to do that while you are reading.
 *
 * Reordering is two arrows, not a drag. Dragging a list item on a touch screen
 * needs either a library — which every kilobyte of is precached for offline
 * use (§9) — or a hand-rolled gesture that fights the page scroll. Two arrows
 * always work, including for a keyboard and a screen reader.
 */
function AreaEditor() {
  const { index } = useSnapshot()
  const [name, setName] = useState('')
  const [removing, setRemoving] = useState<{ area: Area; contents: AreaContents } | null>(null)
  const toast = useToast()

  const areas = index.areas
  const full = areas.length >= MAX_AREAS
  const last = areas.length <= MIN_AREAS

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const clean = name.trim()
    if (!clean) return
    setName('')
    void addArea(clean).catch((err: unknown) => {
      toast.show(err instanceof AreaLimitError ? err.message : 'That area could not be added.')
    })
  }

  const askRemove = (area: Area) => {
    void areaContents(area.id).then((contents) => setRemoving({ area, contents }))
  }

  return (
    <>
      <p className="section-label">Areas</p>

      <div className="card">
        {areas.map((area, i) => (
          <div key={area.id} className="edit-row">
            <span className="edit-move">
              <button
                type="button"
                className="edit-arrow"
                aria-label={`Move ${area.name} earlier`}
                disabled={i === 0}
                onClick={() => void moveArea(area.id, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="edit-arrow"
                aria-label={`Move ${area.name} later`}
                disabled={i === areas.length - 1}
                onClick={() => void moveArea(area.id, 1)}
              >
                ↓
              </button>
            </span>
            <input
              className="edit-name"
              defaultValue={area.name}
              aria-label={`Name of ${area.name}`}
              /* Renaming commits on blur rather than on every keystroke: each
                 write re-reads the whole store and rebuilds the star (§9), and
                 a name is not worth doing that once per letter. */
              onBlur={(e) => void renameArea(area.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
            />
            <button
              type="button"
              className="edit-remove"
              aria-label={`Remove ${area.name}`}
              disabled={last}
              onClick={() => askRemove(area)}
            >
              <Cross size={13} />
            </button>
          </div>
        ))}

        <form className="area-add" onSubmit={submit}>
          <span className="add-task-plus" aria-hidden="true">
            <Plus size={15} />
          </span>
          <input
            className="area-add-input"
            value={name}
            aria-label="New area"
            placeholder={full ? `${MAX_AREAS} areas is the limit` : 'Add area'}
            disabled={full}
            enterKeyHint="done"
            onChange={(e) => setName(e.target.value)}
          />
          {name.trim() ? (
            <button type="submit" className="btn btn-sm btn-primary">
              Add
            </button>
          ) : null}
        </form>
      </div>

      {removing ? (
        <div style={{ marginTop: 12 }}>
          <InlineConfirm
            question={describeRemoval(removing.area, removing.contents)}
            confirmLabel="Remove"
            onConfirm={() => {
              const id = removing.area.id
              setRemoving(null)
              void deleteArea(id).catch((err: unknown) => {
                toast.show(
                  err instanceof AreaLimitError ? err.message : 'That area could not be removed.',
                )
              })
            }}
            onCancel={() => setRemoving(null)}
          />
        </div>
      ) : null}

      <Toast message={toast.message} onDone={toast.clear} />
    </>
  )
}

/** Says out loud what removal takes with it, so the tap is an informed one. */
function describeRemoval(area: Area, contents: AreaContents): string {
  const parts: string[] = []
  if (contents.habits > 0) {
    parts.push(`${contents.habits} habit${contents.habits === 1 ? '' : 's'}`)
  }
  if (contents.todos > 0) parts.push(`${contents.todos} to-do${contents.todos === 1 ? '' : 's'}`)
  if (contents.goals > 0) parts.push(`${contents.goals} goal${contents.goals === 1 ? '' : 's'}`)
  if (parts.length === 0) return `Remove “${area.name}”?`
  const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)!}`
  return `Remove “${area.name}”? Its ${list} go with it — habits are archived, not deleted.`
}
