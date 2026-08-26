import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Milestone 1 is the pure core (src/core) only. src/db, src/sync and src/ui are
// scaffolded empty and get filled in from milestone 2 onwards (SPEC.md §11).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main style={{ padding: 24, font: '16px/1.5 -apple-system, system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20, margin: 0 }}>Startem</h1>
      <p style={{ color: '#767e8a' }}>Core only — UI arrives in milestone 2.</p>
    </main>
  </StrictMode>,
)
