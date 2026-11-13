// TC-04: sacks compartidos (sack_by + otros defensores en tackle_by) en lo que
// muestra el viewer: "Capturas" de Individual > Defensiva (_buildIndDefense) y
// la tabla SACKS de Comparación > Defense (_sacksRows). Corre el código real
// de viewer.html. Sin red: jugadas sintéticas.
// Uso: node debug/verify_individual/sacks_compartidos.mjs [ruta stats-lib.js]
import { loadLib, SRC, extract, ok, done } from './common.mjs'

const L = await loadLib(process.argv[2])
const Bld = new Function('L', `const { _playerKeyLabel, calcNetYards, isTouchdown, resolvePlay, _blockedPuntEnd, _blockedPuntRunner } = L;
${SRC.f56Builders()}\nreturn { _buildIndDefense };`)(L)
const { _sacksRows } = new Function(`${extract(/function _sacksRows[\s\S]*?\n}\n/)}\nreturn { _sacksRows }`)()

const A = 'AAA', B = 'BBB', teams = { home: { name: A }, away: { name: B } }
const pos = (team, yard) => ({ team, yard })
const P = (n, apellido) => ({ number: n, nombre: '', apellido })
const Benton = P(99, 'Benton'), Baker = P(31, 'Baker'), Brown = P(50, 'Brown')
const sack = (tackle_by, at = pos(B, 48)) => ({ play_type: 'PASS', possession: A, field_pos: pos(B, 40), down: 2, distance: 10,
  pass_by: P(12, 'Adams'), pass_result: 'sack', sack_by: Benton, result: 'tackle', tackle_by, at,
  net_yards: L.calcNetYards(teams, A, pos(B, 40), at) })

function show(name, plays) {
  const def = L.computeDefenseStats(plays, A, B)
  const ind = Object.fromEntries(Bld._buildIndDefense(def, {}, B).tackles.map(r => [r.label.split(' ')[0], r]))
  const tab = Object.fromEntries(_sacksRows(def, B).map(r => [r[0].split(' ')[0], r]))
  const team = L.computeComparisonStats(plays, L.computeDrives(plays, A, B), A, B, teams)[B]
  console.log(`\n${name}`)
  for (const k of Object.keys(ind)) {
    const r = ind[k], t = tab[k]
    console.log(`   ${k.padEnd(4)} Individual: Solo ${r.solo} Ast ${r.ast} TFL ${r.tfl} Capturas ${r.sacks} · SACKS: Sacks ${t?.[1] ?? '—'} Sack Yds ${t?.[2] ?? '—'}`)
  }
  console.log(`   Equipo: Sacks ${team.sacksMade}-${team.sacksYds} · TFL ${team.tflMade}-${team.tflYds}`)
  return { ind, tab, team }
}

{
  const { ind, tab, team } = show('Sack de 8 yds compartido entre dos (#99 sack_by, #31 en tackle_by)', [sack([Benton, Baker])])
  for (const k of ['#99', '#31']) {
    ok(ind[k].sacks === 0.5 && ind[k].ast === 1 && ind[k].solo === 0 && ind[k].tfl === 1, `${k} Individual: Capturas 0.5, Ast 1, Solo 0, TFL 1`)
    ok(tab[k][1] === 0.5 && tab[k][2] === 4, `${k} SACKS: 0.5 sacks, 4 yds`)
  }
  ok(team.sacksMade === 1 && team.sacksYds === 8, 'equipo: 1 sack de 8 yds')
}
{
  const { ind, tab, team } = show('Sack de 8 yds compartido entre tres (#99, #31, #50)', [sack([Benton, Baker, Brown])])
  for (const k of ['#99', '#31', '#50']) {
    ok(ind[k].sacks === 0.5 && ind[k].ast === 1 && ind[k].tfl === 1, `${k} Individual: Capturas 0.5, Ast 1, TFL 1`)
    ok(tab[k][1] === 0.5 && tab[k][2] === 2.7, `${k} SACKS: 0.5 sacks, 2.7 yds (8/3)`)
  }
  ok(team.sacksMade === 1 && team.sacksYds === 8, 'equipo: 1 sack de 8 yds')
}
{
  const { ind, tab } = show('Juego: #99 un sack solo (7 yds) + uno compartido con #31 (8 yds)', [sack([Benton], pos(B, 47)), sack([Benton, Baker])])
  ok(ind['#99'].sacks === 1.5 && ind['#99'].solo === 1 && ind['#99'].ast === 1 && ind['#99'].tfl === 2, '#99 Individual: Capturas 1.5, Solo 1, Ast 1, TFL 2')
  ok(tab['#99'][1] === 1.5 && tab['#99'][2] === 11, '#99 SACKS: 1.5 sacks, 11 yds (7 + 4)')
  ok(ind['#31'].sacks === 0.5 && tab['#31'][1] === 0.5, '#31: 0.5')
}
{
  const { ind, tab } = show('tackle_by solo repite al que hizo el sack (como TC-03)', [sack([Benton])])
  ok(ind['#99'].sacks === 1 && ind['#99'].solo === 1 && ind['#99'].ast === 0 && tab['#99'][1] === 1 && tab['#99'][2] === 8, '#99: Capturas 1, Solo 1, SACKS 1 / 8 yds')
}
done()
