/**
 * A ~50-line path router.
 *
 * The app has seven routes and needs deep links to survive a refresh (which
 * is what §11's `vercel.json` rewrite is for). That does not justify a routing
 * dependency — every kilobyte here is precached for offline use (§9).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

const PathContext = createContext<string>('/')

/**
 * Path routing is the production shape: §11's `vercel.json` rewrite exists so
 * that a refresh on `/goals/12` still serves the app.
 *
 * Where the app is *not* served from the origin root — a preview host, an
 * embed, a subdirectory — pushing `/goals/12` would navigate out of the app
 * entirely, so the route rides in the hash instead. That is a property of where
 * the build is deployed, not something to sniff at runtime: guessing from
 * `location.pathname` gets it exactly backwards on a genuine deep link, which
 * arrives at `/goals/12` precisely *because* the rewrite worked.
 *
 * Set `VITE_HASH_ROUTER=1` at build time for those hosts.
 */
const USE_HASH = import.meta.env['VITE_HASH_ROUTER'] === '1'

function readPath(): string {
  if (USE_HASH) return window.location.hash.replace(/^#/, '') || '/'
  return window.location.pathname || '/'
}

/** The href a link needs, which differs between the two modes. */
export function href(to: string): string {
  return USE_HASH ? `#${to}` : to
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(readPath)

  useEffect(() => {
    const onPop = () => setPath(readPath())
    window.addEventListener('popstate', onPop)
    window.addEventListener('hashchange', onPop)
    window.addEventListener('startem:navigate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('hashchange', onPop)
      window.removeEventListener('startem:navigate', onPop)
    }
  }, [])

  return <PathContext.Provider value={path}>{children}</PathContext.Provider>
}

export function usePath(): string {
  return useContext(PathContext)
}

export function navigate(to: string, replace = false): void {
  if (to === readPath()) return
  if (USE_HASH) {
    // Assigning the hash pushes a history entry; replaceState keeps Back sane.
    if (replace) window.history.replaceState(null, '', `#${to}`)
    else window.location.hash = to
  } else if (replace) {
    window.history.replaceState(null, '', to)
  } else {
    window.history.pushState(null, '', to)
  }
  window.dispatchEvent(new Event('startem:navigate'))
  window.scrollTo(0, 0)
}

export function back(fallback = '/'): void {
  if (window.history.length > 1) window.history.back()
  else navigate(fallback)
}

export function Link({
  to,
  children,
  className,
  ...rest
}: { to: string; children: ReactNode; className?: string } & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
>) {
  const path = usePath()
  return (
    <a
      href={href(to)}
      className={className}
      aria-current={path === to ? 'page' : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(to)
      }}
      {...rest}
    >
      {children}
    </a>
  )
}

/**
 * Matches `/goals/:id` style patterns and returns the captured params, or
 * null. Kept deliberately dumb: exact segment count, `:name` captures one.
 */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean)
  const a = path.split('/').filter(Boolean)
  if (p.length !== a.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(a[i]!)
    else if (seg !== a[i]) return null
  }
  return params
}

/** The first pattern that matches, with its params. */
export function useMatch(patterns: string[]): { pattern: string; params: Record<string, string> } | null {
  const path = usePath()
  return useMemo(() => {
    for (const pattern of patterns) {
      const params = match(pattern, path)
      if (params) return { pattern, params }
    }
    return null
  }, [patterns, path])
}

/** `navigate`, memoised, for use inside callbacks. */
export function useNavigate() {
  return useCallback((to: string, replace = false) => navigate(to, replace), [])
}
