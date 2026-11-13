// Unit tests for shared/stats-import.js (weekly stats CSV import).
// Run: node --test debug/stats_import.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseStatsCsv, weekMismatches, findTeamGame, classifyStatsImport, computeTeamTotals,
  buildPlayerPayload, buildTeamPayload, planPlayerWrites, uniformKeys, PDF_TEAM_LABELS,
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

test('classify: el operador puede omitir una fila con error o de equipo desconocido', () => {
  const rows = parse('semana,equipo,nombre,rec', '3,MTY,X,abc', '3,XXX,Y,1').rows
  assert.deepEqual(run(rows).rows.map(r => r.status), ['error', 'error'])
  assert.deepEqual(run(rows, { choices: { players: { 2: 'skip', 3: 'skip' } } }).rows.map(r => r.status), ['skipped', 'skipped'])
})

// ── Peticiones: PostgREST rechaza (PGRST102) cuerpos con objetos de llaves distintas ──
// CSV SINTÉTICO de una semana completa: 142 filas en 12 equipos (misma distribución que un import
// real) con nombres inventados y el patrón real de celdas vacías (cada jugador solo trae las
// columnas de lo que hizo: pase, carrera, recepción o mezclas). El roster también es sintético
// (un jugador por fila, con el nombre del PDF como nombre_completo) y cada equipo juega su propio
// partido; así se prueba el patrón de celdas vacías sin depender de datos reales ni de la BD.
const WEEK_TEAMS = { LEONES: 17, LINCES: 15, ZORROS: 14, AZTECAS: 13, PUMAS: 12, GDL: 12, 'B BLANCOS': 12, PUE: 11, 'A BLANCAS': 11, CEM: 10, CCM: 8, CANCUN: 7 }   // 12 equipos, 142 filas
const syntheticWeekCsv = () => {
  const cols = ['pass_att', 'pass_comp', 'pass_yds', 'pass_td', 'pass_int', 'rush_att', 'rush_yds', 'rush_td', 'rush_fum', 'rec', 'rec_yds', 'rec_td', 'rec_fum']
  // Qué columnas trae cada perfil (el resto va vacío).
  const profiles = [
    ['pass_att', 'pass_comp', 'pass_yds', 'pass_td', 'pass_int', 'rush_att', 'rush_yds'],            // pasador que también corre
    ['rush_att', 'rush_yds', 'rush_td', 'rush_fum', 'rec', 'rec_yds'],                                  // corredor que también recibe
    ['rec', 'rec_yds', 'rec_td', 'rec_fum'],                                                            // receptor
    ['rush_att', 'rush_yds'],                                                                           // solo carrera
    ['rec', 'rec_yds'],                                                                                 // solo recepción
  ]
  const lines = ['semana,equipo,nombre,' + cols.join(',')]
  let n = 0
  for (const [team, count] of Object.entries(WEEK_TEAMS)) {
    for (let k = 0; k < count; k++, n++) {
      const has = new Set(profiles[(k + n) % profiles.length])
      lines.push(['3', team, `APELLIDO${String(n).padStart(3, '0')} NOMBRE${String(n).padStart(3, '0')}`, ...cols.map((c, j) => (has.has(c) ? String((n * 7 + j * 3) % 23 - (c.endsWith('yds') && n % 5 === 0 ? 25 : 0)) : ''))].join(','))
    }
  }
  return lines.join('\n') + '\n'
}
const week3 = () => {
  const parsed = parseStatsCsv(syntheticWeekCsv())
  const rostersByTeam = {}, games = [], existing = { player: new Map(), team: new Map() }
  parsed.rows.forEach((r, i) => {
    const teamId = PDF_TEAM_LABELS[r.equipo]
    const p = { id: `p${i}`, team_id: teamId, number: i % 100, apellido: 'X', nombre: `Y${i}`, nombre_completo: r.nombre }
    ;(rostersByTeam[teamId] ??= []).push(p)
    if (!games.some(g => g.id === `g-${teamId}`)) games.push(G(`g-${teamId}`, teamId, 'rival-' + teamId, '3'))
    if (i % 3 === 0) existing.player.set(`g-${teamId}|${p.id}`, { rec: 1 })   // un tercio ya tiene stats → update
  })
  const { rows } = classifyStatsImport(parsed.rows, { semana: '3', temporada: '2026', games, rostersByTeam, existing, choices: {} })
  return { parsed, rows, existing: existing.player, okRows: rows.filter(r => r.status === 'ok') }
}
// Lo que hace PostgREST con el cuerpo de un POST con on_conflict.
const postgrest = body => { if (!uniformKeys(body)) throw new Error('PGRST102 All object keys must match') }

test('semana 3: el CSV semanal tiene celdas vacías heterogéneas (el bug original)', () => {
  const { okRows } = week3()
  assert.equal(okRows.length, 142)
  const byTeam = {}
  for (const r of okRows) (byTeam[r.teamId] ??= []).push(buildPlayerPayload(r))
  // Enviar un arreglo por equipo con buildPlayerPayload (lo que hacía la página) falla en TODOS los equipos.
  for (const rows of Object.values(byTeam)) assert.throws(() => postgrest(rows), /PGRST102/)
})

test('semana 3: ningún cuerpo de petición tiene objetos con llaves heterogéneas', () => {
  const { okRows, existing, parsed } = week3()
  const plan = planPlayerWrites(okRows, existing, parsed.statColumns)
  assert.ok(plan.length > 12, 'hay varios grupos por equipo')
  for (const q of plan) assert.doesNotThrow(() => postgrest(q.rows), `${q.label} ${q.kind} ${q.columns}`)
  assert.equal(plan.reduce((a, q) => a + q.rows.length, 0), 142)       // ninguna fila se pierde ni se repite
  assert.equal(new Set(plan.flatMap(q => q.rows.map(r => r.player_id))).size, 142)
})

test('semana 3: filas NEW completan con 0 las columnas vacías; UPDATE solo manda celdas con valor', () => {
  const { okRows, existing, parsed } = week3()
  const plan = planPlayerWrites(okRows, existing, parsed.statColumns)
  const ids = ['game_id', 'player_id']
  for (const q of plan.filter(q => q.kind === 'new')) {
    for (const row of q.rows) assert.deepEqual(Object.keys(row).sort(), [...ids, ...parsed.statColumns].sort())
  }
  const byPlayer = new Map(okRows.map(r => [r.player.id, r]))
  for (const q of plan) for (const row of q.rows) {
    const src = byPlayer.get(row.player_id)
    for (const c of parsed.statColumns) {
      if (q.kind === 'update') assert.equal(c in row, src.stats[c] !== undefined, `update ${c}: la celda vacía no se manda`)
      else assert.equal(row[c], src.stats[c] ?? 0, `new ${c}: vacía → 0, con valor → el valor`)
    }
  }
  assert.ok(plan.some(q => q.kind === 'update') && plan.some(q => q.kind === 'new'))
})

test('semana 3: una fila que apareció después de la vista previa se trata como update (no pisa con 0)', () => {
  const { okRows, parsed } = week3()
  const r = okRows.find(x => Object.keys(x.stats).length < parsed.statColumns.length)
  const plan = planPlayerWrites([r], new Map([[`${r.gameId}|${r.player.id}`, { rec: 5 }]]), parsed.statColumns)
  assert.equal(plan[0].kind, 'update')
  assert.deepEqual(Object.keys(plan[0].rows[0]).sort(), ['game_id', 'player_id', ...Object.keys(r.stats)].sort())
})

test('semana 3: totales de equipo y demás cuerpos de un solo objeto son siempre uniformes', () => {
  const { rows } = week3()
  for (const t of computeTeamTotals(rows)) {
    const body = [buildTeamPayload(t, ['pass_yds'])]
    assert.doesNotThrow(() => postgrest(body))
    assert.deepEqual(Object.keys(body[0]).sort(), ['game_id', 'pass_yds', 'team_id'])
  }
  assert.equal(uniformKeys([]), true)
  assert.equal(uniformKeys([{ a: 1, b: 2 }, { b: 3, a: 4 }]), true)
  assert.equal(uniformKeys([{ a: 1 }, { a: 1, b: 2 }]), false)
})

// ── Columnas defensivas (tackles, tfl, sacks, ff, fum_rec, ints) ──
// Roster y partido SINTÉTICOS (nombres inventados), independientes de los fixtures de arriba.
const DEF_COLS = ['tackles', 'tfl', 'sacks', 'ff', 'fum_rec', 'ints']
const OFF_COLS = ['pass_att', 'pass_comp', 'pass_yds', 'pass_td', 'pass_int', 'rush_att', 'rush_yds', 'rush_td', 'rush_fum', 'rec', 'rec_yds', 'rec_td', 'rec_fum']
const defRoster = {
  [MTY]: [
    P('d1', MTY, 50, 'Ficticio', 'Alfa', 'Alfa Ficticio Perez'),
    P('d2', MTY, 51, 'Inventado', 'Beto', 'Beto Inventado Lopez'),
    P('d3', MTY, 52, 'Supuesto', 'Ciro', 'Ciro Supuesto Ruiz'),
  ],
}
const defCtx = (over = {}) => ctx({ games: [G('gd', MTY, OPP)], rostersByTeam: defRoster, ...over })
const DEF_HEADER = 'semana,equipo,nombre,tackles,sacks,ff,tfl,fum_rec,ints'
const defParse = (...lines) => parse(DEF_HEADER, ...lines)
const defRun = (rows, over) => classifyStatsImport(rows, defCtx(over))

test('defensa: CSV solo defensivo se acepta con las 6 columnas, sin desconocidas ni totales de equipo', () => {
  const p = defParse('3,MTY,FICTICIO PEREZ ALFA,5,1,0,2,0,1')
  assert.equal(p.error, undefined)
  assert.deepEqual(p.statColumns, DEF_COLS)
  assert.deepEqual(p.unknownColumns, [])
  assert.deepEqual(p.rows[0].stats, { tackles: 5, sacks: 1, ff: 0, tfl: 2, fum_rec: 0, ints: 1 })
  const { rows } = defRun(p.rows)
  assert.equal(rows[0].status, 'ok')
  assert.deepEqual(computeTeamTotals(rows), [])
})

test('defensa: celda vacía = no tocar, 0 explícito = 0, medios en tackles/tfl/sacks', () => {
  const p = defParse('3,MTY,FICTICIO PEREZ ALFA,4.5,,0,0.5,,0', '3,MTY,INVENTADO LOPEZ BETO,,0.5,,,,')
  assert.deepEqual(p.rows[0].errors, [])
  assert.deepEqual(p.rows[0].stats, { tackles: 4.5, ff: 0, tfl: 0.5, ints: 0 })
  for (const c of ['sacks', 'fum_rec']) assert.equal(c in p.rows[0].stats, false)
  assert.deepEqual(p.rows[1].stats, { sacks: 0.5 })
})

test('defensa: rechaza decimales en ints/ff/fum_rec y negativos en cualquier columna defensiva', () => {
  const p = defParse(
    '3,MTY,A,,,0.5,,,',      // ff decimal
    '3,MTY,B,,,,,1.5,',      // fum_rec decimal
    '3,MTY,C,,,,,,0.5',      // ints decimal
    '3,MTY,D,-1,-0.5,-1,-2,-1,-1',
  )
  assert.deepEqual(p.rows[0].errors, ['ff: valor inválido "0.5" (debe ser un entero ≥ 0)'])
  assert.deepEqual(p.rows[1].errors, ['fum_rec: valor inválido "1.5" (debe ser un entero ≥ 0)'])
  assert.deepEqual(p.rows[2].errors, ['ints: valor inválido "0.5" (debe ser un entero ≥ 0)'])
  assert.equal(p.rows[3].errors.length, 6)
  for (const c of DEF_COLS) assert.ok(p.rows[3].errors.some(e => e.startsWith(`${c}: valor inválido "-`)), c)
  for (const r of p.rows) assert.deepEqual(r.stats, {})
  // Las ofensivas siguen aceptando negativos.
  assert.deepEqual(parse('semana,equipo,nombre,rush_yds,tackles', '3,MTY,X,-4,1').rows[0].stats, { rush_yds: -4, tackles: 1 })
})

test('defensa: múltiplos de 0.5 en tackles/tfl/sacks (0.3 y 2.75 se rechazan, 2.5 y 3 se aceptan)', () => {
  const p = defParse('3,MTY,A,2.5,3,,0.5,,', '3,MTY,B,0.3,2.75,,1.25,,', '3,MTY,C,abc,.5,,1.,,')
  assert.deepEqual(p.rows[0].stats, { tackles: 2.5, sacks: 3, tfl: 0.5 })
  assert.deepEqual(p.rows[0].errors, [])
  assert.deepEqual(p.rows[1].errors, [
    // Orden de DEFENSE_STAT_COLUMNS (tackles, tfl, sacks), no el del encabezado.
    'tackles: valor inválido "0.3" (debe ser un número ≥ 0 en múltiplos de 0.5)',
    'tfl: valor inválido "1.25" (debe ser un número ≥ 0 en múltiplos de 0.5)',
    'sacks: valor inválido "2.75" (debe ser un número ≥ 0 en múltiplos de 0.5)',
  ])
  assert.equal(p.rows[2].errors.length, 3)   // formatos mal escritos también se rechazan
})

test('defensa: UPDATE manda solo las celdas defensivas con valor, nunca ofensivas; cuerpos uniformes', () => {
  const p = defParse('3,MTY,FICTICIO PEREZ ALFA,6,,,1,,', '3,MTY,INVENTADO LOPEZ BETO,3,1,,,,', '3,MTY,SUPUESTO RUIZ CIRO,2,,,1,,')
  const prev = { pass_att: 10, pass_yds: 120, rush_yds: 30, rec: 2, tackles: 1 }
  const existing = new Map(['d1', 'd2', 'd3'].map(id => [`gd|${id}`, prev]))
  const { rows } = defRun(p.rows, { existing: { player: existing, team: new Map() } })
  assert.deepEqual(rows.map(r => r.kind), ['update', 'update', 'update'])
  const plan = planPlayerWrites(rows.filter(r => r.status === 'ok'), existing, p.statColumns)
  assert.ok(plan.every(q => q.kind === 'update'))
  for (const q of plan) assert.equal(uniformKeys(q.rows), true, q.columns.join())
  const sent = Object.fromEntries(plan.flatMap(q => q.rows).map(r => [r.player_id, r]))
  assert.deepEqual(sent.d1, { game_id: 'gd', player_id: 'd1', tackles: 6, tfl: 1 })
  assert.deepEqual(sent.d2, { game_id: 'gd', player_id: 'd2', tackles: 3, sacks: 1 })
  assert.deepEqual(sent.d3, { game_id: 'gd', player_id: 'd3', tackles: 2, tfl: 1 })
  // d1 y d3 comparten llaves → misma petición; d2 va aparte.
  assert.equal(plan.length, 2)
  for (const r of Object.values(sent)) for (const c of OFF_COLS) assert.equal(c in r, false, `no se manda ${c}`)
})

test('defensa: NEW manda las 6 columnas defensivas (vacías en 0) y ninguna ofensiva', () => {
  const p = defParse('3,MTY,FICTICIO PEREZ ALFA,4,,,1.5,,', '3,MTY,INVENTADO LOPEZ BETO,,2,1,,,')
  const { rows } = defRun(p.rows)
  const plan = planPlayerWrites(rows.filter(r => r.status === 'ok'), new Map(), p.statColumns)
  assert.equal(plan.length, 1)
  assert.equal(plan[0].kind, 'new')
  assert.equal(uniformKeys(plan[0].rows), true)
  const [a, b] = plan[0].rows
  assert.deepEqual(a, { game_id: 'gd', player_id: 'd1', tackles: 4, tfl: 1.5, sacks: 0, ff: 0, fum_rec: 0, ints: 0 })
  assert.deepEqual(b, { game_id: 'gd', player_id: 'd2', tackles: 0, tfl: 0, sacks: 2, ff: 1, fum_rec: 0, ints: 0 })
  for (const r of plan[0].rows) for (const c of OFF_COLS) assert.equal(c in r, false, `no se manda ${c}`)
})

test('defensa: el mismo jugador con fila ofensiva y fila defensiva en un CSV → ambas duplicate', () => {
  const p = parse('semana,equipo,nombre,rec,rec_yds,tackles,sacks', '3,MTY,FICTICIO PEREZ ALFA,3,40,,', '3,MTY,FICTICIO PEREZ ALFA,,,5,1')
  const { rows, summary } = defRun(p.rows)
  assert.deepEqual(rows.map(r => r.status), ['duplicate', 'duplicate'])
  assert.deepEqual(summary, { duplicate: 2 })
})
