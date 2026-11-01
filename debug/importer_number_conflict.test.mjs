// Importer guard: same team + same number + another player_id already in that game → the row is
// blocked until the operator chooses (shared/stats-import.js). Synthetic data: see
// debug/helpers/duplicate_scenario.mjs. Run: node --test debug/importer_number_conflict.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rosterFullName } from '../shared/stats-lib.js'
import { parseStatsCsv, classifyStatsImport, findNumberConflicts, computeTeamTotals, planPlayerWrites } from '../shared/stats-import.js'
import { TA, TB, G_A, games, A25, A26, B_DROP, B_KEEP, H18, R8, stats, roster2026 } from './helpers/duplicate_scenario.mjs'

const existingMap = (omitPlayerIds = []) =>
  new Map(stats.filter(r => !omitPlayerIds.includes(r.player_id)).map(r => [`${r.game_id}|${r.player_id}`, r]))

function run(csv, { omit = [], choices = {} } = {}) {
  const parsed = parseStatsCsv(csv)
  assert.ok(!parsed.error, parsed.error)
  const ctx = {
    semana: '1', temporada: '2026', games,
    rostersByTeam: { [TA]: roster2026(TA), [TB]: roster2026(TB) },
    existing: { player: existingMap(omit), team: new Map() },
    choices: { players: {}, games: {}, conflicts: {}, ...choices },
  }
  return { parsed, ...classifyStatsImport(parsed.rows, ctx) }
}
// PDF names are "APELLIDOS NOMBRES".
const CASE_A_CSV = 'semana,equipo,nombre,pass_att,pass_comp,pass_yds,pass_td,pass_int,rush_att,rush_yds,rush_td\n1,TIGRES,BETA DELTA ALFA GAMMA,25,17,278,4,0,5,29,0\n'
const CASE_B_CSV = 'semana,equipo,nombre,rec,rec_yds,rec_td\n1,AZTECAS,DEL VEGA RIOS SOTO OMAR,3,20,0\n'

test('caso A (estado previo: solo existe la fila del id 2025) → conflict, no se escribe', () => {
  const { rows } = run(CASE_A_CSV, { omit: [A26.id] })
  assert.equal(rows[0].status, 'conflict')
  assert.equal(rows[0].player.id, A26.id)                       // el match del roster 2026
  assert.deepEqual(rows[0].conflicts.map(c => c.playerId), [A25.id])
  assert.match(rows[0].reason, /mismo número/)
  assert.match(rows[0].reason, /temporada 2025/)
  assert.equal(rows.filter(r => r.status === 'ok').length, 0)   // nada llega a planPlayerWrites
})

test('caso A: elegir "existing:<id 2025>" → actualiza esa fila (update, mismo player_id)', () => {
  const { rows, parsed } = run(CASE_A_CSV, { omit: [A26.id], choices: { conflicts: { 2: `existing:${A25.id}` } } })
  const r = rows[0]
  assert.equal(r.status, 'ok')
  assert.equal(r.player.id, A25.id)
  assert.equal(r.rosterPlayer.id, A26.id)
  assert.equal(r.kind, 'update')
  assert.equal(r.level, 'existing')
  assert.equal(r.nameSave.offer, false, 'no se ofrece nombre_completo para el jugador de otra temporada')
  const plan = planPlayerWrites([r], existingMap([A26.id]), parsed.statColumns)
  assert.equal(plan.length, 1)
  assert.equal(plan[0].kind, 'update')
  assert.equal(plan[0].rows[0].player_id, A25.id)
})

test('caso A: elegir "new" (es otra persona) → crea la fila del roster 2026', () => {
  const { rows } = run(CASE_A_CSV, { omit: [A26.id], choices: { conflicts: { 2: 'new' } } })
  assert.equal(rows[0].status, 'ok')
  assert.equal(rows[0].player.id, A26.id)
  assert.equal(rows[0].kind, 'new')
  assert.equal(rows[0].conflictChoice, 'new')
})

test('caso A: una elección inválida no desbloquea', () => {
  const { rows } = run(CASE_A_CSV, { omit: [A26.id], choices: { conflicts: { 2: 'existing:no-existe' } } })
  assert.equal(rows[0].status, 'conflict')
})

test('caso A: omitir la fila desde el selector también la saca del conflicto', () => {
  const { rows } = run(CASE_A_CSV, { omit: [A26.id], choices: { players: { 2: 'skip' } } })
  assert.equal(rows[0].status, 'skipped')
})

test('caso A (estado con las dos filas): un re-import también avisa, aunque la propia ya exista', () => {
  const { rows } = run(CASE_A_CSV)
  assert.equal(rows[0].status, 'conflict')
  assert.deepEqual(rows[0].conflicts.map(c => c.playerId), [A25.id])
})

test('caso B (estado previo: solo existe la fila del roster duplicado) → conflict', () => {
  const { rows } = run(CASE_B_CSV, { omit: [B_KEEP.id] })
  assert.equal(rows[0].status, 'conflict')
  assert.equal(rows[0].player.id, B_KEEP.id)
  assert.deepEqual(rows[0].conflicts.map(c => c.playerId), [B_DROP.id])
})

test('caso B: elegir "existing:<id duplicado>" → actualiza la fila existente', () => {
  const { rows } = run(CASE_B_CSV, { omit: [B_KEEP.id], choices: { conflicts: { 2: `existing:${B_DROP.id}` } } })
  assert.equal(rows[0].status, 'ok')
  assert.equal(rows[0].player.id, B_DROP.id)
  assert.equal(rows[0].kind, 'update')
})

test('sin conflicto: la propia fila del jugador (update normal) no es un conflicto', () => {
  // Solo existe la fila del jugador que conserva el roster: es la misma persona que el match → update limpio.
  const { rows } = run(CASE_B_CSV, { omit: [B_DROP.id] })
  assert.equal(rows[0].status, 'ok')
  assert.equal(rows[0].player.id, B_KEEP.id)
  assert.equal(rows[0].kind, 'update')
})

test('sin falso positivo: mismo apellido, número distinto y otra persona (#18 vs #8)', () => {
  assert.ok(stats.some(r => r.player_id === R8.id && r.game_id === G_A), 'el #8 tiene fila en el partido (condición del escenario)')
  const csv = `semana,equipo,nombre,rec,rec_yds\n1,TIGRES,${rosterFullName(H18).toUpperCase()},2,30\n`
  const { rows } = run(csv, { omit: [A25.id, A26.id] })
  assert.equal(rows[0].status, 'ok')
  assert.equal(rows[0].player.id, H18.id)
})

test('findNumberConflicts: solo cuenta el mismo partido, el mismo equipo y otro player_id', () => {
  const base = existingMap([A26.id])
  assert.equal(findNumberConflicts(base, G_A, TA, A26).length, 1)
  // otro partido
  assert.equal(findNumberConflicts(base, 'otro-partido', TA, A26).length, 0)
  // el rival con el mismo número no cuenta (otro equipo)
  const rival = new Map([['g|x', { game_id: G_A, player_id: 'x', player: { team_id: 'rival', number: 17 } }]])
  assert.equal(findNumberConflicts(rival, G_A, TA, A26).length, 0)
  // el mismo player_id no es conflicto
  const own = new Map([['g|own', { game_id: G_A, player_id: A26.id, player: { team_id: TA, number: 17 } }]])
  assert.equal(findNumberConflicts(own, G_A, TA, A26).length, 0)
  // filas sin join de jugador (esquema viejo) se ignoran
  assert.equal(findNumberConflicts(new Map([['g|y', { game_id: G_A, player_id: 'y' }]]), G_A, TA, A26).length, 0)
})

test('un conflicto sin resolver cuenta como fila pendiente en el total del equipo', () => {
  const csv = `semana,equipo,nombre,pass_yds\n1,TIGRES,BETA DELTA ALFA GAMMA,278\n1,TIGRES,${rosterFullName(H18).toUpperCase()},30\n`
  const { rows } = run(csv, { omit: [A26.id] })
  assert.equal(rows[0].status, 'conflict')
  assert.equal(rows[1].status, 'ok')
  const totals = computeTeamTotals(rows)
  assert.equal(totals.length, 1)
  assert.equal(totals[0].diff.pass_yds.new, 30, 'solo suma la fila ok')
  assert.ok(totals[0].warnings.some(w => /sin resolver/.test(w)), 'avisa que el total está incompleto')
})
