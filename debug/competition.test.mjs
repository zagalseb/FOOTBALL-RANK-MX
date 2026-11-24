// shared/competition.js y los filtros de categoría/conferencia de
// selectLeaderGames / buildLeaders (shared/stats-lib.js). Sin red.
// Run: node --test debug/competition.test.mjs   (desde la raíz del repo)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  withCompetition, loadCompetitions, defaultCategory, competitionCode, gameCategory, gameMatches,
  filterGames, categoryPrefix, ambiguousAbbreviations, teamCategoryCode, TEAM_COMP_FIELDS, _resetCompetitionSupport,
} from '../shared/competition.js'
import { selectLeaderGames, buildLeaders } from '../shared/stats-lib.js'

const LM = 'cat-lm', INT = 'cat-int', C14 = 'conf-14g', CN = 'conf-cn'
const CATS = [
  { id: INT, codigo: 'INT', nombre: 'Intermedia', league: { abreviatura: 'ONEFA' }, conferences: [] },
  { id: LM, codigo: 'LM', nombre: 'Liga Mayor', league: { abreviatura: 'ONEFA' }, conferences: [{ id: CN, codigo: 'CN', nombre: 'Conferencia Nacional' }, { id: C14, codigo: '14G', nombre: '14 Grandes' }] },
]
const team = (abbr, cat, conf) => ({ abreviatura: abbr, cat: cat && { codigo: cat }, conf: conf && { codigo: conf } })
const G = [
  { id: 'g1', home: team('MTY', 'LM', '14G'), away: team('CU', 'LM', '14G') },
  { id: 'g2', home: team('MTY', 'LM', '14G'), away: team('UAQ', 'LM', 'CN') },   // cruza conferencias
  { id: 'g3', home: team('MTY', 'INT', null), away: team('AT', 'INT', null) },
]

test('loadCompetitions ordena LM, INT, JUV y conferencias; null si el schema no tiene categorías', async () => {
  const cats = await loadCompetitions(async () => CATS)
  assert.deepEqual(cats.map(c => c.codigo), ['LM', 'INT'])
  assert.deepEqual(cats[0].conferences.map(c => c.codigo), ['14G', 'CN'])
  assert.equal(cats[0].liga, 'ONEFA')
  assert.equal(await loadCompetitions(async () => { throw new Error('HTTP 404') }), null)
  assert.equal(await loadCompetitions(async () => []), null)
  assert.equal(defaultCategory(cats).codigo, 'LM')
  assert.equal(defaultCategory(cats, 'INT').codigo, 'INT')
  assert.equal(defaultCategory(cats, 'XXX').codigo, 'LM')
  assert.equal(competitionCode('ONEFA', 'LM', '14G'), 'ONEFA-LM-14G')
  assert.equal(competitionCode('ONEFA', 'INT'), 'ONEFA-INT')
})

test('filtro: categoría del local; conferencia si CUALQUIERA de los dos equipos', () => {
  assert.deepEqual(filterGames(G, { categoria: 'LM' }).map(g => g.id), ['g1', 'g2'])
  assert.deepEqual(filterGames(G, { categoria: 'INT' }).map(g => g.id), ['g3'])
  assert.deepEqual(filterGames(G, { categoria: 'LM', conferencia: 'CN' }).map(g => g.id), ['g2'])
  assert.deepEqual(filterGames(G, { categoria: 'LM', conferencia: '14G' }).map(g => g.id), ['g1', 'g2'])
  assert.deepEqual(filterGames(G, {}).map(g => g.id), ['g1', 'g2', 'g3'])
  assert.equal(gameMatches({ home: {}, away: {} }, { categoria: 'LM' }), false, 'sin categoría no entra a LM')
  assert.equal(gameCategory(G[2]), 'INT')
  assert.equal(categoryPrefix(G[2]), 'INT · ')
  assert.equal(categoryPrefix({ home: { abreviatura: 'MTY' } }), '', 'schema sin categorías: etiqueta como antes')
})

test('ambiguousAbbreviations: solo las abreviaturas en más de una categoría', () => {
  const teams = [{ abreviatura: 'MTY', category_id: LM }, { abreviatura: 'mty', category_id: INT }, { abreviatura: 'CU', category_id: LM }]
  assert.deepEqual([...ambiguousAbbreviations(teams)], ['MTY'])
  assert.equal(teamCategoryCode(teams[1], [{ id: INT, codigo: 'INT' }]), 'INT')
})

test('withCompetition: pide los campos; sin categorías reintenta sin ellos y no vuelve a pedirlos', async () => {
  _resetCompetitionSupport()
  const calls = []
  const prod = async p => { calls.push(p); if (p.includes('cat:categories')) throw new Error('HTTP 400'); return [] }
  await withCompetition(prod, c => `games?select=home:home_team_id(abreviatura${c})`)
  await withCompetition(prod, c => `games?select=away:away_team_id(abreviatura${c})`)
  assert.deepEqual(calls, [
    `games?select=home:home_team_id(abreviatura,${TEAM_COMP_FIELDS})`,
    'games?select=home:home_team_id(abreviatura)',
    'games?select=away:away_team_id(abreviatura)',
  ])
})

test('withCompetition anidado con withSlug: rutas reales (nunca "[object Promise]") y degradación en orden', async () => {
  const { withSlug, _resetSlugSupport } = await import('../shared/game-ref.js')
  const build = (s, c) => `games?select=*${s},home:home_team_id(abreviatura${c})`
  const run = f => withCompetition(f, c => withSlug(f, s => build(s, c)))

  _resetCompetitionSupport(); _resetSlugSupport()
  const stg = []
  const staging = async p => { stg.push(p); return [{ id: 'g', slug: 'S' }] }
  assert.deepEqual(await run(staging), [{ id: 'g', slug: 'S' }])
  assert.deepEqual(stg, [build(',slug', ',' + TEAM_COMP_FIELDS)], 'staging: una sola consulta con slug y categorías')

  _resetCompetitionSupport(); _resetSlugSupport()
  const prd = []
  const prod = async p => { prd.push(p); if (p.includes(',slug') || p.includes('cat:categories')) throw new Error('HTTP 400'); return [{ id: 'g' }] }
  assert.deepEqual(await run(prod), [{ id: 'g' }])
  assert.equal(prd.at(-1), build('', ''), 'prod: termina sin slug ni categorías')
  assert.ok(prd.every(p => typeof p === 'string' && p.startsWith('games?')), prd.join(' | '))
  const n = prd.length
  await run(prod)
  assert.deepEqual(prd.slice(n), [build('', '')], 'segunda consulta en prod: directo sin campos opcionales')
})

// ── Leaders ────────────────────────────────────────────────────────────────
const T = new Map([
  ['mty', { abreviatura: 'MTY', category_id: LM, conference_id: C14 }],
  ['cu',  { abreviatura: 'CU',  category_id: LM, conference_id: C14 }],
  ['uaq', { abreviatura: 'UAQ', category_id: LM, conference_id: CN }],
  ['mtyi', { abreviatura: 'MTY', category_id: INT, conference_id: null }],
  ['ati',  { abreviatura: 'AT',  category_id: INT, conference_id: null }],
])
const fin = (id, h, a) => ({ id, status: 'final', semana: '3', temporada: '2026', home_team_id: h, away_team_id: a })
const GAMES = [fin('lm1', 'mty', 'cu'), fin('lm2', 'mty', 'uaq'), fin('int1', 'mtyi', 'ati')]
const row = (id, game, player, team, yds) => ({ id, game_id: game, player_id: player, rush_att: 10, rush_yds: yds, updated_at: '1',
  player: { id: player, number: 1, nombre: 'N', apellido: player, team_id: team } })
const ROWS = [row('r1', 'lm1', 'p-mty', 'mty', 50), row('r2', 'lm2', 'p-uaq', 'uaq', 70), row('r3', 'int1', 'p-mtyi', 'mtyi', 999)]

test('selectLeaderGames: sin filtros nuevos, igual que antes; categoría por local; conferencia por cualquiera', () => {
  const base = { temporada: '2026' }
  assert.deepEqual(selectLeaderGames(GAMES, base).map(g => g.id), ['lm1', 'lm2', 'int1'])
  assert.deepEqual(selectLeaderGames(GAMES, { ...base, categoryId: LM, teams: T }).map(g => g.id), ['lm1', 'lm2'])
  assert.deepEqual(selectLeaderGames(GAMES, { ...base, categoryId: INT, teams: T }).map(g => g.id), ['int1'])
  assert.deepEqual(selectLeaderGames(GAMES, { ...base, categoryId: LM, conferenceId: CN, teams: T }).map(g => g.id), ['lm2'])
})

test('buildLeaders: un juego INT no entra en LM; la conferencia limita a jugadores de esa conferencia', () => {
  const ids = r => r.players.rush.map(p => p.playerId).sort()
  const all = buildLeaders(GAMES, ROWS, { temporada: '2026', teams: T })
  assert.deepEqual(ids(all), ['p-mty', 'p-mtyi', 'p-uaq'], 'sin categoría: como antes, todo')
  const lm = buildLeaders(GAMES, ROWS, { temporada: '2026', categoryId: LM, teams: T })
  assert.deepEqual(ids(lm), ['p-mty', 'p-uaq'])
  assert.equal(lm.games.total, 2)
  const cn = buildLeaders(GAMES, ROWS, { temporada: '2026', categoryId: LM, conferenceId: CN, teams: T })
  assert.deepEqual(ids(cn), ['p-uaq'], 'lm2 cruza conferencias: solo cuenta el jugador de CN')
  assert.equal(cn.games.total, 1)
  const intl = buildLeaders(GAMES, ROWS, { temporada: '2026', categoryId: INT, teams: T })
  assert.deepEqual(ids(intl), ['p-mtyi'])
})
