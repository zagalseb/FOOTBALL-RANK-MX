// Identificador de partido en URLs: acepta UUID (games.id) o slug legible
// (LIGA-CATEGORIA-LOCAL-VISITANTE-TEMPORADA-SEMANA, campo calculado `slug`
// de PostgREST). El UUID sigue siendo la única llave: todo lo que escribe,
// guarda en localStorage o filtra Realtime usa el UUID que devuelve
// resolveGameRef, nunca el valor crudo de la URL.
//
// Sin dependencias de config: cada página pasa su propia función de lectura
// (fetchJson(path) → JSON, lanza si !ok), así se respetan su base URL, sus
// headers y su schema (?env=staging) sin duplicar esa lógica aquí.
//
// Compatibilidad: un schema sin la función slug (prod antes de migrar)
// responde error a cualquier consulta que la nombre. withSlug reintenta sin
// slug y los links caen a UUID; resolveGameRef reporta el slug como no
// encontrado sin romper la página.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Slug: letras, dígitos y guiones (el desempate agrega -XXXXXX hex).
const SLUG_RE = /^[A-Z0-9]+(?:-[A-Z0-9]+){2,}$/

export const isUuid = v => typeof v === 'string' && UUID_RE.test(v)

// Valor crudo de la URL: ?game_id= (viewer, captura) o ?game= (QB Map).
export function readGameRef(search = globalThis.location?.search ?? '') {
  const qs = search instanceof URLSearchParams ? search : new URLSearchParams(search)
  const v = (qs.get('game_id') || qs.get('game') || '').trim()
  return v || null
}

// → { id, via: 'uuid' | 'slug' } o { id: null, reason: 'empty' | 'invalid' | 'not_found' | 'lookup_failed', message }
// Un UUID se devuelve tal cual, sin consultar.
export async function resolveGameRef(ref, fetchJson) {
  const raw = (ref ?? '').trim()
  if (!raw) return { id: null, reason: 'empty', message: 'No se especificó un partido.' }
  if (isUuid(raw)) return { id: raw.toLowerCase(), via: 'uuid' }
  const slug = raw.toUpperCase()
  if (!SLUG_RE.test(slug)) {
    return { id: null, reason: 'invalid', message: `Partido no encontrado: "${raw}" no es un identificador válido.` }
  }
  let rows
  try {
    rows = await fetchJson(`games?select=id&slug=eq.${encodeURIComponent(slug)}&limit=2`)
  } catch (e) {
    // Schema sin slug (prod antes de migrar) o sin red.
    return { id: null, reason: 'lookup_failed', message: `Partido no encontrado: no se pudo buscar "${slug}".` }
  }
  if (Array.isArray(rows) && rows.length === 1 && isUuid(rows[0]?.id)) return { id: rows[0].id, via: 'slug' }
  return { id: null, reason: 'not_found', message: `Partido no encontrado: "${slug}".` }
}

// null = sin probar; false = el schema no tiene slug (no se vuelve a pedir en esta carga).
let slugSupported = null
export function _resetSlugSupport() { slugSupported = null }   // pruebas

// buildPath(slugCol) arma la consulta; slugCol es ',slug' o ''.
// Si la consulta con slug falla, se repite sin slug (los links caen a UUID).
export async function withSlug(fetchJson, buildPath) {
  if (slugSupported !== false) {
    try {
      const out = await fetchJson(buildPath(',slug'))
      slugSupported = true
      return out
    } catch (e) {
      if (slugSupported === true) throw e   // el slug ya funcionó: es otro error
      slugSupported = false
    }
  }
  return fetchJson(buildPath(''))
}

// Valor para la URL: slug si el juego lo trae, si no el UUID.
export const gameUrlRef = g => (g?.slug || g?.id || '')

// URL canónica para history.replaceState: ?game=<slug>, sin ?game_id=,
// conservando el resto de parámetros (env, tab…). null si no hay cambio.
export function canonicalGameUrl(href, slug) {
  if (!slug) return null
  const url = new URL(href)
  if (url.searchParams.get('game') === slug && !url.searchParams.has('game_id')) return null
  url.searchParams.delete('game_id')
  url.searchParams.set('game', slug)
  return url.pathname + url.search + url.hash
}
