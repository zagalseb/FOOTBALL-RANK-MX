// setup.html alta: similarRosterPlayers warns when a new player shares a number and part of a name
// with someone already in the roster. Synthetic data: see debug/helpers/duplicate_scenario.mjs.
// Run: node --test debug/roster_similar.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { similarRosterPlayers } from '../shared/stats-lib.js'
import { TB, B_DROP, B_KEEP, roster2026 } from './helpers/duplicate_scenario.mjs'

test('alta: "Omar Vega #3" junto a "Omar Rios #3" avisa (comparten OMAR y RIOS)', () => {
  const roster = roster2026(TB).filter(p => p.id !== B_KEEP.id)   // el roster antes de crear la 2.ª fila
  const hits = similarRosterPlayers({ number: 3, nombre: 'Omar', apellido: 'Vega', nombre_completo: 'Omar Del Vega Rios Soto', temporada: '2026' }, roster)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].player.id, B_DROP.id)
  assert.deepEqual(hits[0].shared.sort(), ['OMAR', 'RIOS'])   // normalizeName devuelve mayúsculas
})

test('alta: sin nombre_completo basta con compartir una palabra de nombre/apellido', () => {
  const roster = roster2026(TB).filter(p => p.id !== B_KEEP.id)
  const hits = similarRosterPlayers({ number: 3, nombre: 'Omar', apellido: 'Vega', temporada: '2026' }, roster)
  assert.deepEqual(hits.map(h => h.player.id), [B_DROP.id])
})

test('alta: no avisa con número distinto, nombre sin relación, otra temporada ni el mismo jugador', () => {
  const roster = roster2026(TB)
  assert.equal(similarRosterPlayers({ number: 99, nombre: 'Omar', apellido: 'Vega', temporada: '2026' }, roster).length, 0)        // número libre
  assert.equal(similarRosterPlayers({ number: 3, nombre: 'Pedro', apellido: 'Lopez', temporada: '2026' }, roster).length, 0)        // nada en común
  assert.equal(similarRosterPlayers({ number: 3, nombre: 'Omar', apellido: 'Vega', temporada: '2025' }, roster).length, 0)        // roster de otra temporada
  assert.equal(similarRosterPlayers({ id: B_DROP.id, number: 3, nombre: 'Omar', apellido: 'Rios', temporada: '2026' }, roster.filter(p => p.id !== B_KEEP.id)).length, 0)  // editarse a sí mismo
})

test('alta: ignora palabras cortas (De, La) para no avisar de más', () => {
  const roster = [{ id: 'a', number: 5, nombre: 'Luis', apellido: 'De La Rosa', temporada: '2026' }]
  assert.equal(similarRosterPlayers({ number: 5, nombre: 'Pedro', apellido: 'De La Cruz', temporada: '2026' }, roster).length, 0)
})
