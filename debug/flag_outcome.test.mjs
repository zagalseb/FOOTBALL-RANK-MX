// H-06: flagOutcome() is the read-time authority over a flagged play's net_yards/
// touchdown/stats_count. Plays captured with flag_N_timing live/dead/missing (no
// flag_N_enforced) must resolve exactly as wizard.js stored them before, except the
// two production plays identified in the lote 3 proposal.
// Run: node --test debug/flag_outcome.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flagOutcome, resolvePlay, calcNetYards, isTouchdown, _firstDownsOnPlay } from '../shared/stats-lib.js'

const teams = { home: { name: 'AAA' }, away: { name: 'BBB' } }

// wizard.js _confirmSubmit before lote 3: _flagVoidsPlay + net_yards/touchdown from `at`.
function oldSubmit(p) {
  const voids = [1, 2].some(n => p[`flag_${n}_result`] === 'accepted' &&
    ['repeat_down', 'loss_of_down', 'first_down'].includes(p[`flag_${n}_down_result`]) &&
    p[`flag_${n}_timing`] !== 'dead')
  const out = { ...p }
  if (p.at) {
    out.net_yards = calcNetYards(teams, p.possession, p.field_pos, p.at)
    out.touchdown = isTouchdown(teams, p.possession, p.at)
  }
  if (voids) { out.net_yards = 0; out.touchdown = false; out.stats_count = false }
  return out
}

const bases = {
  rushGain: { play_type: 'RUSH', possession: 'AAA', field_pos: { team: 'AAA', yard: 40 }, at: { team: 'AAA', yard: 45 } },
  rushTD:   { play_type: 'RUSH', possession: 'BBB', field_pos: { team: 'AAA', yard: 8 }, at: { team: 'AAA', yard: 0 } },
  passInc:  { play_type: 'PASS', pass_result: 'incomplete', possession: 'AAA', field_pos: { team: 'BBB', yard: 30 } },
  fumble:   { play_type: 'RUSH', result: 'fumble', possession: 'AAA', field_pos: { team: 'BBB', yard: 30 },
              fumble_recovery_team: 'BBB', fumble_recovered_at: { team: 'BBB', yard: 25 } },
  punt:     { play_type: 'PUNT', punt_result: 'fair_catch', possession: 'AAA', field_pos: { team: 'AAA', yard: 40 } },
  kickoff:  { play_type: 'KICK', kick_type: 'kickoff', kickoff_result: 'touchback', possession: 'AAA', field_pos: { team: 'AAA', yard: 35 } },
  fg:       { play_type: 'KICK', kick_type: 'field_goal', fg_result: 'good', possession: 'AAA', field_pos: { team: 'BBB', yard: 25 } },
}

// Punts and kickoffs (2026-11-13): a legacy flag (no flag_N_enforced) no
// longer voids them — the timing mapping can't tell a previous-spot foul from a
// foul by the receiving team after the kick, so only an explicit
// flag_N_enforced === 'previous' voids a punt or kickoff. Every other play
// with a legacy flag, field goals included, still resolves exactly as the
// wizard stored it.
const legacyKickCounts = base => base.play_type === 'PUNT' || (base.play_type === 'KICK' && base.kick_type === 'kickoff')

test('live / dead / sin timing: flagOutcome reproduce lo que guardaba el wizard (salvo punts y kickoffs, que ya no se anulan)', () => {
  let n = 0
  for (const [name, base] of Object.entries(bases)) {
    for (const timing of ['live', 'dead', null, undefined]) {
      for (const down of ['repeat_down', 'loss_of_down', 'first_down', undefined]) {
        for (const result of ['accepted', 'declined', 'offsetting']) {
          const flagged = { ...base, flag_1_infraction: { code: 'HO' }, flag_1_team: 'BBB', flag_1_result: result,
            flag_1_new_los: { team: 'BBB', yard: 45 }, flag_1_down_result: down }
          if (timing !== undefined) flagged.flag_1_timing = timing
          const stored = oldSubmit(flagged)
          const r = resolvePlay(stored)
          const ctx = `${name} timing=${timing} down=${down} ${result}`
          if (legacyKickCounts(base)) {
            // Never voided; the zeros of a capture-time void no longer apply (null yards).
            assert.equal(r.stats_count === false, false, ctx)
            assert.equal(r.net_yards ?? null, stored.stats_count === false ? null : (stored.net_yards ?? null), ctx)
            assert.equal(r.touchdown ?? false, false, ctx)
          } else {
            assert.equal(r.stats_count === false, stored.stats_count === false, ctx)
            assert.equal(r.net_yards ?? null, stored.net_yards ?? null, ctx)
            assert.equal(r.touchdown ?? false, stored.touchdown ?? false, ctx)
          }
          n++
        }
      }
    }
  }
  assert.equal(n, 7 * 4 * 4 * 3)

  // Punts y kickoffs: solo flag_N_enforced = previous explícito los anula; los FG siguen la regla anterior.
  const flag = extra => ({ flag_1_infraction: { code: 'RK' }, flag_1_team: 'BBB', flag_1_result: 'accepted',
    flag_1_new_los: { team: 'BBB', yard: 45 }, flag_1_down_result: 'first_down', ...extra })
  for (const name of ['punt', 'kickoff']) {
    assert.equal(flagOutcome({ ...bases[name], ...flag({ flag_1_timing: 'live' }) }).voided, false, `${name} viejo`)
    assert.equal(flagOutcome({ ...bases[name], ...flag({ flag_1_enforced: 'previous', flag_1_timing: 'live' }) }).voided, true, `${name} previous`)
    assert.equal(flagOutcome({ ...bases[name], ...flag({ flag_1_enforced: 'end', flag_1_timing: 'dead' }) }).voided, false, `${name} end`)
  }
  assert.equal(flagOutcome({ ...bases.fg, ...flag({ flag_1_timing: 'live' }) }).voided, true, 'fg viejo')
  assert.equal(flagOutcome({ ...bases.fg, ...flag({ flag_1_enforced: 'previous', flag_1_timing: 'live' }) }).voided, true, 'fg previous')
  assert.equal(flagOutcome({ ...bases.fg, ...flag({ flag_1_enforced: 'end', flag_1_timing: 'dead' }) }).voided, false, 'fg end')
})

// The 4 flagged plays in covercero.plays (all in TEST games), as stored.
const prod = {
  '2dd8·16': { play_type: 'PASS', pass_result: 'complete', possession: 'CU', field_pos: { team: 'CU', yard: 27 }, down: 2, distance: 8,
    at: { team: 'CCM', yard: 50 }, net_yards: 0, touchdown: false, stats_count: false,
    flag_1_infraction: { code: 'HO' }, flag_1_team: 'CU', flag_1_result: 'accepted', flag_1_new_los: { team: 'CU', yard: 17 }, flag_1_down_result: 'repeat_down' },
  '2dd8·18': { play_type: 'PASS', pass_result: 'incomplete', possession: 'CU', field_pos: { team: 'CU', yard: 22 }, down: 2, distance: 15,
    net_yards: null,
    flag_1_infraction: { code: 'PI' }, flag_1_team: 'CCM', flag_1_result: 'accepted', flag_1_new_los: { team: 'CU', yard: 37 }, flag_1_down_result: 'first_down' },
  'b10e·5': { play_type: 'RUSH', possession: 'PUE', field_pos: { team: 'ANA', yard: 42 }, down: 1, distance: 10,
    at: { team: 'ANA', yard: 34 }, net_yards: 0, touchdown: false, stats_count: false,
    flag_1_infraction: { code: 'HO' }, flag_1_team: 'PUE', flag_1_result: 'accepted', flag_1_new_los: { team: 'PUE', yard: 48 }, flag_1_down_result: 'repeat_down' },
  'c0a8·31': { play_type: 'PUNT', punt_result: 'fair_catch', possession: 'AT', field_pos: { team: 'AT', yard: 42 }, down: 4, distance: 5,
    punt_kicked_to: { team: 'MTY', yard: 22 }, net_yards: 0, touchdown: false, stats_count: false,
    flag_1_infraction: { code: 'NF' }, flag_1_team: 'MTY', flag_1_result: 'accepted', flag_1_new_los: { team: 'MTY', yard: 12 }, flag_1_down_result: 'first_down' },
}

test('producción: sólo cambian de anulación 2dd8·18 (PI capturado antes de la regla) y c0a8·31 (punt con bandera vieja: ya no se anula)', () => {
  for (const [id, p] of Object.entries(prod)) {
    const r = resolvePlay(p)
    if (id === '2dd8·18') {
      assert.deepEqual(flagOutcome(p), { voided: true, net_yards: 0, touchdown: false })
      assert.equal(r.stats_count, false)
    } else if (id === 'c0a8·31') {
      // NF of MTY (the receiving team) after the fair catch: the punt counts.
      assert.deepEqual(flagOutcome(p), { voided: false, net_yards: null, touchdown: false })
      assert.notEqual(r.stats_count, false)
      assert.equal(r.net_yards, null)
    } else {
      assert.equal(r, p, id)   // same object: nothing changes
    }
  }
})

test('producción: primeros downs iguales a la regla anterior salvo c0a8·31 (NF tras fair catch: la serie es de MTY)', () => {
  // Before lote 3: 1 when any flag had down_result first_down, on top of the yardage rule.
  const before = { '2dd8·16': 0, '2dd8·18': 1, 'b10e·5': 0, 'c0a8·31': 1 }
  const after  = { '2dd8·16': 0, '2dd8·18': 1, 'b10e·5': 0, 'c0a8·31': 0 }
  for (const id of Object.keys(prod)) {
    assert.equal(_firstDownsOnPlay(prod[id]), after[id], id)
    if (id !== 'c0a8·31') assert.equal(after[id], before[id], id)
  }
})
