// PostgREST upsert as the signed-in operator (same call manual_stats.html makes
// inline). Used by capture/import_stats.html. Needs a session: RLS only lets
// `authenticated` write.
import { SUPABASE_URL } from './supabase_config.js'
import { getAuthHeaders } from './auth_client.js'

async function extractError(res) {
  try {
    const j = await res.json()
    if (j.code === '23505') return 'Ya existe un registro con esos datos (restricción única en la base).'
    return j.message || `HTTP ${res.status}`
  } catch { return `HTTP ${res.status}` }
}

export async function sbUpsert(path, body, onConflict) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: 'POST',
    headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json()
}
