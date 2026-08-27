/** The shell: routes, tab bar, and the one loading gate. */

import './theme.css'
import { DataProvider, useData } from './DataContext'
import { RouterProvider, Link, useMatch } from './router'
import { TaskScreen, TasksScreen } from './Tasks'
import { AreaScreen, StarScreen } from './Star'
import { GoalEditorScreen, GoalScreen } from './Goal'
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
        <Link to="/settings" className="tab">
          {/*
            A cog, not a sun. The distinction is that the teeth are part of the
            body's outline — one closed path stepping between a root radius of
            6 and a tip radius of 8.2, eight times — rather than separate marks
            floating outside a circle, which is what made the old icon read as
            rays. Generated, then pasted: the arithmetic is not worth carrying
            into the bundle for one 20px icon.
          */}
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          >
            <path d="M8.55 4.18L8.78 1.89L11.22 1.89L11.45 4.18L13.09 4.86L14.87 3.4L16.6 5.13L15.14 6.91L15.82 8.55L18.11 8.78L18.11 11.22L15.82 11.45L15.14 13.09L16.6 14.87L14.87 16.6L13.09 15.14L11.45 15.82L11.22 18.11L8.78 18.11L8.55 15.82L6.91 15.14L5.13 16.6L3.4 14.87L4.86 13.09L4.18 11.45L1.89 11.22L1.89 8.78L4.18 8.55L4.86 6.91L3.4 5.13L5.13 3.4L6.91 4.86Z" />
            <circle cx="10" cy="10" r="2.9" />
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
