/**
 * The Supabase client — SPEC.md §10.
 *
 * There is no backend of ours: the browser talks to Postgres directly with the
 * publishable anon key, and row-level security is what stops it seeing anyone
 * else's rows. Shipping that key in the bundle is deliberate (§9) — RLS is the
 * boundary, not the key.
 *
 * The client is **optional**. With no env vars configured the app is exactly
 * what it was before milestone 4: a local-first tracker that never speaks to
 * anything. That is what keeps `npm run dev` working on a clean checkout, and
 * it is also the honest fallback if the project is ever torn down.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env['VITE_SUPABASE_URL']
const anonKey = import.meta.env['VITE_SUPABASE_ANON_KEY']

/** Null when the app is running local-only. Every caller has to handle that. */
export const supabase: SupabaseClient | null =
  typeof url === 'string' && url && typeof anonKey === 'string' && anonKey
    ? createClient(url, anonKey, {
        auth: {
          // The phone signs in once and then works offline indefinitely: the
          // session lives in local storage and refreshes itself whenever a
          // connection and a valid token next coincide (§10).
          persistSession: true,
          autoRefreshToken: true,
          // The magic link comes back as a URL fragment, which the client has
          // to read on boot before the router throws the rest of the URL away.
          detectSessionInUrl: true,
        },
      })
    : null

/** Whether a cloud is configured at all. Sync is inert without one. */
export function isCloudConfigured(): boolean {
  return supabase !== null
}
