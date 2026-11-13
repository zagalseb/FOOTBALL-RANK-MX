// Gol de campo en advanceGameState + applyFlags: spot y posesión del play siguiente.
// Sin red: jugadas armadas en memoria, mismo arranque de estado que
// deriveNextPlayContext (engine.js) y computeScoringPlays (viewer.html).
// Uso: node debug/verify_individual/fg_spot.mjs [ruta stats-lib.js] [--antes ruta stats-lib.js]
//   --antes: compara además los FG bloqueados contra otra versión (deben dar lo mismo).
import { loadLib, ok, done } from './common.mjs'

const args = process.argv.slice(2)
const iAntes = args.indexOf('--antes')
const antesPath = iAntes >= 0 ? args[iAntes + 1] : null
const L = await loadLib(args.find((x, i) => !x.startsWith('--') && (iAntes < 0 || i !== iAntes + 1)))
const Lantes = antesPath ? await loadLib(antesPath) : null

const K = 'AT', R = 'MTY' // K patea (visitante), R recibe (local)
const teams = { home: { name: R }, away: { name: K } }
const fp = p => p ? `${p.team} ${p.yard}` : '—'

function fg(extra) {
  return { play_type: 'KICK', kick_type: 'field_goal', possession: K, quarter: 2, clock: '5:00',
    down: 4, distance: 6, field_pos: { team: R, yard: 25 }, score_home: 7, score_away: 10, ...extra }
}
function next(play, lib = L) {
  const st = { quarter: play.quarter, clock: play.clock, possession: play.possession,
    field_pos: play.field_pos ? { ...play.field_pos } : null, down: play.down, distance: play.distance,
    score: { home: play.score_home, away: play.score_away } }
  lib.advanceGameState(st, play, teams)
  lib.applyFlags(st, play, teams)
  return st
}
const pts = st => `${st.score.away}-${st.score.home}`

console.log('\nFG bueno')
{
  const st = next(fg({ fg_result: 'good' }))
  ok(st.score.away === 13 && st.score.home === 7, `suma 3 al que patea: 10-7 → ${pts(st)}`)
  ok(st.possession === K, `posesión se queda con ${K}: ${st.possession}`)
  ok(st.field_pos.team === K && st.field_pos.yard === 35, `kickoff en su propia 35: ${fp(st.field_pos)}`)
  ok(st.down === 0 && st.distance === 0, `down 0: ${st.down}/${st.distance}`)
}

console.log('\nFG fallado: snap en la yarda N del rival')
for (const y of [35, 30, 25, 20, 19, 15, 5]) {
  const st = next(fg({ fg_result: 'missed', fg_miss_type: 'wide_left', field_pos: { team: R, yard: y } }))
  const exp = y < 20 ? 20 : y
  ok(st.possession === R && st.field_pos.team === R && st.field_pos.yard === exp && st.down === 1 && st.distance === 10,
    `snap ${R} ${y} → ${R} 1ro y 10 en su ${exp}${y < 20 ? ' (dentro de la 20)' : ' (spot del snap)'}: ${st.possession} @ ${fp(st.field_pos)} ${st.down}&${st.distance}`)
}
{
  // Snap en campo propio (FG de 60+): el spot previo es el del snap.
  const st = next(fg({ fg_result: 'missed', field_pos: { team: K, yard: 45 } }))
  ok(st.possession === R && st.field_pos.team === K && st.field_pos.yard === 45, `snap ${K} 45 (campo propio) → ${R} en ${K} 45: ${fp(st.field_pos)}`)
}

console.log('\nFG bueno anulado por bandera aceptada (spot previo)')
{
  // Offside de la defensa, se repite el down 5 yardas adelante.
  const play = fg({ fg_result: 'good', flag_1_infraction: 'Offside', flag_1_team: R, flag_1_result: 'accepted',
    flag_1_enforced: 'previous', flag_1_down_result: 'repeat_down', flag_1_new_los: { team: R, yard: 20 } })
  ok(L.flagOutcome(play)?.voided === true, 'flagOutcome: anulada')
  const st = next(play)
  ok(st.score.away === 10 && st.score.home === 7, `no suma puntos: ${pts(st)}`)
  ok(st.possession === K, `posesión sigue con ${K}: ${st.possession}`)
  ok(st.field_pos.team === R && st.field_pos.yard === 20 && st.down === 4 && st.distance === 1,
    `applyFlags: se repite 4to down desde ${R} 20 (4&6 − 5 yds = 4&1): ${fp(st.field_pos)} ${st.down}&${st.distance}`)
}
{
  // Falta de la ofensiva (holding), se repite el down 10 atrás.
  const play = fg({ fg_result: 'good', flag_1_infraction: 'Holding', flag_1_team: K, flag_1_result: 'accepted',
    flag_1_enforced: 'previous', flag_1_down_result: 'repeat_down', flag_1_new_los: { team: R, yard: 35 } })
  const st = next(play)
  ok(st.score.away === 10 && st.possession === K && st.field_pos.yard === 35 && st.down === 4 && st.distance === 16,
    `holding de ${K}: sin puntos, 4&16 en ${R} 35: ${pts(st)} ${st.possession} @ ${fp(st.field_pos)} ${st.down}&${st.distance}`)
}
{
  const play = fg({ fg_result: 'missed', flag_1_infraction: 'Offside', flag_1_team: R, flag_1_result: 'accepted',
    flag_1_enforced: 'previous', flag_1_down_result: 'repeat_down', flag_1_new_los: { team: R, yard: 20 } })
  const st = next(play)
  ok(st.possession === K && st.field_pos.yard === 20 && st.down === 4, `FG fallado anulado: ${K} conserva el balón, 4to down en ${R} 20: ${st.possession} @ ${fp(st.field_pos)} ${st.down}&${st.distance}`)
}

console.log('\nFG bueno con bandera declinada')
{
  const play = fg({ fg_result: 'good', flag_1_infraction: 'Offside', flag_1_team: R, flag_1_result: 'declined',
    flag_1_enforced: 'previous', flag_1_down_result: 'repeat_down', flag_1_new_los: { team: R, yard: 20 } })
  const st = next(play)
  ok(st.score.away === 13 && st.possession === K && st.field_pos.team === K && st.field_pos.yard === 35 && st.down === 0,
    `suma 3 y kickoff en ${K} 35: ${pts(st)} ${st.possession} @ ${fp(st.field_pos)} down ${st.down}`)
}

console.log('\nFG bloqueado (sin cambios)')
const blocked = [
  ['downed en R 32', fg({ fg_result: 'blocked', fg_recovery_team: R, fg_recovered_at: { team: R, yard: 32 }, fg_return_result: 'downed' }),
    st => st.possession === R && st.field_pos.team === R && st.field_pos.yard === 32 && st.down === 1 && st.score.home === 7],
  ['regresado a K 40', fg({ fg_result: 'blocked', fg_recovery_team: R, fg_recovered_at: { team: R, yard: 30 }, fg_return_result: 'returned', fg_ret_result: 'tackle', fg_ret_at: { team: K, yard: 40 } }),
    st => st.possession === R && st.field_pos.team === K && st.field_pos.yard === 40 && st.down === 1],
  ['regresado para TD', fg({ fg_result: 'blocked', fg_recovery_team: R, fg_recovered_at: { team: R, yard: 30 }, fg_return_result: 'returned', fg_ret_result: 'td', fg_ret_at: { team: K, yard: 0 } }),
    st => st.possession === R && st.score.home === 13 && st.down === 0],
  ['recuperado por K (fg_recovery_team ignorado, limitación conocida)', fg({ fg_result: 'blocked', fg_recovery_team: K, fg_recovered_at: { team: R, yard: 31 }, fg_return_result: 'downed' }),
    st => st.possession === R && st.field_pos.yard === 31],
]
for (const [name, play, check] of blocked) {
  const st = next(play)
  ok(check(st), `${name}: ${st.possession} @ ${fp(st.field_pos)} ${st.down}&${st.distance} · ${pts(st)}`)
  if (Lantes) {
    const prev = next(play, Lantes)
    ok(JSON.stringify(prev) === JSON.stringify(st), `   = versión anterior`)
  }
}

done()
