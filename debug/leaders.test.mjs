// Unit tests for the season-leaders functions in shared/stats-lib.js (viewer/leaders.html).
// Run: node --test debug/leaders.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  selectLeaderGames, dedupStatRows, buildLeaders, rankLeaders, fetchAllRows,
  LEADER_MIN_PER_TEAM_GAME, _passerRating,
} from '../shared/stats-lib.js'

const A = 'team-a', B = 'team-b', C = 'team-c', D = 'team-d'
const TEAMS = new Map([[A, { abreviatura: 'AAA' }], [B, { abreviatura: 'BBB' }], [C, { abreviatura: 'CCC' }], [D, { abreviatura: 'DDD' }]])
const G = (id, semana, home, away, extra = {}) =>
  ({ id, semana, home_team_id: home, away_team_id: away, status: 'final', temporada: null, kickoff: '2026-09-05T18:00:00Z', ...extra })
const P = (id, team_id, number, nombre, apellido) => ({ id, team_id, number, nombre, apellido })
const S = (game_id, player, o = {}) => ({ game_id, player_id: player.id, player, ...o })

const qbA = P('qbA', A, 12, 'Juan', 'Molina')
const qbB = P('qbB', B, 7, 'Luis', 'Perez')
const rbA = P('rbA', A, 22, 'Ana', 'Lopez')
const wrB = P('wrB', B, 81, 'Mario', 'Ruiz')

// ── selectLeaderGames ───────────────────────────────────────────────────────

test('selectLeaderGames: solo final, sin TEST, temporada por getGameTemporada', () => {
  const games = [
    G('g1', '1', A, B),                                    // kickoff 2026 → entra
    G('g2', '2', A, B, { status: 'scheduled' }),           // no final
    G('g3', '3', A, B, { status: 'live' }),                // no final
    G('g4', 'TEST', A, B),                                 // TEST
    G('g5', '5', A, B, { kickoff: '2025-09-05T18:00:00Z' }), // 2025 por kickoff
    G('g6', '6', A, B, { temporada: '2025', kickoff: '2026-10-01T00:00:00Z' }), // temporada explícita gana
    G('g7', '7', A, B, { temporada: '2026', kickoff: null }),
    G('g8', null, A, B),                                   // sin semana: entra en "Todas"
  ]
  assert.deepEqual(selectLeaderGames(games, { temporada: '2026' }).map(g => g.id), ['g1', 'g7', 'g8'])
  assert.deepEqual(selectLeaderGames(games, { temporada: 2026, semana: '1' }).map(g => g.id), ['g1'])
  assert.deepEqual(selectLeaderGames(games, { temporada: '2025' }).map(g => g.id), ['g5', 'g6'])
})

test('selectLeaderGames: filtro de equipo (local o visitante)', () => {
  const games = [G('g1', '1', A, B), G('g2', '2', C, A), G('g3', '3', C, D)]
  assert.deepEqual(selectLeaderGames(games, { temporada: '2026', teamId: A }).map(g => g.id), ['g1', 'g2'])
})

// ── dedupStatRows ───────────────────────────────────────────────────────────

test('dedupStatRows: una fila por (game_id, player_id); gana el updated_at más reciente', () => {
  const r1 = { game_id: 'g1', player_id: 'p', pass_yds: 10, updated_at: '2026-10-01' }
  const r2 = { game_id: 'g1', player_id: 'p', pass_yds: 99, updated_at: '2026-10-02' }
  const r3 = { game_id: 'g2', player_id: 'p', pass_yds: 5 }
  const out = dedupStatRows([r1, r2, r3])
  assert.equal(out.duplicates, 1)
  assert.equal(out.rows.length, 2)
  assert.equal(out.rows.find(r => r.game_id === 'g1').pass_yds, 99)
  assert.equal(dedupStatRows([r2, r1]).rows.find(r => r.game_id === 'g1').pass_yds, 99)
})

test('buildLeaders: una fila duplicada no se suma dos veces', () => {
  const games = [G('g1', '1', A, B)]
  const row = S('g1', qbA, { pass_att: 20, pass_comp: 10, pass_yds: 150 })
  const r = buildLeaders(games, [row, { ...row }], { temporada: '2026' })
  assert.equal(r.duplicates, 1)
  assert.equal(r.players.pass[0].yds, 150)
  assert.equal(r.players.pass[0].gp, 1)
})

// ── agregación ──────────────────────────────────────────────────────────────

test('buildLeaders: suma por player_id y calcula derivados con los totales acumulados', () => {
  const games = [G('g1', '1', A, B), G('g2', '2', B, A)]
  const rows = [
    S('g1', qbA, { pass_att: 20, pass_comp: 10, pass_yds: 100, pass_td: 1, pass_int: 1 }),
    S('g2', qbA, { pass_att: 30, pass_comp: 24, pass_yds: 300, pass_td: 3, pass_int: 0 }),
  ]
  const q = buildLeaders(games, rows, { temporada: '2026' }).players.pass[0]
  assert.deepEqual([q.gp, q.att, q.comp, q.yds, q.td, q.int], [2, 50, 34, 400, 4, 1])
  assert.equal(q.ypa, 8)
  assert.equal(q.ypg, 200)
  assert.equal(q.pct, 68)
  // rating sobre totales, NO el promedio de los ratings por partido
  assert.equal(q.rating, _passerRating(34, 50, 400, 4, 1))
  const avgOfRatings = (_passerRating(10, 20, 100, 1, 1) + _passerRating(24, 30, 300, 3, 0)) / 2
  assert.notEqual(q.rating, avgOfRatings)
})

test('buildLeaders: dos jugadores con el mismo nombre y equipo (otro id) no se mezclan', () => {
  const g1 = P('x1', A, 10, 'Rene', 'Molina'), g2 = P('x2', A, 11, 'Rene', 'Molina')
  const games = [G('g1', '1', A, B)]
  const r = buildLeaders(games, [S('g1', g1, { rush_att: 5, rush_yds: 20 }), S('g1', g2, { rush_att: 3, rush_yds: 9 })], { temporada: '2026', teams: TEAMS })
  assert.equal(r.players.rush.length, 2)
  assert.deepEqual(r.players.rush.map(p => p.yds).sort((a, b) => a - b), [9, 20])
  assert.deepEqual(r.players.rush.map(p => p.label).sort(), ['#10 R. Molina · AAA', '#11 R. Molina · AAA'])
})

test('buildLeaders: mismo nombre en equipos distintos → etiquetas con equipo y número', () => {
  const a = P('h1', A, 5, 'Luis', 'Perez'), b = P('h2', B, 5, 'Luis', 'Perez')
  const r = buildLeaders([G('g1', '1', A, B)], [S('g1', a, { rec: 3, rec_yds: 30 }), S('g1', b, { rec: 2, rec_yds: 20 })], { temporada: '2026', teams: TEAMS })
  assert.deepEqual(r.players.rec.map(p => p.label).sort(), ['#5 L. Perez · AAA', '#5 L. Perez · BBB'])
})

test('buildLeaders: GP por categoría — un RB que lanzó una vez no tiene GP de QB en otros juegos', () => {
  const games = [G('g1', '1', A, B), G('g2', '2', A, B), G('g3', '3', A, B)]
  const rows = [
    S('g1', rbA, { rush_att: 10, rush_yds: 50 }),
    S('g2', rbA, { rush_att: 8, rush_yds: 40, pass_att: 1, pass_comp: 1, pass_yds: 20 }),
    S('g3', rbA, { rush_att: 6, rush_yds: 30 }),
  ]
  const r = buildLeaders(games, rows, { temporada: '2026' })
  assert.equal(r.players.rush[0].gp, 3)
  assert.equal(r.players.pass[0].gp, 1)
  assert.equal(r.players.rec.length, 0)
})

test('buildLeaders: jugador sin actividad en una categoría no aparece en ella', () => {
  const r = buildLeaders([G('g1', '1', A, B)], [S('g1', qbA, { pass_att: 0, pass_yds: 0, rush_att: 0, rec: 0 })], { temporada: '2026' })
  assert.deepEqual([r.players.pass.length, r.players.rush.length, r.players.rec.length], [0, 0, 0])
})

test('buildLeaders: fumbles se suman en carrera y recepción', () => {
  const r = buildLeaders([G('g1', '1', A, B), G('g2', '2', A, B)], [
    S('g1', rbA, { rush_att: 5, rush_yds: 10, rush_fum: 1, rec: 1, rec_yds: 5, rec_fum: 1 }),
    S('g2', rbA, { rush_att: 5, rush_yds: 10, rush_fum: 1 }),
  ], { temporada: '2026' })
  assert.equal(r.players.rush[0].fum, 2)
  assert.equal(r.players.rec[0].fum, 1)
})

test('buildLeaders: valores null en columnas cuentan como 0', () => {
  const r = buildLeaders([G('g1', '1', A, B)], [S('g1', qbA, { pass_att: 10, pass_comp: null, pass_yds: 50, pass_td: null, pass_int: null })], { temporada: '2026' })
  assert.equal(r.players.pass[0].comp, 0)
  assert.equal(r.players.pass[0].td, 0)
})

// ── filas excluidas ─────────────────────────────────────────────────────────

test('buildLeaders: sin jugador, sin equipo o equipo ajeno al partido se excluyen y se cuentan', () => {
  const games = [G('g1', '1', A, B)]
  const noTeam = P('n1', null, 1, 'No', 'Team')
  const foreign = P('f1', C, 2, 'Fuera', 'Equipo')
  const rows = [
    { game_id: 'g1', player_id: 'orphan', player: null, rush_att: 5, rush_yds: 20 },
    S('g1', noTeam, { rush_att: 5, rush_yds: 20 }),
    S('g1', foreign, { rush_att: 5, rush_yds: 20 }),
    S('g1', rbA, { rush_att: 5, rush_yds: 20 }),
  ]
  const r = buildLeaders(games, rows, { temporada: '2026' })
  assert.deepEqual(r.excluded, { noPlayer: 1, noTeam: 1, teamNotInGame: 1 })
  assert.equal(r.players.rush.length, 1)
  assert.equal(r.players.rush[0].playerId, 'rbA')
})

test('buildLeaders: jugador de roster 2025 con stats en partido 2026 sí cuenta (la temporada es del partido)', () => {
  const old = { ...P('m1', A, 40, 'Ruben', 'Salas'), temporada: '2025' }
  const r = buildLeaders([G('g1', '1', A, B)], [S('g1', old, { rec: 4, rec_yds: 60 })], { temporada: '2026' })
  assert.equal(r.players.rec.length, 1)
})

test('buildLeaders: filas de partidos fuera del filtro se ignoran (TEST, no final, otra temporada)', () => {
  const games = [G('g1', '1', A, B), G('g2', 'TEST', A, B), G('g3', '3', A, B, { status: 'scheduled' }), G('g4', '4', A, B, { kickoff: '2025-09-01T00:00:00Z' })]
  const rows = ['g1', 'g2', 'g3', 'g4'].map(id => S(id, rbA, { rush_att: 5, rush_yds: 10 }))
  const r = buildLeaders(games, rows, { temporada: '2026' })
  assert.equal(r.players.rush[0].gp, 1)
  assert.equal(r.players.rush[0].yds, 10)
})

// ── cobertura "N de M partidos con datos" ───────────────────────────────────

test('buildLeaders: games.total / withData (partido final sin filas no cuenta como con datos)', () => {
  const games = [G('g1', '1', A, B), G('g2', '1', C, D), G('g3', '2', A, B), G('g4', '3', A, B, { status: 'scheduled' })]
  const rows = [S('g1', rbA, { rush_att: 5, rush_yds: 10 })]
  assert.deepEqual(buildLeaders(games, rows, { temporada: '2026' }).games, { total: 3, withData: 1 })
  assert.deepEqual(buildLeaders(games, rows, { temporada: '2026', semana: '1' }).games, { total: 2, withData: 1 })
  assert.deepEqual(buildLeaders(games, rows, { temporada: '2026', semana: '2' }).games, { total: 1, withData: 0 })
})

test('buildLeaders: con filtro de equipo, solo cuentan los jugadores y partidos de ese equipo', () => {
  const games = [G('g1', '1', A, B), G('g2', '2', C, D)]
  const rows = [S('g1', rbA, { rush_att: 5, rush_yds: 10 }), S('g1', wrB, { rec: 2, rec_yds: 20 })]
  const r = buildLeaders(games, rows, { temporada: '2026', teamId: A })
  assert.deepEqual(r.games, { total: 1, withData: 1 })
  assert.equal(r.players.rush.length, 1)
  assert.equal(r.players.rec.length, 0)
  assert.deepEqual(r.teamGames, { [A]: 1 })
})

// ── mínimos: por partidos del EQUIPO con stats ──────────────────────────────

test('mínimos: se multiplican por los partidos del equipo con datos, no por los del jugador', () => {
  // Equipo A tiene stats en 4 partidos; el QB solo jugó 1 y lanzó 15 → mínimo 40, no califica.
  const games = [G('g1', '1', A, B), G('g2', '2', A, B), G('g3', '3', A, B), G('g4', '4', A, B)]
  const rows = [
    S('g1', qbA, { pass_att: 15, pass_comp: 10, pass_yds: 150 }),
    S('g2', rbA, { rush_att: 5, rush_yds: 10 }),
    S('g3', rbA, { rush_att: 5, rush_yds: 10 }),
    S('g4', rbA, { rush_att: 5, rush_yds: 10 }),
  ]
  const r = buildLeaders(games, rows, { temporada: '2026' })
  assert.equal(r.teamGames[A], 4)
  const qb = r.players.pass[0]
  assert.equal(qb.gp, 1)
  assert.equal(qb.minAtt, 40)
  assert.equal(qb.qualifies, false)
  // 15 acarreos en 4 juegos del equipo (mínimo 20) tampoco califica
  assert.equal(r.players.rush[0].minAtt, 20)
  assert.equal(r.players.rush[0].qualifies, false)
})

test('mínimos: umbral exacto califica (>=) y recepción usa 1.5 por partido del equipo', () => {
  const games = [G('g1', '1', A, B), G('g2', '2', A, B), G('g3', '3', A, B)]
  const base = [S('g1', qbA, { pass_att: 10 }), S('g2', qbA, { pass_att: 10 }), S('g3', qbA, { pass_att: 10 })]
  const wr = (rec) => S('g1', rbA, { rec, rec_yds: rec * 10 })
  // 3 juegos de A con datos: pase 30, carrera 15, recepción 4.5
  let r = buildLeaders(games, [...base, wr(4)], { temporada: '2026' })
  assert.equal(r.players.pass[0].qualifies, true)          // 30 >= 30
  assert.equal(r.players.rec[0].minRec, 4.5)
  assert.equal(r.players.rec[0].qualifies, false)          // 4 < 4.5
  r = buildLeaders(games, [...base, wr(5)], { temporada: '2026' })
  assert.equal(r.players.rec[0].qualifies, true)           // 5 >= 4.5
  assert.deepEqual(LEADER_MIN_PER_TEAM_GAME, { pass: 10, rush: 5, rec: 1.5 })
})

test('mínimos: la base es el filtro vigente (semana) — con una semana el mínimo baja', () => {
  const games = [G('g1', '1', A, B), G('g2', '2', A, B)]
  const rows = [S('g1', qbA, { pass_att: 12, pass_comp: 8, pass_yds: 100 }), S('g2', rbA, { rush_att: 5, rush_yds: 10 })]
  assert.equal(buildLeaders(games, rows, { temporada: '2026' }).players.pass[0].qualifies, false)   // 12 < 20
  assert.equal(buildLeaders(games, rows, { temporada: '2026', semana: '1' }).players.pass[0].qualifies, true) // 12 >= 10
})

test('mínimos: cada equipo usa sus propios partidos con datos', () => {
  const games = [G('g1', '1', A, B), G('g2', '2', A, C)]
  const rows = [
    S('g1', qbA, { pass_att: 12 }), S('g2', rbA, { rush_att: 1, rush_yds: 1 }),   // A: 2 partidos con datos
    S('g1', qbB, { pass_att: 12 }),                                                // B: 1 partido con datos
  ]
  const r = buildLeaders(games, rows, { temporada: '2026' })
  const byId = Object.fromEntries(r.players.pass.map(p => [p.playerId, p]))
  assert.equal(byId.qbA.qualifies, false)   // mínimo 20
  assert.equal(byId.qbB.qualifies, true)    // mínimo 10
})

// ── rankLeaders ─────────────────────────────────────────────────────────────

function sampleLeaders() {
  const games = [G('g1', '1', A, B), G('g2', '2', A, B)]
  const q2 = P('qb2', A, 3, 'Beto', 'Soto')
  const rows = [
    S('g1', qbA, { pass_att: 20, pass_comp: 12, pass_yds: 200, pass_td: 2 }),
    S('g2', qbA, { pass_att: 20, pass_comp: 12, pass_yds: 200, pass_td: 2 }),   // 40 att, 400 yds
    S('g1', q2, { pass_att: 2, pass_comp: 2, pass_yds: 90, pass_td: 1 }),       // 2 att: rating enorme, no califica
    S('g1', qbB, { pass_att: 25, pass_comp: 15, pass_yds: 250 }), S('g2', qbB, { pass_att: 25, pass_comp: 15, pass_yds: 250 }),
  ]
  return buildLeaders(games, rows, { temporada: '2026' }).players.pass
}

test('rankLeaders: totales sin mínimo; promedios y rating solo califican', () => {
  const pass = sampleLeaders()
  assert.deepEqual(rankLeaders(pass, 'yds').map(p => p.playerId), ['qbB', 'qbA', 'qb2'])   // 500, 400, 90
  assert.deepEqual(rankLeaders(pass, 'rating').map(p => p.playerId).includes('qb2'), false)
  assert.equal(rankLeaders(pass, 'rating')[0].playerId, 'qbA')
  // ypa empatado en 10.0: desempata por yardas totales, y ambos comparten rank 1
  const ypa = rankLeaders(pass, 'ypa')
  assert.deepEqual(ypa.map(p => p.playerId), ['qbB', 'qbA'])
  assert.deepEqual(ypa.map(p => p.rank), [1, 1])
})

test('rankLeaders: showAll incluye a los que no califican en promedios', () => {
  const pass = sampleLeaders()
  const all = rankLeaders(pass, 'rating', { showAll: true })
  assert.equal(all.length, 3)
  assert.equal(all[0].playerId, 'qb2')
  assert.equal(all[0].qualifies, false)
})

test('rankLeaders: limit y rank con empates', () => {
  const list = [
    { label: 'a', yds: 100, qualifies: true }, { label: 'b', yds: 100, qualifies: true },
    { label: 'c', yds: 80, qualifies: true }, { label: 'd', yds: 10, qualifies: true },
  ]
  const r = rankLeaders(list, 'yds')
  assert.deepEqual(r.map(x => x.rank), [1, 1, 3, 4])
  assert.equal(rankLeaders(list, 'yds', { limit: 2 }).length, 2)
  assert.equal(list[0].rank, undefined, 'no muta la lista original')
})

test('rankLeaders: valores null (sin intentos) no se ordenan', () => {
  const list = [{ label: 'a', yds: 0, ypa: null, qualifies: true }, { label: 'b', yds: 5, ypa: 5, qualifies: true }]
  assert.deepEqual(rankLeaders(list, 'ypa').map(x => x.label), ['b'])
})

test('rankLeaders: lista vacía → vacía', () => {
  assert.deepEqual(rankLeaders([], 'yds'), [])
})

// ── fetchAllRows ────────────────────────────────────────────────────────────

const makeServer = (n, { cap = Infinity, onCall } = {}) => {
  const data = Array.from({ length: n }, (_, i) => ({ id: i }))
  const calls = []
  const fetchPage = async (offset, limit) => {
    calls.push([offset, limit])
    onCall?.(calls.length, data)
    return { rows: data.slice(offset, offset + Math.min(limit, cap)), total: data.length }
  }
  return { fetchPage, calls }
}

test('fetchAllRows: 2500 filas en 3 páginas y el conteo coincide', async () => {
  const { fetchPage, calls } = makeServer(2500)
  const rows = await fetchAllRows(fetchPage, { keyOf: r => r.id })
  assert.equal(rows.length, 2500)
  assert.deepEqual(calls, [[0, 1000], [1000, 1000], [2000, 1000]])
})

test('fetchAllRows: siempre pagina — incluso con pocas filas hace la petición con límite', async () => {
  const { fetchPage, calls } = makeServer(965)
  assert.equal((await fetchAllRows(fetchPage)).length, 965)
  assert.deepEqual(calls, [[0, 1000]])
})

test('fetchAllRows: exactamente 1000 filas no se queda sin la siguiente página', async () => {
  const { fetchPage, calls } = makeServer(1000)
  assert.equal((await fetchAllRows(fetchPage)).length, 1000)
  assert.equal(calls.length, 1)
})

test('fetchAllRows: tope del servidor menor al pedido (max_rows) no pierde filas', async () => {
  const { fetchPage } = makeServer(2300, { cap: 1000 })
  const rows = await fetchAllRows(fetchPage, { pageSize: 5000, keyOf: r => r.id })
  assert.equal(rows.length, 2300)
})

test('fetchAllRows: tabla vacía → []', async () => {
  const { fetchPage } = makeServer(0)
  assert.deepEqual(await fetchAllRows(fetchPage), [])
})

test('fetchAllRows: falla si se leen menos filas que el conteo de la base', async () => {
  // El servidor dice que hay 2000 pero la segunda página llega vacía.
  const fetchPage = async (offset) => ({ rows: offset === 0 ? Array.from({ length: 1000 }, (_, i) => ({ id: i })) : [], total: 2000 })
  await assert.rejects(fetchAllRows(fetchPage), /distintas al conteo/)
})

test('fetchAllRows: falla si no hay conteo en la respuesta', async () => {
  await assert.rejects(fetchAllRows(async () => ({ rows: [{ id: 1 }], total: null })), /conteo total/)
})

test('fetchAllRows: falla si el total cambia mientras lee', async () => {
  const data = Array.from({ length: 1500 }, (_, i) => ({ id: i }))
  const fetchPage = async (offset, limit) => ({ rows: data.slice(offset, offset + limit), total: offset === 0 ? 1500 : 1501 })
  await assert.rejects(fetchAllRows(fetchPage), /total cambió/)
})

test('fetchAllRows: falla si una fila aparece repetida entre páginas (datos movidos)', async () => {
  // Entre la página 1 y la 2 se inserta una fila al inicio: el conteo no cambia
  // (otra se borra al final) pero la página 2 repite el id 999.
  let data = Array.from({ length: 2000 }, (_, i) => ({ id: i }))
  let n = 0
  const fetchPage = async (offset, limit) => {
    const rows = data.slice(offset, offset + limit)
    if (++n === 1) data = [{ id: -1 }, ...data.slice(0, 1999)]
    return { rows, total: 2000 }
  }
  await assert.rejects(fetchAllRows(fetchPage, { keyOf: r => r.id }), /repetida/)
})
