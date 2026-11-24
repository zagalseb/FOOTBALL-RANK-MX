// Pruebas del rediseño de la pestaña Comparación (viewer.html): tablas con
// fila Total, "Por cuarto" (computeQuarterSplits) y resumen de captura manual.
// Solo importa shared/stats-lib.js (no usa `location`; corre en Node).
// Los partidos reales salen de debug/fixtures (congelados) y su
// computeComparisonStats se compara contra debug/snapshots.
// Run: node --test debug/comparacion.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  computeComparisonStats, computeDrives, computeSpecialTeamsStats, buildOffenseMaps, computeQBProgression,
  buildRosterIndex, computeQuarterSplits, quarterSplitCells, compOffenseRows, manualCompOffense,
  manualCompSummaryRows, manualIndOffense, manualIndDefense, manualTeamStatRows, _passerRating,
} from '../shared/stats-lib.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GAMES = [
  ['c0a826d4-5dfa-4279-942e-b3ecff24361c', 'full-plays'],
  ['2dd8daf7-5053-4f5c-8c32-acabbbacda83', 'penalties-fumbles'],
]

function loadGame(id) {
  const data = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', `${id}.json`), 'utf8')).data
  const g = data.games[0]
  const plays = data.plays.map(({ play_data, ...rest }) => ({ ...rest, ...(play_data || {}) }))
  const h = g.home.abreviatura, a = g.away.abreviatura
  const teams = { home: { name: h }, away: { name: a } }
  const rosters = {
    [h]: buildRosterIndex(g.home_team_id, data.roster.filter(r => r.team_id === g.home_team_id)),
    [a]: buildRosterIndex(g.away_team_id, data.roster.filter(r => r.team_id === g.away_team_id)),
  }
  return { plays, h, a, teams, rosters }
}

const ADDITIVE = ['firstDowns', 'rushYds', 'passYds', 'passCompletions', 'passAttempts', 'intsThrown',
  'totalPlays', 'thirdConv', 'thirdAtt', 'fourthConv', 'fourthAtt', 'rushPlays', 'turnovers', 'fumblesLost',
  'sacksMade', 'tflMade']

// ── computeComparisonStats: la extracción de _accumulateComparison no cambia nada ──

for (const [id, snap] of GAMES) {
  test(`computeComparisonStats igual al snapshot (${snap})`, () => {
    const { plays, h, a, teams } = loadGame(id)
    const out = computeComparisonStats(plays, computeDrives(plays, h, a), h, a, teams)
    const expected = JSON.parse(fs.readFileSync(path.join(HERE, 'snapshots', `${snap}.json`), 'utf8')).computeComparisonStats
    assert.deepEqual(JSON.parse(JSON.stringify(out)), expected)
  })

  test(`computeQuarterSplits: la suma de los cuartos == computeComparisonStats (${snap})`, () => {
    const { plays, h, a, teams, rosters } = loadGame(id)
    const total = computeComparisonStats(plays, computeDrives(plays, h, a), h, a, teams)
    const qs = computeQuarterSplits(plays, h, a, teams, rosters)
    assert.deepEqual(qs.map(q => q.key), ['1', '2', '3', '4'])  // sin OT en estos partidos
    for (const team of [h, a]) {
      for (const f of ADDITIVE) {
        assert.equal(qs.reduce((s, q) => s + q.stats[team][f], 0), total[team][f], `${team} ${f}`)
      }
      // KR: misma suma que el panel de resumen (_sumByTeam sobre kickReturns).
      const st = computeSpecialTeamsStats(plays, h, a, teams, rosters)
      const kr = st.kickReturns.filter(r => r.team === team).reduce((acc, r) => ({ no: acc.no + r.no, yds: acc.yds + r.yds }), { no: 0, yds: 0 })
      assert.deepEqual(
        qs.reduce((acc, q) => ({ no: acc.no + q.kr[team].no, yds: acc.yds + q.kr[team].yds }), { no: 0, yds: 0 }), kr)
    }
  })
}

test('quarterSplitCells del total coincide con el formato del panel de resumen', () => {
  const { plays, h, a, teams } = loadGame(GAMES[0][0])
  const A = computeComparisonStats(plays, computeDrives(plays, h, a), h, a, teams)[h]
  const kr = { no: 2, yds: 40 }
  // Mismas fórmulas que summaryRows de ComparacionTab (fmtRatio / PASS-CAI / KR-YDS / EFF).
  const fmtRatio = (num, den) => den > 0 ? (num / den).toFixed(1) : '0.0'
  assert.deepEqual(quarterSplitCells(A, kr), [
    A.firstDowns, A.rushYds, A.passYds,
    `${A.passCompletions}-${A.passAttempts}-${A.intsThrown}`,
    fmtRatio(A.passYds + A.rushYds, A.totalPlays),
    `${kr.no}-${kr.yds}`, `${A.thirdConv}-${A.thirdAtt}`, `${A.fourthConv}-${A.fourthAtt}`,
  ])
  assert.deepEqual(quarterSplitCells(undefined, undefined), [0, 0, 0, '0-0-0', '0.0', '0-0', '0-0', '0-0'])
})

test('computeQuarterSplits: OT solo si hay jugadas en OT (quarter >= 5)', () => {
  const H = 'HOM', A = 'AWY', teams = { home: { name: H }, away: { name: A } }
  const rush = (quarter, yds, extra = {}) => ({ play_type: 'RUSH', possession: H, quarter, down: 2, distance: 8,
    yardline_100: 50, net_yards: yds, rush_by: { number: 22 }, ...extra })
  const base = [rush(1, 5), rush(4, 7)]
  assert.deepEqual(computeQuarterSplits(base, H, A, teams).map(q => q.key), ['1', '2', '3', '4'])
  const ot = computeQuarterSplits([...base, rush(5, 3), rush(6, 4)], H, A, teams)
  assert.deepEqual(ot.map(q => q.label), ['1º', '2º', '3º', '4º', 'OT'])
  const total = computeComparisonStats([...base, rush(5, 3), rush(6, 4)], [], H, A, teams)
  assert.equal(ot.find(q => q.key === 'OT').stats[H].rushYds, 7)
  assert.equal(ot.reduce((s, q) => s + q.stats[H].rushYds, 0), total[H].rushYds)
  // Un GAME_CTRL en OT no crea la fila OT.
  assert.equal(computeQuarterSplits([...base, { play_type: 'GAME_CTRL', quarter: 5 }], H, A, teams).length, 4)
})

// ── compOffenseRows (juegos con jugadas) ──

test('compOffenseRows: filas ordenadas por yardas y Total de pase/carrera/recepción', () => {
  const { plays, h, a, teams, rosters } = loadGame(GAMES[0][0])
  const maps = buildOffenseMaps(plays, h, a, rosters)
  assert.ok(Object.keys(maps.passers[h] || {}).length + Object.keys(maps.passers[a] || {}).length > 0)
  const qbIntMap = {}
  computeQBProgression(plays, rosters).forEach(qb => { qbIntMap[`${qb.team}::${qb.key}`] = qb.int })
  for (const abbr of [h, a]) {
    const d = compOffenseRows(maps.passers, maps.rushers, maps.receivers, qbIntMap, abbr)
    for (const [rows, f] of [[d.passing, 'yds'], [d.rushing, 'yds'], [d.receiving, 'yds']]) {
      for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1][f] >= rows[i][f])
    }
    const sum = (rows, f) => rows.reduce((s, r) => s + r[f], 0)
    const max = (rows, f) => Math.max(...rows.map(r => r[f]))
    if (d.passing.length) {
      const t = d.passTotal
      assert.equal(t.comp, sum(d.passing, 'comp')); assert.equal(t.att, sum(d.passing, 'att'))
      assert.equal(t.int, sum(d.passing, 'int')); assert.equal(t.yds, sum(d.passing, 'yds'))
      assert.equal(t.td, sum(d.passing, 'td')); assert.equal(t.long, max(d.passing, 'long'))
      assert.equal(t.sacked, sum(d.passing, 'sacked')); assert.equal(t.sackedYds, sum(d.passing, 'sackedYds'))
      assert.equal(t.rating, _passerRating(t.comp, t.att, t.yds, t.td, t.int))
    } else assert.equal(d.passTotal, null)
    if (d.rushing.length) {
      const t = d.rushTotal
      assert.equal(t.att, sum(d.rushing, 'att')); assert.equal(t.yds, sum(d.rushing, 'yds'))
      assert.equal(t.gained, sum(d.rushing, 'gained')); assert.equal(t.td, sum(d.rushing, 'td'))
      assert.equal(t.long, max(d.rushing, 'long'))
    }
    if (d.receiving.length) {
      const t = d.recTotal
      assert.equal(t.rec, sum(d.receiving, 'rec')); assert.equal(t.yds, sum(d.receiving, 'yds'))
      assert.equal(t.td, sum(d.receiving, 'td')); assert.equal(t.long, max(d.receiving, 'long'))
    }
  }
})

test('compOffenseRows: Long negativo, -Infinity y equipo sin datos', () => {
  const passers = {}, receivers = {}
  const rushers = { X: { a: { label: '#1 A. Uno', att: 2, gained: 0, yds: -8, td: 0, long: -3 },
                         b: { label: '#2 B. Dos', att: 1, gained: 0, yds: -5, td: 0, long: -Infinity } } }
  const d = compOffenseRows(passers, rushers, receivers, {}, 'X')
  assert.deepEqual(d.rushing.map(r => r.label), ['#2 B. Dos', '#1 A. Uno'])  // Net desc: -5, -8
  assert.equal(d.rushing[0].long, 0)        // -Infinity → 0 (igual que _rushingRows)
  assert.equal(d.rushing[1].long, -3)
  assert.equal(d.rushTotal.long, 0)         // máximo de las filas mostradas
  assert.equal(d.rushTotal.yds, -13)
  const e = compOffenseRows({}, {}, {}, {}, 'Y')
  assert.deepEqual([e.passTotal, e.rushTotal, e.recTotal], [null, null, null])
})

// ── Captura manual ──

const TA = 'team-a', TB = 'team-b'
const P = (id, team_id, number, nombre, apellido) => ({ id, team_id, number, nombre, apellido })
const S = (player, o = {}) => ({ game_id: 'g1', player_id: player.id, player, ...o })
const qb1 = P('qb1', TA, 12, 'Juan', 'Molina'), qb2 = P('qb2', TA, 5, 'Pedro', 'Sosa')
const rb = P('rb', TA, 22, 'Ana', 'Lopez'), wr = P('wr', TA, 81, 'Mario', 'Ruiz')
const lb = P('lb', TA, 44, 'Luis', 'Paz'), opp = P('opp', TB, 1, 'Otro', 'Equipo')
const ROWS = [
  S(qb2, { pass_comp: 2, pass_att: 5, pass_yds: 20, pass_int: 1 }),
  S(qb1, { pass_comp: 15, pass_att: 25, pass_yds: 210, pass_td: 2, rush_att: 4, rush_yds: -12 }),
  S(rb, { rush_att: 18, rush_yds: 95, rush_td: 1, rec: 2, rec_yds: 11 }),
  S(wr, { rec: 6, rec_yds: 120, rec_td: 2 }),
  S(lb, { tackles: 9.5, tfl: 1.5, sacks: 0.5, ff: 1 }),
  S(opp, { pass_comp: 30, pass_att: 40, pass_yds: 400, pass_int: 2, rush_att: 3, rush_yds: 9, rec: 4, rec_yds: 50 }),
]

test('manualCompOffense: mismas filas que manualIndOffense + Total', () => {
  const d = manualCompOffense(ROWS, TA)
  const base = manualIndOffense(ROWS, TA)
  assert.deepEqual(d.passing, base.passing); assert.deepEqual(d.rushing, base.rushing); assert.deepEqual(d.receiving, base.receiving)
  assert.deepEqual(d.passTotal, { label: 'Total', comp: 17, att: 30, int: 1, yds: 230, td: 2,
    pct: (17 / 30) * 100, rating: _passerRating(17, 30, 230, 2, 1) })
  assert.deepEqual(d.rushTotal, { label: 'Total', att: 22, yds: 83, td: 1, avg: 83 / 22 })
  assert.deepEqual(d.recTotal, { label: 'Total', rec: 8, yds: 131, td: 2, avg: 131 / 8 })
  // Sin columnas que la carga manual no tiene.
  for (const t of [d.passTotal, d.rushTotal, d.recTotal]) {
    assert.ok(!('long' in t) && !('gained' in t) && !('sacked' in t))
  }
  const none = manualCompOffense([], TA)
  assert.deepEqual([none.passTotal, none.rushTotal, none.recTotal], [null, null, null])
})

test('manualCompSummaryRows: filas, sumas de jugadores y fila de equipo', () => {
  const team = [{ team_id: TA, first_downs: 18, total_yds: 420, pass_yds: 230, rush_yds: 190, penalties: 6, penalty_yds: 55,
    third_down_conv: 5, third_down_att: 12, fourth_down_conv: 1, fourth_down_att: 2, red_zone_td: 3, red_zone_trips: 4,
    fumbles_lost: 1, sacks: 2.5, tfl: 6, time_of_possession_sec: 1935 }]
  const rows = manualCompSummaryRows(team, ROWS, TA, TB)
  assert.deepEqual(rows.map(r => r.label), ['1st DWN', 'RUSH-ATT', 'RUSH-YDS', 'RUSH-AVG', 'REC', 'REC-YDS', 'REC-AVG',
    'PASS-YDS', 'PASS-CAI', 'TOTAL-YDS', 'SACKS', 'TFL', 'FUM-LST', 'PEN', 'RED ZONE', 'POS', '3RD EFF', '4TH EFF'])
  const by = Object.fromEntries(rows.map(r => [r.label, r]))
  assert.equal(by['1st DWN'].away, '18')
  assert.equal(by['RUSH-ATT'].away, '22'); assert.equal(by['RUSH-YDS'].away, '83'); assert.equal(by['RUSH-AVG'].away, '3.8')
  assert.equal(by['REC'].away, '8'); assert.equal(by['REC-YDS'].away, '131'); assert.equal(by['REC-AVG'].away, '16.4')
  assert.equal(by['PASS-YDS'].away, '230'); assert.equal(by['PASS-CAI'].away, '17-30-1')
  assert.equal(by['TOTAL-YDS'].away, '420'); assert.equal(by['SACKS'].away, '2.5'); assert.equal(by['TFL'].away, '6')
  assert.equal(by['FUM-LST'].away, '1'); assert.equal(by['PEN'].away, '6-55'); assert.equal(by['RED ZONE'].away, '3-4')
  assert.equal(by['POS'].away, '32:15'); assert.equal(by['3RD EFF'].away, '5-12'); assert.equal(by['4TH EFF'].away, '1-2')
  for (const r of rows) assert.ok(!String(r.away).includes('—') && !String(r.home).includes('—'), r.label)
})

test('manualCompSummaryRows: equipo sin fila en team_game_stats_manual → 0, no truena', () => {
  // Caso real: game_id d9163bf9-eaf7-4a9e-be78-bd95bf3c0f36 tiene un equipo sin esa fila.
  const rows = manualCompSummaryRows([{ team_id: TA, first_downs: 18 }], ROWS, TA, TB)
  const by = Object.fromEntries(rows.map(r => [r.label, r]))
  assert.equal(by['1st DWN'].home, '0'); assert.equal(by['PASS-YDS'].home, '0'); assert.equal(by['TOTAL-YDS'].home, '0')
  assert.equal(by['SACKS'].home, '0'); assert.equal(by['PEN'].home, '0-0'); assert.equal(by['RED ZONE'].home, '0-0')
  assert.equal(by['POS'].home, '0:00'); assert.equal(by['3RD EFF'].home, '0-0')
  // Las sumas de jugadores del equipo sin fila sí aparecen.
  assert.equal(by['PASS-CAI'].home, '30-40-2'); assert.equal(by['RUSH-YDS'].home, '9'); assert.equal(by['REC-YDS'].home, '50')
  // Sin ninguna fila ni jugadores.
  const empty = manualCompSummaryRows(undefined, undefined, TA, TB)
  assert.equal(empty.find(r => r.label === 'RUSH-AVG').away, '0.0')
})

// ── Los adaptadores existentes no cambian ──

test('adaptadores existentes: misma salida', () => {
  const off = manualIndOffense(ROWS, TA)
  assert.deepEqual(Object.keys(off), ['passing', 'receiving', 'rushing'])
  assert.deepEqual(off.passing[0], { label: '#12 J. Molina', player: qb1, comp: 15, att: 25, int: 0, yds: 210, td: 2,
    pct: 60, rating: _passerRating(15, 25, 210, 2, 0) })
  assert.deepEqual(manualIndDefense(ROWS, TA), [{ label: '#44 L. Paz', player: lb, tackles: 9.5, tfl: 1.5, sacks: 0.5, ff: 1, fum_rec: 0, ints: 0 }])
  const team = manualTeamStatRows([{ team_id: TA, penalties: 6, penalty_yds: 55 }], TA, TB)
  assert.equal(team.length, 13)
  assert.deepEqual(team.find(r => r.label === 'Penalties - Yds'), { label: 'Penalties - Yds', away: '6-55', home: '0-0' })
})
