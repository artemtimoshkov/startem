import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // The bundle is precached so the app opens on a plane, first try (§9).
      registerType: 'autoUpdate',
      // Registration is done by hand in src/ui/serviceWorker.tsx, so that a new
      // deploy can land quietly instead of reloading the page underneath you.
      injectRegister: false,
      includeAssets: ['favicon-32.png', 'apple-touch-icon-180.png'],
      manifest: {
        name: 'Startem',
        short_name: 'Startem',
        description: 'Areas, goals and the habits that actually move them.',
        // `standalone` is what makes the home-screen launch full-screen with no
        // Safari chrome (§9).
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        background_color: '#f7f8fa',
        theme_color: '#f7f8fa',
        categories: ['productivity', 'lifestyle'],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            // A separate maskable variant with a safe margin: Android crops the
            // icon to whatever shape the launcher uses, and a mark drawn to the
            // edges loses its corners (§9).
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        // Deep links have to work with no network too, so a navigation to any
        // route falls back to the cached shell — the offline twin of §11's
        // `vercel.json` rewrite.
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // The plugin only forces these when it injects its own registration.
        // With `injectRegister: false` they are ours to set, and without them
        // the new worker waits forever and the update never lands.
        skipWaiting: true,
        clientsClaim: true,
      },
      devOptions: {
        // Off by default: a service worker caching a dev server is a debugging
        // trap. `npm run dev:pwa` turns it on when the install path itself is
        // what's being worked on.
        enabled: process.env['VITE_DEV_PWA'] === '1',
        type: 'module',
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
  },
})
