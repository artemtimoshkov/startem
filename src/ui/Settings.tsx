/** Areas, and the migration import / export (SPEC.md §7, and the migration note). */

import { useRef, useState } from 'react'
import { exportSnapshot, importSnapshot, renameArea, type ImportResult } from '../db/repo'
import { useSnapshot } from './DataContext'
import { InlineConfirm, Toast, TopBar, useToast } from './bits'

export function SettingsScreen() {
  const { index, snapshot, today } = useSnapshot()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ name: string; raw: unknown } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  const counts = {
    areas: snapshot.areas.filter((r) => !r.deleted).length,
    goals: snapshot.goals.filter((r) => !r.deleted).length,
    subgoals: snapshot.subgoals.filter((r) => !r.deleted).length,
    checkins: snapshot.checkins.filter((r) => !r.deleted).length,
    freezes: snapshot.freezes.filter((r) => !r.deleted).length,
  }

  const pickFile = async (file: File) => {
    setError(null)
    setResult(null)
    try {
      const raw: unknown = JSON.parse(await file.text())
      setPending({ name: file.name, raw })
    } catch {
      setError(`${file.name} is not valid JSON.`)
    }
  }

  const runImport = () => {
    if (!pending) return
    const raw = pending.raw
    setPending(null)
    void importSnapshot(raw, today)
      .then((r) => {
        setResult(r)
        toast.show('Import complete')
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Import failed.'))
  }

  const download = () => {
    void exportSnapshot().then((data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `startem-export-${today}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.show('Export downloaded')
    })
  }

  return (
    <div className="screen">
      <TopBar title="Settings" />

      <p className="section-label">Areas</p>
      <div className="card">
        {index.areas.map((area) => (
          <div key={area.id} className="row">
            <div className="row-body">
              <label className="sr-only" htmlFor={`area-${area.id}`}>
                Rename {area.name}
              </label>
              <input
                id={`area-${area.id}`}
                className="input input-sm"
                defaultValue={area.name}
                onBlur={(e) => {
                  if (e.target.value.trim() !== area.name) {
                    void renameArea(area.id, e.target.value)
                    toast.show('Area renamed')
                  }
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
        Name only — areas are the vertices of the chart, so they are not created or destroyed.
      </p>

      <p className="section-label">Your data, on this device</p>
      <div className="card card-pad">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <tbody>
            {(
              [
                ['Areas', counts.areas],
                ['Goals', counts.goals],
                ['Actions', counts.subgoals],
                ['Check-ins', counts.checkins],
                ['Freeze periods', counts.freezes],
              ] as const
            ).map(([label, n]) => (
              <tr key={label}>
                <td style={{ padding: '3px 0', color: 'var(--text-secondary)' }}>{label}</td>
                <td style={{ padding: '3px 0', textAlign: 'right' }} className="num">
                  {n}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '12px 0 0' }}>
          Everything lives in this browser's IndexedDB. Cloud sync arrives later — until then, the
          export below is your only backup.
        </p>
      </div>

      <p className="section-label">Import / export</p>
      <div className="card card-pad">
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            Import JSON…
          </button>
          <button type="button" className="btn" onClick={download}>
            Export JSON
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="Choose a JSON export to import"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void pickFile(file)
            e.target.value = ''
          }}
        />
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '12px 0 0' }}>
          The five tables dumped whole, with row ids preserved — they reference each other by id.
          An export taken before a schema change still loads: unknown fields are ignored and
          out-of-range values are repaired on the way in.
        </p>

        {error ? (
          <p style={{ color: 'var(--imp-high)', fontSize: 13, marginBottom: 0 }}>{error}</p>
        ) : null}

        {pending ? (
          <div style={{ marginTop: 12 }}>
            <InlineConfirm
              question={`Import ${pending.name}? This replaces everything currently on this device.`}
              confirmLabel="Replace my data"
              onConfirm={runImport}
              onCancel={() => setPending(null)}
            />
          </div>
        ) : null}

        {result ? (
          <p style={{ fontSize: 13, marginTop: 12, marginBottom: 0 }}>
            Imported {result.areas} areas, {result.goals} goals, {result.subgoals} actions,{' '}
            {result.checkins} check-ins and {result.freezes} freeze periods.
          </p>
        ) : null}
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 24 }}>
        Startem — local only for now. Scoring window 28 days; weeks start Monday.
      </p>

      <Toast message={toast.message} onDone={toast.clear} />
    </div>
  )
}
