// Unit tests for normalizeName / matchStatName (matching de nombres de PDFs de Tableau).
// Run: node --test debug/stat_name_match.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeName, matchStatName, rosterFullName, normName } from '../shared/stats-lib.js'

const P = (id, apellido, nombre, nombre_completo = null) => ({ id, apellido, nombre, nombre_completo })

test('normalizeName: acentos, ñ, puntuación, espacios', () => {
  assert.equal(normalizeName('  RODRíGUEZ   Núñez, J. '), 'RODRIGUEZ NUNEZ J')
  assert.equal(normalizeName('FéLIX'), 'FELIX')
  assert.equal(normalizeName("D'Angelo-Pérez"), 'DANGELO PEREZ')
  assert.equal(normalizeName(null), '')
})

test('normName existente sigue igual (no se tocó)', () => {
  assert.equal(normName(' Félix '), 'felix')
})

test('acentos inconsistentes: RODRíGUEZ vs Rodriguez, FéLIX vs Felix → exact', () => {
  const r = [P('a', 'Rodriguez', 'Juan'), P('b', 'De Leon', 'Felix')]
  assert.deepEqual(matchStatName('RODRíGUEZ JUAN', r), { level: 'exact', player: r[0] })
  assert.deepEqual(matchStatName('DE LEóN FéLIX', r), { level: 'exact', player: r[1] })
})

test('2 apellidos en el PDF vs 1 en el roster → approx', () => {
  const r = [P('a', 'Rodriguez', 'Juan Carlos'), P('b', 'Lopez', 'Luis')]
  const m = matchStatName('RODRÍGUEZ MARTÍNEZ JUAN CARLOS', r)
  assert.equal(m.level, 'approx')
  assert.equal(m.player.id, 'a')
})

test('homónimos (GARZA RODRIGO ×2) → ambiguous con ambos candidatos', () => {
  const r = [P('a', 'Garza', 'Rodrigo'), P('b', 'Garza', 'Rodrigo'), P('c', 'Garza', 'Pedro')]
  const m = matchStatName('GARZA RODRIGO', r)
  assert.equal(m.level, 'ambiguous')
  assert.deepEqual(m.candidates.map(p => p.id).sort(), ['a', 'b'])
  assert.equal(m.player, undefined)
})

test('homónimos en approx también son ambiguous', () => {
  const r = [P('a', 'Garza', 'Rodrigo'), P('b', 'Garza', 'Rodrigo')]
  const m = matchStatName('GARZA LOPEZ RODRIGO', r)
  assert.equal(m.level, 'ambiguous')
  assert.equal(m.candidates.length, 2)
})

test('apellido compuesto DE LA ROSA', () => {
  const r = [P('a', 'De La Rosa', 'Patricio')]
  assert.equal(matchStatName('DE LA ROSA PATRICIO', r).level, 'exact')
  const m = matchStatName('DE LA ROSA GARZA PATRICIO', r)
  assert.equal(m.level, 'approx')
  assert.equal(m.player.id, 'a')
})

test('nombre extra en el PDF → approx', () => {
  const r = [P('a', 'Flores', 'Adrian')]
  const m = matchStatName('FLORES ADRIÁN PATRICIO', r)
  assert.equal(m.level, 'approx')
  assert.equal(m.player.id, 'a')
})

test('sin candidato → none', () => {
  const r = [P('a', 'Flores', 'Adrian')]
  assert.deepEqual(matchStatName('PEREZ LUIS', r), { level: 'none' })
  assert.deepEqual(matchStatName('', r), { level: 'none' })
  assert.deepEqual(matchStatName('X', []), { level: 'none' })
})

test('approx exige que la primera palabra del PDF sea el apellido del roster', () => {
  // Mismas palabras pero en otro orden (nombre primero): no es approx.
  const r = [P('a', 'Flores', 'Adrian')]
  assert.equal(matchStatName('ADRIAN FLORES MARTINEZ', r).level, 'none')
})

test('nombre_completo del roster tiene prioridad en exact', () => {
  const r = [P('a', 'Rodriguez', 'Juan', 'RODRIGUEZ MARTINEZ JUAN')]
  assert.equal(rosterFullName(r[0]), 'RODRIGUEZ MARTINEZ JUAN')
  assert.equal(matchStatName('RODRÍGUEZ MARTÍNEZ JUAN', r).level, 'exact')
})

test('exact gana sobre approx', () => {
  const r = [P('a', 'Garza', 'Rodrigo'), P('b', 'Garza', 'Rodrigo Alberto')]
  const m = matchStatName('GARZA RODRIGO', r)
  assert.equal(m.level, 'exact')
  assert.equal(m.player.id, 'a')
})

test('exact con orden invertido: "Fernando Tonda Urias" == "TONDA URIAS FERNANDO"', () => {
  const r = [P('a', 'Tonda', 'Fernando', 'Fernando Tonda Urias'), P('b', 'Sarabia', 'Fernando', 'Fernando Sarabia Rodríguez')]
  const m = matchStatName('TONDA URIAS FERNANDO', r)
  assert.equal(m.level, 'exact')
  assert.equal(m.player.id, 'a')
  assert.equal(matchStatName('SARABIA RODRíGUEZ FERNANDO', r).player.id, 'b')
})

test('exact por conjunto sin nombre_completo: apellido+nombre en cualquier orden', () => {
  const r = [P('a', 'Garza', 'Rodrigo')]
  assert.equal(matchStatName('RODRIGO GARZA', r).level, 'exact')
  assert.equal(matchStatName('GARZA RODRIGO', r).level, 'exact')
})

test('dos jugadores con el mismo conjunto de palabras (orden distinto) → ambiguous', () => {
  const r = [P('a', 'Garza', 'Rodrigo', 'Rodrigo Garza Martinez'), P('b', 'Garza', 'Rodrigo', 'GARZA MARTÍNEZ RODRIGO')]
  const m = matchStatName('GARZA MARTINEZ RODRIGO', r)
  assert.equal(m.level, 'ambiguous')
  assert.equal(m.candidates.length, 2)
})

test('mismas palabras pero distinto conjunto no es exact', () => {
  const r = [P('a', 'Tonda', 'Fernando', 'Fernando Tonda Urias')]
  assert.notEqual(matchStatName('TONDA FERNANDO', r).level, 'exact')
})
