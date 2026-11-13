// Fase 4: Big Plays y Penalties (constructores reales de viewer.html) vs las
// pestañas existentes. Con --simular agrega en memoria (sin escribir nada) dos
// banderas al pase seq 50 del TEST y cambia la PENALTY seq 26 a compensada.
// Uso: node debug/verify_individual/f4_big_pen.mjs [--simular] [ruta stats-lib.js]
import { loadLib, loadGame, GAMES, SRC, ok, done } from './common.mjs'

const args = process.argv.slice(2)
const L = await loadLib(args.find(x => !x.startsWith('--')))
const B = new Function('L', `const { _playerKeyLabel, _isFirstDownPlay, playTouchdown } = L;
${SRC.context()}\n${SRC.firstDown()}\n${SRC.f4Builders()}\nreturn { _buildIndBigPlays, _buildIndPenalties, _indFirstDownBySeq };`)(L)

const simulate = plays => plays.map(p => {
  if (p.seq === 50) return { ...p,
    flag_1_infraction: { code: 'PI', label: 'Pass interference' }, flag_1_team: 'AT', flag_1_by: { number: 24, nombre: 'Test', apellido: 'Defensa' }, flag_1_result: 'accepted', flag_1_enforced: 'end', flag_1_down_result: 'first_down', flag_1_new_los: { team: 'AT', yard: 20 },
    flag_2_infraction: { code: 'HO', label: 'Holding' }, flag_2_team: 'MTY', flag_2_result: 'declined' }
  if (p.seq === 26) return { ...p, penalty_result: 'offsetting', penalty_down_result: null, penalty_new_los: null }
  return p
})

const runs = args.includes('--simular') ? [[GAMES.test, true]] : Object.values(GAMES).map(g => [g, false])
for (const [gid, sim] of runs) {
  const G = await loadGame(L, gid)
  const plays = sim ? simulate(G.plays) : G.plays
  const { h, a, teams, rosters, toApodo } = G
  console.log(`\n######## ${gid.slice(0, 8)} (${a} @ ${h})${sim ? ' — SIMULADO' : ''}`)
  const ex = L.computeExplosivePlays(plays, teams)
  const big = B._buildIndBigPlays(ex, B._indFirstDownBySeq(plays, h, a), rosters, toApodo)
  for (const team of [a, h]) {
    const old = [...ex.passing.filter(p => p.possession === team && p._effYards >= 20), ...ex.rushing.filter(p => p.possession === team && p._effYards >= 10)].map(p => p.seq).sort((x, y) => x - y)
    const scan = plays.map(L.resolvePlay).filter(p => p.possession === team && ((p.play_type === 'PASS' && p.pass_result === 'complete' && L.playNetYards(p) >= 20) ||
      ((p.play_type === 'RUSH' || (p.play_type === 'PASS' && p.pass_result === 'scramble')) && L.playNetYards(p) >= 10))).map(p => p.seq)
    const mine = big.filter(r => r.team === team).map(r => r.seq)
    ok(JSON.stringify(mine) === JSON.stringify(old) && JSON.stringify(scan) === JSON.stringify(mine), `Big Plays ${team}: nuevo [${mine}] = existente 20+/10+ [${old}] = barrido directo [${scan}]`)
  }
  for (const r of big) console.log(`     ${r.team} Q${r.quarter} ${r.kind.padEnd(7)} ${r.play.padEnd(34)} ${String(r.yds).padStart(3)} ${r.result.padEnd(3)} ${r.context} (seq ${r.seq})`)
  const pen = L.computePenalties(plays, h)
  const rows = B._buildIndPenalties(pen, plays)
  for (const team of [a, h]) {
    const old = pen.filter(r => r.team === team), mine = rows.filter(r => r.team === team)
    const acc = old.filter(r => r.result === 'accepted')
    const accYds = acc.reduce((s, r) => s + (r.yards || 0), 0)
    ok(old.length === mine.length && old.every((r, i) => r.seq === mine[i].seq && (r.result === 'accepted' ? r.yards === mine[i].yards : mine[i].yards == null)) &&
       mine.filter(r => r.accepted).length === acc.length,
       `Penalties ${team}: Flags (aceptadas) ${mine.filter(r => r.accepted).length}, ${mine.reduce((s, r) => s + (r.yards || 0), 0)} yds · Team Stats ${acc.length}-${accYds} · ${mine.length} filas en tabla`)
  }
  for (const r of rows) console.log(`     ${r.team} Q${r.quarter} ${r.infraction.padEnd(32)} ${String(r.player).padEnd(20)} ${String(r.yards ?? '—').padStart(3)} ${r.result.padEnd(10)} ${r.down} (seq ${r.seq})`)
}
done()
