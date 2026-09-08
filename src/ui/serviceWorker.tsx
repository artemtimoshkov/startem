/**
 * Service-worker registration and the update notice — SPEC.md §9.
 *
 * `registerType: 'autoUpdate'` means a new deploy replaces the cached bundle by
 * itself. What it must *not* do is reload the page out from under whatever is
 * on screen, so registration passes `onNeedReload`: supplying that callback is
 * what suppresses vite-plugin-pwa's automatic `location.reload()`. The new
 * worker is already in control and the new bundle is already cached — it takes
 * effect on the next launch, which is exactly what the spec describes, and all
 * that is left is to say so quietly.
 */

import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

type Notice = 'updated' | 'offline-ready' | null

export function ServiceWorkerNotice() {
  const [notice, setNotice] = useState<Notice>(null)

  useEffect(() => {
    registerSW({
      immediate: true,
      onNeedReload() {
        setNotice('updated')
      },
      onOfflineReady() {
        setNotice('offline-ready')
      },
      onRegisterError(error: unknown) {
        // Nothing to do about it, and nothing to bother the user with — the app
        // works without a worker, it just will not open offline.
        console.error('Service worker registration failed', error)
      },
    })
  }, [])

  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(id)
  }, [notice])

  if (!notice) return null

  return (
    <div className="toast" role="status" aria-live="polite">
      {notice === 'updated' ? 'Updated — loads on next launch' : 'Ready offline'}
    </div>
  )
}
