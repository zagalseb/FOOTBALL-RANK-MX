// Fila "TFL (Def Yds)" de Team Stats alineada con el TFL por jugador (segundo
// commit de proposal/defensa-tackles). Compara computeComparisonStats ANTES vs
// DESPUÉS, comprueba que ningún otro campo cambie y que la fila de equipo
// cuadre con la suma del TFL por jugador.
// Uso:
//   git show proposal/defensa-tackles~1:shared/stats-lib.js > /tmp/tfl/antes/stats-lib.js
//   git show proposal/defensa-tackles:shared/stats-lib.js   > /tmp/tfl/despues/stats-lib.js
//   node debug/verify_individual/tfl_equipo.mjs /tmp/tfl/antes/stats-lib.js /tmp/tfl/despues/stats-lib.js
import { loadLib, loadGame, GAMES, ok, done } from './common.mjs'

const [beforePath, afterPath] = process.argv.slice(2)
if (!beforePath || !afterPath) { console.error('Faltan las rutas de stats-lib.js antes y después (ver cabecera).'); process.exit(2) }
const B = await loadLib(beforePath), A = await loadLib(afterPath)

for (const gid of Object.values(GAMES)) {
  const { plays, h, a, teams, rosters } = await loadGame(A, gid)
  const cs = L => L.computeComparisonStats(plays, L.computeDrives(plays, h, a), h, a, teams)
  const b = cs(B), x = cs(A)
  console.log(`\n### ${gid.slice(0, 8)} (${a} @ ${h})`)
  for (const tm of [a, h]) {
    const other = Object.keys(x[tm]).filter(k => !['tflMade', 'tflYds'].includes(k) && x[tm][k] !== b[tm][k])
    const pTfl = Object.values(A.computeDefenseStats(plays, h, a, rosters)[tm] || {}).reduce((s, r) => s + r.tfl, 0)
    console.log(`  ${tm}: Sacks (Def Yds) ${b[tm].sacksMade}-${b[tm].sacksYds} → ${x[tm].sacksMade}-${x[tm].sacksYds} · TFL (Def Yds) ${b[tm].tflMade}-${b[tm].tflYds} → ${x[tm].tflMade}-${x[tm].tflYds} · suma TFL por jugador ${pTfl}`)
    ok(!other.length, `${tm}: ningún otro campo de Team Stats cambia${other.length ? ' (cambian: ' + other.join(',') + ')' : ''}`)
  }
}
done()
