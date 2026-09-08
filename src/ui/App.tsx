/** The shell: routes, tab bar, and the one loading gate. */

import './theme.css'
import { DataProvider, useData, useSnapshot } from './DataContext'
import { RouterProvider, Link, useMatch, usePath } from './router'
import { TodayScreen } from './Today'
import { TodosScreen } from './Todos'
import { TaskScreen } from './Task'
import { AreaScreen } from './Area'
import { StarScreen } from './Star'
import { ServiceWorkerNotice } from './serviceWorker'
import { buildTodos } from '../core'

/**
 * Four routes and one detail route each for a task and an area. Goals have no
 * route at all any more: an aim is written and read inline on its area (§7).
 */
const ROUTES = ['/', '/todos', '/tasks/:id', '/star', '/areas/:id']

function Screens() {
  const { loading, storageError } = useData()
  const hit = useMatch(ROUTES)

  if (storageError) {
    return (
      <div className="screen">
        <div className="card card-pad">
          <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>No room to store anything</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 8px' }}>
            Startem keeps all of your data on the device, so it cannot run without somewhere to
            put it. This browser is refusing.
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0 }}>
            Private browsing and “block all cookies” are the usual causes. A normal window, or
            installing the app to the home screen, will fix it.
          </p>
          <p style={{ color: 'var(--text-tertiary)', fontSize: 12, marginBottom: 0 }}>
            {storageError}
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="screen">
        <p className="empty">Loading…</p>
      </div>
    )
  }

  switch (hit?.pattern) {
    case '/':
      return <TodayScreen />
    case '/todos':
      return <TodosScreen />
    case '/tasks/:id':
      return <TaskScreen taskId={Number(hit.params['id'])} />
    case '/star':
      return <StarScreen />
    case '/areas/:id':
      return <AreaScreen areaId={Number(hit.params['id'])} />
    default:
      return (
        <div className="screen">
          <p className="empty">
            Nothing here. <Link to="/">Back to today</Link>
          </p>
        </div>
      )
  }
}

/**
 * Three tabs, and they are the three things the app is: the habits you keep
 * today, the errands parked alongside them, and where all of it leaves you.
 *
 * The to-do tab carries a count when something is late, because that tab is
 * the only place a deadline is visible and a silent one would be missed.
 */
function TabBar() {
  const { loading, storageError } = useData()
  if (loading || storageError) return null
  return <Tabs />
}

function Tabs() {
  const { snapshot, today } = useSnapshot()
  const path = usePath()
  const todos = buildTodos(snapshot, today)
  // A task or area opened from the day's list belongs to that tab, so the
  // highlight stays put rather than dropping off while you are two taps deep.
  const active = path === '/todos' ? '/todos' : path === '/star' ? '/star' : '/'

  return (
    <nav className="tabbar" aria-label="Main">
      <div className="tabbar-inner">
        <Link to="/" className="tab" aria-current={active === '/' ? 'page' : undefined}>
          <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M3.2 6.2l1.7 1.7 3-3M3.2 13.2l1.7 1.7 3-3M10.5 6.5h6.3M10.5 13.5h6.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Today
        </Link>
        <Link to="/todos" className="tab" aria-current={active === '/todos' ? 'page' : undefined}>
          <span className="tab-icon">
            <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M5.5 3.5h9a1 1 0 011 1v11a1 1 0 01-1 1h-9a1 1 0 01-1-1v-11a1 1 0 011-1z" strokeLinejoin="round" />
              <path d="M7.6 8.4l1.4 1.4 3-3.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {todos.overdueCount > 0 ? (
              <span className="tab-badge" aria-hidden="true">
                {todos.overdueCount}
              </span>
            ) : null}
          </span>
          To-dos
          {todos.overdueCount > 0 ? (
            <span className="sr-only">, {todos.overdueCount} overdue</span>
          ) : null}
        </Link>
        <Link to="/star" className="tab" aria-current={active === '/star' ? 'page' : undefined}>
          <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M10 2.5l6.5 4.7-2.5 7.6h-8L3.5 7.2z" strokeLinejoin="round" />
          </svg>
          Star
        </Link>
      </div>
    </nav>
  )
}

export default function App() {
  return (
    <RouterProvider>
      <DataProvider>
        <div className="app">
          <Screens />
        </div>
        <TabBar />
        <ServiceWorkerNotice />
      </DataProvider>
    </RouterProvider>
  )
}
