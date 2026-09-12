/** The shell: routes, tab bar, and the one loading gate. */

import './theme.css'
import { DataProvider, useData, useSnapshot } from './DataContext'
import { RouterProvider, Link, useMatch, usePath } from './router'
import { TopBar } from './bits'
import { TodayScreen } from './Today'
import { TodosScreen } from './Todos'
import { TaskScreen } from './Task'
import { AreaScreen } from './Area'
import { StarScreen } from './Star'
import { ServiceWorkerNotice } from './serviceWorker'
import { SyncProvider, SyncBadge } from './SyncContext'
import { AccountScreen } from './Account'
import { buildTodos } from '../core'

/**
 * Four routes and one detail route each for a task and an area. Goals have no
 * route at all any more: an aim is written and read inline on its area (§7).
 */
const ROUTES = ['/', '/todos', '/tasks/:id', '/star', '/areas/:id', '/account']

function Screens() {
  const { loading, storageError } = useData()
  const hit = useMatch(ROUTES)

  if (storageError) {
    return (
      <div className="screen">
        <TopBar title="No room to store anything" />
        <p style={{ color: 'var(--text-secondary)', fontSize: 14.5, margin: 0 }}>
          Startem keeps its data on the device. Private browsing and “block all cookies” are the
          usual causes; a normal window, or the app on your home screen, will fix it.
        </p>
        <p style={{ color: 'var(--text-tertiary)', fontSize: 12, marginTop: 12 }}>
          {storageError}
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="screen">
        <div className="spinner" role="status" aria-label="Loading" />
      </div>
    )
  }

  switch (hit?.pattern) {
    case '/todos':
      return <TodosScreen />
    case '/tasks/:id':
      return <TaskScreen taskId={Number(hit.params['id'])} />
    case '/star':
      return <StarScreen />
    case '/areas/:id':
      return <AreaScreen areaId={Number(hit.params['id'])} />
    case '/account':
      return <AccountScreen />
    // '/' and anything unrecognised: the day's list. A URL nobody can type on
    // a phone does not deserve a dead-end screen explaining itself.
    default:
      return <TodayScreen />
  }
}

/**
 * Three tabs, and they are the three things the app is: the habits you keep
 * today, the errands parked alongside them, and where all of it leaves you.
 *
 * Icon only. Three drawn glyphs at this size need no captions, and the labels
 * were the last of the app's belt-and-braces text; the screen each one opens
 * says what it is at the top. The to-do tab still carries a count when
 * something is late, because that tab is the only place a deadline is visible
 * and a silent one would be missed.
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
        <Link
          to="/"
          className="tab"
          aria-label="Today"
          aria-current={active === '/' ? 'page' : undefined}
        >
          {/* A calendar with today's square filled: the day's list, not a
              generic list. */}
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={active === '/' ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3.5" y="5" width="17" height="15.5" rx="3.5" />
            <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
            <rect x="7.5" y="12.5" width="4.5" height="4.5" rx="1.4" fill="currentColor" stroke="none" />
          </svg>
        </Link>
        <Link
          to="/todos"
          className="tab"
          aria-label={
            todos.overdueCount > 0 ? `To-dos, ${todos.overdueCount} overdue` : 'To-dos'
          }
          aria-current={active === '/todos' ? 'page' : undefined}
        >
          <span className="tab-icon">
            {/* Ticked lines: a list of errands. */}
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={active === '/todos' ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.5 7l2 2 3.5-3.5M3.5 16.5l2 2 3.5-3.5M12.5 7.5h8M12.5 17h8" />
            </svg>
            {todos.overdueCount > 0 ? (
              <span className="tab-badge" aria-hidden="true">
                {todos.overdueCount}
              </span>
            ) : null}
          </span>
        </Link>
        <Link
          to="/star"
          className="tab"
          aria-label="Star"
          aria-current={active === '/star' ? 'page' : undefined}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" fill={active === '/star' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
            <path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8z" />
          </svg>
        </Link>
      </div>
    </nav>
  )
}

export default function App() {
  return (
    <RouterProvider>
      <DataProvider>
        <SyncProvider>
          <div className="app">
            <Screens />
          </div>
          <TabBar />
          {/* Not a fourth tab: the three tabs are the three things the app is
              (§8), and sync is plumbing. The badge stays out of the way until
              it has something to say, and opens the account screen. */}
          <SyncBadge />
          <ServiceWorkerNotice />
        </SyncProvider>
      </DataProvider>
    </RouterProvider>
  )
}
