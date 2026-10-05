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

test('new ref with nombre/apellido resolves by number', () => {
  assert.equal(resolvePlayerKey({ nombre: 'Edson', apellido: 'Rincón', number: 3 }, idx), 'p2')
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
