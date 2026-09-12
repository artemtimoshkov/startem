/**
 * Magic-link auth — SPEC.md §10.
 *
 * No password for a single-user app. The session persists in local storage and
 * refreshes itself, so the phone signs in once and then works offline
 * indefinitely; sync simply resumes whenever a connection and a valid session
 * next coincide. The website is the same build doing the same thing.
 *
 * Signing in is **not** a gate on using the app. Everything works signed out,
 * against the device store, exactly as it did before there was a cloud — the
 * session only decides whether any of it is backed up.
 */

import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './client'

export type { Session, User }

/** The current session, or null when signed out or running local-only. */
export async function currentSession(): Promise<Session | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session
}

/**
 * Sends the magic link.
 *
 * `emailRedirectTo` has to be an origin on the project's auth allowlist, or
 * Supabase sends the link to the default site URL instead and the link opens
 * somewhere other than where it was asked for — on a phone, usually a browser
 * tab rather than the installed app.
 */
export async function sendMagicLink(email: string): Promise<void> {
  if (!supabase) throw new Error('No cloud is configured for this build.')
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: window.location.origin },
  })
  if (error) throw new Error(error.message)
}

/**
 * Signs out, and deliberately leaves the device store alone.
 *
 * Wiping on sign-out would be the more "correct" thing for a shared computer
 * and the wrong thing here: this is one person's phone, the data is the app,
 * and a stray sign-out that emptied it would be the exact failure sync exists
 * to prevent. Everything on the device is already in the cloud anyway.
 */
export async function signOut(): Promise<void> {
  if (!supabase) return
  await supabase.auth.signOut()
}

/** Calls back on every sign-in, sign-out and token refresh. */
export function onSessionChange(fn: (session: Session | null) => void): () => void {
  if (!supabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange((_event, session) => fn(session))
  return () => data.subscription.unsubscribe()
}
