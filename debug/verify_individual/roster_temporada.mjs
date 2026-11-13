// Arreglo de roster por temporada: antes (roster sin filtrar) vs después
// (getGameTemporada → buildRosterIndex) en lo que muestran las pestañas
// existentes. Solo deben cambiar las filas duplicadas y sus etiquetas.
// Uso: node debug/verify_individual/roster_temporada.mjs [ruta stats-lib.js]
import { loadLib, loadGame, GAMES } from './common.mjs'

const L = await loadLib(process.argv[2])

function snapshot(h, a, plays, rosters) {
  const teams = { home: { name: h }, away: { name: a } }, out = []
  const add = (tab, sec, line) => out.push(`${tab} | ${sec} | ${line}`)
  const om = L.buildOffenseMaps(plays, h, a, rosters)
  for (const [sec, m] of Object.entries(om)) for (const t in m) for (const d of Object.values(m[t])) { const { label, ...v } = d; add('{Apodo} Stats + Comparación', sec, `${t} ${label} ${JSON.stringify(v)}`) }
  const def = L.computeDefenseStats(plays, h, a, rosters)
  for (const t in def) for (const d of Object.values(def[t])) { const { label, ...v } = d; add('{Apodo} Stats + Comparación', 'defensa', `${t} ${label} ${JSON.stringify(v)}`) }
  for (const q of L.computeQBProgression(plays, rosters)) add('{Apodo} Stats', 'QB progression', `${q.team} ${q.label} ${q.comp}-${q.att} ${q.yds}y ${q.td}td ${q.int}int filas:${q.rows.map(r => r.caTally + '/' + r.receiver).join(',')}`)
  const st = L.computeSpecialTeamsStats(plays, h, a, teams, rosters)
  for (const sec of ['punting', 'kickoffs', 'kickReturns', 'puntReturns']) for (const r of st[sec]) { const { key, ...v } = r; add('{Apodo} Stats + Comparación', sec, JSON.stringify(v)) }
  for (const r of st.fgs) add('{Apodo} Stats', 'fgs', JSON.stringify(r))
  const to = L.computeTurnoverStatsByPlayer(plays, h, a, teams, rosters)
  for (const sec in to) for (const t in to[sec]) for (const d of Object.values(to[sec][t])) add('Comparación', sec, `${t} ${JSON.stringify(d)}`)
  const ex = L.computeExplosivePlays(plays, teams)
  for (const sec in ex) for (const p of ex[sec]) add('{Apodo} Stats', 'big ' + sec, `${p.seq} ${p._effYards}`)
  for (const p of L.computePenalties(plays, h)) add('{Apodo} Stats', 'penalties', JSON.stringify(p))
  const drives = L.computeDrives(plays, h, a)
  add('Team Stats/Comparación', 'comparisonStats', JSON.stringify(L.computeComparisonStats(plays, drives, h, a, teams)))
  drives.forEach((d, i) => add('Drives', 'drive', `${i} ${d.possession} ${d.plays.map(p => p.seq).join(',')} ${L.driveEndLabel(d.plays, i === drives.length - 1, teams)}`))
  for (const p of plays) add('Play by Play', 'jugada', `${p.seq} ${L.formatPlay(p)}`)
  return out
}
function diff(before, after) {
  const A = new Map(), B = new Map()
  before.forEach(x => A.set(x, (A.get(x) || 0) + 1)); after.forEach(x => B.set(x, (B.get(x) || 0) + 1))
  return { gone: [...A].filter(([k, n]) => (B.get(k) || 0) < n).map(([k]) => k), added: [...B].filter(([k, n]) => (A.get(k) || 0) < n).map(([k]) => k) }
}
function report(name, G, temporada, plOverride = null) {
  const pl = plOverride || G.pl
  const before = snapshot(G.h, G.a, G.plays, G.rostersOf(G.pl.map(({ temporada: _t, ...r }) => r), null))
  const after = snapshot(G.h, G.a, G.plays, G.rostersOf(pl, temporada))
  const { gone, added } = diff(before, after)
  console.log(`\n### ${name}: temporada usada = ${JSON.stringify(temporada)} · ${G.plays.length} jugadas`)
  if (!gone.length && !added.length) { console.log('  Sin cambios en ninguna pestaña.'); return }
  gone.forEach(l => console.log('  - ANTES   ' + l)); added.forEach(l => console.log('  + DESPUÉS ' + l))
}

const T = await loadGame(L, GAMES.test)
report('TEST c0a826d4 (2025)', T, L.getGameTemporada(T.g))
const G26 = await loadGame(L, GAMES.t2026)
report('TEST 2dd8daf7 (2026)', G26, L.getGameTemporada(G26.g))
const GN = await loadGame(L, GAMES.tNull)
report('TEST 7709996c (temporada null → año del kickoff)', GN, L.getGameTemporada(GN.g))
report('Simulado: 7709996c sin temporada ni kickoff', GN, L.getGameTemporada({ ...GN.g, temporada: null, kickoff: null }))
report('Simulado: c0a826d4 con jugadores sin temporada', T, L.getGameTemporada(T.g), T.pl.map(r => ({ ...r, temporada: null })))
