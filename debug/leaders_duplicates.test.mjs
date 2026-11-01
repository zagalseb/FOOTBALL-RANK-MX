// Líderes: buildLeaders reports possible duplicate players (same game + team + jersey under two
// player_ids) and flags them. Synthetic data: see debug/helpers/duplicate_scenario.mjs.
// Run: node --test debug/leaders_duplicates.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLeaders } from '../shared/stats-lib.js'
import { TA, TB, games, A25, A26, B_DROP, B_KEEP, stats } from './helpers/duplicate_scenario.mjs'

test('el escenario sintético reproduce los dos duplicados (y no más)', () => {
  const r = buildLeaders(games, stats, { temporada: '2026' })
  assert.equal(r.suspected.length, 2)
  assert.deepEqual(r.suspected.map(s => s.number).sort((a, b) => a - b), [3, 17])
})

test('Líderes (con los duplicados): buildLeaders reporta ambos casos como sospechosos y los marca', () => {
  const r = buildLeaders(games, stats, { temporada: '2026' })
  assert.equal(r.suspected.length, 2)
  const byTeam = Object.fromEntries(r.suspected.map(s => [s.teamId, s]))
  assert.deepEqual(byTeam[TA].players.map(p => p.playerId).sort(), [A25.id, A26.id].sort())
  assert.equal(byTeam[TA].number, 17)
  assert.deepEqual(byTeam[TB].players.map(p => p.playerId).sort(), [B_DROP.id, B_KEEP.id].sort())
  assert.equal(byTeam[TB].number, 3)
  const all = [...r.players.pass, ...r.players.rush, ...r.players.rec]
  const flagged = new Set(all.filter(p => p.dupSuspect).map(p => p.playerId))
  assert.deepEqual([...flagged].sort(), [A25.id, A26.id, B_DROP.id, B_KEEP.id].sort())   // nadie más
})

test('Líderes: tras quitar las filas duplicadas (como la limpieza) no queda ningún sospechoso', () => {
  const clean = stats.filter(r => r.player_id !== A25.id && r.player_id !== B_DROP.id)
  const r = buildLeaders(games, clean, { temporada: '2026' })
  assert.equal(r.suspected.length, 0)
  assert.equal([...r.players.pass, ...r.players.rush, ...r.players.rec].filter(p => p.dupSuspect).length, 0)
})

test('Líderes: el filtro de equipo solo reporta los sospechosos de ese equipo', () => {
  const r = buildLeaders(games, stats, { temporada: '2026', teamId: TA })
  assert.equal(r.suspected.length, 1)
  assert.equal(r.suspected[0].teamId, TA)
})

test('Líderes: números distintos o equipos distintos no son sospechosos', () => {
  const pl = (id, team, number) => ({ id, team_id: team, number, nombre: 'N', apellido: 'A' })
  const g = [{ id: 'g1', semana: '1', status: 'final', temporada: null, kickoff: '2026-09-05T00:00:00Z', home_team_id: 'A', away_team_id: 'B' }]
  const rows = [
    { game_id: 'g1', player_id: 'p1', player: pl('p1', 'A', 11), rush_att: 3, rush_yds: 10 },
    { game_id: 'g1', player_id: 'p2', player: pl('p2', 'A', 82), rush_att: 3, rush_yds: 10 },   // mismo equipo, otro número
    { game_id: 'g1', player_id: 'p3', player: pl('p3', 'B', 11), rush_att: 3, rush_yds: 10 },   // rival con el mismo número
  ]
  assert.equal(buildLeaders(g, rows, { temporada: '2026' }).suspected.length, 0)
})
