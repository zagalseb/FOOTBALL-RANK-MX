// Pruebas de los adaptadores de la pestaña Individual para juegos con captura
// manual (viewer.html, isManualOnly). Solo importa shared/stats-lib.js (no usa
// `location`, así que corre en Node sin simular el navegador).
// Run: node --test debug/manual_individual.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  manualIndOffense, manualIndDefense, manualIndSpecialTeams, manualIndSpecialTeamsHasData,
  manualTeamStatRows, fmtManualHalf, fmtSignedYds, _passerRating,
} from '../shared/stats-lib.js'

const A = 'team-a', B = 'team-b'
const P = (id, team_id, number, nombre, apellido) => ({ id, team_id, number, nombre, apellido })
const S = (player, o = {}) => ({ game_id: 'g1', player_id: player.id, player, ...o })

const qb1 = P('qb1', A, 12, 'Juan', 'Molina')
const qb2 = P('qb2', A, 5, 'Pedro', 'Sosa')
const rb  = P('rb',  A, 22, 'Ana', 'Lopez')
const wr  = P('wr',  A, 81, 'Mario', 'Ruiz')
const lb  = P('lb',  A, 44, 'Luis', 'Paz')
const dl  = P('dl',  A, 90, 'Raúl', 'Gil')
const ol  = P('ol',  A, 70, 'Sin', 'Stats')
const opp = P('opp', B, 1, 'Otro', 'Equipo')

const ROWS = [
  S(qb2, { pass_comp: 2, pass_att: 5, pass_yds: 20, pass_td: 0, pass_int: 1 }),
  S(qb1, { pass_comp: 15, pass_att: 25, pass_yds: 210, pass_td: 2, pass_int: 0, rush_att: 4, rush_yds: -12 }),
  S(rb,  { rush_att: 18, rush_yds: 95, rush_td: 1, rec: 2, rec_yds: 11 }),
  S(wr,  { rec: 6, rec_yds: 120, rec_td: 2 }),
  S(lb,  { tackles: 9.5, tfl: 1.5, sacks: 0.5, ff: 1 }),
  S(dl,  { tackles: 4, tfl: 2, sacks: 2, fum_rec: 1, ints: 1 }),
  S(ol,  {}),
  S(opp, { pass_comp: 30, pass_att: 40, pass_yds: 400, tackles: 12 }),
]

test('ofensiva: filtra por team_id, solo jugadores con actividad', () => {
  const d = manualIndOffense(ROWS, A)
  assert.deepEqual(d.passing.map(r => r.label), ['#12 J. Molina', '#5 P. Sosa'])
  assert.deepEqual(d.rushing.map(r => r.label), ['#22 A. Lopez', '#12 J. Molina'])
  assert.deepEqual(d.receiving.map(r => r.label), ['#81 M. Ruiz', '#22 A. Lopez'])
  const all = [...d.passing, ...d.rushing, ...d.receiving].map(r => r.label)
  assert.ok(!all.includes('#1 O. Equipo'))
  assert.ok(!all.includes('#70 S. Stats'))
})

test('ofensiva: pase con rating NCAA, % y orden por yardas', () => {
  const [p] = manualIndOffense(ROWS, A).passing
  assert.equal(p.comp, 15); assert.equal(p.att, 25); assert.equal(p.int, 0)
  assert.equal(p.yds, 210); assert.equal(p.td, 2)
  assert.equal(p.pct, 60)
  assert.equal(p.rating, _passerRating(15, 25, 210, 2, 0))
  assert.equal(p.rating.toFixed(1), '157.0')
})

test('ofensiva: carrera negativa y promedios', () => {
  const d = manualIndOffense(ROWS, A)
  const qbRush = d.rushing.find(r => r.label === '#12 J. Molina')
  assert.equal(qbRush.yds, -12); assert.equal(qbRush.avg, -3)
  assert.equal(fmtSignedYds(qbRush.yds), '−12')
  assert.equal(fmtSignedYds(qbRush.avg, 1), '−3.0')
  const wrRec = d.receiving[0]
  assert.equal(wrRec.rec, 6); assert.equal(wrRec.yds, 120); assert.equal(wrRec.avg, 20); assert.equal(wrRec.td, 2)
})

test('ofensiva: sin filas → arreglos vacíos', () => {
  assert.deepEqual(manualIndOffense([], A), { passing: [], receiving: [], rushing: [] })
  assert.deepEqual(manualIndOffense(undefined, A), { passing: [], receiving: [], rushing: [] })
})

test('defensiva: una tabla, orden por tackles desc, solo con actividad', () => {
  const rows = manualIndDefense(ROWS, A)
  assert.deepEqual(rows.map(r => r.label), ['#44 L. Paz', '#90 R. Gil'])
  assert.deepEqual(
    { tackles: rows[0].tackles, tfl: rows[0].tfl, sacks: rows[0].sacks, ff: rows[0].ff, fum_rec: rows[0].fum_rec, ints: rows[0].ints },
    { tackles: 9.5, tfl: 1.5, sacks: 0.5, ff: 1, fum_rec: 0, ints: 0 })
  assert.equal(rows[1].fum_rec, 1); assert.equal(rows[1].ints, 1)
  assert.ok(!('solo' in rows[0]) && !('ast' in rows[0]))
})

test('defensiva: numéricos que llegan como texto (numeric de Postgres)', () => {
  const rows = manualIndDefense([S(lb, { tackles: '3.5', tfl: '0', sacks: '1' })], A)
  assert.equal(rows[0].tackles, 3.5); assert.equal(rows[0].sacks, 1)
})

test('fmtManualHalf: decimal solo si no es entero', () => {
  assert.equal(fmtManualHalf(9.5), '9.5')
  assert.equal(fmtManualHalf(4), '4')
  assert.equal(fmtManualHalf(0), '0')
  assert.equal(fmtManualHalf(null), '0')
})

test('fmtSignedYds: positivos, cero y negativos', () => {
  assert.equal(fmtSignedYds(95), '95')
  assert.equal(fmtSignedYds(0), '0')
  assert.equal(fmtSignedYds(-0.01, 1), '0.0')
  assert.equal(fmtSignedYds(5.27, 1), '5.3')
})

test('especiales: vacío por ahora y sin datos', () => {
  const st = manualIndSpecialTeams(ROWS, A)
  assert.deepEqual(st, { kicking: [], kickoffs: [], punting: [], kickReturns: [], puntReturns: [] })
  assert.equal(manualIndSpecialTeamsHasData(st), false)
  assert.equal(manualIndSpecialTeamsHasData({ ...st, punting: [{ label: '#9' }] }), true)
})

test('equipo: filas Away | Home con pares y tiempo de posesión', () => {
  const team = [
    { team_id: A, first_downs: 18, total_yds: 420, pass_yds: 230, rush_yds: 190, penalties: 6, penalty_yds: 55,
      third_down_conv: 5, third_down_att: 12, fourth_down_conv: 1, fourth_down_att: 2, red_zone_td: 3, red_zone_trips: 4,
      turnovers: 1, fumbles: 2, fumbles_lost: 1, sacks: 2.5, tfl: 6, time_of_possession_sec: 1935 },
    { team_id: B, first_downs: 10, total_yds: 200, pass_yds: 250, rush_yds: -50 },
  ]
  const rows = manualTeamStatRows(team, A, B)
  const by = Object.fromEntries(rows.map(r => [r.label, r]))
  assert.deepEqual(rows.map(r => r.label), [
    'First Downs', 'Total Yds', 'Pass Yds', 'Rush Yds', 'Penalties - Yds', '3rd Down', '4th Down',
    'Red Zone (TD-Trips)', 'Turnovers', 'Fumbles - Lost', 'Sacks', 'TFL', 'Time of Possession',
  ])
  assert.deepEqual(by['Penalties - Yds'], { label: 'Penalties - Yds', away: '6-55', home: '0-0' })
  assert.equal(by['3rd Down'].away, '5-12')
  assert.equal(by['4th Down'].away, '1-2')
  assert.equal(by['Red Zone (TD-Trips)'].away, '3-4')
  assert.equal(by['Fumbles - Lost'].away, '2-1')
  assert.equal(by['Sacks'].away, '2.5')
  assert.equal(by['Rush Yds'].home, '−50')
  assert.equal(by['Time of Possession'].away, '32:15')
  assert.equal(by['Time of Possession'].home, '—')
})

test('equipo: sin fila de un equipo → ceros, no truena', () => {
  const rows = manualTeamStatRows([], A, B)
  assert.equal(rows.find(r => r.label === 'First Downs').away, '0')
})
