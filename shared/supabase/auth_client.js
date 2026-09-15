// Supabase Auth for capture/ operators — real signed-in sessions, used to
// satisfy the `authenticated`-only RLS policies on games/plays/players/teams
// writes. Operator accounts are created manually in the Supabase dashboard
// (Authentication → Users) — there is no public sign-up flow anywhere here.
//
// viewer/ (index.html, viewer.html) must NEVER import this file — it stays
// fully public, read-only, unauthenticated. Only capture/ pages (via
// auth_gate.js) and engine.js's write functions use it.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase_config.js'

let _clientPromise = null
function client() {
  if (!_clientPromise) {
    _clientPromise = import('https://esm.sh/@supabase/supabase-js@2').then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    )
  }
  return _clientPromise
}

export async function signIn(email, password) {
  const c = await client()
  return c.auth.signInWithPassword({ email, password })
}

export async function signOut() {
  const c = await client()
  return c.auth.signOut()
}

export async function getSession() {
  const c = await client()
  const { data } = await c.auth.getSession()
  return data.session
}

// fn(event, session) — fires on sign-in, sign-out, and token refresh, so the
// login overlay/logout button stay in sync with the real session state.
export async function onAuthStateChange(fn) {
  const c = await client()
  c.auth.onAuthStateChange(fn)
}

// Headers for a write request. Falls back to the anon key as the bearer
// token when signed out, so a write attempted with no session still gets a
// clean RLS rejection from PostgREST (role=anon) instead of a malformed
// request — the actual security boundary is the DB policy, not this file.
export async function getAuthHeaders() {
  const session = await getSession()
  const token = session?.access_token || SUPABASE_ANON_KEY
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    'Accept-Profile': 'covercero',
    'Content-Profile': 'covercero',
  }
}
