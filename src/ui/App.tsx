/** The shell: routes, tab bar, and the one loading gate. */

import './theme.css'
import { DataProvider, useData } from './DataContext'
import { RouterProvider, Link, useMatch } from './router'
import { TaskScreen, TasksScreen } from './Tasks'
import { AreaScreen, StarScreen } from './Star'
import { GoalEditorScreen, GoalScreen } from './Goal'
import { CalendarScreen, DayScreen } from './Calendar'
import { SettingsScreen } from './Settings'
import { ServiceWorkerNotice } from './serviceWorker'

const ROUTES = [
  '/',
  '/tasks/:id',
  '/star',
  '/areas/:id',
  '/areas/:id/goals/new',
  '/goals/new',
  '/goals/:id',
  '/goals/:id/edit',
  '/calendar',
  '/calendar/:date',
  '/settings',
]

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
      return <TasksScreen />
    case '/tasks/:id':
      return <TaskScreen taskId={Number(hit.params['id'])} />
    case '/star':
      return <StarScreen />
    case '/areas/:id':
      return <AreaScreen areaId={Number(hit.params['id'])} />
    case '/goals/new':
      return <GoalEditorScreen goalId={null} />
    case '/areas/:id/goals/new':
      return <GoalEditorScreen goalId={null} presetAreaId={Number(hit.params['id'])} />
    case '/goals/:id':
      return <GoalScreen goalId={Number(hit.params['id'])} />
    case '/goals/:id/edit':
      return <GoalEditorScreen goalId={Number(hit.params['id'])} />
    case '/calendar':
      return <CalendarScreen />
    case '/calendar/:date':
      return <DayScreen date={hit.params['date']!} />
    case '/settings':
      return <SettingsScreen />
    default:
      return (
        <div className="screen">
          <p className="empty">
            Nothing here. <Link to="/">Back to your tasks</Link>
          </p>
        </div>
      )
  }
}

function TabBar() {
  return (
    <nav className="tabbar" aria-label="Main">
      <div className="tabbar-inner">
        <Link to="/" className="tab">
          <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h8" strokeLinecap="round" />
          </svg>
          Tasks
        </Link>
        <Link to="/star" className="tab">
          <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M10 2.5l6.5 4.7-2.5 7.6h-8L3.5 7.2z" strokeLinejoin="round" />
          </svg>
          Star
        </Link>
        <Link to="/calendar" className="tab">
          <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="3" y="4.5" width="14" height="12" rx="2" />
            <path d="M3 8.5h14M7 3.5v2M13 3.5v2" strokeLinecap="round" />
          </svg>
          Calendar
        </Link>
        <Link to="/settings" className="tab">
          <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="10" cy="10" r="2.6" />
            <path
              d="M10 3v1.6M10 15.4V17M3 10h1.6M15.4 10H17M5.1 5.1l1.1 1.1M13.8 13.8l1.1 1.1M14.9 5.1l-1.1 1.1M6.2 13.8l-1.1 1.1"
              strokeLinecap="round"
            />
          </svg>
          Settings
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
