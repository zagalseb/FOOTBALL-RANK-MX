// Liga → categoría → conferencia (tablas categories / conferences y
// teams.category_id / teams.conference_id). El código de competencia
// (ONEFA-LM-14G) se deriva, no se guarda.
//
// Categoría de un juego = la del equipo local (la misma regla que el slug).
// Un juego entra en el filtro de una conferencia si CUALQUIERA de los dos
// equipos pertenece a ella (un juego puede cruzar conferencias).
//
// Todo es opcional: un schema sin estas tablas/columnas (prod antes de migrar)
// rechaza cualquier consulta que las nombre. withCompetition repite la
// consulta sin ellas y loadCompetitions devuelve null → las páginas no
// muestran filtros nuevos y se ven como antes. Sin dependencias de config:
// cada página pasa su propia función de lectura (respeta ?env=staging).

// Campos extra dentro del embed de un equipo (home:home_team_id(...)).
export const TEAM_COMP_FIELDS = 'category_id,conference_id,cat:categories(codigo,nombre),conf:conferences(codigo,nombre)'
export const DEFAULT_CATEGORY = 'LM'
const CATEGORY_ORDER = ['LM', 'INT', 'JUV']

// null = sin probar; false = el schema no tiene categorías (no se vuelve a pedir en esta carga).
let compSupported = null
export function _resetCompetitionSupport() { compSupported = null }   // pruebas

// buildPath(teamCols): teamCols es ',' + TEAM_COMP_FIELDS o ''. Devuelve la
// ruta (string, se lee con fetchJson) o directamente una promesa con el
// resultado, para anidar: withCompetition(f, c => withSlug(f, s => `...${s}...${c}`)).
export async function withCompetition(fetchJson, buildPath) {
  const run = teamCols => {
    const p = buildPath(teamCols)
    return typeof p === 'string' ? fetchJson(p) : p
  }
  if (compSupported !== false) {
    try {
      const out = await run(',' + TEAM_COMP_FIELDS)
      compSupported = true
      return out
    } catch (e) {
      if (compSupported === true) throw e   // ya funcionó en esta carga: es otro error
      compSupported = false
    }
  }
  return run('')
}

const byCategoryOrder = (a, b) => {
  const ia = CATEGORY_ORDER.indexOf(a.codigo), ib = CATEGORY_ORDER.indexOf(b.codigo)
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || String(a.codigo).localeCompare(String(b.codigo))
}

// → [{ id, codigo, nombre, liga, conferences: [{ id, codigo, nombre }] }] ordenadas LM, INT, JUV…
//   o null si el schema no tiene categorías (o la lectura falla): sin filtros.
export async function loadCompetitions(fetchJson) {
  try {
    const rows = await fetchJson('categories?select=id,codigo,nombre,league:leagues(abreviatura),conferences(id,codigo,nombre)')
    if (!Array.isArray(rows) || !rows.length) return null
    return rows
      .map(c => ({
        id: c.id, codigo: c.codigo, nombre: c.nombre, liga: c.league?.abreviatura ?? null,
        conferences: (c.conferences || []).slice().sort((a, b) => String(a.codigo).localeCompare(String(b.codigo))),
      }))
      .sort(byCategoryOrder)
  } catch {
    return null
  }
}

export const findCategory = (cats, codigo) => (cats || []).find(c => c.codigo === codigo) || null

// Categoría inicial: la pedida si existe; si no, LM; si no, la primera.
export function defaultCategory(cats, wanted = null) {
  return findCategory(cats, wanted) || findCategory(cats, DEFAULT_CATEGORY) || (cats || [])[0] || null
}

// ONEFA-LM-14G (derivado; solo para mostrar o filtrar).
export const competitionCode = (liga, categoria, conferencia = null) =>
  [liga, categoria, conferencia].filter(Boolean).join('-')

// ── Juegos con equipos embebidos (home/away con cat/conf) ──────────────────
export const gameCategory = g => g?.home?.cat?.codigo ?? null
export const gameConferences = g => [g?.home?.conf?.codigo, g?.away?.conf?.codigo].filter(Boolean)

// categoria / conferencia: códigos (null = sin filtro).
export function gameMatches(g, { categoria = null, conferencia = null } = {}) {
  if (categoria && gameCategory(g) !== categoria) return false
  if (conferencia && !gameConferences(g).includes(conferencia)) return false
  return true
}
export const filterGames = (games, filter) => (games || []).filter(g => gameMatches(g, filter))

// "LM · " para anteponer a la etiqueta de un juego; '' si no hay categoría.
export const categoryPrefix = g => (gameCategory(g) ? `${gameCategory(g)} · ` : '')

// ── Equipos (filas de teams con category_id) ───────────────────────────────
// Abreviaturas que aparecen en más de una categoría dentro de `teams`
// (MTY en LM e INT): solo esas necesitan la categoría en su etiqueta.
export function ambiguousAbbreviations(teams) {
  const cats = new Map()
  for (const t of teams || []) {
    const k = String(t?.abreviatura || '').toUpperCase()
    if (!k) continue
    if (!cats.has(k)) cats.set(k, new Set())
    cats.get(k).add(t.category_id ?? null)
  }
  return new Set([...cats].filter(([, s]) => s.size > 1).map(([k]) => k))
}

// Código de la categoría de un equipo a partir de la lista de categorías.
export const teamCategoryCode = (team, cats) =>
  (cats || []).find(c => c.id === team?.category_id)?.codigo ?? null
