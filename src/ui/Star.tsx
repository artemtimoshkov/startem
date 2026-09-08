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
import {
  Cross,
  InlineConfirm,
  ListLink,
  Plus,
  ScoreBadge,
  Toast,
  TopBar,
  useToast,
} from './bits'
import { navigate } from './router'

export function StarScreen() {
  const { snapshot, today } = useSnapshot()
  const star = buildStar(snapshot, today)
  const [editing, setEditing] = useState(false)

  return (
    <div className="screen">
      <TopBar
        title="Where you stand"
        sub="last 28 days"
        right={
          <button type="button" className="btn btn-sm" onClick={() => setEditing(!editing)}>
            {editing ? 'Done' : 'Edit'}
          </button>
        }
      />

      <div className="card card-pad">
        <RadarChart star={star} onSelect={(id) => navigate(`/areas/${id}`)} />
      </div>

      {editing ? <AreaEditor /> : <AreaList star={star} />}
    </div>
  )
}

function AreaList({ star }: { star: ReturnType<typeof buildStar> }) {
  return (
    <>
      <p className="section-label">Areas</p>
      <div className="card">
        {star.vertices.map((v) => (
          <ListLink
            key={v.area_id}
            to={`/areas/${v.area_id}`}
            ariaLabel={`${v.name}, score ${v.label} out of 10, ${v.habitCount} habits`}
          >
            <span style={{ flex: 1 }}>
              {v.name}
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)' }}>
                {v.habitCount === 0
                  ? 'No habits yet'
                  : `${v.habitCount} habit${v.habitCount === 1 ? '' : 's'}`}
                {v.goalCount > 0
                  ? ` · ${v.goalCount} goal${v.goalCount === 1 ? '' : 's'}`
                  : ''}
              </span>
            </span>
            <ScoreBadge score={v.score} />
          </ListLink>
        ))}
      </div>
    </>
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
 * editor lives behind an Edit button rather than being always-on, because
 * every control here changes the shape of the one chart above it, and a stray
 * thumb on a phone should not be able to do that while you are reading.
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
      <p className="section-label">Editing areas · {areas.length}</p>

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
      </div>

      {removing ? (
        <div style={{ marginTop: 12 }}>
          <InlineConfirm
            question={describeRemoval(removing.area, removing.contents)}
            confirmLabel="Remove it"
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

      <form className="card card-pad area-add" onSubmit={submit}>
        <span className="add-task-plus" aria-hidden="true">
          <Plus size={16} />
        </span>
        <input
          className="input input-sm"
          value={name}
          aria-label="New area"
          placeholder={full ? `${MAX_AREAS} areas is the limit` : 'Add an area of life…'}
          disabled={full}
          enterKeyHint="done"
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn btn-sm btn-primary" disabled={full || !name.trim()}>
          Add
        </button>
      </form>

      <p className="empty" style={{ textAlign: 'left', padding: '14px 2px 0' }}>
        {last
          ? 'The last area stays — the star needs something to draw.'
          : 'Removing an area archives its habits rather than deleting them: their check-ins still describe real days.'}
      </p>

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
  if (parts.length === 0) return `Remove “${area.name}”? It is empty.`
  const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)!}`
  return `Remove “${area.name}”? Its ${list} go with it — the habits are archived, so their history survives.`
}
