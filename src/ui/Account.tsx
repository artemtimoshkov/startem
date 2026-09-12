/**
 * The account screen — SPEC.md §10.
 *
 * Signing in is what turns the device store into something that survives the
 * device. It is never a gate: everything works signed out, and this screen is
 * the only place the difference is stated.
 *
 * Magic link, no password. One user, two devices, and a password to manage
 * would be one more thing to lose than the data it protects.
 */

import { useState } from 'react'
import { TopBar } from './bits'
import { useSync, syncLabel } from './SyncContext'
import { isCloudConfigured, sendMagicLink, signOutAndStop, syncNow } from '../sync'

export function AccountScreen() {
  const state = useSync()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  if (!isCloudConfigured()) {
    return (
      <div className="screen">
        <TopBar title="This device only" backTo="/" />
        <p className="prose">
          This build has no cloud configured, so everything lives on this device and nothing
          leaves it. That is a working app — but it is one dropped phone away from being gone.
        </p>
        <p className="prose dim">
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> and it will
          offer to sign in.
        </p>
      </div>
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || busy) return
    setBusy(true)
    setProblem(null)
    try {
      await sendMagicLink(email)
      setSent(true)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not send the link.')
    } finally {
      setBusy(false)
    }
  }

  if (state.status === 'signed-out') {
    return (
      <div className="screen">
        <TopBar title="Back up and sync" backTo="/" />
        {sent ? (
          <>
            <p className="prose">
              Link sent to <strong>{email}</strong>. Open it on this device — on a phone, from
              the installed app rather than a browser tab, or the session lands in the wrong
              place.
            </p>
            <button type="button" className="btn-quiet" onClick={() => setSent(false)}>
              Use a different address
            </button>
          </>
        ) : (
          <>
            <p className="prose">
              Sign in and this device keeps its own copy while a second one stays in step. Your
              habits stay on the phone either way — signing in is what makes them survive it.
            </p>
            <form onSubmit={submit} className="stack">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="Email address"
                required
              />
              <button type="submit" disabled={busy || !email.trim()}>
                {busy ? 'Sending…' : 'Email me a link'}
              </button>
            </form>
            {problem ? <p className="prose warn">{problem}</p> : null}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="screen">
      <TopBar title="Account" backTo="/" />
      <dl className="rows">
        <div>
          <dt>Signed in</dt>
          <dd>{state.email ?? '—'}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{syncLabel(state)}</dd>
        </div>
        <div>
          <dt>Last synced</dt>
          <dd>
            {state.lastSyncedAt ? new Date(state.lastSyncedAt).toLocaleString() : 'Not yet'}
          </dd>
        </div>
      </dl>

      {state.error ? (
        <p className="prose warn">
          {state.error}
          {/* A free-tier project pauses after about a week idle (§12), and that
              is by far the likeliest cause of a failure that persists. */}
          <br />
          <span className="dim">
            Nothing is lost — {state.pending} change{state.pending === 1 ? '' : 's'} are still
            queued on this device and will go up once this clears.
          </span>
        </p>
      ) : null}

      <div className="stack">
        <button type="button" onClick={() => void syncNow()} disabled={state.status === 'syncing'}>
          {state.status === 'syncing' ? 'Syncing…' : 'Sync now'}
        </button>
        <button type="button" className="btn-quiet" onClick={() => void signOutAndStop()}>
          Sign out
        </button>
      </div>
      <p className="prose dim">
        Signing out leaves everything on this device untouched. It is all in the cloud too.
      </p>
    </div>
  )
}
