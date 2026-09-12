import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './ui/App'
import { primeCompleteSound } from './ui/sound'

// Fetched and decoded now so the first tick of a session sounds as fast as the
// tenth. Nothing plays until a tap asks it to (see ui/sound.ts).
primeCompleteSound()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
