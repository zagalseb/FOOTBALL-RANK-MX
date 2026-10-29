// Unit tests for shared/stats-import.js (weekly stats CSV import).
// Run: node --test debug/stats_import.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseStatsCsv, weekMismatches, findTeamGame, classifyStatsImport, computeTeamTotals,
  buildPlayerPayload, buildTeamPayload, PDF_TEAM_LABELS,
} from '../shared/stats-import.js'

const MTY = PDF_TEAM_LABELS.MTY, CEM = PDF_TEAM_LABELS.CEM, PUE = PDF_TEAM_LABELS.PUE
const OPP = 'opp-team', OPP2 = 'opp-team-2'
const P = (id, team, number, apellido, nombre, nombre_completo = null) => ({ id, team_id: team, number, apellido, nombre, nombre_completo })
const G = (id, home, away, semana = '3', extra = {}) => ({ id, home_team_id: home, away_team_id: away, semana, temporada: null, kickoff: '2026-09-19T18:00:00Z', ...extra })

const rosters = {
  [MTY]: [
    P('m1', MTY, 14, 'Tonda', 'Fernando', 'Fernando Tonda Urias'),
    P('m2', MTY, 81, 'Garza', 'Rodrigo', 'Rodrigo Garza Martinez'),
    P('m3', MTY, 98, 'Garza', 'Rodrigo', 'Rodrigo Garza Martínez'),
    P('m4', MTY, 2, 'Palacios', 'Victor'),
    P('m5', MTY, 82, 'Michael', 'Benjamin'),
  ],
  [CEM]: [P('c1', CEM, 80, 'Urtusuastegui', 'Alejandro', 'Alejandro Urtusuastegui Guerrero')],
  [PUE]: [],
}
const ctx = (over = {}) => ({
  semana: '3', temporada: '2026',
  games: [G('g1', MTY, OPP), G('g2', CEM, OPP2)],
  rostersByTeam: rosters, existing: { player: new Map(), team: new Map() }, choices: {},
  ...over,
})
const csv = (...lines) => lines.join('\n')
const parse = (...lines) => parseStatsCsv(csv(...lines))
const run = (rows, over) => classifyStatsImport(rows, ctx(over))

// ── parser ──
test('parse: columnas, celda vacía = no tocar, 0 explícito = 0, negativos', () => {
  const r = parse('semana,equipo,nombre,rec,rec_yds,rush_yds,rec_td', '3,MTY,TONDA URIAS FERNANDO,4,,-3,0')
  assert.deepEqual(r.rows[0].stats, { rec: 4, rush_yds: -3, rec_td: 0 })
  assert.equal('rec_yds' in r.rows[0].stats, false)
  assert.deepEqual(r.statColumns, ['rush_yds', 'rec', 'rec_yds', 'rec_td'].sort((a, b) => ['rush_yds','rec','rec_yds','rec_td'].indexOf(a) - ['rush_yds','rec','rec_yds','rec_td'].indexOf(b)))
  assert.equal(r.rows[0].line, 2)
})

test('parse: BOM, comillas, equipo en minúsculas, semana normalizada', () => {
  const r = parseStatsCsv('﻿semana,equipo,nombre,rec\n qf ,b blancos,"RIVERA GARDUÑO, ALAN",2')
  assert.equal(r.rows[0].semana, 'QF')
  assert.equal(r.rows[0].equipo, 'B BLANCOS')
  assert.equal(r.rows[0].nombre, 'RIVERA GARDUÑO, ALAN')
})

test('parse: errores de archivo y de fila', () => {
  assert.match(parse('equipo,nombre,rec', 'MTY,X,1').error, /semana/)
  assert.match(parse('semana,equipo,nombre', '3,MTY,X').error, /ninguna columna de stats/)
  assert.match(parseStatsCsv('').error, /vacío/)
  const r = parse('semana,equipo,nombre,rec,rec_yds', '3,MTY,X,1.5,abc', '3,,Y,1,1')
  assert.equal(r.rows[0].errors.length, 2)
  assert.deepEqual(r.rows[1].errors, ['Equipo vacío'])
})

test('parse: columnas desconocidas se reportan; jersey es opcional (pista)', () => {
  const r = parse('semana,equipo,nombre,jersey,rec,foo', '3,MTY,X,14,1,9')
  assert.deepEqual(r.unknownColumns, ['foo'])
  assert.equal(r.rows[0].jersey, 14)
  assert.equal(r.hasJersey, true)
  assert.equal(parse('semana,equipo,nombre,rec', '3,MTY,X,1').hasJersey, false)
  assert.match(parse('semana,equipo,nombre,jersey,rec', '3,MTY,X,abc,1').rows[0].errors[0], /jersey/)
})

// ── semana ──
test('weekMismatches: bloquea filas con otra semana o vacía', () => {
  const r = parse('semana,equipo,nombre,rec', '3,MTY,A,1', '2,MTY,B,1', ',MTY,C,1')
  assert.deepEqual(weekMismatches(r.rows, '3'), [{ line: 3, semana: '2' }, { line: 4, semana: '' }])
  assert.deepEqual(weekMismatches(r.rows.slice(0, 1), '3'), [])
})

// ── partido por equipo ──
test('findTeamGame: uno, descanso, varios, temporada por kickoff', () => {
  const games = [G('a', MTY, OPP), G('b', OPP, CEM), G('c', MTY, OPP2), G('t', MTY, OPP, 'TEST'), G('o', MTY, OPP, '3', { kickoff: '2025-09-19T18:00:00Z' })]
  assert.equal(findTeamGame(CEM, games, '3', '2026').game.id, 'b')
  assert.equal(findTeamGame(PUE, games, '3', '2026').status, 'none')
  const m = findTeamGame(MTY, games, '3', '2026')
  assert.equal(m.status, 'multiple')
  assert.deepEqual(m.games.map(g => g.id), ['a', 'c'])
  assert.equal(findTeamGame(MTY, games, '3', '2025').game.id, 'o')
  assert.equal(findTeamGame(MTY, [G('x', MTY, OPP, '3', { temporada: '2026-QA2' })], '3', '2026').status, 'none')
})

// ── clasificación ──
const rowsOf = (...lines) => parse('semana,equipo,nombre,jersey,rec,rec_yds', ...lines).rows

test('classify: exact por orden invertido, approx ofrece nombre_completo marcado', () => {
  const { rows } = run(rowsOf('3,MTY,TONDA URIAS FERNANDO,14,4,50', '3,MTY,PALACIOS MARTINEZ VICTOR,2,1,10'))
  assert.equal(rows[0].status, 'ok'); assert.equal(rows[0].level, 'exact'); assert.equal(rows[0].nameSave.offer, false)
  assert.equal(rows[1].level, 'approx'); assert.equal(rows[1].player.id, 'm4')
  assert.deepEqual(rows[1].nameSave, { offer: true, default: true, conflict: false })
})

test('classify: approx con nombre_completo distinto → conflicto, desmarcado, nunca sobrescribe en silencio', () => {
  const rs = { ...rosters, [MTY]: [P('m1', MTY, 14, 'Tonda', 'Fernando', 'Fernando Tonda Otro')] }
  const { rows } = run(rowsOf('3,MTY,TONDA URIAS FERNANDO,14,4,50'), { rostersByTeam: rs })
  assert.equal(rows[0].level, 'approx')
  assert.deepEqual(rows[0].nameSave, { offer: true, default: false, conflict: true })
})

test('classify: ambiguous usa el jersey solo como pista; none también', () => {
  const { rows } = run(rowsOf('3,MTY,GARZA MARTINEZ RODRIGO,81,1,1', '3,MTY,LAX BENJAMIN MICHAEL,82,1,1', '3,MTY,NADIE NUNCA,99,1,1'))
  assert.equal(rows[0].status, 'ambiguous'); assert.equal(rows[0].candidates.length, 2); assert.equal(rows[0].hint.id, 'm2')
  assert.equal(rows[1].status, 'none'); assert.equal(rows[1].hint.id, 'm5')
  assert.equal(rows[2].status, 'none'); assert.equal(rows[2].hint, null)
})

test('classify: sin jersey no hay pista y no se elige al azar', () => {
  const { rows } = run(parse('semana,equipo,nombre,rec', '3,MTY,GARZA MARTINEZ RODRIGO,1').rows)
  assert.equal(rows[0].status, 'ambiguous'); assert.equal(rows[0].hint, null)
})

test('classify: elección manual resuelve ambiguous y none; skip omite', () => {
  const rows = rowsOf('3,MTY,GARZA MARTINEZ RODRIGO,81,1,1', '3,MTY,LAX BENJAMIN MICHAEL,82,1,1', '3,MTY,NADIE NUNCA,99,1,1')
  const r = run(rows, { choices: { players: { 2: 'm3', 3: 'm5', 4: 'skip' } } }).rows
  assert.equal(r[0].status, 'ok'); assert.equal(r[0].level, 'manual'); assert.equal(r[0].player.id, 'm3')
  assert.deepEqual(r[1].nameSave, { offer: true, default: true, conflict: false })
  assert.equal(r[2].status, 'skipped')
  const bad = run(rows, { choices: { players: { 2: 'cualquiera' } } }).rows[0]
  assert.equal(bad.status, 'error')
})

test('classify: descanso, equipo sin roster, equipo desconocido, fila con error', () => {
  const { rows } = run(parse('semana,equipo,nombre,rec', '3,CEM,X,1', '3,PUE,X,1', '3,XXX,X,1', '3,MTY,X,abc').rows, { games: [G('g1', MTY, OPP)] })
  assert.equal(rows[0].status, 'rest')
  assert.equal(rows[1].status, 'noroster')
  assert.equal(rows[2].status, 'error'); assert.match(rows[2].reason, /desconocido/)
  assert.equal(rows[3].status, 'error')
})

test('classify: dos partidos del mismo equipo piden elegir', () => {
  const games = [G('a', MTY, OPP), G('c', MTY, OPP2)]
  const rows = rowsOf('3,MTY,TONDA URIAS FERNANDO,14,4,50')
  assert.equal(run(rows, { games }).rows[0].status, 'pickgame')
  const r = run(rows, { games, choices: { games: { [MTY]: 'c' } } }).rows[0]
  assert.equal(r.status, 'ok'); assert.equal(r.gameId, 'c')
})

test('classify: dos filas del CSV para el mismo jugador → ambas duplicate', () => {
  const { rows, summary } = run(rowsOf('3,MTY,TONDA URIAS FERNANDO,14,4,50', '3,MTY,TONDA FERNANDO,14,2,20', '3,CEM,URTUSUASTEGUI GUERRERO ALEJANDRO,80,1,1'))
  assert.equal(rows[0].status, 'duplicate'); assert.equal(rows[1].status, 'duplicate')
  assert.match(rows[0].reason, /2 y 3/)
  assert.equal(rows[2].status, 'ok')
  assert.deepEqual(summary, { duplicate: 2, ok: 1 })
})

test('classify: diff viejo/nuevo, new vs update, jersey en desacuerdo', () => {
  const existing = { player: new Map([['g1|m1', { rec: 1, rec_yds: 10, pass_att: 7 }]]), team: new Map() }
  const { rows } = run(rowsOf('3,MTY,TONDA URIAS FERNANDO,99,4,'), { existing })
  assert.equal(rows[0].kind, 'update')
  assert.deepEqual(rows[0].diff, { rec: { old: 1, new: 4 } })        // rec_yds vacío: no se toca
  assert.deepEqual(rows[0].jerseyMismatch, { csv: 99, roster: 14 })
  const fresh = run(rowsOf('3,MTY,TONDA URIAS FERNANDO,14,0,'), {}).rows[0]
  assert.equal(fresh.kind, 'new'); assert.deepEqual(fresh.diff, { rec: { old: null, new: 0 } }) // 0 explícito se escribe
})

// ── payloads y totales ──
test('payload: solo columnas con valor, nunca las ausentes', () => {
  const r = run(parse('semana,equipo,nombre,rec,pass_att', '3,MTY,TONDA URIAS FERNANDO,4,').rows).rows[0]
  assert.deepEqual(buildPlayerPayload(r), { game_id: 'g1', player_id: 'm1', rec: 4 })
})

test('totales de equipo: suma de ok, total_yds solo con pass y rush, pendientes avisan', () => {
  const rs = parse('semana,equipo,nombre,pass_yds,rush_yds', '3,MTY,TONDA URIAS FERNANDO,100,5', '3,MTY,PALACIOS VICTOR,0,-2', '3,MTY,NADIE NUNCA,50,50').rows
  const { rows } = run(rs)
  const [t] = computeTeamTotals(rows, new Map([['g1|' + MTY, { pass_yds: 300, rush_yds: 3, total_yds: 0 }]]))
  assert.deepEqual(t.diff, { pass_yds: { old: 300, new: 100 }, rush_yds: { old: 3, new: 3 }, total_yds: { old: 0, new: 103 } })
  assert.equal(t.kind, 'update')
  assert.ok(t.warnings.some(w => /pass_yds/.test(w)))
  assert.ok(t.warnings.some(w => /sin resolver/.test(w)))
  assert.deepEqual(buildTeamPayload(t), { game_id: 'g1', team_id: MTY, pass_yds: 100, rush_yds: 3, total_yds: 103 })
  assert.deepEqual(buildTeamPayload(t, ['pass_yds']), { game_id: 'g1', team_id: MTY, pass_yds: 100 })
})

test('totales de equipo: sin columnas de yardas no hay totales; total_yds exige ambas', () => {
  assert.deepEqual(computeTeamTotals(run(parse('semana,equipo,nombre,rec', '3,MTY,TONDA URIAS FERNANDO,4').rows).rows), [])
  const [t] = computeTeamTotals(run(parse('semana,equipo,nombre,rush_yds', '3,MTY,TONDA URIAS FERNANDO,7').rows).rows)
  assert.deepEqual(Object.keys(t.diff), ['rush_yds'])
})
