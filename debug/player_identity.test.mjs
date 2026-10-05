// Unit tests for shared/stats-lib.js player identity (C1/C2).
// Run: node --test debug/player_identity.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRosterIndex, resolvePlayerKey, isOrphanKey, buildDisplayLabels,
  labelForKey, countOrphans, normName,
} from '../shared/stats-lib.js'

const TEAM = 'team-A'
const roster = [
  { id: 'p1', number: 12, nombre: 'Edson', apellido: 'Rincón' },
  { id: 'p2', number: 3,  nombre: 'Emilio', apellido: 'Lozada' },
]
const idx = buildRosterIndex(TEAM, roster)

test('ref with player_id is used as-is', () => {
  assert.equal(resolvePlayerKey({ player_id: 'zzz', number: 99 }, idx), 'zzz')
})

test('old ref with empty name resolves by team+number', () => {
  assert.equal(resolvePlayerKey({ name: '', number: 12, position: 'QB' }, idx), 'p1')
})

test('new ref with matching surname resolves by number', () => {
  assert.equal(resolvePlayerKey({ nombre: 'Emilio', apellido: 'Lozada', number: 3 }, idx), 'p2')
})

test('lone roster player with same number but another surname is an orphan', () => {
  // #3 on this roster is Lozada; an #3 Rincón (other season) must not become Lozada.
  assert.ok(isOrphanKey(resolvePlayerKey({ nombre: 'Edson', apellido: 'Rincón', number: 3 }, idx)))
})

test('number not on roster becomes an orphan key', () => {
  const k = resolvePlayerKey({ name: 'Nadie Visto', number: 77 }, idx)
  assert.ok(isOrphanKey(k))
  assert.equal(countOrphans([k, 'p1', k]), 2)
})

test('duplicate numbers: disambiguated by normalized name (future case)', () => {
  const dup = buildRosterIndex(TEAM, [
    { id: 'a', number: 7, nombre: 'Luis', apellido: 'Pérez' },
    { id: 'b', number: 7, nombre: 'Jorge', apellido: 'Gómez' },
  ])
  assert.equal(resolvePlayerKey({ nombre: '  LUIS ', apellido: 'perez', number: 7 }, dup), 'a')
  assert.ok(isOrphanKey(resolvePlayerKey({ nombre: 'Ana', apellido: 'X', number: 7 }, dup)))
})

test('old and new refs of the same player collapse to one key', () => {
  const oldRef = { name: 'Edson Rincón', number: 12 }
  const newRef = { nombre: 'Edson', apellido: 'Rincón', number: 12 }
  assert.equal(resolvePlayerKey(oldRef, idx), resolvePlayerKey(newRef, idx))
})

test('display labels disambiguate equal short labels', () => {
  const dup = buildRosterIndex(TEAM, [
    { id: 'a', number: 7, nombre: 'Luis', apellido: 'Pérez' },
    { id: 'b', number: 7, nombre: 'Luis', apellido: 'Pérez' },
    { id: 'c', number: 9, nombre: 'Ana', apellido: 'Ruiz' },
  ])
  const labels = buildDisplayLabels(dup)
  assert.equal(labels.get('c'), '#9 A. Ruiz')
  assert.equal(labels.get('a'), '#7 Luis Pérez')
  assert.equal(labels.get('b'), '#7 Luis Pérez')
})

test('labelForKey falls back to the reference for orphans', () => {
  const labels = buildDisplayLabels(idx)
  assert.equal(labelForKey('p1', idx, labels, {}), '#12 E. Rincón')
  assert.equal(labelForKey('orphan:x', idx, labels, { number: 5, nombre: 'Ana', apellido: 'Ruiz' }), '#5 A. Ruiz')
})

test('normName strips accents, case and spaces', () => {
  assert.equal(normName('  Rincón '), 'rincon')
})

import { computePlayerStats } from '../shared/stats-lib.js'

test('computePlayerStats with roster index separates duplicate numbers (C3)', () => {
  const dupIdx = buildRosterIndex('T', [
    { id: 'a', number: 12, nombre: 'Edson', apellido: 'Rincón' },
    { id: 'b', number: 12, nombre: 'Luis', apellido: 'Pérez' },
  ])
  const plays = [
    { play_type: 'RUSH', possession: 'T', net_yards: 5, rush_by: { number: 12, nombre: 'Edson', apellido: 'Rincón' } },
    { play_type: 'RUSH', possession: 'T', net_yards: 9, rush_by: { number: 12, nombre: 'Luis', apellido: 'Pérez' } },
    { play_type: 'RUSH', possession: 'T', net_yards: 2, rush_by: { number: 12, name: '' } },   // old ref, number-only
  ]
  const a = computePlayerStats(plays, { id: 'a', number: 12 }, 'T', dupIdx)
  const b = computePlayerStats(plays, { id: 'b', number: 12 }, 'T', dupIdx)
  assert.equal(a.rushing.yds, 5)   // old ref without names: unresolvable among duplicates -> orphan, not counted
  assert.equal(b.rushing.yds, 9)
  // legacy call (no index) keeps number-only behaviour
  assert.equal(computePlayerStats(plays, { number: 12 }, 'T').rushing.yds, 16)
})

// Surname contradiction (approved 2026-10-05): a lone roster player with the
// same number is NOT the same player when both surnames are present and differ.
const solo = buildRosterIndex(TEAM, [{ id: 'm', number: 35, nombre: 'Juan Pablo', apellido: 'Mandujano' }])

test('lone number with contradicting surname is an orphan', () => {
  assert.ok(isOrphanKey(resolvePlayerKey({ nombre: 'Lucio', apellido: 'Ascolani', number: 35 }, solo)))
})

test('same letters with different case, spaces or accents do NOT make an orphan', () => {
  assert.equal(resolvePlayerKey({ nombre: 'x', apellido: '  MANDÚJANO ', number: 35 }, solo), 'm')
  assert.equal(resolvePlayerKey({ nombre: 'x', apellido: 'Mandujano', number: 35 }, solo), 'm')
})

test('ref without surname with lone number resolves as before', () => {
  assert.equal(resolvePlayerKey({ name: '', number: 35 }, solo), 'm')
  assert.equal(resolvePlayerKey({ nombre: 'Juan', apellido: '', number: 35 }, solo), 'm')
})

test('ref with surname against roster row with empty surname resolves as before', () => {
  const blank = buildRosterIndex(TEAM, [{ id: 'z', number: 9, nombre: 'Sin', apellido: '' }])
  assert.equal(resolvePlayerKey({ nombre: 'Ana', apellido: 'Lopez', number: 9 }, blank), 'z')
})

// Roster duplicate rule (B4).
import { rosterDuplicate } from '../shared/stats-lib.js'
const named = [
  { id: 'a', number: 7, nombre: 'Luis', apellido: 'Pérez', temporada: '2026' },
  { id: 'n', number: 9, nombre: '', apellido: '', temporada: '2026' },
]
test('exact duplicate (same number, names, accents/case) is blocked', () => {
  assert.equal(rosterDuplicate({ number: 7, nombre: ' LUIS ', apellido: 'perez' }, named).kind, 'exact')
})
test('same number with different names is allowed', () => {
  assert.equal(rosterDuplicate({ number: 7, nombre: 'Jorge', apellido: 'Gómez' }, named), null)
})
test('same number when either side has no name is blocked with a clear message', () => {
  const r1 = rosterDuplicate({ number: 9, nombre: 'Ana', apellido: 'Lopez' }, named)
  assert.equal(r1.kind, 'nameless')
  assert.match(r1.message, /sin nombre/)
  assert.equal(rosterDuplicate({ number: 7, nombre: '', apellido: '' }, named).kind, 'nameless')
})
test('the row being edited is not a duplicate of itself', () => {
  assert.equal(rosterDuplicate({ id: 'a', number: 7, nombre: 'Luis', apellido: 'Pérez' }, named), null)
})
test('a row of another season does not count as a duplicate', () => {
  assert.equal(rosterDuplicate({ number: 7, nombre: 'Luis', apellido: 'Pérez', temporada: '2025' }, named), null)
})
test('rows without temporada field are compared without season filtering', () => {
  const noSeason = [{ id: 'x', number: 4, nombre: 'Ana', apellido: 'Ruiz' }]
  assert.equal(rosterDuplicate({ number: 4, nombre: 'ana', apellido: 'ruiz', temporada: '2026' }, noSeason).kind, 'exact')
})

// Temporada (preparation): same number and team in two seasons is not a repeat.
import { getGameTemporada, filterRosterBySeason } from '../shared/stats-lib.js'
const two = [
  { id: 'old', team_id: TEAM, number: 7, nombre: 'Luis', apellido: 'Pérez', temporada: '2025' },
  { id: 'new', team_id: TEAM, number: 7, nombre: 'Luis', apellido: 'Pérez', temporada: '2026' },
]
test('same number/team in two seasons: index of one season sees only that season', () => {
  const i26 = buildRosterIndex(TEAM, two, '2026')
  assert.deepEqual(i26.byNumber.get(7).map(p => p.id), ['new'])
  assert.equal(resolvePlayerKey({ nombre: 'Luis', apellido: 'Pérez', number: 7 }, i26), 'new')
  assert.equal(resolvePlayerKey({ nombre: 'Luis', apellido: 'Pérez', number: 7 }, buildRosterIndex(TEAM, two, '2025')), 'old')
})
test('same number in two seasons is not a duplicate in the roster rule', () => {
  assert.equal(rosterDuplicate({ number: 7, nombre: 'Luis', apellido: 'Pérez', temporada: '2026' }, two.filter(p => p.temporada === '2025')), null)
})
test('rows without temporada are not season-filtered', () => {
  const plain = [{ id: 'p', number: 3, nombre: 'Ana', apellido: 'Ruiz' }]
  assert.equal(buildRosterIndex(TEAM, plain, '2026').byNumber.get(3).length, 1)
  assert.equal(filterRosterBySeason(plain, '2026').length, 1)
})
test('getGameTemporada: explicit season, else kickoff year', () => {
  assert.equal(getGameTemporada({ temporada: '2026', kickoff: '2025-09-01T00:00:00+00:00' }), '2026')
  assert.equal(getGameTemporada({ temporada: null, kickoff: '2025-09-01T00:00:00+00:00' }), '2025')
  assert.equal(getGameTemporada({ temporada: null, kickoff: null }), null)
})
