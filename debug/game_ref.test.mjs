// shared/game-ref.js: lectura de ?game_id= / ?game=, resolución UUID|slug y
// degradación a UUID cuando el schema no tiene la función slug (prod antes de migrar).
// Sin red: fetchJson es un doble en memoria.
// Run: node --test debug/game_ref.test.mjs   (desde la raíz del repo)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readGameRef, resolveGameRef, withSlug, gameUrlRef, canonicalGameUrl, isUuid, _resetSlugSupport } from '../shared/game-ref.js'

const UUID = 'c9192eef-64bf-4f2d-bcaa-ee8afed922ec'
const SLUG = 'ONEFA-LM-MTY-CU-2026-W03'

function fakeFetch(handler) {
  const calls = []
  const fn = async path => { calls.push(path); return handler(path) }
  fn.calls = calls
  return fn
}
const noSlugColumn = () => { throw new Error('HTTP 400') }   // "column games.slug does not exist"

test('readGameRef acepta game_id y game; game_id vacío no tapa a game', () => {
  assert.equal(readGameRef(`?game_id=${UUID}`), UUID)
  assert.equal(readGameRef(`?game=${SLUG}&side=home`), SLUG)
  assert.equal(readGameRef(`?game_id=&game=${SLUG}`), SLUG)
  assert.equal(readGameRef('?env=staging'), null)
  assert.equal(readGameRef(new URLSearchParams(`game=%20${SLUG}%20`)), SLUG)
})

test('UUID se devuelve tal cual, sin consultar', async () => {
  const f = fakeFetch(() => { throw new Error('no debería consultar') })
  assert.deepEqual(await resolveGameRef(UUID, f), { id: UUID, via: 'uuid' })
  assert.deepEqual(await resolveGameRef(UUID.toUpperCase(), f), { id: UUID, via: 'uuid' })
  assert.equal(f.calls.length, 0)
})

test('slug: se pasa a mayúsculas y se consulta slug=eq con limit=2', async () => {
  const f = fakeFetch(() => [{ id: UUID }])
  assert.deepEqual(await resolveGameRef(SLUG.toLowerCase(), f), { id: UUID, via: 'slug' })
  assert.deepEqual(f.calls, [`games?select=id&slug=eq.${SLUG}&limit=2`])
})

test('slug inexistente, ambiguo, inválido o schema sin slug → id null con mensaje', async () => {
  const none = await resolveGameRef(SLUG, fakeFetch(() => []))
  assert.equal(none.id, null); assert.equal(none.reason, 'not_found'); assert.match(none.message, /Partido no encontrado/)
  const two = await resolveGameRef(SLUG, fakeFetch(() => [{ id: UUID }, { id: UUID }]))
  assert.equal(two.id, null)
  const f = fakeFetch(() => [{ id: UUID }])
  for (const bad of ['MTY', 'ONEFA-LM-MTY CU', 'a,b-c-d', 'ONEFA-LM-(x)-y']) {
    assert.equal((await resolveGameRef(bad, f)).reason, 'invalid', bad)
  }
  assert.equal(f.calls.length, 0, 'valores inválidos no llegan a PostgREST')
  const prod = await resolveGameRef(SLUG, fakeFetch(noSlugColumn))
  assert.equal(prod.id, null); assert.equal(prod.reason, 'lookup_failed')
  assert.equal((await resolveGameRef('', f)).reason, 'empty')
  const notUuid = await resolveGameRef(SLUG, fakeFetch(() => [{ id: 'no-es-uuid' }]))
  assert.equal(notUuid.id, null, 'nunca devuelve un id que no sea UUID')
})

test('withSlug: con slug pide ",slug"; sin slug reintenta sin él y no vuelve a pedirlo', async () => {
  _resetSlugSupport()
  const ok = fakeFetch(p => [{ id: UUID, slug: SLUG, p }])
  const rows = await withSlug(ok, s => `games?select=*${s}`)
  assert.deepEqual(ok.calls, ['games?select=*,slug'])
  assert.equal(gameUrlRef(rows[0]), SLUG)

  _resetSlugSupport()
  const prod = fakeFetch(p => { if (p.includes(',slug')) throw new Error('HTTP 400'); return [{ id: UUID }] })
  const r1 = await withSlug(prod, s => `games?select=*${s}`)
  assert.equal(gameUrlRef(r1[0]), UUID, 'link cae a UUID')
  await withSlug(prod, s => `games?select=id${s}`)
  assert.deepEqual(prod.calls, ['games?select=*,slug', 'games?select=*', 'games?select=id'])

  _resetSlugSupport()
  let n = 0
  const flaky = fakeFetch(() => { if (++n > 1) throw new Error('HTTP 500'); return [] })
  await withSlug(flaky, s => `a${s}`)
  await assert.rejects(withSlug(flaky, s => `b${s}`), /HTTP 500/, 'con slug ya confirmado, otro error se propaga')
})

test('canonicalGameUrl: cambia game_id por game=slug y conserva env/tab', () => {
  assert.equal(canonicalGameUrl(`https://x/live-stats/viewer/viewer.html?game_id=${UUID}&env=staging`, SLUG),
    `/live-stats/viewer/viewer.html?env=staging&game=${SLUG}`)
  assert.equal(canonicalGameUrl(`https://x/v.html?game=${SLUG}`, SLUG), null)
  assert.equal(canonicalGameUrl(`https://x/v.html?game=${SLUG.toLowerCase()}`, SLUG), `/v.html?game=${SLUG}`)
  assert.equal(canonicalGameUrl(`https://x/v.html?game_id=${UUID}`, undefined), null, 'sin slug no toca la URL')
  assert.ok(isUuid(UUID) && !isUuid(SLUG))
})
