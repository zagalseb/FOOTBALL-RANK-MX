// Fase 3: QB Progression. Corre el _buildIndQbData real de viewer.html y
// compara los totales de cada QB contra Individual > Ofensiva > Pase y contra
// la suma de sus filas. Con --anuladas simula en memoria (sin escribir nada)
// un holding aceptado sobre el pase seq 24 y el sack seq 9 del partido TEST.
// Uso: node debug/verify_individual/f3_qb.mjs [--anuladas] [ruta stats-lib.js]
import { loadLib, loadGame, GAMES, SRC, ok, done } from './common.mjs'

const args = process.argv.slice(2)
const simulate = args.includes('--anuladas')
const L = await loadLib(args.find(x => !x.startsWith('--')))
const build = new Function('L', `const { _playerKeyLabel, resolvePlay, playNetYards, fumbleYards, _isFirstDownPlay } = L;
${SRC.context()}\n${SRC.firstDown()}\n${SRC.qbBuilder()}\nreturn _buildIndQbData;`)(L)

const holding = p => ({ ...p, flag_1_infraction: { code: 'HO', label: 'Holding' }, flag_1_team: p.possession, flag_1_result: 'accepted', flag_1_enforced: 'previous', flag_1_down_result: 'repeat_down' })

for (const gid of simulate ? [GAMES.test] : Object.values(GAMES)) {
  const G = await loadGame(L, gid)
  const plays = simulate ? G.plays.map(p => (p.seq === 24 || p.seq === 9) ? holding(p) : p) : G.plays
  const { passers } = L.buildOffenseMaps(plays, G.h, G.a, G.rosters)
  const data = build(plays, L.computeQBProgression(plays, G.rosters), G.rosters, G.h, G.a, G.toApodo)
  console.log(`\n######## ${gid.slice(0, 8)} (${G.a} @ ${G.h})${simulate ? ' — SIMULADO: anuladas seq 24 y 9' : ''}`)
  for (const d of data) {
    const q = d.qb, P = passers[q.team]?.[q.key] || {}
    const live = d.attempts.filter(x => !x.voided)
    const rows = { comp: live.filter(x => x.complete).length, att: live.length, yds: live.reduce((s, x) => s + x.yds, 0), td: live.filter(x => x.result === 'TD').length, int: live.filter(x => x.isInt).length }
    ok(q.comp === P.comp && P.comp === rows.comp && q.att === P.att && P.att === rows.att && q.yds === P.yds && P.yds === rows.yds &&
       q.td === P.td && P.td === rows.td && q.int === rows.int && d.sacked === (P.sacked ?? 0) && d.sackedYds === (P.sackedYds ?? 0),
       `${q.team} ${q.label}: tarjeta ${q.comp}-${q.att}, ${q.yds} yds (${q.td}TD, ${q.int}INT) · capturas ${d.sacked}-${d.sackedYds} = Ofensiva·Pase = suma de filas`)
    let n = 0
    for (const x of d.attempts) console.log(`     ${x.voided ? '—' : ++n} | ${x.voided ? 'ANULADA' : x.complete ? '✓' : '✗'} | ${x.yds ?? '—'} | ${x.result} | ${x.context} | ${x.target}  (seq ${x.seq})`)
    for (const k of d.sacks) console.log(`     captura seq ${k.seq}: ${k.voided ? 'Anulada' : k.yds} | ${k.context} | ${k.by}`)
  }
}
done()
