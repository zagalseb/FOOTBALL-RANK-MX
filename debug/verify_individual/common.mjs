// Utilidades comunes de los scripts de verificación de la pestaña Individual.
// Solo lectura: GET a la REST API de Supabase (mismas rutas que viewer.html),
// nunca escribe.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// stats-lib.js a usar: por defecto la del working tree (la que carga el viewer).
// Se puede pasar otra ruta, p. ej. una versión sacada con
//   git show <rama>:shared/stats-lib.js > /tmp/x/stats-lib.js
export const loadLib = (p = path.join(ROOT, 'shared/stats-lib.js')) => import(pathToFileURL(path.resolve(p)).href)

export const viewerHtml = () => fs.readFileSync(path.join(ROOT, 'live-stats/viewer/viewer.html'), 'utf8')

// Extrae un trozo del <script> de viewer.html (sin JSX) para correrlo en Node.
export function extract(re) {
  const m = viewerHtml().match(re)
  if (!m) throw new Error(`No se encontró en viewer.html: ${re}`)
  return m[0]
}
export const SRC = {
  context: () => extract(/const _IND_DOWN[\s\S]*?\n}\n/),
  firstDown: () => extract(/function _indFirstDownBySeq[\s\S]*?\n}\n/),
  qbBuilder: () => extract(/\/\/ IND_QB_BUILDER_START[\s\S]*?\/\/ IND_QB_BUILDER_END/),
  f4Builders: () => extract(/\/\/ IND_F4_BUILDERS_START[\s\S]*?\/\/ IND_F4_BUILDERS_END/),
  f56Builders: () => extract(/\/\/ IND_F56_BUILDERS_START[\s\S]*?\/\/ IND_F56_BUILDERS_END/),
}

const CONFIG = fs.readFileSync(path.join(ROOT, 'shared/supabase/supabase_config.js'), 'utf8')
const URL_ = CONFIG.match(/SUPABASE_URL = '([^']+)'/)[1]
const KEY = CONFIG.match(/SUPABASE_ANON_KEY = '([^']+)'/)[1]
const SCHEMA = process.env.FR_SCHEMA || 'covercero'
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Accept-Profile': SCHEMA }

export async function get(p) {
  const r = await fetch(`${URL_}/rest/v1/${p}`, { headers: H })
  if (!r.ok) throw new Error(`HTTP ${r.status} ${p}`)
  return r.json()
}

// Partidos de prueba (semana TEST). c0a826d4 es temporada 2025.
export const GAMES = {
  test: 'c0a826d4-5dfa-4279-942e-b3ecff24361c',
  t2026: '2dd8daf7-5053-4f5c-8c32-acabbbacda83',
  tNull: '7709996c-5bee-4c33-bad5-75b76deebb80',
}

// Carga un partido como viewer.html: plays aplanadas (_flattenPlay) y rosters
// indexados por la temporada del partido. season:false = sin filtro (como el
// viewer antes del arreglo de roster).
export async function loadGame(L, gid, { season = true } = {}) {
  const tf = 'nombre_corto,abreviatura,Apodo,color_principal,color_texto'
  const [g] = await get(`games?select=*,home:home_team_id(${tf}),away:away_team_id(${tf})&id=eq.${gid}`)
  const plays = (await get(`plays?select=*&game_id=eq.${gid}&order=seq.asc`)).map(({ play_data, ...r }) => ({ ...r, ...(play_data || {}) }))
  const pl = await get(`players?select=id,team_id,number,nombre,apellido,temporada&team_id=in.(${g.home_team_id},${g.away_team_id})`)
  const h = g.home.abreviatura, a = g.away.abreviatura
  const temporada = season ? L.getGameTemporada(g) : null
  const rostersOf = (rows, temp) => ({
    [h]: L.buildRosterIndex(g.home_team_id, rows.filter(r => r.team_id === g.home_team_id), temp),
    [a]: L.buildRosterIndex(g.away_team_id, rows.filter(r => r.team_id === g.away_team_id), temp),
  })
  const rosters = rostersOf(season ? pl : pl.map(({ temporada: _t, ...r }) => r), temporada)
  const teams = { home: { name: h }, away: { name: a } }
  const toApodo = x => x === h ? (g.home.Apodo || h) : x === a ? (g.away.Apodo || a) : x
  return { g, plays, pl, h, a, teams, rosters, rostersOf, toApodo, temporada }
}

let fails = 0
export function ok(cond, msg) { if (!cond) fails++; console.log(`  ${cond ? '✓' : '✗'} ${msg}`) }
export function done(okMsg = 'Todo coincide.') {
  console.log(fails ? `\n${fails} DIFERENCIAS` : `\n${okMsg}`)
  process.exitCode = fails ? 1 : 0
}
