/**
 * The two install paths — SPEC.md §9.
 *
 * Browsers that fire `beforeinstallprompt` get a button that installs in one
 * tap. iOS has no programmatic install at all, so it gets the only thing that
 * works there: instructions for Share → Add to Home Screen. Getting this on the
 * home screen is the whole delivery mechanism, so it cannot be buried.
 */

import { useCallback, useEffect, useState } from 'react'

const DISMISSED_KEY = 'startem:install-dismissed'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** True when the app is already running as an installed app rather than a tab. */
function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // Safari's own, older flag — the only signal on iOS.
  return (window.navigator as { standalone?: boolean }).standalone === true
}

function isIOS(): boolean {
  const ua = window.navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // iPadOS 13+ reports itself as a Mac, and is told apart by having a touch
  // screen.
  return window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1
}

export interface InstallState {
  installed: boolean
  ios: boolean
  /** Non-null once the browser has offered a programmatic install. */
  promptable: boolean
  install: () => void
  dismissed: boolean
  dismiss: () => void
}

export function useInstall(): InstallState {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISSED_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Holding on to the event is the only way to install later, on a tap of
      // our own button, rather than in whatever mini-infobar the browser felt
      // like showing.
      e.preventDefault()
      setEvent(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setEvent(null)
    }
    const display = window.matchMedia('(display-mode: standalone)')
    const onDisplay = () => setInstalled(isStandalone())

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    display.addEventListener('change', onDisplay)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      display.removeEventListener('change', onDisplay)
    }
  }, [])

  const install = useCallback(() => {
    if (!event) return
    void event.prompt().then(() => event.userChoice.then(() => setEvent(null)))
  }, [event])

  const dismiss = useCallback(() => {
    setDismissed(true)
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      // A browser that will not remember the dismissal is not worth an error.
    }
  }, [])

  return { installed, ios: isIOS(), promptable: event !== null, install, dismissed, dismiss }
}

/** Share → Add to Home Screen, the only route iOS offers. */
export function IOSInstructions() {
  return (
    <ol style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13.5, lineHeight: 1.6 }}>
      <li>
        Tap <ShareGlyph /> Share, at the bottom of Safari.
      </li>
      <li>
        Scroll down and choose <strong>Add to Home Screen</strong>.
      </li>
      <li>
        Tap <strong>Add</strong>. Startem opens full-screen from then on, and works with no
        signal.
      </li>
    </ol>
  )
}

function ShareGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      aria-label="Share"
      role="img"
      style={{ verticalAlign: '-2px' }}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 10.5V2.5M5.5 5L8 2.5 10.5 5" />
      <path d="M4 7.5H3v6h10v-6h-1" />
    </svg>
  )
}

/**
 * The dismissible card on Today — the only install surface, now that the
 * settings screen is gone. Hidden once the app is installed, and once
 * dismissed it stays dismissed.
 */
export function InstallCard() {
  const { installed, ios, promptable, install, dismissed, dismiss } = useInstall()
  if (installed || dismissed) return null
  if (!promptable && !ios) return null

  return (
    <div className="card card-pad" style={{ marginTop: 12 }}>
      <p className="card-title" style={{ marginBottom: 6 }}>
        Put Startem on your home screen
      </p>
      <p style={{ margin: '0 0 10px', fontSize: 13.5, color: 'var(--text-secondary)' }}>
        It opens full-screen, keeps its own copy of your data, and works with no signal.
      </p>
      {promptable ? (
        <div className="btn-row">
          <button type="button" className="btn btn-primary btn-sm" onClick={install}>
            Install
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={dismiss}>
            Not now
          </button>
        </div>
      ) : (
        <>
          <IOSInstructions />
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-quiet btn-sm" onClick={dismiss}>
              Got it
            </button>
          </div>
        </>
      )}
    </div>
  )
}
