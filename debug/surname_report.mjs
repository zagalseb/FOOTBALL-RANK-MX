// Read-only report on surname-based resolution (2026-10-05). For each game:
//  A) orphans whose number IS on the roster but whose surname contradicts it;
//     flagged "similar" when the surnames look like an abbreviation, compound or typo.
//  B) refs that resolve, but whose surname matches a roster player with a
//     different nombre (same surname, different first name).
// Usage: node debug/surname_report.mjs <game_id> [...]
import fs from 'node:fs'
import * as fn from '../shared/stats-lib.js'
import { playRefs } from './play_refs.mjs'

const src = fs.readFileSync(new URL('./snapshot_stats.mjs', import.meta.url), 'utf8')
const APIKEY = src.match(/apikey:\s*'([^']+)'/)[1]
const BASE = 'https://rlttycaajdsqovxjdjvx.supabase.co/rest/v1/'
const H = { apikey: APIKEY, Authorization: `Bearer ${APIKEY}`, 'Accept-Profile': 'covercero' }
const get = async p => (await fetch(BASE + p, { headers: H })).json()

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1))
  return d[a.length][b.length]
}
// abbreviation (initial, prefix), compound (one contains the other's words) or typo (<=2 edits)
function looksRelated(a, b) {
  if (!a || !b) return false
  if (a.startsWith(b) || b.startsWith(a)) return true
  const wa = a.split(' '), wb = b.split(' ')
  if (wa.some(w => wb.includes(w))) return true
  return lev(a, b) <= 2
}

for (const gameId of process.argv.slice(2)) {
  const [game] = await get(`games?select=id,home_team_id,away_team_id,home:home_team_id(abreviatura),away:away_team_id(abreviatura)&id=eq.${gameId}`)
  const teams = { [game.home.abreviatura]: game.home_team_id, [game.away.abreviatura]: game.away_team_id }
  const rows = await get(`players?select=id,team_id,number,nombre,apellido&team_id=in.(${Object.values(teams).join(',')})`)
  const idx = Object.fromEntries(Object.entries(teams).map(([a, t]) => [a, fn.buildRosterIndex(t, rows.filter(r => r.team_id === t))]))
  const plays = (await get(`plays?select=*&game_id=eq.${gameId}`)).map(({ play_data, ...rest }) => ({ ...rest, ...(play_data || {}) }))
  const refs = []
  for (const p of plays) refs.push(...playRefs(p, game.home.abreviatura, game.away.abreviatura).map(({ team, ref }) => [team, ref]))
  console.log(`\n== ${gameId}  refs=${refs.length}`)
  const A = [], B = []
  for (const [team, ref] of refs) {
    const index = idx[team]; if (!index) continue
    const cands = index.byNumber.get(Number(ref.number)) || []
    const n = { nombre: fn.normName(ref.nombre), apellido: fn.normName(ref.apellido) }
    const key = fn.resolvePlayerKey(ref, index)
    if (fn.isOrphanKey(key) && cands.length === 1 && n.apellido) {
      const c = fn.normName(cands[0].apellido)
      A.push(`${team} #${ref.number} "${ref.nombre} ${ref.apellido}" vs roster "${cands[0].nombre} ${cands[0].apellido}"` + (looksRelated(n.apellido, c) ? '  [posible abreviatura/compuesto/typo]' : ''))
    }
    if (!fn.isOrphanKey(key)) {
      const p = index.byId.get(key)
      if (p && n.apellido && fn.normName(p.nombre) !== n.nombre && n.nombre) B.push(`${team} #${ref.number} "${ref.nombre} ${ref.apellido}" resolved to "${p.nombre} ${p.apellido}"`)
    }
  }
  console.log(`A) number on roster, surname contradicts -> orphan: ${A.length}`); A.forEach(x => console.log('   ' + x))
  console.log(`B) same surname, different nombre (resolved): ${B.length}`); B.forEach(x => console.log('   ' + x))
}
