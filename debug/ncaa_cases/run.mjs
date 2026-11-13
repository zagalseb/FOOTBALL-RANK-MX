// Ejecuta los casos NCAA de casos_de_prueba.json contra shared/stats-lib.js (solo lectura).
// Uso (desde la raíz del repo): node debug/ncaa_cases/run.mjs [salida.json]
import fs from 'node:fs'
import * as L from '../../shared/stats-lib.js'

const teams = { home: { name: 'AAA', abreviatura: 'AAA' }, away: { name: 'BBB', abreviatura: 'BBB' } }
const A = 'AAA', B = 'BBB'
const P = (n, nombre = '', apellido = '') => ({ number: n, nombre, apellido })
const Adams = P(12), Allen = P(22), Brown = P(50), Benton = P(99), Baker = P(31)
const pos = (team, yard) => ({ team, yard })

let seq = 0
function mk(p) {
  const play = { quarter: 1, clock: '10:00', score_home: 0, score_away: 0, ...p, seq: ++seq }
  play.yardline_100 = play.field_pos.team === play.possession ? 100 - play.field_pos.yard : play.field_pos.yard
  if (play.at && play.field_pos) {
    play.net_yards = L.calcNetYards(teams, play.possession, play.field_pos, play.at)
    play.touchdown = L.isTouchdown(teams, play.possession, play.at)
  }
  const voids = [1, 2].some(n => play[`flag_${n}_result`] === 'accepted' &&
    ['repeat_down', 'loss_of_down', 'first_down'].includes(play[`flag_${n}_down_result`]) &&
    play[`flag_${n}_timing`] !== 'dead')
  if (voids) { play.net_yards = 0; play.touchdown = false; play.stats_count = false }
  if (play.play_type === 'PENALTY' && play.penalty_result === 'accepted') play.penalty_stats_count = false
  return play
}
const flag = (n, code, team, newLos, down_result, timing = 'live') => ({
  [`flag_${n}_infraction`]: { code, label: code }, [`flag_${n}_team`]: team, [`flag_${n}_result`]: 'accepted',
  [`flag_${n}_new_los`]: newLos, [`flag_${n}_down_result`]: down_result, [`flag_${n}_timing`]: timing,
})
const find = (obj, num) => Object.values(obj || {}).find(v => String(v.label).includes(`#${num}`)) || null
const defOf = (plays, team, num) => find(L.computeDefenseStats(plays, A, B)[team], num)
const cmp = plays => L.computeComparisonStats(plays, L.computeDrives(plays, A, B), A, B, teams)
const rushOf = (plays, team, num) => find(L.buildOffenseMaps(plays, A, B).rushers[team], num)
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o ? (o[k] ?? 0) : 0]))
const state0 = (o = {}) => ({ quarter: 1, clock: '10:00', possession: A, field_pos: pos(B, 40), down: 1, distance: 10, score: { home: 0, away: 0 }, ...o })
const adv = (play, st) => { L.advanceGameState(st, play, teams); L.applyFlags(st, play, teams); return st }
const n2 = x => Math.round(x * 100) / 100

const sackPlay = (extra = {}) => mk({ play_type: 'PASS', possession: A, field_pos: pos(B, 40), down: 1, distance: 10,
  pass_by: Adams, pass_result: 'sack', sack_by: Benton, result: 'tackle', at: pos(B, 48), ...extra })
const igPlay = (down, dist, fp) => mk({ play_type: 'PASS', possession: A, field_pos: fp, down, distance: dist,
  pass_by: Adams, pass_result: 'incomplete', ...flag(1, 'IG', A, pos(B, 28), 'loss_of_down') })
const punt = (extra, from = pos(A, 50)) => mk({ play_type: 'PUNT', possession: A, field_pos: from, down: 4, distance: 8, punted_by: P(5), ...extra })
const puntRow = pl => L.computeSpecialTeamsStats(pl, A, B, teams).punting[0] || null
const rushLoss = tb => mk({ play_type: 'RUSH', possession: A, field_pos: pos(B, 40), down: 1, distance: 10, rush_by: Adams, result: 'tackle', tackle_by: tb, at: pos(B, 44) })

const stripSack = () => mk({ play_type: 'PASS', possession: A, field_pos: pos(B, 40), down: 1, distance: 10,
  pass_by: Adams, pass_result: 'sack', sack_by: Benton, result: 'fumble', fumble_at: pos(B, 45), fumble_forced_by: Benton,
  fumble_recovery_team: A, fumble_recovered_by: Allen, fumble_recovered_at: pos(B, 48), fumble_result: 'eop', fumble_at_result: pos(B, 48) })
const rushFumbleLost = () => mk({ play_type: 'RUSH', possession: A, field_pos: pos(B, 30), down: 1, distance: 10, rush_by: Adams, result: 'fumble',
  fumble_at: pos(B, 25), fumble_forced_by: Brown, fumble_recovery_team: B, fumble_recovered_by: Brown, fumble_recovered_at: pos(B, 24),
  fumble_result: 'eop', fumble_at_result: pos(B, 24) })

// H-19 (TC-44): falta de B (first_down) cobrada desde `enforced`; resultado = estado siguiente + equipo.
const h19Pass = { play_type: 'PASS', possession: A, field_pos: pos(B, 40), down: 2, distance: 10, pass_by: Adams }
const h19Flag = (code, newLos, enforced, foulSpot) => ({ ...flag(1, code, B, newLos, 'first_down', enforced === 'previous' ? 'live' : 'dead'),
  flag_1_enforced: enforced, ...(foulSpot ? { flag_1_foul_spot: foulSpot } : {}) })
// Parte 2 (TC-17, TC-40, TC-12b): jugadas base.
const fourth17 = { possession: A, field_pos: pos(B, 30), down: 4, distance: 5 }
const p17 = p => { const st = adv(p, state0({ field_pos: p.field_pos, down: p.down, distance: p.distance })); return { possession: st.possession, down: st.down, distance: st.distance, field_pos: st.field_pos } }
const rushFF40 = (extra = {}) => mk({ play_type: 'RUSH', possession: A, field_pos: pos(B, 30), down: 1, distance: 10, rush_by: Adams, result: 'fumble',
  fumble_at: pos(B, 27), fumble_forced_by: Brown, fumble_recovery_team: A, fumble_recovered_by: Allen, fumble_recovered_at: pos(B, 27), fumble_result: 'eop', fumble_at_result: pos(B, 27), ...extra })
const koFumble = () => mk({ play_type: 'KICK', kick_type: 'kickoff', possession: A, field_pos: pos(A, 35), down: 0, distance: 0, kicked_by: P(5), kickoff_result: 'returned', kicked_to: pos(B, 5),
  kick_returned_by: Baker, kick_return_result: 'fumble', fumble_at: pos(B, 12), fumble_forced_by: P(40), fumble_recovery_team: A, fumble_recovered_by: P(40), fumble_recovered_at: pos(B, 12), fumble_result: 'eop', fumble_at_result: pos(B, 12) })
const dblFumble = () => mk({ play_type: 'RUSH', possession: A, field_pos: pos(B, 40), down: 1, distance: 10, rush_by: Adams, result: 'fumble', fumble_at: pos(B, 35), fumble_recovery_team: A, fumble_recovered_by: Allen, fumble_recovered_at: pos(B, 36),
  fumble_result: 'fumble', fumble_2_at: pos(B, 36), fumble_2_forced_by: Brown, fumble_2_recovery_team: B, fumble_2_recovered_by: Baker, fumble_2_recovered_at: pos(B, 37), fumble_2_result: 'eop', fumble_2_at_result: pos(B, 37) })
// H-22 (TC-25b-g, TC-44*-ind): flag en el formato actual (enforced + timing derivado).
const h22Flag = (team, enforced, extra = {}) => ({ ...flag(1, 'HO', team, pos(A, 30), 'repeat_down', enforced === 'previous' ? 'live' : 'dead'),
  flag_1_enforced: enforced, ...extra })
const h22Compl = { play_type: 'PASS', possession: A, field_pos: pos(B, 40), down: 2, distance: 8, pass_by: Adams, pass_result: 'complete',
  received_by: Allen, result: 'tackle', at: pos(B, 30), tackle_by: [Brown] }
const h22Int = (at, ret, foul, res = 'tackle') => mk({ ...h19Pass, pass_result: 'intercepted', intercepted_by: Brown, intercepted_at: at,
  return_result: res, return_at: ret, ...h19Flag('BI', pos(A, 40), 'foul_spot', foul) })
const intRet = w => { const r = Object.values(L.computeTurnoverStatsByPlayer([w], A, B, teams).interceptions[B])[0]
  return { no: r?.no ?? 0, yds: r?.yds ?? 0, td: r?.td ?? 0, teamIntYds: L.computeTurnoverReturnYardsByTeam([w], A, B, teams)[B].intYds,
    allPurpose: L.computeTurnoverReturnYards([w], A, B, teams).reduce((s, x) => s + x.yds, 0),
    driveEnd: L.driveEndLabel(L.computeDrives([w], A, B)[0].plays, false, teams) } }
const h19 = p => { const st = adv(p, state0({ field_pos: p.field_pos, down: p.down, distance: p.distance })); const c = cmp([p])
  return { next: { possession: st.possession, field_pos: st.field_pos, down: st.down, distance: st.distance },
    score: { [A]: st.score.home, [B]: st.score.away }, turnoversA: c[A].turnovers, firstDownsA: c[A].firstDowns } }

// TC-20: punt bloqueado (§7 Art.1, 3). La fila Team lleva key PUNT_TEAM_KEY.
const blockedPunt = s => { const team = s.punting.find(r => r.key === L.PUNT_TEAM_KEY)
  const punters = s.punting.filter(r => r.key !== L.PUNT_TEAM_KEY)
  return { punterRows: punters.length, punterYds: punters.reduce((a, r) => a + r.yds, 0),
    teamPuntsZeroYds: team && team.yds === 0 ? team.no : 0, blockerPuntReturnYds: s.puntReturns.reduce((a, r) => a + r.yds, 0) } }

// TC-20c/d: regresos del punt bloqueado por jugador (Brown #50 bloquea, Baker #31).
const blockReturns = p => { const r = L.computeSpecialTeamsStats([p], A, B, teams).puntReturns
  const of = num => { const x = find(Object.fromEntries(r.map(q => [q.key, q])), num); return x ? { no: x.no, yds: x.yds } : null }
  return { brown: of(50), baker: of(31) } }
// TC-49: FG bueno desde BBB25 (4&6) con bandera de B; estado siguiente.
const fgFlag = f => { const p = mk({ play_type: 'KICK', kick_type: 'field_goal', possession: A, field_pos: pos(B, 25), down: 4, distance: 6, kicked_by: P(5), fg_result: 'good', ...f })
  const st = adv(p, state0({ field_pos: pos(B, 25), down: 4, distance: 6 }))
  return { voided: L.flagOutcome(p)?.voided === true, possession: st.possession, field_pos: st.field_pos, scoreA: st.score.home } }

const P_ = {
  'TC-01': () => ({ rating: n2(L._passerRating(98, 166, 1567, 16, 7)) }),
  'TC-02': () => pick(defOf([sackPlay()], B, 99), ['solo', 'ast', 'sacks', 'tfl', 'sackYds']),
  'TC-03': () => pick(defOf([sackPlay({ tackle_by: [Benton] })], B, 99), ['solo', 'ast', 'sacks', 'tfl', 'sackYds']),
  'TC-04': () => { const pl = [sackPlay({ tackle_by: [Benton, Baker] })]; const k = ['solo', 'ast', 'sacks', 'asstSacks', 'tfl', 'sackYds']
    return { '99': pick(defOf(pl, B, 99), k), '31': pick(defOf(pl, B, 31), k) } },
  // flag_1_pressured_by: el wizard ya lo captura (la auditoría es anterior a ese campo).
  'TC-05': () => { const p = { ...igPlay(1, 10, pos(B, 20)), flag_1_pressured_by: Benton }; const r = L.computePlayerStats([p], Adams, A)
    return { passAtt: r.passing?.att ?? 0, rushAtt: r.rushing?.att ?? 0, rushYds: r.rushing?.yds ?? 0,
      penaltyYds: L.computePenalties([p], A)[0]?.yards ?? null, benton: pick(defOf([p], B, 99), ['sacks', 'solo', 'tfl', 'sackYds']) } },
  'TC-06': () => { const c = cmp([igPlay(3, 15, pos(B, 50))])[A]; return { thirdAtt: c.thirdAtt, thirdConv: c.thirdConv } },
  'TC-07': () => { const s = stripSack(); const r = L.computePlayerStats([s], Adams, A); const c = cmp([s])
    return { qbRush: { att: r.rushing?.att ?? 0, yds: r.rushing?.yds ?? 0 }, benton: pick(defOf([s], B, 99), ['ff', 'sacks', 'solo', 'tfl', 'sackYds']),
      team: { fumbles: c[A].fumbles, fumblesLost: c[A].fumblesLost, sacksYds: c[B].sacksYds } } },
  'TC-08': () => { const f = rushFumbleLost(); const r = rushOf([f], A, 12); const c = cmp([f])[A]
    return { adams: { att: r?.att ?? 0, yds: r?.yds ?? 0 }, teamRushYds: c.rushYds, fumbles: c.fumbles, fumblesLost: c.fumblesLost } },
  'TC-09': () => { const p = mk({ play_type: 'RUSH', possession: A, field_pos: pos(B, 40), down: 2, distance: 5, rush_by: Adams, result: 'fumble',
      fumble_at: pos(B, 30), fumble_recovery_team: A, fumble_recovered_by: Allen, fumble_recovered_at: pos(B, 30), fumble_result: 'eop', fumble_at_result: pos(B, 30) })
    return { adamsYds: rushOf([p], A, 12)?.yds ?? 0, firstDowns: cmp([p])[A].firstDowns } },
  'TC-10': () => ({ fumbleReturnRows: Object.keys(L.computeTurnoverStatsByPlayer([rushFumbleLost()], A, B, teams).fumbleReturns[B]).length }),
  'TC-11': () => { const p = mk({ play_type: 'RUSH', possession: A, field_pos: pos(B, 40), down: 1, distance: 10, rush_by: Adams, result: 'fumble',
      fumble_at: pos(B, 35), fumble_recovery_team: A, fumble_recovered_by: Allen, fumble_recovered_at: pos(B, 36), fumble_result: 'fumble',
      fumble_2_at: pos(B, 36), fumble_2_forced_by: Brown, fumble_2_recovery_team: B, fumble_2_recovered_by: Baker, fumble_2_recovered_at: pos(B, 37), fumble_2_result: 'eop', fumble_2_at_result: pos(B, 37) })
    const c = cmp([p])[A]; const f = L.computeFumbleStats([p]); const g = n => f.filter(x => x.label.includes(`#${n}`)).reduce((a, x) => a + x.no, 0)
    return { teamA: { fumbles: c.fumbles, fumblesLost: c.fumblesLost, turnovers: c.turnovers }, indiv: { adams: g(12), allen: g(22) } } },
  'TC-12': () => { const p = mk({ play_type: 'KICK', kick_type: 'kickoff', possession: A, field_pos: pos(A, 35), down: 0, distance: 0,
      kicked_by: P(5), kickoff_result: 'returned', kicked_to: pos(B, 5), kick_returned_by: Baker, kick_return_result: 'fumble',
      fumble_at: pos(B, 12), fumble_forced_by: P(40), fumble_recovery_team: A, fumble_recovered_by: P(40), fumble_recovered_at: pos(B, 12), fumble_result: 'eop', fumble_at_result: pos(B, 12) })
    const f = L.computeFumbleStats([p], null, A, B)[0]; const c = cmp([p]); const dd = L.computeDefenseStats([p], A, B)
    return { fumbleRow: { team: f?.team ?? null, lost: f?.lost ?? 0 }, teamB: { fumbles: c[B].fumbles, fumblesLost: c[B].fumblesLost }, ffAAA40: find(dd[A], 40)?.ff ?? 0 } },
  'TC-13': () => { const p = mk({ play_type: 'RUSH', possession: A, field_pos: pos(B, 20), down: 1, distance: 10, rush_by: Adams, result: 'fumble',
      fumble_at: pos(B, 5), fumble_recovery_team: A, fumble_recovered_by: Allen, fumble_recovered_at: pos(B, 0), fumble_result: 'eop', fumble_at_result: pos(B, 0) })
    const st = adv(p, state0({ field_pos: pos(B, 20) })); const r = L.computePlayerStats([p], Allen, A)
    return { scoreHome: st.score.home, adamsRushYds: rushOf([p], A, 12)?.yds ?? 0, allenTD: r.rushing?.td ?? 0 } },
  'TC-14': () => { const p = mk({ play_type: 'RUSH', possession: A, field_pos: pos(A, 5), down: 1, distance: 10, rush_by: Adams, result: 'safety', safety_time: '9:30' })
    const st = adv(p, state0({ field_pos: pos(A, 5) })); const r = rushOf([p], A, 12)
    return { adamsRush: { att: r?.att ?? 0, yds: r?.yds ?? 0 }, scoreAway: st.score.away, possession: st.possession, field_pos: st.field_pos, down: st.down } },
  'TC-15': () => {
    const s = mk({ play_type: 'PASS', possession: A, field_pos: pos(A, 5), down: 1, distance: 10, pass_by: Adams, pass_result: 'sack', sack_by: Benton, result: 'safety' })
    const r = mk({ play_type: 'PASS', possession: A, field_pos: pos(A, 5), down: 1, distance: 10, pass_by: Adams, pass_result: 'scramble', result: 'safety' })
    return { sackScoreAway: adv(s, state0({ field_pos: pos(A, 5) })).score.away, scrambleScoreAway: adv(r, state0({ field_pos: pos(A, 5) })).score.away } },
  'TC-16': () => {
    const muff = mk({ play_type: 'PUNT', possession: A, field_pos: pos(A, 5), down: 4, distance: 8, punted_by: P(5), punt_result: 'muffed', punt_muff_at: pos(B, 3), punt_muff_recovery_team: B, punt_muff_recovered_at: pos(B, 0), punt_muff_result: 'safety' })
    const sn = mk({ play_type: 'SNAP_FUMBLE', possession: A, field_pos: pos(A, 5), down: 1, distance: 10, snap_fumble_at: pos(A, 2), snap_fumble_recovery_team: A, snap_fumble_recovered_at: pos(A, 0), snap_fumble_result: 'safety' })
    const m = adv(muff, state0({ field_pos: pos(A, 5), down: 4, distance: 8 })); const s = adv(sn, state0({ field_pos: pos(A, 5) }))
    return { muffNext: { down: m.down, possession: m.possession, field_pos: m.field_pos }, snapNext: { down: s.down, possession: s.possession, field_pos: s.field_pos } } },
  'TC-17': () => { const p = mk({ play_type: 'PASS', possession: A, field_pos: pos(B, 30), down: 4, distance: 5, pass_by: Adams, pass_result: 'incomplete' })
    const st = adv(p, state0({ field_pos: pos(B, 30), down: 4, distance: 5 })); return { possession: st.possession, down: st.down, distance: st.distance } },
  'TC-18': () => pick(puntRow([punt({ punt_result: 'downed', punt_downed_at: pos(B, 10) })]), ['no', 'yds', 'in20']),
  'TC-19': () => ({
    ret_to_15: puntRow([punt({ punt_result: 'returned', punt_kicked_to: pos(B, 35), punt_returned_by: Baker, punt_return_result: 'tackle', punt_return_at: pos(B, 15) })])?.in20 ?? 0,
    ret_from_15_to_30: puntRow([punt({ punt_result: 'returned', punt_kicked_to: pos(B, 15), punt_returned_by: Baker, punt_return_result: 'tackle', punt_return_at: pos(B, 30) })])?.in20 ?? 0,
    oob_on_20: puntRow([punt({ punt_result: 'oob', punt_oob_at: pos(B, 20) })])?.in20 ?? 0 }),
  // §7 Art.1 A.R.1-2: bloqueado y recuperado por A detrás de la línea → fila Team de 0 yds y regreso de 10 al que bloqueó.
  'TC-20': () => blockedPunt(L.computeSpecialTeamsStats([punt({ punt_result: 'blocked', punt_blocked_by: Brown, punt_recovery_team: A, punt_recovered_at: pos(A, 40), punt_block_return_result: 'downed' })], A, B, teams)),
  // §7 Art.3: A recupera pasada la línea de golpeo → despeje del pateador desde la línea, sin regreso.
  'TC-20b': () => blockedPunt(L.computeSpecialTeamsStats([punt({ punt_result: 'blocked', punt_blocked_by: Brown, punt_recovery_team: A, punt_recovered_at: pos(B, 45), punt_block_return_result: 'downed' })], A, B, teams)),
  'TC-21': () => { const row = puntRow([
      punt({ punt_result: 'returned', punt_kicked_to: pos(B, 10), punt_returned_by: Baker, punt_return_result: 'tackle', punt_return_at: pos(B, 15) }, pos(A, 45)),
      punt({ punt_result: 'touchback' }, pos(A, 50)),
      punt({ punt_result: 'fair_catch', punt_kicked_to: pos(B, 20), punt_fair_catch_by: Baker, punt_fair_catch_at: pos(B, 20) }, pos(A, 40))])
    return { net: row && 'net' in row ? row.net : null, _exportsNetPunting: Object.keys(L).filter(k => /net.?punt/i.test(k)) } },
  'TC-22': () => { const p = punt({ punt_result: 'muffed', punt_muff_at: pos(B, 30), punt_muff_recovery_team: A, punt_muff_recovered_at: pos(B, 20), punt_muff_result: 'tackle', punt_muff_at_result: pos(B, 20) }, pos(A, 30))
    const c = cmp([p]); return { puntYds: puntRow([p])?.yds ?? 0, teamB: { fumbles: c[B].fumbles, fumblesLost: c[B].fumblesLost } } },
  'TC-23': () => { const p = mk({ play_type: 'KICK', kick_type: 'kickoff', possession: A, field_pos: pos(A, 35), down: 0, distance: 0, kicked_by: P(5), kickoff_result: 'returned', kicked_to: pos(B, 5), kick_returned_by: Baker, kick_return_result: 'tackle', kick_return_tackle_by: [P(40)], kick_return_at: pos(B, 30) })
    return { aaa40: pick(find(L.computeDefenseStats([p], A, B)[A], 40), ['solo']) } },
  'TC-24': () => { const p = mk({ play_type: 'PASS', possession: A, field_pos: pos(B, 40), down: 2, distance: 8, pass_by: Adams, pass_result: 'intercepted', intercepted_by: Brown, intercepted_at: pos(B, 30), returned_by: Brown, return_result: 'tackle', return_tackle_by: [Adams], return_at: pos(B, 40) })
    const d = L.computeDefenseStats([p], A, B); return { adams12InAAA: find(d[A], 12)?.solo ?? 0, adams12InBBB: find(d[B], 12)?.solo ?? 0 } },
  'TC-25': () => { const w = sackPlay({ ...flag(1, 'HO', A, pos(A, 30), 'repeat_down') })
    return { ...pick(defOf([w], B, 99), ['sacks', 'solo']), teamSacksMade: cmp([w])[B].sacksMade } },
  'TC-26': () => {
    const pi = mk({ play_type: 'PAT_TRY', possession: A, field_pos: pos(B, 3), down: 0, distance: 0, pat_type: 'pass', pass_by: Adams, pass_result: 'intercepted', intercepted_by: Brown, intercepted_at: pos(B, 0), return_result: 'tackle', return_at: pos(B, 10), return_tackle_by: [Adams] })
    const pf = mk({ play_type: 'PAT_TRY', possession: A, field_pos: pos(B, 3), down: 0, distance: 0, pat_type: 'run', rush_by: Allen, result: 'fumble', fumble_recovery_team: B, fumble_recovered_by: Brown, fumble_recovered_at: pos(B, 2), fumble_result: 'eop', fumble_at_result: pos(B, 2) })
    const pg = mk({ play_type: 'PAT_TRY', possession: A, field_pos: pos(B, 0), down: 0, distance: 0, pat_type: 'run', rush_by: Allen, result: 'tackle', at: pos(B, 0), tackle_by: [Brown] })
    return { int50: find(L.computeDefenseStats([pi], A, B)[B], 50)?.int ?? 0, adamsTackleOnTry: find(L.computeDefenseStats([pi], A, B)[A], 12)?.solo ?? 0,
      brownTackleOnTry: find(L.computeDefenseStats([pg], A, B)[B], 50)?.solo ?? 0, teamFumbles: cmp([pf])[A].fumbles, turnoversA: cmp([pi, pf])[A].turnovers,
      allenFumbles: L.computeFumbleStats([pf]).length, firstDownsOn2ptGood: cmp([pg])[A].firstDowns } },
  'TC-27': () => { const p = mk({ play_type: 'PAT_TRY', possession: A, field_pos: pos(B, 3), down: 0, distance: 0, pat_type: 'kick', kicked_by: P(5), pat_kick_result: 'good' })
    const s = L.computeSpecialTeamsStats([p], A, B, teams); return { patRows: (s.pat || s.pats || s.extraPoints || []).length } },
  'TC-28': () => { const p = mk({ play_type: 'RUSH', possession: A, field_pos: pos(B, 40), down: 1, distance: 10, rush_by: Adams, result: 'tackle', at: pos(B, 20), ...flag(1, 'PF', B, pos(B, 10), 'first_down', 'dead') })
    return { firstDowns: cmp([p])[A].firstDowns, penaltyYds: L.computePenalties([p], A)[0]?.yards ?? null, teamRushYds: cmp([p])[A].rushYds, adamsYds: rushOf([p], A, 12)?.yds ?? 0 } },
  'TC-29': () => { const p = mk({ play_type: 'RUSH', possession: A, field_pos: pos(A, 40), down: 1, distance: 10, rush_by: Adams, result: 'tackle', at: pos(A, 45), ...flag(1, 'HO', B, pos(A, 55), 'first_down', 'live') })
    const r = rushOf([p], A, 12); return { adamsRush: { att: r?.att ?? 0, yds: r?.yds ?? 0 }, penaltyYds: L.computePenalties([p], A)[0]?.yards ?? null } },
  'TC-30': () => { const p = mk({ play_type: 'RUSH', possession: A, field_pos: pos(A, 30), down: 1, distance: 10, rush_by: Adams, result: 'tackle', at: pos(A, 50), ...flag(1, 'CL', A, pos(A, 32), 'repeat_down', 'live') })
    const r = rushOf([p], A, 12); return { adamsRush: { att: r?.att ?? 0, yds: r?.yds ?? 0 }, penaltyYds: L.computePenalties([p], A)[0]?.yards ?? null } },
  'TC-31': () => { const p = mk({ play_type: 'PASS', possession: A, field_pos: pos(B, 45), down: 2, distance: 8, pass_by: Adams, pass_result: 'complete', received_by: Allen, result: 'tackle', at: pos(B, 30), ...flag(1, 'RP', B, pos(B, 15), 'first_down', 'dead') })
    const c = cmp([p]); return { firstDowns: c[A].firstDowns, teamPassYds: c[A].passYds, penaltyYds: L.computePenalties([p], A)[0]?.yards ?? null, allenYds: L.computePlayerStats([p], Allen, A).receiving?.yds ?? 0 } },
  'TC-32': () => ({ firstDowns: cmp([mk({ play_type: 'RUSH', possession: A, field_pos: pos(B, 5), down: 1, distance: 5, rush_by: Adams, result: 'tackle', at: pos(B, 0) })])[A].firstDowns }),
  'TC-33': () => { const p = mk({ play_type: 'PASS', possession: A, field_pos: pos(B, 40), down: 1, distance: 10, pass_by: Adams, pass_result: 'intercepted', intercepted_by: Brown, intercepted_at: pos(B, 20), returned_by: Brown, return_result: 'tackle', return_at: pos(B, 10) })
    return { yds: find(L.computeTurnoverStatsByPlayer([p], A, B, teams).interceptions[B], 50)?.yds ?? null } },
  'TC-34': () => {
    const o = mk({ play_type: 'SNAP_FUMBLE', possession: A, field_pos: pos(A, 30), down: 1, distance: 10, snap_fumble_at: pos(A, 25), snap_fumble_recovery_team: B, snap_fumble_recovered_by: Brown, snap_fumble_recovered_at: pos(A, 22), snap_fumble_result: 'eop', snap_fumble_at_result: pos(A, 22) })
    const w = mk({ play_type: 'RUSH', snap_fumble: true, possession: A, field_pos: pos(A, 30), down: 1, distance: 10, rush_by: Adams, result: 'tackle', at: pos(A, 20), snap_fumble_recovery_team: A })
    const co = cmp([o])[A], cw = cmp([w])[A]
    return { oppRecovers: { fumbles: co.fumbles, fumblesLost: co.fumblesLost, turnovers: co.turnovers, driveEnd: L.driveEndLabel([o], false, teams) },
      ownRecover: { teamFumbles: cw.fumbles, fumblesLost: cw.fumblesLost } } },
  'TC-34b': () => ({ adamsRushAtt: rushOf([mk({ play_type: 'RUSH', snap_fumble: true, possession: A, field_pos: pos(A, 30), down: 1, distance: 10, rush_by: Adams, result: 'tackle', at: pos(A, 20), snap_fumble_recovery_team: A })], A, 12)?.att ?? 0 }),
  'TC-35': () => ({ adamsRushAtt: rushOf([mk({ play_type: 'RUSH', possession: A, field_pos: pos(B, 40), down: 1, distance: 10, rush_by: Adams, result: 'tackle', at: pos(B, 41), kneel: true })], A, 12)?.att ?? 0, teamRushAtt: 1 }),
  'TC-36': () => { const c = cmp([mk({ play_type: 'PASS', possession: A, field_pos: pos(B, 35), down: 1, distance: 10, pass_by: Adams, pass_result: 'complete', received_by: Allen, result: 'tackle', at: pos(B, 0) })])[A]
    return { redZoneTrips: c.redZoneTrips, redZoneTDs: c.redZoneTDs } },
  'TC-37': () => ({ passMinPerGame: L.LEADER_MIN_PER_TEAM_GAME.pass }),
  'TC-38': () => ({ solo: pick(defOf([rushLoss([Benton])], B, 99), ['solo', 'ast', 'tfl']),
    dos: { a99: pick(defOf([rushLoss([Benton, Baker])], B, 99), ['solo', 'ast', 'tfl', 'tflYds']), a31: pick(defOf([rushLoss([Benton, Baker])], B, 31), ['solo', 'ast', 'tfl', 'tflYds']) } }),
  'TC-39': () => { const p = mk({ play_type: 'PASS', possession: A, field_pos: pos(B, 40), down: 1, distance: 10, pass_by: Adams, pass_result: 'broken_up', broken_up_by: Brown })
    const q = mk({ play_type: 'PASS', possession: A, field_pos: pos(B, 40), down: 1, distance: 10, pass_by: Adams, pass_result: 'intercepted', intercepted_by: Brown, intercepted_at: pos(B, 30), return_result: 'tackle', return_at: pos(B, 30) })
    return { pbu: find(L.computeDefenseStats([p], A, B)[B], 50)?.pbu ?? 0, pbuOnInt: find(L.computeDefenseStats([q], A, B)[B], 50)?.pbu ?? 0 } },
  'TC-40': () => pick(defOf([mk({ play_type: 'RUSH', possession: A, field_pos: pos(B, 30), down: 1, distance: 10, rush_by: Adams, result: 'fumble',
      fumble_at: pos(B, 27), fumble_forced_by: Brown, fumble_recovery_team: A, fumble_recovered_by: Allen, fumble_recovered_at: pos(B, 27), fumble_result: 'eop', fumble_at_result: pos(B, 27) })], B, 50), ['ff', 'solo']),
  'TC-42': () => { const lost = d => mk({ play_type: 'RUSH', possession: A, field_pos: pos(B, 40), down: d, distance: 5, rush_by: Adams, result: 'fumble',
      fumble_at: pos(B, 30), fumble_recovery_team: B, fumble_recovered_by: Brown, fumble_recovered_at: pos(B, 30), fumble_result: 'eop', fumble_at_result: pos(B, 30) })
    const second = lost(2), third = cmp([lost(3)])[A]
    return { adamsYds: rushOf([second], A, 12)?.yds ?? 0, firstDowns: cmp([second])[A].firstDowns, thirdAtt: third.thirdAtt, thirdConv: third.thirdConv } },
  'TC-43': () => { const r = (yl, d, to) => mk({ play_type: 'RUSH', possession: A, field_pos: pos(B, yl), down: d, distance: yl, rush_by: Adams, result: 'tackle', at: pos(B, to) })
    const c = cmp([r(8, 1, 6), r(6, 2, 5), r(5, 3, 0)])[A]; return { firstDowns: c.firstDowns, thirdAtt: c.thirdAtt, thirdConv: c.thirdConv } },
  'TC-48': () => { const p = mk({ play_type: 'PAT_TRY', possession: A, field_pos: pos(B, 3), down: 0, distance: 0, pat_type: 'kick', kicked_by: P(5), pat_kick_result: 'good',
      ...flag(1, 'PF', B, pos(A, 50), 'repeat_down'), flag_1_enforced: 'end' })
    const st = adv(p, state0({ field_pos: pos(B, 3), down: 0, distance: 0 }))
    return { penaltyYds: L.computePenalties([p], A)[0]?.yards ?? null, scoreHome: st.score.home, next: { possession: st.possession, field_pos: st.field_pos, down: st.down } } },
  // TC-04b..e: sack compartido (§16 Art.4 A.R.2) — sack_by + otros en tackle_by.
  'TC-04b': () => { const pl = [sackPlay({ tackle_by: [Benton, Baker, Brown] })]; const k = ['solo', 'ast', 'sacks', 'asstSacks', 'tfl', 'sackYds']
    return { '99': pick(defOf(pl, B, 99), k), '31': pick(defOf(pl, B, 31), k), '50': pick(defOf(pl, B, 50), k) } },
  'TC-04c': () => { const pl = [sackPlay({ tackle_by: [Benton, Baker] })]; const k = ['solo', 'ast', 'sacks', 'asstSacks', 'tfl']
    return { sacker: pick(L.computePlayerStats(pl, Benton, B).defense, k), ayudante: pick(L.computePlayerStats(pl, Baker, B).defense, k) } },
  'TC-04d': () => { const pl = [{ ...stripSack(), tackle_by: [Benton, Baker] }]; const k = ['solo', 'ast', 'sacks', 'asstSacks', 'tfl', 'sackYds', 'ff']
    return { '99': pick(defOf(pl, B, 99), k), '31': pick(defOf(pl, B, 31), k), equipo: pick(cmp(pl)[B], ['sacksMade', 'sacksYds']) } },
  'TC-04e': () => pick(defOf([sackPlay({ tackle_by: [Benton] })], B, 99), ['solo', 'ast', 'sacks', 'asstSacks', 'tfl', 'sackYds']),
  // TC-44a..e (H-19): falta aceptada en una jugada con cambio de posesión.
  // Banderas en el formato actual: enforced + timing derivado (previous → live, resto → dead).
  'TC-44a': () => h19(mk({ ...h19Pass, pass_result: 'intercepted', intercepted_by: Brown, intercepted_at: pos(B, 30), return_result: 'tackle', return_at: pos(B, 50),
    ...h19Flag('BI', pos(B, 35), 'foul_spot', pos(B, 45)) })),
  'TC-44b': () => h19(mk({ play_type: 'RUSH', possession: A, field_pos: pos(B, 30), down: 1, distance: 10, rush_by: Adams, result: 'fumble',
    fumble_at: pos(B, 25), fumble_forced_by: Brown, fumble_recovery_team: B, fumble_recovered_by: Brown, fumble_recovered_at: pos(B, 24),
    fumble_result: 'tackle', fumble_at_result: pos(B, 40), ...h19Flag('HO', pos(B, 25), 'foul_spot', pos(B, 35)) })),
  'TC-44c': () => h19(mk({ ...h19Pass, pass_result: 'intercepted', intercepted_by: Brown, intercepted_at: pos(B, 20), return_result: 'eop', return_at: pos(A, 0),
    ...h19Flag('BI', pos(A, 40), 'foul_spot', pos(A, 30)) })),
  'TC-44d': () => h19(mk({ ...h19Pass, pass_result: 'intercepted', intercepted_by: Brown, intercepted_at: pos(B, 10), return_result: 'tackle', return_at: pos(B, 30),
    ...h19Flag('PI', pos(B, 25), 'previous') })),
  'TC-44e': () => h19(mk({ ...h19Pass, pass_result: 'intercepted', intercepted_by: Brown, intercepted_at: pos(B, 10), return_result: 'tackle', return_at: pos(B, 30),
    ...h19Flag('PI', pos(B, 18), 'foul_spot', pos(B, 18)), flag_1_before_change: true })),
  // §7 Art.1 A.R.3: el mismo jugador bloquea, recoge y corre → UN regreso con todas las yardas.
  'TC-20c': () => blockReturns(punt({ punt_result: 'blocked', punt_blocked_by: Brown, punt_recovery_team: B, punt_recovery_by: Brown, punt_recovered_at: pos(A, 45),
    punt_block_return_result: 'returned', punt_block_returned_by: Brown, punt_block_ret_result: 'eop', punt_block_ret_at: pos(A, 0) })),
  // §7 Art.1 A.R.4: otro jugador recoge y corre → el bloqueador, regreso hasta donde se recogió; el que corre, el resto sin regreso.
  'TC-20d': () => blockReturns(punt({ punt_result: 'blocked', punt_blocked_by: Brown, punt_recovery_team: B, punt_recovery_by: Baker, punt_recovered_at: pos(A, 45),
    punt_block_return_result: 'returned', punt_block_returned_by: Baker, punt_block_ret_result: 'eop', punt_block_ret_at: pos(A, 0) })),
  // FG con bandera: la regla de compatibilidad sigue para los FG (C.1 solo cambia punts y kickoffs).
  'TC-49a': () => fgFlag({ ...flag(1, 'OS', B, pos(B, 20), 'repeat_down') }),
  'TC-49b': () => fgFlag({ ...flag(1, 'OS', B, pos(B, 20), 'repeat_down'), flag_1_enforced: 'previous' }),
  'TC-49c': () => fgFlag({ ...flag(1, 'PF', B, pos(A, 50), 'repeat_down', 'dead'), flag_1_enforced: 'end' }),
  // Formato actual de banderas: en un punt solo flag_N_enforced === 'previous' explícito lo anula.
  'TC-41': () => ({ punterRows: L.computeSpecialTeamsStats([punt({ punt_result: 'downed', punt_downed_at: pos(B, 5), ...flag(1, 'RK', B, pos(B, 35), 'first_down'), flag_1_enforced: 'previous' })], A, B, teams).punting.length }),
  // Bandera vieja (sin flag_N_enforced) en un punt: no se puede saber si fue desde el spot previo → el punt cuenta.
  'TC-41b': () => ({ punterRows: L.computeSpecialTeamsStats([punt({ punt_result: 'downed', punt_downed_at: pos(B, 5), ...flag(1, 'RK', B, pos(B, 35), 'first_down') })], A, B, teams).punting.length }),
  // H-22 (§14 Art.3, 5, 6): jugada anulada no se registra, tampoco la defensa. Falta al final o declinada: sí cuenta.
  'TC-25b': () => { const w = mk({ ...h22Compl, ...h22Flag(A, 'previous') })
    return { solo: defOf([w], B, 50)?.solo ?? 0, soloCard: L.computePlayerStats([w], Brown, B).defense?.solo ?? 0 } },
  'TC-25c': () => { const w = mk({ ...h22Compl, pass_result: 'intercepted', received_by: undefined, at: undefined, tackle_by: undefined,
      intercepted_by: Brown, intercepted_at: pos(B, 20), return_result: 'tackle', return_at: pos(B, 35), ...h22Flag(A, 'previous') })
    return { int: defOf([w], B, 50)?.int ?? 0, intCard: L.computePlayerStats([w], Brown, B).defense?.int ?? 0,
      intRows: Object.keys(L.computeTurnoverStatsByPlayer([w], A, B, teams).interceptions[B]).length,
      teamIntYds: L.computeTurnoverReturnYardsByTeam([w], A, B, teams)[B].intYds } },
  'TC-25d': () => { const w = mk({ ...rushLoss([Brown]), ...h22Flag(A, 'previous') })
    return { teamTfl: cmp([w])[B].tflMade, tfl: defOf([w], B, 50)?.tfl ?? 0 } },
  'TC-25e': () => { const w = sackPlay({ tackle_by: [Benton], ...h22Flag(B, 'end', { flag_1_down_result: 'first_down' }) })
    return { ...pick(defOf([w], B, 99), ['sacks', 'solo']), teamSacksMade: cmp([w])[B].sacksMade } },
  'TC-25f': () => { const w = sackPlay({ tackle_by: [Benton], ...h22Flag(A, 'previous', { flag_1_result: 'declined' }) })
    return { sacks: defOf([w], B, 99)?.sacks ?? 0, teamSacksMade: cmp([w])[B].sacksMade } },
  'TC-25g': () => { const w = mk({ play_type: 'KICK', kick_type: 'kickoff', possession: A, field_pos: pos(A, 35), down: 0, distance: 0, kicked_by: P(5),
      kickoff_result: 'returned', kicked_to: pos(B, 5), kick_returned_by: Baker, kick_return_result: 'eop', kick_return_at: pos(A, 0), ...h22Flag(A, 'previous') })
    const st = L.computeSpecialTeamsStats([w], A, B, teams)
    return { kickoffs: st.kickoffs.length, kickReturns: st.kickReturns.length,
      indReturnTd: viewerST()._buildIndSpecialTeams([w], st, null, A, B, B).kickReturns.reduce((s, r) => s + r.td, 0) } },
  // TC-44 en estadísticas individuales (§14 Art.1 A.R.3): falta de B en su regreso, cobrada en el spot de la falta.
  'TC-44c-ind': () => intRet(h22Int(pos(B, 20), pos(A, 0), pos(A, 30), 'eop')),
  'TC-44a-ind': () => intRet(h22Int(pos(B, 30), pos(B, 50), pos(B, 45))),
  'TC-44f': () => intRet(h22Int(pos(B, 20), pos(B, 45), pos(B, 50))),
  'TC-44b-ind': () => { const w = mk({ play_type: 'RUSH', possession: A, field_pos: pos(B, 30), down: 1, distance: 10, rush_by: Adams, result: 'fumble',
      fumble_at: pos(B, 25), fumble_forced_by: Brown, fumble_recovery_team: B, fumble_recovered_by: Brown, fumble_recovered_at: pos(B, 24),
      fumble_result: 'tackle', fumble_at_result: pos(B, 40), ...h19Flag('HO', pos(B, 25), 'foul_spot', pos(B, 35)) })
    const r = Object.values(L.computeTurnoverStatsByPlayer([w], A, B, teams).fumbleReturns[B])[0]
    return { yds: r?.yds ?? 0, td: r?.td ?? 0, teamFumYds: L.computeTurnoverReturnYardsByTeam([w], A, B, teams)[B].fumYds } },
  // Punto 6: mismo número en los dos equipos; recupera el que patea → el bloqueador solo recibe hasta donde se recogió.
  'TC-20e': () => { const pr = p => L.computeSpecialTeamsStats([p], A, B, teams).puntReturns.map(r => `${r.team} ${r.label} ${r.no}/${r.yds}`).join(', ')
    const base = { punt_result: 'blocked', punt_blocked_by: P(41) }
    return {
      mismoEquipo: pr(punt({ ...base, punt_recovery_team: B, punt_recovery_by: P(41), punt_recovered_at: pos(A, 20), punt_block_return_result: 'returned',
        punt_block_returned_by: P(41), punt_block_ret_result: 'eop', punt_block_ret_at: pos(A, 0) }, pos(A, 30))),
      recuperaElQuePatea: pr(punt({ ...base, punt_recovery_team: A, punt_recovery_by: P(41), punt_recovered_at: pos(A, 25) }, pos(A, 30))),
    } },
  // TC-17: 4to down (§ B.I.9). Banderas en el formato actual (enforced + timing derivado).
  'TC-17b': () => p17(mk({ ...fourth17, play_type: 'RUSH', rush_by: Adams, result: 'tackle', at: pos(B, 28) })),
  'TC-17c': () => p17(mk({ ...fourth17, play_type: 'RUSH', rush_by: Adams, result: 'tackle', at: pos(B, 24) })),
  'TC-17d': () => p17(mk({ ...fourth17, play_type: 'PASS', pass_by: Adams, pass_result: 'incomplete', ...flag(1, 'PI', B, pos(B, 12), 'first_down', 'dead'), flag_1_enforced: 'foul_spot', flag_1_foul_spot: pos(B, 12) })),
  'TC-17e': () => p17(mk({ ...fourth17, play_type: 'RUSH', rush_by: Adams, result: 'tackle', at: pos(B, 28), ...flag(1, 'HO', A, pos(B, 38), 'repeat_down', 'dead'), flag_1_enforced: 'end' })),
  'TC-17f': () => p17(mk({ ...fourth17, play_type: 'PASS', pass_by: Adams, pass_result: 'incomplete', ...flag(1, 'IG', A, pos(B, 38), 'loss_of_down', 'dead'), flag_1_enforced: 'foul_spot', flag_1_foul_spot: pos(B, 38) })),
  // TC-40 (§16 Art.6): quien fuerza el fumble recibe tackle solo; TFL solo si la jugada termina con pérdida.
  'TC-40b': () => { const p = rushFF40({ fumble_recovered_at: pos(B, 33), fumble_at_result: pos(B, 33) }); const c = cmp([p])[B]
    return { ...pick(defOf([p], B, 50), ['ff', 'solo', 'tfl']), card: pick(L.computePlayerStats([p], Brown, B).defense, ['solo', 'tfl']), teamTfl: c.tflMade, teamTflYds: c.tflYds } },
  'TC-40c': () => pick(defOf([mk({ play_type: 'PASS', possession: A, field_pos: pos(B, 40), down: 1, distance: 10, pass_by: Adams, pass_result: 'sack', sack_by: Benton, result: 'fumble',
      fumble_at: pos(B, 47), fumble_forced_by: Benton, fumble_recovery_team: B, fumble_recovered_by: Baker, fumble_recovered_at: pos(B, 48), fumble_result: 'eop', fumble_at_result: pos(B, 48) })], B, 99), ['ff', 'sacks', 'solo', 'tfl']),
  'TC-40d': () => { const p = koFumble(); return { soloAAA40: find(L.computeDefenseStats([p], A, B)[A], 40)?.solo ?? 0, soloBBB40: find(L.computeDefenseStats([p], A, B)[B], 40)?.solo ?? 0 } },
  'TC-40e': () => pick(defOf([dblFumble()], B, 50), ['ff', 'solo']),
  // TC-12b: INT regresada y perdida en fumble → un turnover para cada equipo.
  'TC-12b': () => { const c = cmp([mk({ play_type: 'PASS', possession: A, field_pos: pos(B, 40), down: 2, distance: 8, pass_by: Adams, pass_result: 'intercepted', intercepted_by: Brown, intercepted_at: pos(B, 20), returned_by: Brown,
      return_result: 'fumble', fumble_at: pos(B, 30), fumble_forced_by: Allen, fumble_recovery_team: A, fumble_recovered_by: Allen, fumble_recovered_at: pos(B, 30), fumble_result: 'eop', fumble_at_result: pos(B, 30) })])
    return { A: pick(c[A], ['turnovers', 'intsThrown', 'fumbles']), B: pick(c[B], ['turnovers', 'fumbles', 'fumblesLost']) } },
  // TC-05b/c: grounding sin pérdida, o sin presionador → no hay sack (§16 Art.4).
  'TC-05b': () => pick(defOf([{ ...igPlay(1, 10, pos(B, 20)), flag_1_new_los: pos(B, 18), flag_1_pressured_by: Benton }], B, 99), ['sacks', 'solo']),
  'TC-05c': () => ({ teamSacks: cmp([igPlay(1, 10, pos(B, 20))])[B].sacksMade }),
}

const doc = JSON.parse(fs.readFileSync(new URL('./casos_de_prueba.json', import.meta.url), 'utf8'))
function viewerST() {
  const html = fs.readFileSync(new URL('../../live-stats/viewer/viewer.html', import.meta.url), 'utf8')
  const src = html.match(/\/\/ IND_F56_BUILDERS_START[\s\S]*?\/\/ IND_F56_BUILDERS_END/)[0]
  return new Function('L', `const { _playerKeyLabel, calcNetYards, isTouchdown, resolvePlay, _blockedPuntEnd, _blockedPuntRunner } = L;\n${src}\nreturn { _buildIndSpecialTeams };`)(L)
}
const out = doc.casos.map(c => {
  let actual
  try { actual = P_[c.id]() } catch (e) { actual = { ERROR: String(e.message || e) } }
  const tol = c.tolerancia ?? 0
  const eq = (a, b) => (typeof a === 'number' && typeof b === 'number') ? Math.abs(a - b) <= tol + 1e-9
    : (a && b && typeof a === 'object' && typeof b === 'object')
      ? Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => eq(a[k], b[k]))
      : a === b
  return { id: c.id, expected: c.salida_esperada, actual, cumple: eq(actual, c.salida_esperada),
    igualQueAuditoria: JSON.stringify(actual) === JSON.stringify(c.resultado_actual_codigo) }
})
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2))
console.log('verdes:', out.filter(x => x.cumple).map(x => x.id).join(',') || '(ninguno)')
console.log('distintos a la auditoría:', out.filter(x => !x.igualQueAuditoria).map(x => x.id).join(',') || '(ninguno)')
// Casos que no se pueden resolver con los datos que se capturan hoy (campo sin_resolver).
const sinResolver = doc.casos.filter(c => c.sin_resolver)
if (sinResolver.length) console.log('sin resolver (requieren captura):', sinResolver.map(c => c.id).join(','))
