// Flujo de penalidades del wizard de captura (live-stats/capture/wizard.js), manejado con el
// teclado sobre un DOM mínimo simulado: sin navegador, sin red y sin escribir en Supabase
// (no hay game id, así que engine.js no sincroniza; localStorage es un Map en memoria).
// Cubre flag_N_enforced / foul_spot / pressured_by, el aviso del kickoff, el retroceso con Esc,
// el modo edición y las pantallas de spot (Fase A del flujo de penalidades).
// Teclas del paso de equipo: A = ataque, D = defensa (antes H/A local/visitante).
// Run: node --test debug/wizard_flags.test.mjs   (desde la raíz del repo)
import { test } from 'node:test'
import assert from 'node:assert/strict'

// ── DOM mínimo (debe existir antes de importar wizard.js: registra su keydown al cargarse) ──
const origLog = console.log
console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('Play selected')) return; origLog(...a) }

let html = ''
const keyListeners = [], clicks = new Map(), els = new Map()
function findByClass(sel) {
  const cls = sel.replace(/^\./, '').split(/[\s\[]/)[0]
  const out = []
  for (const m of html.matchAll(/<(\w+)([^>]*)>/g)) {
    const c = /class="([^"]*)"/.exec(m[2])?.[1]?.split(/\s+/) || []
    if (!c.includes(cls)) continue
    const dataset = {}
    for (const d of m[2].matchAll(/data-([\w-]+)="([^"]*)"/g)) dataset[d[1].replace(/-(\w)/g, (_, x) => x.toUpperCase())] = d[2]
    out.push({ dataset, classList: { add() {}, remove() {} },
      addEventListener: (type, fn) => { if (type === 'click') clicks.set(`.${cls}:${JSON.stringify(dataset)}`, fn) } })
  }
  return out
}
function fakeEl(id) {
  return new Proxy({ id, value: '', dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {} } }, {
    get(t, k) {
      if (k in t) return t[k]
      if (k === 'innerHTML') return id === 'wizard-container' ? html : ''
      if (k === 'querySelectorAll') return sel => (id === 'wizard-container' ? findByClass(sel) : [])
      if (k === 'querySelector') return () => null
      if (k === 'addEventListener') return (type, fn) => { if (type === 'click') clicks.set('#' + id, fn) }
      return () => {}
    },
    set(t, k, v) { if (k === 'innerHTML' && id === 'wizard-container') html = v; t[k] = v; return true },
  })
}
globalThis.document = {
  getElementById: id => { if (!els.has(id)) els.set(id, fakeEl(id)); return els.get(id) },
  addEventListener: (type, fn) => { if (type === 'keydown') keyListeners.push(fn) },
  querySelectorAll: () => [], querySelector: () => null, createElement: () => fakeEl('x'), body: fakeEl('body'),
}
globalThis.window = globalThis
const store = new Map()
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }
globalThis.alert = () => {}

const screen = () => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const press = (...keys) => { for (const k of keys) for (const fn of keyListeners) fn({ key: k, target: { tagName: 'DIV' }, preventDefault() {} }) }
const type = s => press(...s.split(''))
const click = key => { const fn = clicks.get(key); if (!fn) throw new Error('no click ' + key); fn() }
const setValue = (id, v) => { document.getElementById(id).value = v }

const E = await import(new URL('../live-stats/capture/engine.js', import.meta.url).href)
const W = await import(new URL('../live-stats/capture/wizard.js', import.meta.url).href)
const L = await import(new URL('../shared/stats-lib.js', import.meta.url).href)

// ── Helpers de captura ────────────────────────────────────────────────────────
function reset(ctx = {}) {
  E.plays.length = 0
  const gs = E.gameState
  gs.teams = { home: { name: 'AAA', abreviatura: 'AAA' }, away: { name: 'BBB', abreviatura: 'BBB' } }
  Object.assign(gs, { possession: 'AAA', field_pos: { team: 'AAA', yard: 40 }, down: 1, distance: 10, quarter: 1, clock: '10:00', score: { home: 0, away: 0 } }, ctx)
  W.renderAddPlay(); Object.assign(gs, ctx)
}
const last = () => E.plays[E.plays.length - 1]
const flagKeys = p => Object.fromEntries(Object.entries(p).filter(([k]) => k.startsWith('flag_')))
const rush = (to = 'AAA45') => { press('r'); type('12'); press('Enter'); press('e'); type(to); press('Enter') }
const passComplete = to => { press('p'); type('12'); press('Enter'); press('c'); type('22'); press('Enter'); press('e'); type(to); press('Enter') }
const teamKey = side => (side === 'atk' ? 'a' : 'd')   // AAA tiene el balón en todos los escenarios
function flag(code, side, result, newLos, down) {
  press('e'); type(code); press(teamKey(side)); press(result)
  if (result === 'a') { press('Enter'); type(newLos); press('Enter'); press(down) }
}
const enforcedScreen = () => screen().startsWith('¿Desde dónde se aplicó la penalidad?')
const noMoreFlags = () => { assert.match(screen(), /¿Hay segundo flag\?/); press('n') }
const submit = () => { press('Enter'); return last() }
const noOrphans = p => {
  for (const n of [1, 2]) {
    if (!Object.keys(p).some(k => k.startsWith(`flag_${n}_`))) continue
    if (p[`flag_${n}_enforced`] !== 'foul_spot') assert.ok(!(`flag_${n}_foul_spot` in p), 'foul_spot huérfano')
    if (!p[`flag_${n}_enforced`]) assert.ok(!(`flag_${n}_timing` in p), 'timing huérfano')
  }
}
const leaveEdit = () => { press('Escape'); press('Escape') }

// ── Enforcement: preselección y captura ──────────────────────────────────────
test('corrida + HO de B más allá de la LOS: preselecciona "fin", la jugada cuenta', () => {
  reset(); rush('AAA45'); flag('HO', 'def', 'a', 'BBB45', 'f')
  assert.ok(enforcedScreen()); assert.match(screen(), /Fin de la jugada \(cuenta\) F \/ ↵/)
  press('Enter'); noMoreFlags(); const p = submit()
  assert.equal(p.flag_1_enforced, 'end'); assert.equal(p.flag_1_timing, 'dead'); assert.equal(p.net_yards, 5)
  assert.ok(!('stats_count' in p)); noOrphans(p)
})

test('corrida detrás de la LOS + falta de B: preselecciona "anterior" y anula', () => {
  reset(); rush('AAA38'); flag('FN', 'def', 'a', 'AAA48', 'f')
  assert.match(screen(), /Spot anterior \(anula la jugada\) P \/ ↵/); press('Enter'); noMoreFlags(); const p = submit()
  assert.equal(p.flag_1_enforced, 'previous'); assert.equal(p.flag_1_timing, 'live'); assert.equal(p.stats_count, false); assert.equal(p.net_yards, 0)
})

test('falta de snap (OD): preselecciona "anterior"', () => {
  reset(); rush('AAA45'); flag('OD', 'def', 'a', 'AAA45', 'r')
  assert.match(screen(), /Spot anterior \(anula la jugada\) P \/ ↵/)
})

test('pase completo + RP de B: sin preselección, Enter no avanza', () => {
  reset({ field_pos: { team: 'BBB', yard: 45 }, down: 2, distance: 8 }); passComplete('BBB30'); flag('RP', 'def', 'a', 'BBB15', 'f')
  assert.ok(enforcedScreen()); assert.ok(!/↵/.test(screen()))
  press('Enter'); assert.ok(enforcedScreen(), 'Enter no debe elegir nada')
  press('f'); noMoreFlags(); const p = submit()
  assert.equal(p.flag_1_enforced, 'end'); assert.equal(p.net_yards, 15)
})

test('clipping propio más allá de la LOS: pide el spot de la falta y guarda net 17', () => {
  reset({ field_pos: { team: 'AAA', yard: 30 } }); rush('AAA50'); flag('CL', 'atk', 'a', 'AAA32', 'r')
  press('s'); assert.match(screen(), /Escribe posición/); type('AAA47'); press('Enter'); noMoreFlags()
  assert.match(screen(), /rush for 17 yards to AAA 50/, 'el submit muestra las yardas netas guardadas')
  const p = submit()
  assert.equal(p.flag_1_enforced, 'foul_spot'); assert.deepEqual(p.flag_1_foul_spot, { team: 'AAA', yard: 47 }); assert.equal(p.net_yards, 17)
})

test('IG: no pregunta enforced, pide el presionador (opcional); net -8 y la jugada cuenta', () => {
  reset({ field_pos: { team: 'BBB', yard: 20 } }); press('p'); type('12'); press('Enter'); press('i'); press('Enter', 'Enter', 'Enter')
  assert.match(screen(), /INCOMPLETE Submit/)
  flag('IG', 'atk', 'a', 'BBB28', 'l'); assert.ok(!enforcedScreen()); assert.match(screen(), /Omitir/)
  type('99'); press('Enter'); noMoreFlags(); const p = submit()
  assert.equal(p.flag_1_pressured_by?.number, 99); assert.ok(!('flag_1_enforced' in p)); assert.ok(!('flag_1_timing' in p))
  assert.equal(p.net_yards, -8); assert.ok(!('stats_count' in p))
})

test('punt, kickoff y PAT: pregunta enforced sin preselección; en el PAT "fin" mide 15 desde la 35', () => {
  reset(); press('u'); type('5'); press('Enter'); press('t'); flag('RK', 'def', 'a', 'BBB45', 'f')
  assert.ok(enforcedScreen()); assert.ok(!/↵/.test(screen())); press('p'); noMoreFlags()
  assert.equal(submit().flag_1_enforced, 'previous')

  reset({ field_pos: { team: 'AAA', yard: 35 }, down: 0, distance: 0 }); press('k'); press('k'); type('5'); press('Enter'); press('t')
  flag('PF', 'def', 'a', 'BBB10', 'f'); assert.ok(enforcedScreen()); assert.ok(!/↵/.test(screen()))

  reset({ field_pos: { team: 'BBB', yard: 3 }, down: 0, distance: 0 }); press('a'); press('k'); type('5'); press('Enter'); press('g')
  flag('PF', 'def', 'a', 'AAA50', 'r'); assert.ok(enforcedScreen()); assert.ok(!/↵/.test(screen())); press('f'); noMoreFlags()
  const p = submit()
  assert.equal(p.flag_1_enforced, 'end'); assert.equal(L.computePenalties([p], 'AAA')[0].yards, 15)
})

test('declinada: no pregunta nada más; compensada: sólo el "Stats Count?" de siempre', () => {
  reset(); rush('AAA45'); flag('HO', 'atk', 'd'); noMoreFlags(); let p = submit()
  assert.deepEqual(Object.keys(flagKeys(p)).sort(), ['flag_1_infraction', 'flag_1_result', 'flag_1_team']); assert.equal(p.net_yards, 5)
  reset(); rush('AAA45'); flag('HO', 'atk', 'o'); assert.match(screen(), /Yes Y No N/); press('n'); noMoreFlags(); p = submit()
  assert.deepEqual(Object.keys(flagKeys(p)).sort(), ['flag_1_infraction', 'flag_1_result', 'flag_1_stats_count', 'flag_1_team'])
})

test('aviso "captúrala en el PAT": sólo con flag "fin" en una jugada de TD', () => {
  reset({ field_pos: { team: 'BBB', yard: 8 } }); rush('BBB0'); flag('PF', 'def', 'a', 'AAA50', 'r'); press('f'); noMoreFlags()
  assert.match(screen(), /Aplicada en el kickoff: captúrala en el PAT/)
  reset({ field_pos: { team: 'BBB', yard: 8 } }); rush('BBB0'); flag('HO', 'atk', 'a', 'BBB18', 'r'); press('p'); noMoreFlags()
  assert.ok(!/kickoff/.test(screen()), 'TD + previous: sin aviso')
  reset(); rush('AAA45'); flag('HO', 'def', 'a', 'BBB45', 'f'); press('f'); noMoreFlags(); assert.ok(!/kickoff/.test(screen()), 'fin sin TD: sin aviso')
  reset({ field_pos: { team: 'BBB', yard: 8 } }); rush('BBB0'); assert.ok(!/kickoff/.test(screen()), 'TD sin flag: sin aviso')
})

test('segundo flag: mismos pasos con flag_2_, preselección "fin"', () => {
  reset(); rush('AAA45'); flag('HO', 'atk', 'd'); press('y'); type('FN'); press('d'); press('a'); press('Enter'); type('BBB40'); press('Enter'); press('f')
  assert.match(screen(), /Fin de la jugada \(cuenta\) F \/ ↵/); press('Enter'); const p = submit()
  assert.equal(p.flag_2_enforced, 'end'); assert.equal(p.net_yards, 5); noOrphans(p)
})

// ── Retroceso con Esc ────────────────────────────────────────────────────────
test('Esc retrocede un paso y borra ese campo y los siguientes', () => {
  reset({ field_pos: { team: 'AAA', yard: 30 } }); rush('AAA50'); flag('CL', 'atk', 'a', 'AAA32', 'r')
  press('s'); assert.ok(screen().includes('Escribe posición'))
  press('Escape'); assert.ok(enforcedScreen())
  assert.ok(!('flag_1_enforced' in E.currentPlay) && !('flag_1_timing' in E.currentPlay) && !('flag_1_foul_spot' in E.currentPlay))
  press('Escape'); assert.match(screen(), /Repeat Down R/); assert.ok(!('flag_1_down_result' in E.currentPlay))
  press('Escape'); assert.ok(screen().includes('Escribe posición')); assert.ok(!('flag_1_new_los' in E.currentPlay))
  type('AAA32'); press('Enter'); press('r'); press('f'); noMoreFlags()
  const p = submit(); assert.equal(p.flag_1_enforced, 'end'); noOrphans(p); assert.equal(p.net_yards, 20)
})

test('Esc hasta el primer paso descarta el flag completo', () => {
  reset(); rush('AAA45'); flag('HO', 'def', 'a', 'BBB45', 'f'); for (let i = 0; i < 6; i++) press('Escape')
  assert.match(screen(), /Infraction Code/); press('Escape')
  assert.match(screen(), /rush for 5 yards to AAA 45 Submit/); assert.deepEqual(flagKeys(E.currentPlay), {})
  const p = submit(); assert.deepEqual(flagKeys(p), {}); assert.equal(p.net_yards, 5)
})

test('retroceder hasta "Result" y cambiar a declined no deja campos huérfanos', () => {
  reset(); rush('AAA45'); flag('HO', 'def', 'a', 'BBB45', 'f'); for (let i = 0; i < 4; i++) press('Escape'); press('d')
  noMoreFlags(); const p = submit()
  assert.deepEqual(Object.keys(flagKeys(p)).sort(), ['flag_1_infraction', 'flag_1_result', 'flag_1_team'])
})

// ── Modo edición ─────────────────────────────────────────────────────────────
const rowOf = (label) => [...html.matchAll(/data-idx="(\d+)">\s*<span class="edit-step-row__label">([^<]*)<\/span>\s*<span class="edit-step-row__value">([^<]*)</g)]
  .findLast(x => x[2] === label) || null
function openEdit(play) {
  reset(); E.plays.push(play); assert.equal(W.renderEditPlay(play), true)
  setValue('es-clock', play.clock); setValue('es-quarter', String(play.quarter)); setValue('es-poss', play.possession)
  setValue('es-fp', `${play.field_pos.team} ${play.field_pos.yard}`); setValue('es-down', String(play.down)); setValue('es-dist', String(play.distance))
}
const legacy = () => ({ play_id: 'x1', seq: 16, play_type: 'PASS', quarter: 2, clock: '05:00', possession: 'AAA', field_pos: { team: 'AAA', yard: 27 },
  down: 2, distance: 8, pass_by: { number: 12 }, pass_result: 'complete', received_by: { number: 22 }, result: 'tackle', at: { team: 'BBB', yard: 50 },
  net_yards: 0, touchdown: false, stats_count: false,
  flag_1_infraction: { code: 'HO', label: 'Holding' }, flag_1_team: 'AAA', flag_1_result: 'accepted', flag_1_by: null,
  flag_1_new_los: { team: 'AAA', yard: 17 }, flag_1_down_result: 'repeat_down' })

test('edición: una jugada vieja muestra el enforced mapeado y guardar sin cambios no la altera', () => {
  let play = legacy(); let before = JSON.stringify(play); openEdit(play)
  assert.equal(rowOf('Aplicada desde')[3], 'Spot anterior (anula la jugada) (mapeado)'); press('Enter')
  assert.equal(JSON.stringify(E.plays[0]), before)
  play = { ...legacy(), flag_1_team: 'BBB', flag_1_timing: 'dead', net_yards: 23 }; delete play.stats_count; before = JSON.stringify(play); openEdit(play)
  assert.equal(rowOf('Aplicada desde')[3], 'Fin de la jugada (cuenta) (mapeado)'); press('Enter')
  assert.equal(JSON.stringify(E.plays[0]), before)
})

test('edición: cambiar enforced / foul_spot / result recalcula y no deja huérfanos', () => {
  let play = legacy(); openEdit(play); click(`.edit-step-row:{"idx":"${rowOf('Aplicada desde')[1]}"}`)
  assert.ok(enforcedScreen()); assert.ok(!/↵/.test(screen()))
  press('f'); press('Enter'); let t = E.plays[0]
  assert.equal(t.flag_1_enforced, 'end'); assert.equal(t.flag_1_timing, 'dead'); assert.ok(!('stats_count' in t)); assert.equal(t.net_yards, 23)

  play = legacy(); openEdit(play); click(`.edit-step-row:{"idx":"${rowOf('Aplicada desde')[1]}"}`); press('s')
  type('AAA45'); press('Enter'); press('Enter'); t = E.plays[0]
  assert.equal(t.flag_1_enforced, 'foul_spot'); assert.equal(t.net_yards, 18)
  openEdit(t); click(`.edit-step-row:{"idx":"${rowOf('Aplicada desde')[1]}"}`); press('p'); press('Enter'); t = E.plays[0]
  assert.ok(!('flag_1_foul_spot' in t)); assert.equal(t.stats_count, false); assert.equal(t.net_yards, 0)

  play = legacy(); openEdit(play); click(`.edit-step-row:{"idx":"${rowOf('Result')[1]}"}`); press('d'); press('Enter'); t = E.plays[0]
  assert.deepEqual(Object.keys(flagKeys(t)).sort(), ['flag_1_infraction', 'flag_1_result', 'flag_1_team'])
  assert.ok(!('stats_count' in t)); assert.equal(t.net_yards, 23)
})

// ── Fase A: pantallas de spot, equipo y roster ───────────────────────────────
test('pantalla del balón tras la penalidad: título, explicación, LOS y fin de la jugada', () => {
  reset(); rush('AAA45'); press('e'); type('HO'); press('d'); press('a'); press('Enter')
  const t = screen()
  assert.match(t, /¿Dónde quedó el balón tras la penalidad\? \(siguiente snap\)/)
  assert.match(t, /Es la yarda desde donde empieza la siguiente jugada/)
  assert.match(t, /Línea de scrimmage: AAA 40/); assert.match(t, /Fin de la jugada: AAA 45/)
  assert.ok(!/Snap:/.test(t)); assert.ok(!/New LOS/.test(t))
})

test('yarda de la falta: título, explicación y los tres spots de referencia', () => {
  reset({ field_pos: { team: 'AAA', yard: 30 } }); rush('AAA50'); press('e'); type('CL'); press('a'); press('a'); press('Enter'); type('AAA32'); press('Enter'); press('r'); press('s')
  const t = screen()
  assert.match(t, /¿En qué yarda ocurrió la falta\?/); assert.match(t, /La jugada cuenta hasta aquí y la penalidad se mide desde aquí/)
  assert.match(t, /Línea de scrimmage: AAA 30/); assert.match(t, /Fin de la jugada: AAA 50/); assert.match(t, /Balón tras la penalidad: AAA 32/)
})

test('jugada PENALTY suelta: sólo la LOS; un AT normal conserva el chip "Snap"', () => {
  reset(); press('e'); type('FS'); press('a'); press('a'); press('Enter')
  let t = screen()
  assert.match(t, /¿Dónde quedó el balón tras la penalidad\?/); assert.match(t, /Línea de scrimmage: AAA 40/); assert.ok(!/Fin de la jugada/.test(t))
  reset(); press('r'); type('12'); press('Enter'); press('e'); t = screen()
  assert.match(t, /Snap: AAA 40/); assert.ok(!/penalidad/.test(t))
})

test('equipo: Ataque / Defensa según la posesión; guarda el nombre del equipo', () => {
  reset(); rush('AAA45'); press('e'); type('HO')
  assert.match(screen(), /¿Quién cometió la falta\? Ataque \(AAA\) A Defensa \(BBB\) D/)
  press('h'); assert.match(screen(), /¿Quién cometió la falta\?/, 'H ya no hace nada'); press('d'); assert.match(screen(), /Accepted A/)
  press('a'); press('Enter'); type('BBB45'); press('Enter'); press('f'); press('f'); press('n'); press('Enter')
  assert.equal(last().flag_1_team, 'BBB')
  reset(); rush('AAA45'); press('e'); type('HO'); press('a'); press('d'); press('n'); press('Enter'); assert.equal(last().flag_1_team, 'AAA')

  reset({ possession: 'BBB', field_pos: { team: 'BBB', yard: 40 } }); press('r'); type('12'); press('Enter'); press('e'); type('BBB45'); press('Enter'); press('e'); type('OS')
  assert.match(screen(), /Ataque \(BBB\) A Defensa \(AAA\) D/); press('a'); press('d'); press('n'); press('Enter'); assert.equal(last().flag_1_team, 'BBB')

  reset(); press('e'); type('FS'); assert.match(screen(), /¿Quién cometió la falta\? Ataque \(AAA\) A Defensa \(BBB\) D/)
  press('a'); press('a'); press('Enter'); type('AAA35'); press('Enter'); press('r'); press('Enter'); assert.equal(last().penalty_team, 'AAA')

  reset(); press('r'); type('12'); press('Enter'); press('f'); type('AAA44'); press('Enter'); press('Enter'); press('Enter'); press('Enter')
  assert.ok(!/Ataque/.test(screen()), 'los demás pasos de equipo siguen local/visitante')
})

test('equipo en edición: "AAA (defensa)" y el selector usa la posesión de la jugada editada', () => {
  const play = { play_id: 'x1', seq: 5, play_type: 'RUSH', quarter: 1, clock: '10:00', possession: 'BBB', field_pos: { team: 'BBB', yard: 40 }, down: 1, distance: 10,
    rush_by: { number: 12 }, result: 'tackle', at: { team: 'BBB', yard: 45 }, net_yards: 5, touchdown: false,
    flag_1_infraction: { code: 'HO', label: 'Holding' }, flag_1_team: 'AAA', flag_1_result: 'accepted', flag_1_new_los: { team: 'AAA', yard: 45 }, flag_1_down_result: 'first_down' }
  reset(); E.plays.push(play); W.renderEditPlay(play)
  assert.equal(rowOf('Cometió la falta')[3], 'AAA (defensa)')
  click(`.edit-step-row:{"idx":"${rowOf('Cometió la falta')[1]}"}`); assert.match(screen(), /Ataque \(BBB\) A Defensa \(AAA\) D/)
  leaveEdit()
  reset(); E.plays.push(play); W.renderEditPlay(play)
  click(`.edit-step-row:{"idx":"${rowOf('Balón tras la penalidad')[1]}"}`)
  assert.match(screen(), /Línea de scrimmage: BBB 40/); assert.match(screen(), /Fin de la jugada: BBB 45/)
  leaveEdit()
})

test('Penalty By: roster del equipo que cometió la falta (en vivo, PENALTY suelta y edición)', () => {
  const P = (number, apellido) => ({ number, nombre: 'X', apellido, position: '' })
  E.setRosters([P(1, 'Local'), P(2, 'Local2')], [P(50, 'Visita'), P(51, 'Visita2')])   // AAA = local, BBB = visitante
  try {
    reset(); rush('AAA45'); press('e'); type('HO'); press('d'); press('a')
    let t = screen(); assert.match(t, /→ 50 51/); assert.ok(!/→ 1 2/.test(t), 'falta de la defensa: roster de BBB')
    press('5'); press('0'); press('Enter'); assert.match(screen(), /¿Dónde quedó el balón tras la penalidad\?/)
    type('BBB45'); press('Enter'); press('f'); press('f'); press('n'); press('Enter'); assert.equal(last().flag_1_by?.apellido, 'Visita')

    reset(); rush('AAA45'); press('e'); type('CL'); press('a'); press('a'); t = screen(); assert.match(t, /→ 1 2/); assert.ok(!/→ 50 51/.test(t))
    reset(); press('e'); type('FS'); press('d'); press('a'); t = screen(); assert.match(t, /→ 50 51/); assert.ok(!/→ 1 2/.test(t))

    const play = { play_id: 'x1', seq: 5, play_type: 'RUSH', quarter: 1, clock: '10:00', possession: 'BBB', field_pos: { team: 'BBB', yard: 40 }, down: 1, distance: 10,
      rush_by: { number: 50 }, result: 'tackle', at: { team: 'BBB', yard: 45 }, net_yards: 5, touchdown: false,
      flag_1_infraction: { code: 'HO', label: 'Holding' }, flag_1_team: 'AAA', flag_1_result: 'accepted', flag_1_new_los: { team: 'AAA', yard: 45 }, flag_1_down_result: 'first_down' }
    reset(); E.plays.push(play); W.renderEditPlay(play)
    click(`.edit-step-row:{"idx":"${rowOf('Penalty By')[1]}"}`); t = screen(); assert.match(t, /→ 1 2/); assert.ok(!/→ 50 51/.test(t), 'edición: equipo de la falta de la jugada editada')
    leaveEdit()

    reset({ field_pos: { team: 'BBB', yard: 20 } }); press('p'); type('1'); press('Enter'); press('i'); press('Enter', 'Enter', 'Enter')
    press('e'); type('IG'); press('a'); press('a'); press('Enter'); type('BBB28'); press('Enter'); press('l')
    assert.match(screen(), /→ 50 51/, '"Presionado por" sigue con el roster del rival')
  } finally {
    E.setRosters([], [])
  }
})
