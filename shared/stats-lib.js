// stats-lib.js — pure calculation/display logic shared by capture/ AND
// viewer/. No Supabase import, no fetch, no DOM. Split out of engine.js
// (2026-09-08) so viewer/index.html can load this file directly instead of
// downloading the whole capture app (wizard trees, DB-write functions,
// gameEvents/game-control state) just to get a handful of pure functions.
//
// engine.js (capture/-only) imports what it needs from here and re-exports
// a few of them (gameState, isTouchdown, calcNetYards, formatPlay,
// playerShortLabel, advanceGameState, applyFlags) so wizard.js's existing
// `import {...} from './engine.js'` keeps working unchanged.

// ── Game state ────────────────────────────────────────────────────────────────

export const gameState = {
  seq: 1,
  quarter: 1,
  clock: '15:00',
  possession: 'MTY',
  field_pos: { team: 'MTY', yard: 35 },
  down: 1,
  distance: 10,
  score: { home: 0, away: 0 },
  ended: false,
  // Teams config — home attacks toward yard 100, away attacks toward yard 0.
  // abreviatura: real team abbreviation (from Supabase) used for shorthand input (e.g. "CCM40" → CCM 40)
  teams: {
    home: { name: 'MTY', abreviatura: 'MTY' },
    away: { name: 'UANL', abreviatura: 'UANL' },
  },
}

// ── Field position helpers ────────────────────────────────────────────────────

// Returns absolute yard 0-100 where home endzone = 0, home TD = 100.
// home team yard maps directly; away team yard mirrors (100 - yard).
export function absYard(teams, teamName, yard) {
  return teamName === teams.home.name ? yard : (100 - yard)
}

// Net yards gained by the possession team from snapPos to atPos.
// Positive = forward progress for whoever has the ball.
export function calcNetYards(teams, possession, snapPos, atPos) {
  const dir = possession === teams.home.name ? 1 : -1
  return dir * (absYard(teams, atPos.team, atPos.yard) - absYard(teams, snapPos.team, snapPos.yard))
}

// Returns true if the AT position is a touchdown for the possessing team.
// TD = reaching yard 0 of the opponent's endzone.
export function isTouchdown(teams, possession, atPos) {
  const opponent = possession === teams.home.name ? teams.away.name : teams.home.name
  return atPos.team === opponent && atPos.yard === 0
}

// ── Formatting helpers ────────────────────────────────────────────────────────

// "1935" -> "32:15". Shared by manual_stats.html (converts on save/load) and
// viewer.html's BasicBoxScore (display-only) — the inverse (MM:SS -> seconds,
// with input validation) stays capture-only in manual_stats.html since the
// viewer never needs to parse operator-typed text back into seconds.
export function secondsToMMSS(sec) {
  if (!sec) return ''
  const m = Math.floor(sec / 60), s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// ── Single-player stat aggregation (Reports / Player Card) ───────────────────
// Purpose-built for capture/'s Reports tab: stats for ONE player in the
// current game only. Deliberately NOT a reuse of viewer.html's passers/
// rushers/receivers map (that's built inline inside a useMemo, all players
// of both teams at once, and viewer.html isn't an ES module capture/ could
// import from) — but it applies the exact same business rules already
// validated there, read from the same fields, so the numbers match:
//   - stats_count === false plays are excluded from offense categories
//     (same as viewer.html's passers/rushers/receivers), but NOT from
//     defense (viewer.html's computeDefenseStats doesn't gate on it either).
//   - A scramble or a sack is credited as a RUSH to the QB (pass_by), never
//     as a passing attempt — same NCAA-convention rule as Comparación.
//   - Individual stats use raw net_yards, not _effectiveNetYards — that
//     distinction (team/drive yardage vs. individual credit) was established
//     earlier this session and viewer.html's own player maps already follow it.
// Player matching is by `number` only (not name) — real captured play_data
// includes rows from before the wizard wrote {nombre,apellido}, so number is
// the only field guaranteed present across old and new data.
function _isSamePlayer(ref, player) {
  return !!(ref && player && Number(ref.number) === Number(player.number))
}

export function computePlayerStats(plays, player, teamAbbr) {
  let rushing = null, passing = null, receiving = null, defense = null
  const ensureRushing   = () => rushing   ?? (rushing   = { att: 0, yds: 0, td: 0 })
  const ensurePassing   = () => passing   ?? (passing   = { att: 0, comp: 0, yds: 0, td: 0, int: 0 })
  const ensureReceiving = () => receiving ?? (receiving = { rec: 0, yds: 0, td: 0 })
  const ensureDefense   = () => defense   ?? (defense   = { solo: 0, ast: 0, sacks: 0, tfl: 0, ff: 0, int: 0 })

  for (const p of plays) {
    if (p.play_type === 'GAME_CTRL') continue

    if (p.possession === teamAbbr && p.stats_count !== false) {
      if (p.play_type === 'RUSH' && _isSamePlayer(p.rush_by, player)) {
        const r = ensureRushing()
        r.att++
        r.yds += p.net_yards || 0
        if (p.touchdown) r.td++
      }

      if (p.play_type === 'PASS' && (p.pass_result === 'scramble' || p.pass_result === 'sack') &&
          _isSamePlayer(p.pass_by, player)) {
        const r = ensureRushing()
        r.att++
        r.yds += p.net_yards || 0
        if (p.touchdown) r.td++
      }

      // Any non-scramble/non-sack pass_result is an attempt — including
      // 'dropped'/'broken_up' — same rule as viewer.html:1975, not just
      // complete/incomplete/intercepted.
      if (p.play_type === 'PASS' && p.pass_result !== 'scramble' && p.pass_result !== 'sack' &&
          _isSamePlayer(p.pass_by, player)) {
        const pa = ensurePassing()
        pa.att++
        if (p.pass_result === 'complete') {
          pa.comp++
          pa.yds += p.net_yards || 0
          if (p.touchdown) pa.td++
        }
        if (p.pass_result === 'intercepted') pa.int++
      }

      if (p.play_type === 'PASS' && p.pass_result === 'complete' && _isSamePlayer(p.received_by, player)) {
        const rc = ensureReceiving()
        rc.rec++
        rc.yds += p.net_yards || 0
        if (p.touchdown) rc.td++
      }
    }

    // Defense credit belongs to the team that did NOT snap this play —
    // same defTeam pattern as viewer.html's computeDefenseStats.
    if (p.possession && p.possession !== teamAbbr) {
      const tackleArrays = [p.tackle_by, p.fumble_tackle_by, p.punt_block_ret_tackle_by, p.return_tackle_by]
      for (const arr of tackleArrays) {
        if (!Array.isArray(arr) || !arr.length) continue
        const isSolo = arr.length === 1
        for (const ref of arr) {
          if (!_isSamePlayer(ref, player)) continue
          const d = ensureDefense()
          d[isSolo ? 'solo' : 'ast']++
          if (p.net_yards != null && p.net_yards < 0) d.tfl++
        }
      }
      if (p.play_type === 'PASS' && p.pass_result === 'sack' && _isSamePlayer(p.sack_by, player)) {
        const d = ensureDefense()
        d.sacks++
        d.solo++
      }
      if (_isSamePlayer(p.fumble_forced_by, player) || _isSamePlayer(p.fumble_2_forced_by, player)) {
        ensureDefense().ff++
      }
      if (p.pass_result === 'intercepted' && _isSamePlayer(p.intercepted_by, player)) {
        ensureDefense().int++
      }
    }
  }

  if (rushing) rushing.avg = rushing.att ? +(rushing.yds / rushing.att).toFixed(1) : 0
  if (passing) passing.compAtt = `${passing.comp}-${passing.att}`

  const out = {}
  if (passing)   out.passing   = passing
  if (rushing)   out.rushing   = rushing
  if (receiving) out.receiving = receiving
  if (defense)   out.defense   = defense
  return out
}

// ── Drives / team comparison stats (Team Stats, Comparación, Reports / Box Score) ──
// Single source of truth for both viewer/ and capture/'s Reports tab — this used
// to be duplicated (once here, once in viewer.html, kept in sync by hand with
// mirrored ⚠️ comments) until the 2026-09-08 stats-lib.js split made viewer.html
// able to import this file directly like capture/ always could.
// NOTE: Reports/Box Score calls these with the full, unfiltered play list —
// viewer.html's Team Stats tab additionally supports per-quarter sub-tabs that
// pre-filter `plays` by quarter before calling in here (with a known, accepted
// Red Zone imprecision at intra-half quarter boundaries — see the comment on
// viewer.html's ComparisonTab). If Reports/Box Score ever wants that same
// per-quarter breakdown, port the pre-filtering from there — it's a caller-side
// concern, not something these functions need to do themselves.

function _kickoffDriveOwner(p, otherTeam) {
  const kicker = p.possession
  const receiver = otherTeam(kicker)
  if (p.kickoff_result === 'onside' && p.onside_recovery_team === kicker) return kicker
  if (p.kick_return_result === 'fumble' && p.fumble_recovery_team === kicker) return kicker
  return receiver
}

function _turnoverScore(p, teams) {
  if (!teams || !p.possession) return null
  const opponentOf = t => (t === teams.home.name ? teams.away.name : teams.home.name)

  if (p.play_type === 'PASS' && p.pass_result === 'intercepted') {
    const intTeam = opponentOf(p.possession)
    const pos = p.return_at || p.intercepted_at
    if (pos && isTouchdown(teams, intTeam, pos)) return 'INTERCEPTION'
  }

  if (p.fumble_recovery_team && p.fumble_recovery_team !== p.possession && p.fumble_recovered_at) {
    if (isTouchdown(teams, p.fumble_recovery_team, p.fumble_recovered_at)) return 'FUMBLE'
  }
  if (p.fumble_2_recovery_team && p.fumble_2_recovery_team !== p.possession && p.fumble_2_recovered_at) {
    if (isTouchdown(teams, p.fumble_2_recovery_team, p.fumble_2_recovered_at)) return 'FUMBLE'
  }

  if (p.play_type === 'KICK' && p.fg_returned_by && p.fg_ret_at) {
    const defTeam = opponentOf(p.possession)
    if (isTouchdown(teams, defTeam, p.fg_ret_at)) return 'BLOCKED KICK'
  }
  if (p.play_type === 'PUNT' && p.punt_block_returned_by && p.punt_block_ret_at) {
    const defTeam = opponentOf(p.possession)
    if (isTouchdown(teams, defTeam, p.punt_block_ret_at)) return 'BLOCKED KICK'
  }

  return null
}

export function computeDrives(plays, homeAbbr, awayAbbr) {
  const otherTeam = t => (t === homeAbbr ? awayAbbr : (t === awayAbbr ? homeAbbr : null))

  function driveOwner(p) {
    if (p.play_type === 'KICK' && p.kick_type !== 'field_goal') {
      return _kickoffDriveOwner(p, otherTeam)
    }
    return p.possession
  }

  const drives = []
  let cur = null
  for (const p of plays) {
    if (p.play_type === 'GAME_CTRL') continue

    if (p.play_type === 'PAT_TRY' && cur) {
      cur.plays.push(p)
      drives.push(cur)
      cur = null
      continue
    }

    const owner = driveOwner(p)
    if (!cur || cur.possession !== owner) {
      if (cur) drives.push(cur)
      cur = { possession: owner, plays: [] }
    }
    cur.plays.push(p)

    if (p.play_type === 'KICK' && p.kick_type === 'field_goal' && p.fg_result === 'good') {
      drives.push(cur)
      cur = null
    }
  }
  if (cur && cur.plays.length) drives.push(cur)
  return drives
}

export function driveEndLabel(plays, isLastDrive, teams) {
  if (!plays.length) return null
  let last = plays[plays.length - 1]
  if (last.play_type === 'PAT_TRY' && plays.length > 1) {
    last = plays[plays.length - 2]
  }
  const turnover = _turnoverScore(last, teams)
  if (turnover) return turnover
  if (last.touchdown) return 'TD'
  if (last.play_type === 'KICK' && last.kick_type === 'field_goal' && last.fg_result === 'good') return 'FG'
  if (last.play_type === 'PUNT') return 'PUNT'
  if (last.pass_result === 'intercepted') return 'INT'
  if (last.result === 'fumble') return 'FUMB'
  if (last.down === 4) return 'DOWNS'
  if (isLastDrive) return 'HALF'
  return null
}

export function _isFirstDownPlay(p) {
  const byYards = p.stats_count !== false &&
    ((p.net_yards != null && p.distance != null && p.net_yards >= p.distance) || p.touchdown === true)
  const byPenalty = p.flag_1_down_result === 'first_down' ||
    p.flag_2_down_result === 'first_down' ||
    p.penalty_down_result === 'first_down'
  return byYards || byPenalty
}

export function _effectiveNetYards(p, teams) {
  if (!teams) return p.net_yards

  if (p.play_type === 'PENALTY') {
    if (p.penalty_result === 'accepted' && p.field_pos && p.penalty_new_los) {
      return calcNetYards(teams, p.possession, p.field_pos, p.penalty_new_los)
    }
    return null
  }

  if (!p.field_pos) return p.net_yards
  let eff = p.net_yards
  for (const num of [1, 2]) {
    if (!p[`flag_${num}_infraction`]) break
    if (p[`flag_${num}_result`] !== 'accepted') continue
    const newLos = p[`flag_${num}_new_los`]
    if (newLos) eff = calcNetYards(teams, p.possession, p.field_pos, newLos)
  }
  return eff
}

export function computeComparisonStats(plays, drives, homeAbbr, awayAbbr, teams) {
  const blank = () => ({
    passYds: 0, rushYds: 0, totalPlays: 0,
    passCompletions: 0, passAttempts: 0, rushPlays: 0, sackAdjRushYds: 0, sackAdjRushPlays: 0,
    firstDowns: 0, thirdAtt: 0, thirdConv: 0, fourthAtt: 0, fourthConv: 0,
    redZoneTrips: 0, redZoneTDs: 0,
    turnovers: 0, fumbles: 0, fumblesLost: 0, intsThrown: 0,
    sacksMade: 0, sacksYds: 0, tflMade: 0, tflYds: 0,
  })
  const out = { [homeAbbr]: blank(), [awayAbbr]: blank() }
  const otherTeam = t => (t === homeAbbr ? awayAbbr : (t === awayAbbr ? homeAbbr : null))

  for (const p of plays) {
    if (p.play_type === 'GAME_CTRL') continue

    // intsThrown mirrors viewer.html's Comparación team summary panel split
    // (PASS-CAI) — kept in sync here even though no Box Score row reads it
    // yet, same as the rest of this duplicated block.
    if (p.play_type === 'PASS' && p.pass_result === 'intercepted' && out[p.possession]) {
      out[p.possession].turnovers++
      out[p.possession].intsThrown++
    }
    if (p.result === 'fumble' && out[p.possession]) {
      out[p.possession].fumbles++
      if (p.fumble_recovery_team && p.fumble_recovery_team !== p.possession) {
        out[p.possession].fumblesLost++
        out[p.possession].turnovers++
      }
    }

    if (p.play_type === 'PASS' && p.pass_result === 'sack') {
      const def = out[otherTeam(p.possession)]
      if (def) { def.sacksMade++; def.sacksYds += Math.abs(p.net_yards || 0) }
    }
    const isTflEligible = p.play_type === 'RUSH' || (p.play_type === 'PASS' && p.pass_result === 'complete')
    if (isTflEligible && p.net_yards != null && p.net_yards < 0) {
      const def = out[otherTeam(p.possession)]
      if (def) { def.tflMade++; def.tflYds += Math.abs(p.net_yards) }
    }

    if (out[p.possession] && _isFirstDownPlay(p)) out[p.possession].firstDowns++

    if (p.stats_count === false) continue
    const t = out[p.possession]
    if (!t) continue

    if (p.play_type === 'RUSH' || p.play_type === 'PASS') {
      t.totalPlays++
      if (p.down === 3) { t.thirdAtt++; if (_isFirstDownPlay(p)) t.thirdConv++ }
      if (p.down === 4) { t.fourthAtt++; if (_isFirstDownPlay(p)) t.fourthConv++ }
    }

    if (p.play_type === 'RUSH') {
      const y = _effectiveNetYards(p, teams) || 0
      t.rushYds += y; t.rushPlays++
      t.sackAdjRushYds += y; t.sackAdjRushPlays++
    } else if (p.play_type === 'PASS' && (p.pass_result === 'sack' || p.pass_result === 'scramble')) {
      const y = _effectiveNetYards(p, teams) || 0
      t.rushYds += y; t.rushPlays++
      if (p.pass_result === 'scramble') { t.sackAdjRushYds += y; t.sackAdjRushPlays++ }
    } else if (p.play_type === 'PASS' && ['complete', 'incomplete', 'dropped', 'broken_up', 'intercepted'].includes(p.pass_result)) {
      // Attempt count matches computeQBProgression()'s isAttempt set (5
      // results, not just the 3 that carry real yardage) — a broken-up or
      // dropped pass is still a pass ATTEMPT (the QB threw it), it just
      // never gains yards, so passYds stays scoped to the original 3.
      t.passAttempts++
      if (p.pass_result !== 'dropped' && p.pass_result !== 'broken_up') {
        t.passYds += (_effectiveNetYards(p, teams) || 0)
      }
      if (p.pass_result === 'complete') t.passCompletions++
    }
  }

  drives.forEach((d, i) => {
    const t = out[d.possession]
    if (!t) return
    const enteredRedZone = d.plays.some(p =>
      p.play_type !== 'PAT_TRY' && p.yardline_100 != null && p.yardline_100 <= 20
    )
    if (!enteredRedZone) return
    t.redZoneTrips++
    if (driveEndLabel(d.plays, i === drives.length - 1, teams) === 'TD') t.redZoneTDs++
  })

  return out
}

// Box Score's "Penalties" row needs computePenalties() too (Comparación
// derives it the same way via _teamPenaltySummary, not from
// computeComparisonStats' own output).
function _puntTerminalSpot(p) {
  if (p.punt_result === 'fair_catch') return p.punt_fair_catch_at || null
  if (p.punt_result === 'oob') return p.punt_oob_at || null
  if (p.punt_result === 'downed') return p.punt_downed_at || null
  if (p.punt_result === 'returned') {
    if (p.punt_return_result === 'fumble') return p.fumble_recovered_at || null
    return p.punt_return_at || null
  }
  if (p.punt_result === 'muffed') {
    if (p.punt_muff_result === 'fumble') return p.fumble_2_recovered_at || null
    return p.punt_muff_at_result || p.punt_muff_recovered_at || null
  }
  if (p.punt_result === 'blocked') {
    if (p.punt_block_return_result === 'returned') {
      if (p.punt_block_ret_result === 'fumble') return p.fumble_recovered_at || null
      return p.punt_block_ret_at || null
    }
    return p.punt_recovered_at || null
  }
  return null
}

export function computePenalties(plays, homeAbbr) {
  const absYd = (team, yard) => (team === homeAbbr ? yard : 100 - yard)
  const out = []

  function pushPenalty(p, team, infraction, by, result, newLos) {
    if (!team || !infraction) return
    let yards = null
    let base = p.field_pos
    if (p.play_type === 'PUNT') {
      base = _puntTerminalSpot(p) || p.field_pos
    }
    if (base && newLos) {
      yards = Math.abs(absYd(newLos.team, newLos.yard) - absYd(base.team, base.yard))
    }
    out.push({
      seq: p.seq, team, quarter: p.quarter, clock: p.clock,
      code: infraction.code, label: infraction.label,
      player: by ? playerShortLabel(by) : null,
      result: result || '—',
      yards,
      context: formatPlay(p),
    })
  }

  for (const p of plays) {
    if (p.play_type === 'GAME_CTRL') continue
    if (p.play_type === 'PENALTY') {
      pushPenalty(p, p.penalty_team, p.penalty_infraction, p.penalty_by, p.penalty_result, p.penalty_new_los)
    }
    for (const num of [1, 2]) {
      const inf = p[`flag_${num}_infraction`]
      if (!inf) continue
      pushPenalty(p, p[`flag_${num}_team`], inf, p[`flag_${num}_by`], p[`flag_${num}_result`], p[`flag_${num}_new_los`])
    }
  }

  return out.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
}

// ── Play text formatter ───────────────────────────────────────────────────────

// Shared short label for a captured player reference ({number, nombre, apellido}),
// e.g. {number:22, nombre:'Juan', apellido:'Pérez'} → "#22 J. Pérez".
// Plays captured before rosters had real names (or any incomplete playerRef)
// fall back to just "#{number}" instead of breaking.
export function playerShortLabel(playerRef) {
  if (!playerRef) return '—'
  const { number, nombre, apellido } = playerRef
  if (!apellido) return `#${number}`
  const initial = nombre ? `${nombre.charAt(0).toUpperCase()}. ` : ''
  return `#${number} ${initial}${apellido}`
}

function _playerStr(p) {
  return playerShortLabel(p)
}

function _playersStr(val) {
  if (!val) return null
  if (Array.isArray(val)) return val.map(_playerStr).join(', ')
  return _playerStr(val)
}

function _downDistStr(down, distance) {
  const labels = ['', '1st', '2nd', '3rd', '4th']
  return `${labels[down] || down} & ${distance}`
}

function _posStr(pos) {
  return pos ? `${pos.team} ${pos.yard}` : '—'
}

// Shared "— FUMBLE forced by X at Y (rec: Z #n) ..." tail, reused by RUSH,
// sack, and PAT-run fumbles — all three write the same flat field names
// (fumble_at, fumble_forced_by, fumble_recovery_team, fumble_recovered_by,
// fumble_recovered_at, fumble_result) via the shared RESULT_BRANCHES.RUSH.fumble
// sub-tree. fumble_at is omitted gracefully (no "at —") for PAT-run fumbles,
// since PAT_TYPE_BRANCHES.run's reuse of the 'result' RESULT step never
// actually appends fumble sub-steps today (RESULT_BRANCHES is keyed by
// playType, and 'PAT_TRY' has no entry) — a separate, already-known capture
// bug, not something this text change can or should paper over.
function _formatFumbleTail(play) {
  const forcedBy = play.fumble_forced_by ? ` forced by ${playerShortLabel(play.fumble_forced_by)}` : ''
  const atStr    = play.fumble_at ? ` at ${_posStr(play.fumble_at)}` : ''
  const recTeam  = play.fumble_recovery_team || '—'
  const recBy    = play.fumble_recovered_by ? ` ${playerShortLabel(play.fumble_recovered_by)}` : ''

  let fumbleResultStr = ''
  if (play.fumble_result) {
    if (play.fumble_result === 'touchdown') {
      fumbleResultStr = ' TOUCHDOWN'
    } else if (play.fumble_result === 'tackle' && play.fumble_at_result) {
      const tackleBy = play.fumble_tackle_by
        ? ` tackle: #${Array.isArray(play.fumble_tackle_by)
            ? play.fumble_tackle_by.map(p => p.number).join(', #')
            : play.fumble_tackle_by.number}`
        : ''
      fumbleResultStr = ` to ${_posStr(play.fumble_at_result)}${tackleBy}`
    } else if (play.fumble_result === 'oob' && play.fumble_at_result) {
      fumbleResultStr = ` to ${_posStr(play.fumble_at_result)} (OOB)`
    } else if (play.fumble_result === 'eop' && play.fumble_at_result) {
      fumbleResultStr = ` to ${_posStr(play.fumble_at_result)}`
    } else if (play.fumble_result === 'safety') {
      fumbleResultStr = ' SAFETY'
    }
  }

  return ` — FUMBLE${forcedBy}${atStr} (rec: ${recTeam}${recBy})${fumbleResultStr}`
}

// Recomputes the kickoff-OOB receiving spot for display, mirroring
// advanceGameState's kickRes==='oob' formula exactly (same absYard/dir/
// clamp math) — kept identical on purpose so the printed text can never
// drift from what actually got applied to game state.
function _kickoffOobFinalSpot(play) {
  const choice = play.kickoff_oob_spot_choice
  if (choice === 'actual_spot') return play.kickoff_oob_at || null
  if (choice === 'twenty_five' && play.field_pos && play.teams) {
    const defTeam = play.possession === play.teams.home.name
      ? play.teams.away.name : play.teams.home.name
    const kickAbs = absYard(play.teams, play.field_pos.team, play.field_pos.yard)
    const dir     = play.possession === play.teams.home.name ? 1 : -1
    const spotAbs = Math.max(0, Math.min(100, kickAbs + dir * 25))
    return { team: defTeam, yard: defTeam === play.teams.home.name ? spotAbs : 100 - spotAbs }
  }
  return null
}

function _formatFlags(play) {
  const flags = []
  for (const num of [1, 2]) {
    const inf = play[`flag_${num}_infraction`]
    if (!inf) break
    const team   = play[`flag_${num}_team`] || '—'
    const res    = play[`flag_${num}_result`] || ''
    const by     = play[`flag_${num}_by`] ? ` on ${_playerStr(play[`flag_${num}_by`])}` : ''
    const newLos = play[`flag_${num}_new_los`] ? ` → ${_posStr(play[`flag_${num}_new_los`])}` : ''
    // timing undefined = plays captured before this field existed — treated
    // the same as 'live' (today's default behavior), not flagged specially.
    const isDead = play[`flag_${num}_timing`] === 'dead'
    const label  = isDead ? 'FLAG (post-play)' : 'FLAG'
    const note   = isDead ? ', play stands + penalty' : ''
    flags.push(`${label}: ${inf.code} ${team}${by} (${res})${note}${newLos}`)
  }
  return flags.length ? ' | ' + flags.join(' | ') : ''
}

// Formats a completed play object into a human-readable string.
// play must have at minimum: down, distance, field_pos, play_type
export function formatPlay(play) {
  const text = _formatPlayCore(play)
  if (play.fake_punt) return `[FAKE PUNT] ${text}`
  // Snap fumble the offense recovered and developed into a real RUSH/PASS —
  // play_type is already 'RUSH'/'PASS' here (see wizard.js's snap_fumble_type
  // retargeting), same tag pattern as [FAKE PUNT] above.
  if (play.snap_fumble) return `[SNAP FUMBLE] ${text}`
  // Bad snap on a PUNT/FG/PAT_KICK, own side recovered — covers both the
  // retargeted-to-RUSH/PASS case AND the punt-still-got-away 'kick' case
  // (play_type stays 'PUNT' there, but the marker is set all the same).
  if (play.bad_snap) return `[BAD SNAP] ${text}`
  return text
}

function _formatPlayCore(play) {
  const { down, distance, field_pos, play_type, result,
          rush_by, tackle_by, at, net_yards, touchdown } = play

  let situation
  if (play_type === 'KICK') {
    const kickLabel = play.kick_type === 'field_goal' ? 'Field Goal' : 'Kickoff'
    situation = `${kickLabel} at ${_posStr(field_pos)}`
  } else if (play_type === 'PUNT') {
    situation = `Punt at ${_posStr(field_pos)}`
  } else if (play_type === 'PAT_TRY') {
    situation = 'PAT'
  } else if (down === 0) {
    situation = `at ${_posStr(field_pos)}`
  } else {
    situation = `${_downDistStr(down, distance)} at ${_posStr(field_pos)}`
  }

  if (play_type === 'RUSH') {
    const carrier = _playersStr(rush_by) || '—'
    const atStr   = at ? ` to ${_posStr(at)}` : ''
    const yds     = net_yards != null ? Math.abs(net_yards) : null

    if (touchdown) {
      return `${situation}: ${carrier} rush for ${yds} yard${yds === 1 ? '' : 's'} TOUCHDOWN${_formatFlags(play)}`
    }

    if (result === 'safety') {
      return `${situation}: ${carrier} tackled in the end zone — SAFETY (${_posStr({ team: play.possession, yard: 0 })})${_formatFlags(play)}`
    }

    const gainLoss = net_yards != null
      ? net_yards >= 0
        ? `rush for ${net_yards} yard${net_yards === 1 ? '' : 's'}`
        : `rush for loss of ${Math.abs(net_yards)} yard${Math.abs(net_yards) === 1 ? '' : 's'}`
      : 'rush'

    let suffix = ''
    if (result === 'tackle' && tackle_by) {
      suffix = ` (tackle: ${_playersStr(tackle_by)})`
    } else if (result === 'oob') {
      suffix = ' (out of bounds)'
    }
    // eop = no suffix

    if (play.fumble_at) {
      return `${situation}: ${carrier} ${gainLoss}${_formatFumbleTail(play)}${_formatFlags(play)}`
    }

    return `${situation}: ${carrier} ${gainLoss}${atStr}${suffix}${_formatFlags(play)}`
  }

  if (play_type === 'PASS') {
    const passer  = _playerStr(play.pass_by)
    const passRes = play.pass_result

    if (['incomplete', 'dropped', 'broken_up'].includes(passRes)) {
      const target  = play.intended_for  ? ` intended for ${_playerStr(play.intended_for)}`  : ''
      const buBy    = play.broken_up_by  ? ` broken up by ${_playerStr(play.broken_up_by)}`  : ''
      const hurried = play.qb_hurried_by ? ` (hurried by ${_playerStr(play.qb_hurried_by)})` : ''
      const label   = passRes === 'dropped' ? 'DROPPED'
                    : passRes === 'broken_up' ? 'BROKEN UP' : 'INCOMPLETE'
      return `${situation}: ${passer} pass ${label}${target}${buBy}${hurried}${_formatFlags(play)}`
    }

    if (passRes === 'sack') {
      const sackBy = play.sack_by ? ` by ${_playerStr(play.sack_by)}` : ''

      if (result === 'fumble') {
        return `${situation}: ${passer} SACK${sackBy}${_formatFumbleTail(play)}${_formatFlags(play)}`
      }

      const atStr  = play.at ? ` to ${_posStr(play.at)}` : ''
      const yds    = play.net_yards != null ? Math.abs(play.net_yards) : null
      const ydsStr = yds != null ? ` for loss of ${yds} yard${yds === 1 ? '' : 's'}` : ''
      return `${situation}: ${passer} SACK${sackBy}${ydsStr}${atStr}${_formatFlags(play)}`
    }

    if (passRes === 'scramble') {
      const yds = play.net_yards != null ? play.net_yards : null
      const gainLoss = yds != null
        ? yds >= 0
          ? `scramble for ${yds} yard${yds === 1 ? '' : 's'}`
          : `scramble for loss of ${Math.abs(yds)} yard${Math.abs(yds) === 1 ? '' : 's'}`
        : 'scramble'
      const atStr = play.at ? ` to ${_posStr(play.at)}` : ''
      if (play.touchdown) return `${situation}: ${passer} ${gainLoss} TOUCHDOWN${_formatFlags(play)}`
      return `${situation}: ${passer} ${gainLoss}${atStr}${_formatFlags(play)}`
    }

    if (passRes === 'intercepted') {
      const intBy = play.intercepted_by ? ` by ${_playerStr(play.intercepted_by)}` : ''
      const intAt = play.intercepted_at ? ` at ${_posStr(play.intercepted_at)}` : ''
      const retBy = play.returned_by    ? ` returned by ${_playerStr(play.returned_by)}` : ''
      const retAt = play.return_at      ? ` to ${_posStr(play.return_at)}` : ''
      let retTD = ''
      if (play.return_at && play.teams) {
        const intTeam = play.possession === play.teams.home.name
          ? play.teams.away.name
          : play.teams.home.name
        if (isTouchdown(play.teams, intTeam, play.return_at)) retTD = ' TOUCHDOWN'
      }
      return `${situation}: ${passer} INTERCEPTED${intBy}${intAt}${retBy}${retAt}${retTD}${_formatFlags(play)}`
    }

    if (passRes === 'complete') {
      const receiver = _playerStr(play.received_by)
      const atStr    = play.at ? ` to ${_posStr(play.at)}` : ''
      const yds      = play.net_yards != null ? play.net_yards : null
      const gainLoss = yds != null
        ? yds >= 0
          ? `pass complete to ${receiver} for ${yds} yard${yds === 1 ? '' : 's'}`
          : `pass complete to ${receiver} for loss of ${Math.abs(yds)} yard${Math.abs(yds) === 1 ? '' : 's'}`
        : `pass complete to ${receiver}`
      if (play.touchdown) return `${situation}: ${passer} ${gainLoss} TOUCHDOWN${_formatFlags(play)}`
      let suffix = ''
      if (play.result === 'tackle' && play.tackle_by) {
        suffix = ` (tackle: ${_playersStr(play.tackle_by)})`
      } else if (play.result === 'oob') {
        suffix = ' (out of bounds)'
      }
      return `${situation}: ${passer} ${gainLoss}${atStr}${suffix}${_formatFlags(play)}`
    }

    return `${situation}: ${passer} pass${_formatFlags(play)}`
  }

  if (play_type === 'PENALTY') {
    const inf     = play.penalty_infraction
      ? `${play.penalty_infraction.code} (${play.penalty_infraction.label})`
      : '—'
    const team    = play.penalty_team || '—'
    const res     = play.penalty_result || '—'
    const by      = play.penalty_by     ? ` on ${_playerStr(play.penalty_by)}` : ''
    const newLos  = play.penalty_new_los ? ` → New LOS: ${_posStr(play.penalty_new_los)}` : ''
    const downRes = play.penalty_down_result
      ? ` (${play.penalty_down_result.replace(/_/g, ' ')})` : ''
    const stats   = play.penalty_stats_count != null
      ? ` stats: ${play.penalty_stats_count ? 'count' : 'no count'}` : ''
    return `${situation}: PENALTY ${inf} on ${team}${by} — ${res}${newLos}${downRes}${stats}${_formatFlags(play)}`
  }

  if (play_type === 'KICK') {
    const kickedBy = play.kicked_by ? _playerStr(play.kicked_by) : '—'

    if (play.kick_type === 'field_goal') {
      const dist    = play.kick_distance ? `${play.kick_distance} yds` : ''
      const res     = play.fg_result || '—'
      const missHow = play.fg_miss_type
        ? ` (${play.fg_miss_type.replace(/_/g, ' ')})` : ''
      const blockedBy = play.fg_blocked_by
        ? ` blocked by ${_playerStr(play.fg_blocked_by)}` : ''
      const retBy   = play.fg_returned_by
        ? ` returned by ${_playerStr(play.fg_returned_by)}` : ''
      const retAt   = play.fg_ret_at
        ? ` to ${_posStr(play.fg_ret_at)}` : ''
      const retTD   = play.fg_ret_at && play.teams
        ? (() => {
            const retTeam = play.possession === play.teams.home.name
              ? play.teams.away.name : play.teams.home.name
            return isTouchdown(play.teams, retTeam, play.fg_ret_at)
              ? ' TOUCHDOWN' : ''
          })()
        : ''

      if (res === 'good') {
        return `${situation}: ${kickedBy} FIELD GOAL ${dist} GOOD${_formatFlags(play)}`
      }
      if (res === 'missed') {
        return `${situation}: ${kickedBy} FIELD GOAL ${dist} MISSED${missHow}${_formatFlags(play)}`
      }
      if (res === 'blocked') {
        return `${situation}: ${kickedBy} FIELD GOAL ${dist} BLOCKED${blockedBy}${retBy}${retAt}${retTD}${_formatFlags(play)}`
      }
      if (res === 'bad_snap') {
        // Own side recovering and scrambling into a real RUSH/PASS never
        // reaches here (play_type is already 'RUSH'/'PASS' by this point —
        // see formatPlay()'s [BAD SNAP] prefix for that case). This is only
        // the 'opponent recovers' terminal case.
        const snapAt   = play.fg_bad_snap_at ? ` at ${_posStr(play.fg_bad_snap_at)}` : ''
        const recTeam  = play.fg_bad_snap_recovery_team || '—'
        const recBy    = play.fg_bad_snap_recovered_by ? ` ${_playerStr(play.fg_bad_snap_recovered_by)}` : ''
        const recAt    = play.fg_bad_snap_recovered_at ? ` at ${_posStr(play.fg_bad_snap_recovered_at)}` : ''

        let tail = ''
        const snapRes = play.fg_bad_snap_result
        if (snapRes === 'tackle' && play.fg_bad_snap_at_result) {
          const tackleBy = play.fg_bad_snap_tackle_by
            ? ` tackle: #${Array.isArray(play.fg_bad_snap_tackle_by)
                ? play.fg_bad_snap_tackle_by.map(p => p.number).join(', #')
                : play.fg_bad_snap_tackle_by.number}`
            : ''
          tail = ` to ${_posStr(play.fg_bad_snap_at_result)}${tackleBy}`
        } else if ((snapRes === 'oob' || snapRes === 'eop') && play.fg_bad_snap_at_result) {
          tail = ` to ${_posStr(play.fg_bad_snap_at_result)}${snapRes === 'oob' ? ' (OOB)' : ''}`
        } else if (snapRes === 'safety') {
          tail = ' SAFETY'
        } else if (snapRes === 'fumble') {
          const fRecTeam = play.fumble_2_recovery_team || '—'
          const fRecBy   = play.fumble_2_recovered_by ? ` ${_playerStr(play.fumble_2_recovered_by)}` : ''
          tail = ` — FUMBLED (rec: ${fRecTeam}${fRecBy})`
        }

        return `${situation}: ${kickedBy} FIELD GOAL — BAD SNAP${snapAt} — recovered by ${recTeam}${recBy}${recAt}${tail}${_formatFlags(play)}`
      }
      return `${situation}: ${kickedBy} FIELD GOAL${_formatFlags(play)}`
    }

    // Kickoff
    const kickRes   = play.kickoff_result || '—'
    const kickedTo  = play.kicked_to
      ? ` to ${_posStr(play.kicked_to)}` : ''
    const retBy     = play.kick_returned_by
      ? ` returned by ${_playerStr(play.kick_returned_by)}` : ''
    const retAt     = play.kick_return_at
      ? ` to ${_posStr(play.kick_return_at)}` : ''
    const retTD     = play.kick_return_at && play.teams
      ? (() => {
          const retTeam = play.possession === play.teams.home.name
            ? play.teams.away.name : play.teams.home.name
          return isTouchdown(play.teams, retTeam, play.kick_return_at)
            ? ' TOUCHDOWN' : ''
        })()
      : ''
    const fairBy    = play.fair_catch_by
      ? ` fair catch by ${_playerStr(play.fair_catch_by)}` : ''
    const fairAt    = play.fair_catch_at
      ? ` at ${_posStr(play.fair_catch_at)}` : ''
    const onsideRec = play.onside_recovery_team
      ? ` recovered by ${play.onside_recovery_team}` : ''

    if (kickRes === 'returned') {
      return `${situation}: ${kickedBy} kickoff${kickedTo}${retBy}${retAt}${retTD}${_formatFlags(play)}`
    }
    if (kickRes === 'oob') {
      const oobAtStr = play.kickoff_oob_at ? ` at ${_posStr(play.kickoff_oob_at)}` : ''
      const choiceLabel = play.kickoff_oob_spot_choice === 'actual_spot' ? ' (spot real)'
        : play.kickoff_oob_spot_choice === 'twenty_five' ? ' (25 yardas desde el kick)' : ''
      const finalSpot = _kickoffOobFinalSpot(play)
      const finalStr = finalSpot ? ` → ${_posStr(finalSpot)}` : ''
      return `${situation}: ${kickedBy} kickoff OUT OF BOUNDS${oobAtStr}${choiceLabel}${finalStr}${_formatFlags(play)}`
    }
    if (kickRes === 'fair_catch') {
      return `${situation}: ${kickedBy} kickoff${kickedTo}${fairBy}${fairAt}${_formatFlags(play)}`
    }
    if (kickRes === 'touchback') {
      return `${situation}: ${kickedBy} kickoff TOUCHBACK${_formatFlags(play)}`
    }
    if (kickRes === 'onside') {
      return `${situation}: ${kickedBy} kickoff ONSIDE${onsideRec}${_formatFlags(play)}`
    }
    return `${situation}: ${kickedBy} kickoff${_formatFlags(play)}`
  }

  if (play_type === 'PAT_TRY') {
    const patType = play.pat_type

    if (patType === 'kick') {
      const kickedBy = play.kicked_by ? _playerStr(play.kicked_by) : '—'
      const res      = play.pat_kick_result
      if (res === 'good')   return `PAT: ${kickedBy} kick GOOD (1pt)${_formatFlags(play)}`
      if (res === 'missed') return `PAT: ${kickedBy} kick MISSED${_formatFlags(play)}`
      if (res === 'blocked') {
        const blkBy  = play.pat_blocked_by
          ? ` blocked by ${_playerStr(play.pat_blocked_by)}` : ''
        const retBy  = play.pat_block_returned_by
          ? ` returned by ${_playerStr(play.pat_block_returned_by)}` : ''
        const blkRes = play.pat_block_result === 'good'
          ? ' GOOD (2pt defense)' : ' downed'
        return `PAT: ${kickedBy} kick BLOCKED${blkBy}${retBy}${blkRes}${_formatFlags(play)}`
      }
      if (res === 'bad_snap') {
        // Own side recovering and scrambling into a real RUSH/PASS never
        // reaches here (play_type is already 'RUSH'/'PASS' by this point —
        // see formatPlay()'s [BAD SNAP] prefix for that case). This is only
        // the 'opponent recovers' terminal case.
        const snapAt  = play.pat_bad_snap_at ? ` at ${_posStr(play.pat_bad_snap_at)}` : ''
        const recTeam = play.pat_bad_snap_recovery_team || '—'
        const recBy   = play.pat_bad_snap_recovered_by ? ` ${_playerStr(play.pat_bad_snap_recovered_by)}` : ''
        const recAt   = play.pat_bad_snap_recovered_at ? ` at ${_posStr(play.pat_bad_snap_recovered_at)}` : ''

        let tail = ''
        const snapRes = play.pat_bad_snap_result
        if (snapRes === 'tackle' && play.pat_bad_snap_at_result) {
          const tackleBy = play.pat_bad_snap_tackle_by
            ? ` tackle: #${Array.isArray(play.pat_bad_snap_tackle_by)
                ? play.pat_bad_snap_tackle_by.map(p => p.number).join(', #')
                : play.pat_bad_snap_tackle_by.number}`
            : ''
          tail = ` to ${_posStr(play.pat_bad_snap_at_result)}${tackleBy}`
        } else if ((snapRes === 'oob' || snapRes === 'eop') && play.pat_bad_snap_at_result) {
          tail = ` to ${_posStr(play.pat_bad_snap_at_result)}${snapRes === 'oob' ? ' (OOB)' : ''}`
        } else if (snapRes === 'safety') {
          tail = ' SAFETY (2pt defense)'
        } else if (snapRes === 'fumble') {
          const fRecTeam = play.fumble_2_recovery_team || '—'
          const fRecBy   = play.fumble_2_recovered_by ? ` ${_playerStr(play.fumble_2_recovered_by)}` : ''
          tail = ` — FUMBLED (rec: ${fRecTeam}${fRecBy})`
        }

        return `PAT: ${kickedBy} kick — BAD SNAP${snapAt} — recovered by ${recTeam}${recBy}${recAt}${tail}${_formatFlags(play)}`
      }
      return `PAT: ${kickedBy} kick${_formatFlags(play)}`
    }

    if (patType === 'run') {
      const carrier = play.rush_by ? _playerStr(play.rush_by) : '—'
      if (play.touchdown) {
        return `PAT: ${carrier} rush GOOD (2pt)${_formatFlags(play)}`
      }
      if (play.result === 'fumble') {
        // fumble_forced_by/fumble_recovered_by/fumble_at rarely populate here
        // today — PAT_TYPE_BRANCHES.run's reuse of the 'result' RESULT step
        // never appends fumble sub-steps in the current wizard flow, since
        // RESULT_BRANCHES is keyed by playType and 'PAT_TRY' has no entry
        // (separate, already-known capture gap). _formatFumbleTail degrades
        // gracefully when those fields are absent.
        const defScored = play.pat_two_pt_defense ? ' — DEFENSE 2pt' : ''
        return `PAT: ${carrier} rush${_formatFumbleTail(play)}${defScored}${_formatFlags(play)}`
      }
      return `PAT: ${carrier} rush NO GOOD${_formatFlags(play)}`
    }

    if (patType === 'pass') {
      const passer  = play.pass_by ? _playerStr(play.pass_by) : '—'
      const passRes = play.pass_result
      if (passRes === 'complete' && play.touchdown) {
        const rec = play.received_by ? ` to ${_playerStr(play.received_by)}` : ''
        return `PAT: ${passer} pass${rec} GOOD (2pt)${_formatFlags(play)}`
      }
      if (passRes === 'intercepted') {
        const intBy     = play.intercepted_by
          ? ` by ${_playerStr(play.intercepted_by)}` : ''
        const defScored = play.pat_two_pt_defense ? ' — DEFENSE 2pt' : ''
        return `PAT: ${passer} pass INTERCEPTED${intBy}${defScored}${_formatFlags(play)}`
      }
      if (passRes === 'complete') {
        return `PAT: ${passer} pass complete NO GOOD${_formatFlags(play)}`
      }
      return `PAT: ${passer} pass ${passRes || 'NO GOOD'}${_formatFlags(play)}`
    }

    return `PAT: ${patType || '—'}${_formatFlags(play)}`
  }

  if (play_type === 'PUNT') {
    const puntedBy  = play.punted_by ? _playerStr(play.punted_by) : '—'
    const puntRes   = play.punt_result
    const kickedTo  = play.punt_kicked_to
      ? ` to ${_posStr(play.punt_kicked_to)}` : ''
    const retBy     = play.punt_returned_by
      ? ` returned by ${_playerStr(play.punt_returned_by)}` : ''
    const retAt     = play.punt_return_at
      ? ` to ${_posStr(play.punt_return_at)}` : ''
    const retTD     = play.punt_return_at && play.teams
      ? (() => {
          const defTeam = play.possession === play.teams.home.name
            ? play.teams.away.name : play.teams.home.name
          return isTouchdown(play.teams, defTeam, play.punt_return_at)
            ? ' TOUCHDOWN' : ''
        })()
      : ''
    const fairBy    = play.punt_fair_catch_by
      ? ` fair catch by ${_playerStr(play.punt_fair_catch_by)}` : ''
    const fairAt    = play.punt_fair_catch_at
      ? ` at ${_posStr(play.punt_fair_catch_at)}` : ''
    const oobAt     = play.punt_oob_at
      ? ` at ${_posStr(play.punt_oob_at)}` : ''
    const downedAt  = play.punt_downed_at
      ? ` at ${_posStr(play.punt_downed_at)}` : ''
    const blockedBy = play.punt_blocked_by
      ? ` blocked by ${_playerStr(play.punt_blocked_by)}` : ''
    const blkRetBy  = play.punt_block_returned_by
      ? ` returned by ${_playerStr(play.punt_block_returned_by)}` : ''
    const blkRetAt  = play.punt_block_ret_at
      ? ` to ${_posStr(play.punt_block_ret_at)}` : ''
    const blkTD     = play.punt_block_ret_at && play.teams
      ? (() => {
          const defTeam = play.possession === play.teams.home.name
            ? play.teams.away.name : play.teams.home.name
          return isTouchdown(play.teams, defTeam, play.punt_block_ret_at)
            ? ' TOUCHDOWN' : ''
        })()
      : ''

    if (puntRes === 'returned') {
      return `${situation}: ${puntedBy} punt${kickedTo}${retBy}${retAt}${retTD}${_formatFlags(play)}`
    }
    if (puntRes === 'muffed') {
      const muffAt    = play.punt_muff_at ? ` at ${_posStr(play.punt_muff_at)}` : ''
      const muffRecTm = play.punt_muff_recovery_team || '—'
      const muffRecBy = play.punt_muff_recovered_by
        ? ` ${_playerStr(play.punt_muff_recovered_by)}` : ''
      const muffRecAt = play.punt_muff_recovered_at
        ? ` at ${_posStr(play.punt_muff_recovered_at)}` : ''

      let muffTail = ''
      const muffRes = play.punt_muff_result
      if (muffRes === 'tackle' && play.punt_muff_at_result) {
        const tackleBy = play.punt_muff_tackle_by
          ? ` tackle: #${Array.isArray(play.punt_muff_tackle_by)
              ? play.punt_muff_tackle_by.map(p => p.number).join(', #')
              : play.punt_muff_tackle_by.number}`
          : ''
        muffTail = ` to ${_posStr(play.punt_muff_at_result)}${tackleBy}`
      } else if ((muffRes === 'oob' || muffRes === 'eop') && play.punt_muff_at_result) {
        muffTail = ` to ${_posStr(play.punt_muff_at_result)}${muffRes === 'oob' ? ' (OOB)' : ''}`
      } else if (muffRes === 'safety') {
        muffTail = ' SAFETY'
      } else if (muffRes === 'fumble') {
        // The recovering player DID have possession before losing it — a
        // genuine fumble, captured with the ordinary fumble_2_* fields (see
        // PUNT_MUFF_RESULT_BRANCHES.fumble in engine.js), not punt_muff_*.
        const fRecTm = play.fumble_2_recovery_team || '—'
        const fRecBy = play.fumble_2_recovered_by ? ` ${_playerStr(play.fumble_2_recovered_by)}` : ''
        muffTail = ` — FUMBLED (rec: ${fRecTm}${fRecBy})`
      }

      return `${situation}: ${puntedBy} punt${kickedTo} — MUFFED${muffAt} (rec: ${muffRecTm}${muffRecBy})${muffRecAt}${muffTail}${_formatFlags(play)}`
    }
    if (puntRes === 'bad_snap') {
      // Own side recovering (either scrambling into a real RUSH/PASS, or
      // still getting the kick away) never reaches here — both cases end up
      // with a play_type/punt_result that already formats normally (see
      // formatPlay()'s [BAD SNAP] prefix). This is only the 'opponent
      // recovers' terminal case.
      const snapAt   = play.punt_bad_snap_at ? ` at ${_posStr(play.punt_bad_snap_at)}` : ''
      const recTeam  = play.punt_bad_snap_recovery_team || '—'
      const recBy    = play.punt_bad_snap_recovered_by ? ` ${_playerStr(play.punt_bad_snap_recovered_by)}` : ''
      const recAt    = play.punt_bad_snap_recovered_at ? ` at ${_posStr(play.punt_bad_snap_recovered_at)}` : ''

      let tail = ''
      const snapRes = play.punt_bad_snap_result
      if (snapRes === 'tackle' && play.punt_bad_snap_at_result) {
        const tackleBy = play.punt_bad_snap_tackle_by
          ? ` tackle: #${Array.isArray(play.punt_bad_snap_tackle_by)
              ? play.punt_bad_snap_tackle_by.map(p => p.number).join(', #')
              : play.punt_bad_snap_tackle_by.number}`
          : ''
        tail = ` to ${_posStr(play.punt_bad_snap_at_result)}${tackleBy}`
      } else if ((snapRes === 'oob' || snapRes === 'eop') && play.punt_bad_snap_at_result) {
        tail = ` to ${_posStr(play.punt_bad_snap_at_result)}${snapRes === 'oob' ? ' (OOB)' : ''}`
      } else if (snapRes === 'safety') {
        tail = ' SAFETY'
      } else if (snapRes === 'fumble') {
        const fRecTeam = play.fumble_2_recovery_team || '—'
        const fRecBy   = play.fumble_2_recovered_by ? ` ${_playerStr(play.fumble_2_recovered_by)}` : ''
        tail = ` — FUMBLED (rec: ${fRecTeam}${fRecBy})`
      }

      return `${situation}: ${puntedBy} punt — BAD SNAP${snapAt} — recovered by ${recTeam}${recBy}${recAt}${tail}${_formatFlags(play)}`
    }
    if (puntRes === 'fair_catch') {
      return `${situation}: ${puntedBy} punt${kickedTo}${fairBy}${fairAt}${_formatFlags(play)}`
    }
    if (puntRes === 'touchback') {
      return `${situation}: ${puntedBy} punt TOUCHBACK${_formatFlags(play)}`
    }
    if (puntRes === 'oob') {
      return `${situation}: ${puntedBy} punt OUT OF BOUNDS${oobAt}${_formatFlags(play)}`
    }
    if (puntRes === 'downed') {
      return `${situation}: ${puntedBy} punt DOWNED${downedAt}${_formatFlags(play)}`
    }
    if (puntRes === 'blocked') {
      return `${situation}: ${puntedBy} punt BLOCKED${blockedBy}${blkRetBy}${blkRetAt}${blkTD}${_formatFlags(play)}`
    }
    return `${situation}: ${puntedBy} punt${_formatFlags(play)}`
  }

  // Bad snap the offense's own side recovered and developed into a real
  // RUSH/PASS never reaches here — play_type is already 'RUSH'/'PASS' by
  // this point (see formatPlay()'s [SNAP FUMBLE] prefix for that case
  // instead). This branch is only the 'opponent recovers' terminal case.
  if (play_type === 'SNAP_FUMBLE') {
    const fumbleAt = play.snap_fumble_at ? ` at ${_posStr(play.snap_fumble_at)}` : ''
    const recTeam  = play.snap_fumble_recovery_team || '—'
    const recBy    = play.snap_fumble_recovered_by ? ` ${_playerStr(play.snap_fumble_recovered_by)}` : ''
    const recAt    = play.snap_fumble_recovered_at ? ` at ${_posStr(play.snap_fumble_recovered_at)}` : ''

    let tail = ''
    const snapRes = play.snap_fumble_result
    if (snapRes === 'tackle' && play.snap_fumble_at_result) {
      const tackleBy = play.snap_fumble_tackle_by
        ? ` tackle: #${Array.isArray(play.snap_fumble_tackle_by)
            ? play.snap_fumble_tackle_by.map(p => p.number).join(', #')
            : play.snap_fumble_tackle_by.number}`
        : ''
      tail = ` to ${_posStr(play.snap_fumble_at_result)}${tackleBy}`
    } else if ((snapRes === 'oob' || snapRes === 'eop') && play.snap_fumble_at_result) {
      tail = ` to ${_posStr(play.snap_fumble_at_result)}${snapRes === 'oob' ? ' (OOB)' : ''}`
    } else if (snapRes === 'safety') {
      tail = ' SAFETY'
    } else if (snapRes === 'fumble') {
      // Recovering player DID have possession before losing it — a genuine
      // fumble, captured with the ordinary fumble_2_* fields (see
      // SNAP_FUMBLE_RESULT_BRANCHES.fumble in engine.js).
      const fRecTeam = play.fumble_2_recovery_team || '—'
      const fRecBy   = play.fumble_2_recovered_by ? ` ${_playerStr(play.fumble_2_recovered_by)}` : ''
      tail = ` — FUMBLED (rec: ${fRecTeam}${fRecBy})`
    }

    return `${situation}: SNAP FUMBLE${fumbleAt} — recovered by ${recTeam}${recBy}${recAt}${tail}${_formatFlags(play)}`
  }

  // Fallback for play types not yet formatted
  return `${situation}: ${play_type}${_formatFlags(play)}`
}

// ── Game state advancement ────────────────────────────────────────────────────

export function advanceGameState(state, play, teams) {
  const { net_yards, touchdown, at, result } = play

  if (play.play_type === 'PENALTY') {
    const res = play.penalty_result

    if (res === 'declined' || res === 'offsetting') return

    if (res === 'accepted') {
      if (play.penalty_new_los) {
        state.field_pos = { ...play.penalty_new_los }
      }

      const downRes = play.penalty_down_result
      if (downRes === 'first_down') {
        state.down     = 1
        state.distance = 10
      } else if (downRes === 'loss_of_down') {
        if (state.down >= 4) {
          state.down     = 1
          state.distance = 10
        } else {
          state.down = state.down + 1
        }
      } else {
        // repeat_down — mismo down, recalcular distance desde nuevo LOS
        if (play.penalty_new_los) {
          const net = calcNetYards(
            teams,
            state.possession,
            play.field_pos,
            play.penalty_new_los
          )
          const newDist = state.distance - net
          state.distance = newDist > 0 ? newDist : 10
        }
      }
    }
    return
  }

  if (play.play_type === 'KICK') {

    if (play.kick_type === 'field_goal') {
      const res = play.fg_result

      if (res === 'good') {
        _addPoints(state, play.possession, 3, teams)
        state.down     = 0
        state.distance = 0
        return
      }

      if (res === 'missed') {
        const defTeam = play.possession === teams.home.name
          ? teams.away.name : teams.home.name
        state.possession = defTeam
        state.down       = 1
        state.distance   = 10
        return
      }

      if (res === 'blocked') {
        const retRes  = play.fg_return_result
        const defTeam = play.possession === teams.home.name
          ? teams.away.name : teams.home.name

        if (retRes === 'returned') {
          const retAt = play.fg_ret_at
          const isTD  = retAt ? isTouchdown(teams, defTeam, retAt) : false

          if (isTD) {
            _addPoints(state, defTeam, 6, teams)
            state.possession = defTeam
            state.down       = 0
            state.distance   = 0
            if (retAt) state.field_pos = { ...retAt }
            return
          }

          if (play.fg_ret_result === 'fumble') {
            state.possession = defTeam
            _advanceFumble(state, play, '', teams)
            return
          }

          state.possession = defTeam
          if (retAt) state.field_pos = { ...retAt }
          state.down     = 1
          state.distance = 10
          return
        }

        // Downed
        if (play.fg_recovered_at) state.field_pos = { ...play.fg_recovered_at }
        state.possession = defTeam
        state.down       = 1
        state.distance   = 10
        return
      }

      // Bad snap the offense's own side recovered and scrambled into a real
      // RUSH/PASS never reaches here — play_type is already 'RUSH'/'PASS' by
      // submit time (see wizard.js's fg_bad_snap_type retargeting). This only
      // runs for the 'opponent recovers' terminal case: an immediate
      // turnover, no kick/run/pass attempt ever completed.
      if (res === 'bad_snap') {
        const recoveryTeam = play.fg_bad_snap_recovery_team
        const recoveredAt  = play.fg_bad_snap_recovered_at
        const snapResult   = play.fg_bad_snap_result
        const atResult     = play.fg_bad_snap_at_result

        const recoveringTeam = recoveryTeam || defTeam
        const isTD = atResult ? isTouchdown(teams, recoveringTeam, atResult) : false

        state.possession = recoveringTeam

        if (isTD) {
          state.down     = 0
          state.distance = 0
          if (atResult) state.field_pos = { ...atResult }
          _addPoints(state, recoveringTeam, 6, teams)
          return
        }

        // Safety: recoveringTeam is the one tackled/pinned in their own end
        // zone, so the OTHER team scores — but recoveringTeam is still the
        // one who owes the free kick next, so possession/field_pos (the
        // pre-filled starting point for that next captured KICK play) stay
        // on recoveringTeam, at their own 20. Not the bare "add 2 points and
        // leave state untouched" pattern RUSH's safety branch still has.
        if (snapResult === 'safety') {
          const scoringTeam = recoveringTeam === teams.home.name
            ? teams.away.name
            : teams.home.name
          _addPoints(state, scoringTeam, 2, teams)
          state.possession = recoveringTeam
          state.field_pos  = { team: recoveringTeam, yard: 20 }
          state.down       = 0
          state.distance   = 0
          return
        }

        if (snapResult === 'fumble') {
          _advanceFumble(state, play, 'fumble_2_', teams)
          return
        }

        if (atResult) state.field_pos = { ...atResult }
        else if (recoveredAt) state.field_pos = { ...recoveredAt }
        state.down     = 1
        state.distance = 10
        return
      }

      return
    }

    // Kickoff
    const kickRes = play.kickoff_result
    const defTeam = play.possession === teams.home.name
      ? teams.away.name : teams.home.name

    state.down     = 0
    state.distance = 0

    if (kickRes === 'touchback') {
      state.possession = defTeam
      state.field_pos  = { team: defTeam, yard: 25 }
      state.down       = 1
      state.distance   = 10
      return
    }

    if (kickRes === 'oob') {
      // NCAA: kickoff OOB before being touched by the receiving team between
      // the goal lines is a foul on the kicking team — receiver picks
      // whichever spot is more favorable, operator-chosen (kickoff_oob_spot_choice),
      // never auto-selected. 'twenty_five' is measured from the kick's own
      // spot (play.field_pos), not from either goal line.
      state.possession = defTeam
      const choice = play.kickoff_oob_spot_choice
      if (choice === 'actual_spot' && play.kickoff_oob_at) {
        state.field_pos = { ...play.kickoff_oob_at }
      } else if (choice === 'twenty_five' && play.field_pos) {
        const kickAbs = absYard(teams, play.field_pos.team, play.field_pos.yard)
        const dir     = play.possession === teams.home.name ? 1 : -1
        const spotAbs = Math.max(0, Math.min(100, kickAbs + dir * 25))
        state.field_pos = {
          team: defTeam,
          yard: defTeam === teams.home.name ? spotAbs : 100 - spotAbs,
        }
      } else {
        // Legacy plays captured before this field existed (branch used to be
        // empty) — falls back to the old fixed spot instead of crashing.
        state.field_pos = { team: defTeam, yard: 40 }
      }
      state.down       = 1
      state.distance   = 10
      return
    }

    if (kickRes === 'fair_catch') {
      state.possession = defTeam
      state.field_pos  = { team: defTeam, yard: 25 }
      state.down       = 1
      state.distance   = 10
      return
    }

    if (kickRes === 'onside') {
      const recoveryTeam = play.onside_recovery_team || defTeam
      state.possession = recoveryTeam
      if (play.onside_recovered_at) state.field_pos = { ...play.onside_recovered_at }
      state.down       = 1
      state.distance   = 10
      return
    }

    if (kickRes === 'returned') {
      const retAt = play.kick_return_at
      const isTD  = retAt ? isTouchdown(teams, defTeam, retAt) : false

      if (isTD) {
        _addPoints(state, defTeam, 6, teams)
        state.possession = defTeam
        state.down       = 0
        state.distance   = 0
        if (retAt) state.field_pos = { ...retAt }
        return
      }

      if (play.kick_return_result === 'safety') {
        _addPoints(state, play.possession, 2, teams)
      }

      if (play.kick_return_result === 'fumble') {
        state.possession = defTeam
        _advanceFumble(state, play, '', teams)
        return
      }

      state.possession = defTeam
      if (retAt) state.field_pos = { ...retAt }
      state.down       = 1
      state.distance   = 10
      return
    }
    return
  }

  if (play.play_type === 'PUNT') {
    const puntRes = play.punt_result
    const defTeam = play.possession === teams.home.name
      ? teams.away.name : teams.home.name

    if (puntRes === 'touchback') {
      state.possession = defTeam
      state.field_pos  = { team: defTeam, yard: 20 }
      state.down       = 1
      state.distance   = 10
      return
    }

    if (puntRes === 'oob') {
      state.possession = defTeam
      if (play.punt_oob_at) state.field_pos = { ...play.punt_oob_at }
      state.down       = 1
      state.distance   = 10
      return
    }

    if (puntRes === 'downed') {
      state.possession = defTeam
      if (play.punt_downed_at) state.field_pos = { ...play.punt_downed_at }
      state.down       = 1
      state.distance   = 10
      return
    }

    if (puntRes === 'fair_catch') {
      state.possession = defTeam
      if (play.punt_fair_catch_at) state.field_pos = { ...play.punt_fair_catch_at }
      state.down       = 1
      state.distance   = 10
      return
    }

    if (puntRes === 'returned') {
      const retAt = play.punt_return_at
      const isTD  = retAt ? isTouchdown(teams, defTeam, retAt) : false

      if (isTD) {
        _addPoints(state, defTeam, 6, teams)
        state.possession = defTeam
        state.down       = 0
        state.distance   = 0
        if (retAt) state.field_pos = { ...retAt }
        return
      }

      if (play.punt_return_result === 'safety') {
        _addPoints(state, play.possession, 2, teams)
      }

      if (play.punt_return_result === 'fumble') {
        state.possession = defTeam
        _advanceFumble(state, play, '', teams)
        return
      }

      state.possession = defTeam
      if (retAt) state.field_pos = { ...retAt }
      state.down       = 1
      state.distance   = 10
      return
    }

    // Muffed: the returner never controlled the ball, so this can't reuse
    // _advanceFumble() (its recoveryTeam/recoveredAt/result/atResult field
    // names are hardcoded to the fumble_*/fumble_2_* namespace, incompatible
    // with punt_muff_*'s deliberate isolation from it — see PUNT_MUFF_RESULT_
    // BRANCHES in engine.js). Mirrors _advanceFumble's logic by hand instead.
    // A second loss of the ball AFTER recovery (punt_muff_result === 'fumble')
    // IS a real fumble at that point (the recovering player did have
    // possession), so that one leaf correctly delegates to _advanceFumble
    // with the ordinary fumble_2_ prefix.
    if (puntRes === 'muffed') {
      const recoveryTeam = play.punt_muff_recovery_team
      const recoveredAt  = play.punt_muff_recovered_at
      const muffResult   = play.punt_muff_result
      const atResult     = play.punt_muff_at_result

      const recoveringTeam = recoveryTeam || defTeam
      const isTD = atResult ? isTouchdown(teams, recoveringTeam, atResult) : false

      state.possession = recoveringTeam

      if (isTD) {
        state.down     = 0
        state.distance = 0
        if (atResult) state.field_pos = { ...atResult }
        _addPoints(state, recoveringTeam, 6, teams)
        return
      }

      if (muffResult === 'safety') {
        const muffDefTeam = recoveringTeam === teams.home.name
          ? teams.away.name
          : teams.home.name
        _addPoints(state, muffDefTeam, 2, teams)
        return
      }

      if (muffResult === 'fumble') {
        _advanceFumble(state, play, 'fumble_2_', teams)
        return
      }

      if (atResult) state.field_pos = { ...atResult }
      else if (recoveredAt) state.field_pos = { ...recoveredAt }
      state.down     = 1
      state.distance = 10
      return
    }

    // Bad LONG SNAP to the punter. The offense's own side recovering and
    // scrambling into a real RUSH/PASS never reaches here — play_type is
    // already 'RUSH'/'PASS' by submit time (wizard.js's punt_bad_snap_type
    // retargeting), and recovering-but-still-punting never reaches here
    // either — punt_result gets overwritten back to a normal value (e.g.
    // 'returned') once the punt actually goes off (see PUNT_BAD_SNAP_TYPE_
    // BRANCHES.kick in wizard.js). This only runs for the 'opponent
    // recovers' terminal case.
    if (puntRes === 'bad_snap') {
      const recoveryTeam = play.punt_bad_snap_recovery_team
      const recoveredAt  = play.punt_bad_snap_recovered_at
      const snapResult   = play.punt_bad_snap_result
      const atResult     = play.punt_bad_snap_at_result

      const recoveringTeam = recoveryTeam || defTeam
      const isTD = atResult ? isTouchdown(teams, recoveringTeam, atResult) : false

      state.possession = recoveringTeam

      if (isTD) {
        state.down     = 0
        state.distance = 0
        if (atResult) state.field_pos = { ...atResult }
        _addPoints(state, recoveringTeam, 6, teams)
        return
      }

      // Safety: recoveringTeam is the one pinned in their own end zone, so
      // the OTHER team scores — but recoveringTeam still owes the free kick
      // next, so possession/field_pos stay on recoveringTeam, at their own
      // 20. See the matching fg_result === 'bad_snap' comment above for why
      // this differs from RUSH's minimal safety handling.
      if (snapResult === 'safety') {
        const scoringTeam = recoveringTeam === teams.home.name
          ? teams.away.name
          : teams.home.name
        _addPoints(state, scoringTeam, 2, teams)
        state.possession = recoveringTeam
        state.field_pos  = { team: recoveringTeam, yard: 20 }
        state.down       = 0
        state.distance   = 0
        return
      }

      if (snapResult === 'fumble') {
        _advanceFumble(state, play, 'fumble_2_', teams)
        return
      }

      if (atResult) state.field_pos = { ...atResult }
      else if (recoveredAt) state.field_pos = { ...recoveredAt }
      state.down     = 1
      state.distance = 10
      return
    }

    if (puntRes === 'blocked') {
      const blkRetRes = play.punt_block_return_result
      const recovTeam = play.punt_recovery_team || defTeam

      if (blkRetRes === 'returned') {
        const retAt   = play.punt_block_ret_at
        const retTeam = play.punt_recovery_team || defTeam
        const isTD    = retAt ? isTouchdown(teams, retTeam, retAt) : false

        if (isTD) {
          _addPoints(state, retTeam, 6, teams)
          state.possession = retTeam
          state.down       = 0
          state.distance   = 0
          if (retAt) state.field_pos = { ...retAt }
          return
        }

        if (play.punt_block_ret_result === 'fumble') {
          state.possession = retTeam
          _advanceFumble(state, play, '', teams)
          return
        }

        state.possession = retTeam
        if (retAt) state.field_pos = { ...retAt }
        state.down       = 1
        state.distance   = 10
        return
      }

      state.possession = recovTeam
      if (play.punt_recovered_at) state.field_pos = { ...play.punt_recovered_at }
      state.down       = 1
      state.distance   = 10
      return
    }

    return
  }

  // Bad snap the OWN offense recovered and developed into a real RUSH/PASS
  // never reaches here — play.play_type is already 'RUSH'/'PASS' by submit
  // time (see wizard.js's snap_fumble_type retargeting), so this branch only
  // ever runs for the 'opponent recovers' terminal case: an immediate
  // turnover, no RUSH/PASS ever developed.
  if (play.play_type === 'SNAP_FUMBLE') {
    const recoveryTeam = play.snap_fumble_recovery_team
    const recoveredAt  = play.snap_fumble_recovered_at
    const snapResult   = play.snap_fumble_result
    const atResult     = play.snap_fumble_at_result

    const recoveringTeam = recoveryTeam || play.possession
    const isTD = atResult ? isTouchdown(teams, recoveringTeam, atResult) : false

    state.possession = recoveringTeam

    if (isTD) {
      state.down     = 0
      state.distance = 0
      if (atResult) state.field_pos = { ...atResult }
      _addPoints(state, recoveringTeam, 6, teams)
      return
    }

    if (snapResult === 'safety') {
      const snapDefTeam = recoveringTeam === teams.home.name
        ? teams.away.name
        : teams.home.name
      _addPoints(state, snapDefTeam, 2, teams)
      return
    }

    if (snapResult === 'fumble') {
      _advanceFumble(state, play, 'fumble_2_', teams)
      return
    }

    if (atResult) state.field_pos = { ...atResult }
    else if (recoveredAt) state.field_pos = { ...recoveredAt }
    state.down     = 1
    state.distance = 10
    return
  }

  if (play.play_type === 'PAT_TRY') {
    const patType = play.pat_type

    state.down       = 0
    state.distance   = 0
    state.possession = play.possession
    state.field_pos  = { team: play.possession, yard: 35 }

    if (patType === 'kick') {
      if (play.pat_kick_result === 'good') {
        _addPoints(state, play.possession, 1, teams)
      }
      if (play.pat_block_result === 'good') {
        const defTeam = play.possession === teams.home.name
          ? teams.away.name : teams.home.name
        _addPoints(state, defTeam, 2, teams)
      }

      // Bad snap to the holder. The offense's own side recovering and
      // scrambling into a real RUSH/PASS never reaches here — play_type is
      // already 'RUSH'/'PASS' by submit time (wizard.js's pat_bad_snap_type
      // retargeting). This only runs for the 'opponent recovers' terminal
      // case, overriding the down=0/distance=0/own-35 defaults set above.
      if (play.pat_kick_result === 'bad_snap') {
        const defTeam = play.possession === teams.home.name
          ? teams.away.name : teams.home.name
        const recoveryTeam = play.pat_bad_snap_recovery_team
        const recoveredAt  = play.pat_bad_snap_recovered_at
        const snapResult   = play.pat_bad_snap_result
        const atResult     = play.pat_bad_snap_at_result

        const recoveringTeam = recoveryTeam || defTeam
        const isTD = atResult ? isTouchdown(teams, recoveringTeam, atResult) : false

        state.possession = recoveringTeam

        if (isTD) {
          state.down     = 0
          state.distance = 0
          if (atResult) state.field_pos = { ...atResult }
          _addPoints(state, recoveringTeam, 2, teams)
          return
        }

        if (snapResult === 'safety') {
          const scoringTeam = recoveringTeam === teams.home.name
            ? teams.away.name
            : teams.home.name
          _addPoints(state, scoringTeam, 2, teams)
          state.possession = recoveringTeam
          state.field_pos  = { team: recoveringTeam, yard: 20 }
          state.down       = 0
          state.distance   = 0
          return
        }

        if (snapResult === 'fumble') {
          _advanceFumble(state, play, 'fumble_2_', teams)
          return
        }

        if (atResult) state.field_pos = { ...atResult }
        else if (recoveredAt) state.field_pos = { ...recoveredAt }
        state.down     = 1
        state.distance = 10
        return
      }

      return
    }

    if (patType === 'run') {
      if (play.touchdown) {
        _addPoints(state, play.possession, 2, teams)
        return
      }
      if (play.result === 'fumble') {
        const fumbleAtResult = play.fumble_at_result
        if (fumbleAtResult) {
          const defTeam = play.possession === teams.home.name
            ? teams.away.name : teams.home.name
          const possChanged = play.fumble_recovery_team &&
            play.fumble_recovery_team !== play.possession
          if (possChanged &&
              isTouchdown(teams, play.fumble_recovery_team, fumbleAtResult)) {
            _addPoints(state, play.fumble_recovery_team, 2, teams)
          }
        }
      }
      return
    }

    if (patType === 'pass') {
      const passRes = play.pass_result
      if (passRes === 'complete' && play.touchdown) {
        _addPoints(state, play.possession, 2, teams)
        return
      }
      if (passRes === 'intercepted') {
        const returnPos = play.return_at || play.intercepted_at
        if (returnPos) {
          const defTeam = play.possession === teams.home.name
            ? teams.away.name : teams.home.name
          if (isTouchdown(teams, defTeam, returnPos)) {
            _addPoints(state, defTeam, 2, teams)
          }
        }
      }
      return
    }

    return
  }

  if (play.play_type === 'PASS') {
    const passRes = play.pass_result

    if (['incomplete', 'dropped', 'broken_up'].includes(passRes)) {
      if (state.down >= 4) {
        state.down     = 1
        state.distance = 10
      } else {
        state.down = state.down + 1
      }
      return
    }

    if (passRes === 'sack') {
      // A sack that ends in a fumble goes through the same RESULT_BRANCHES.RUSH
      // 'fumble' sub-tree as any other fumble (result === 'fumble') — must be
      // routed through _advanceFumble like RUSH/PASS-complete already are,
      // not treated as a normal down advance.
      if (result === 'fumble') {
        _advanceFumble(state, play, '', teams)
        return
      }
      if (play.at) state.field_pos = { ...play.at }
      _advanceDownDistance(state, play.net_yards ?? 0)
      return
    }

    if (passRes === 'scramble') {
      if (touchdown) {
        state.down     = 0
        state.distance = 0
        if (at) state.field_pos = { ...at }
        _addPoints(state, play.possession, 6, teams)
        return
      }
      if (result === 'fumble') {
        _advanceFumble(state, play, '', teams)
        return
      }
      if (at) state.field_pos = { ...at }
      _advanceDownDistance(state, play.net_yards ?? 0)
      return
    }

    if (passRes === 'intercepted') {
      const intTeam = state.possession === teams.home.name
        ? teams.away.name
        : teams.home.name

      const returnPos = play.return_at || play.intercepted_at
      const isTD = returnPos ? isTouchdown(teams, intTeam, returnPos) : false

      if (isTD) {
        _addPoints(state, intTeam, 6, teams)
        state.possession = intTeam
        state.down       = 0
        state.distance   = 0
        if (returnPos) state.field_pos = { ...returnPos }
        return
      }

      if (play.return_result === 'safety') {
        _addPoints(state, play.possession, 2, teams)
      }

      if (play.return_result === 'fumble') {
        state.possession = intTeam
        _advanceFumble(state, play, '', teams)
        return
      }

      state.possession = intTeam
      if (play.return_at)           state.field_pos = { ...play.return_at }
      else if (play.intercepted_at) state.field_pos = { ...play.intercepted_at }
      state.down     = 1
      state.distance = 10
      return
    }

    if (passRes === 'complete') {
      if (touchdown) {
        state.down     = 0
        state.distance = 0
        if (at) state.field_pos = { ...at }
        _addPoints(state, play.possession, 6, teams)
        return
      }
      if (result === 'safety') {
        const defTeam = play.possession === teams.home.name
          ? teams.away.name
          : teams.home.name
        _addPoints(state, defTeam, 2, teams)
      }
      if (result === 'fumble') {
        _advanceFumble(state, play, '', teams)
        return
      }
      if (at) state.field_pos = { ...at }
      _advanceDownDistance(state, play.net_yards ?? 0)
      return
    }

    return
  }

  if (touchdown) {
    state.down     = 0
    state.distance = 0
    if (at) state.field_pos = { ...at }
    _addPoints(state, play.possession, 6, teams)
    return
  }

  if (result === 'fumble') {
    _advanceFumble(state, play, '', teams)
    return
  }

  if (at) state.field_pos = { ...at }
  _advanceDownDistance(state, net_yards ?? 0)

  if (result === 'safety') {
    const defensiveTeam = play.possession === teams.home.name
      ? teams.away.name
      : teams.home.name
    _addPoints(state, defensiveTeam, 2, teams)
  }

}

export function applyFlags(state, play, teams) {
  _applyFlag(state, play, 1, teams)
  _applyFlag(state, play, 2, teams)
}

function _applyFlag(state, play, num, teams) {
  const inf = play[`flag_${num}_infraction`]
  if (!inf) return

  const res = play[`flag_${num}_result`]
  if (res !== 'accepted') return

  const newLos  = play[`flag_${num}_new_los`]
  const downRes = play[`flag_${num}_down_result`]

  if (newLos) state.field_pos = { ...newLos }

  // A flag's down_result overrides whatever this play's own result already
  // advanced state.down/state.distance to (advanceGameState ran before this,
  // for whichever play_type the flag was attached to) — it must be computed
  // from the play's own PRE-snap down/distance/field_pos, not from the
  // already-advanced state. Otherwise "repeat down"/"loss of down" compound
  // on top of the play's natural progression instead of replacing it.
  if (downRes === 'first_down') {
    state.down     = 1
    state.distance = 10
  } else if (downRes === 'loss_of_down') {
    if (play.down >= 4) {
      state.down     = 1
      state.distance = 10
    } else {
      state.down = play.down + 1
      if (newLos) {
        const net = calcNetYards(teams, state.possession, play.field_pos, newLos)
        const newDist = play.distance - net
        state.distance = newDist > 0 ? newDist : 10
      } else {
        state.distance = play.distance
      }
    }
  } else if (newLos) {
    // repeat_down — same down number as before this play, distance
    // recomputed from the play's original pre-snap distance and the flag's
    // new line of scrimmage.
    state.down = play.down
    const net = calcNetYards(
      teams,
      state.possession,
      play.field_pos,
      newLos
    )
    const newDist = play.distance - net
    state.distance = newDist > 0 ? newDist : 10
  }
}

function _addPoints(state, teamName, points, teams) {
  if (teamName === teams.home.name) {
    state.score.home += points
  } else if (teamName === teams.away.name) {
    state.score.away += points
  }
}

function _advanceFumble(state, play, prefix, teams) {
  const recoveryTeam   = play[`${prefix}fumble_recovery_team`]
  const recoveredAt    = play[`${prefix}fumble_recovered_at`]
  const fumbleResult   = play[`${prefix}fumble_result`]
  const fumbleAtResult = play[`${prefix}fumble_at_result`]

  const possessionChanged = recoveryTeam && recoveryTeam !== state.possession

  let isTD = false
  if (fumbleAtResult) {
    if (!possessionChanged) {
      isTD = isTouchdown(teams, state.possession, fumbleAtResult)
    } else {
      isTD = isTouchdown(teams, recoveryTeam, fumbleAtResult)
    }
  }

  if (possessionChanged) {
    state.possession = recoveryTeam
  }

  if (isTD) {
    state.down     = 0
    state.distance = 0
    if (fumbleAtResult) state.field_pos = { ...fumbleAtResult }
    if (possessionChanged) _addPoints(state, recoveryTeam, 6, teams)
    return
  }

  if (fumbleResult === 'fumble') {
    _advanceFumble(state, play, 'fumble_2_', teams)
    return
  }

  if (fumbleResult === 'safety') {
    const fumbleDefTeam = recoveryTeam === teams.home.name
      ? teams.away.name
      : teams.home.name
    _addPoints(state, fumbleDefTeam, 2, teams)
    return
  }

  if (fumbleAtResult) {
    state.field_pos = { ...fumbleAtResult }
  } else if (recoveredAt) {
    state.field_pos = { ...recoveredAt }
  }

  if (possessionChanged) {
    state.down     = 1
    state.distance = 10
  } else {
    if (fumbleAtResult) {
      const net = calcNetYards(
        teams, state.possession,
        play.field_pos,
        fumbleAtResult
      )
      _advanceDownDistance(state, net)
    }
  }
}

function _advanceDownDistance(state, gained) {
  const newDistance = state.distance - gained
  if (newDistance <= 0) {
    state.down     = 1
    state.distance = 10
  } else if (state.down >= 4) {
    state.down     = 1
    state.distance = 10
  } else {
    state.down     = state.down + 1
    state.distance = newDistance
  }
}

// ── Extracted from viewer.html (Fase 1 of the stats-lib.js/Edge Function
// refactor, 2026-09-29) ───────────────────────────────────────────────────────
// Moved verbatim (same inputs, same outputs, same field names) — the only
// change is calling playerShortLabel() directly instead of through viewer.html's
// local `playerLabel` wrapper, which existed only to guard against that file's
// own dynamic-import race (playerShortLabel might not be loaded yet); inside
// this module playerShortLabel is always defined, so the guard has nothing to
// do. See debug/snapshot_stats.mjs's baseline for the before/after diff this
// was checked against.

// A play's defense is simply whichever team does NOT have possession on it —
// tackle_by/sack_by/etc. player refs don't carry their own team, but since
// they only ever come from the opposing side of `possession`, this is enough
// to attribute every defensive credit correctly without needing that.
export function computeDefenseStats(plays, homeAbbr, awayAbbr) {
  const teams = { [homeAbbr]: {}, [awayAbbr]: {} }

  function credit(team, player, field, delta) {
    if (!team || !teams[team] || !player) return
    const label = playerShortLabel(player)
    if (!label) return
    if (!teams[team][label]) teams[team][label] = { label, solo: 0, ast: 0, sacks: 0, tfl: 0, ff: 0, int: 0, sackYds: 0, qbh: 0, pbu: 0 }
    teams[team][label][field] += delta
  }

  for (const p of plays) {
    if (p.play_type === 'GAME_CTRL') continue
    const defTeam = p.possession === homeAbbr ? awayAbbr : (p.possession === awayAbbr ? homeAbbr : null)
    if (!defTeam) continue

    const tackleArrays = [p.tackle_by, p.fumble_tackle_by, p.punt_block_ret_tackle_by, p.return_tackle_by]
    for (const arr of tackleArrays) {
      if (!Array.isArray(arr) || !arr.length) continue
      const isSolo = arr.length === 1
      for (const player of arr) {
        credit(defTeam, player, isSolo ? 'solo' : 'ast', 1)
        if (p.net_yards != null && p.net_yards < 0) credit(defTeam, player, 'tfl', 1)
      }
    }

    if (p.play_type === 'PASS' && p.pass_result === 'sack' && p.sack_by) {
      credit(defTeam, p.sack_by, 'sacks', 1)
      credit(defTeam, p.sack_by, 'solo', 1) // a sack is also a solo tackle
      credit(defTeam, p.sack_by, 'sackYds', Math.abs(p.net_yards || 0))
    }

    if (p.fumble_forced_by) credit(defTeam, p.fumble_forced_by, 'ff', 1)
    if (p.fumble_2_forced_by) credit(defTeam, p.fumble_2_forced_by, 'ff', 1)

    if (p.pass_result === 'intercepted' && p.intercepted_by) {
      credit(defTeam, p.intercepted_by, 'int', 1)
    }

    // qb_hurried_by/broken_up_by are optional single-player fields captured
    // on PASS incomplete/dropped/broken_up (same team:'opponent' shape as
    // fumble_forced_by above) — Comparación's Defense sub-tab is the first
    // consumer of either.
    if (p.qb_hurried_by) credit(defTeam, p.qb_hurried_by, 'qbh', 1)
    if (p.broken_up_by) credit(defTeam, p.broken_up_by, 'pbu', 1)
  }

  return teams
}

// ── Special teams stats ──────────────────────────────────────────────────────
// Punt/kickoff plays never get a top-level net_yards (wizard.js only computes
// it for RUSH and PASS-complete, see _confirmSubmit) — every distance here is
// derived from field_pos plus whichever landing-spot field that play's result
// branch actually recorded (punt_kicked_to/punt_oob_at/kicked_to/etc.),
// verified against wizard.js's STEPS_BY_TYPE.PUNT/KICK and their *_BRANCHES.
// A touchback has no recorded landing spot (the branch is empty in both
// PUNT_RESULT_BRANCHES and KICKOFF_RESULT_BRANCHES) — distance is approximated
// as the distance to the goal line, the standard box-score convention for
// touchback punts/kickoffs. Blocked punts and oob/onside kickoffs likewise
// have no measurable landing spot recorded — they still count as an attempt
// (No.) but contribute 0 to Yds/Long/Avg.
export function computeSpecialTeamsStats(plays, homeAbbr, awayAbbr, teams) {
  const punting     = {}
  const kickoffs     = {}
  const fgs          = []
  const kickReturns  = {}
  const puntReturns  = {}

  const dist = (kicker, snap, land) =>
    (typeof calcNetYards === 'function' && snap && land) ? calcNetYards(teams, kicker, snap, land) : null

  for (const p of plays) {
    const defTeam = p.possession === homeAbbr ? awayAbbr : (p.possession === awayAbbr ? homeAbbr : null)
    if (!defTeam) continue

    if (p.play_type === 'PUNT') {
      const label = p.punted_by ? playerShortLabel(p.punted_by) : null
      if (label) {
        const key = `${p.possession}::${label}`
        if (!punting[key]) punting[key] = { team: p.possession, label, no: 0, yds: 0, long: 0, in20: 0, tb: 0 }
        const row = punting[key]
        row.no++
        let landPos = null
        if (p.punt_result === 'returned' || p.punt_result === 'fair_catch') landPos = p.punt_kicked_to
        else if (p.punt_result === 'oob') landPos = p.punt_oob_at
        else if (p.punt_result === 'touchback') { landPos = { team: defTeam, yard: 0 }; row.tb++ }
        if (landPos) {
          const d = dist(p.possession, p.field_pos, landPos)
          if (d != null) {
            row.yds += d
            if (d > row.long) row.long = d
          }
          if (p.punt_result !== 'touchback' && landPos.team === defTeam && landPos.yard > 0 && landPos.yard <= 20) row.in20++
        }
      }

      if (p.punt_result === 'returned' && p.punt_returned_by) {
        const rLabel = playerShortLabel(p.punt_returned_by)
        if (rLabel) {
          let endPos = null
          if (['tackle', 'oob', 'eop'].includes(p.punt_return_result)) endPos = p.punt_return_at
          else if (p.punt_return_result === 'fumble') endPos = p.fumble_at
          const d = endPos ? dist(defTeam, p.punt_kicked_to, endPos) : null
          if (d != null) {
            const key = `${defTeam}::${rLabel}`
            if (!puntReturns[key]) puntReturns[key] = { team: defTeam, label: rLabel, no: 0, yds: 0, long: 0 }
            puntReturns[key].no++
            puntReturns[key].yds += d
            if (d > puntReturns[key].long) puntReturns[key].long = d
          }
        }
      }
    }

    if (p.play_type === 'KICK' && p.kick_type === 'kickoff') {
      const label = p.kicked_by ? playerShortLabel(p.kicked_by) : null
      if (label) {
        const key = `${p.possession}::${label}`
        if (!kickoffs[key]) kickoffs[key] = { team: p.possession, label, no: 0, yds: 0, tb: 0 }
        const row = kickoffs[key]
        row.no++
        let landPos = null
        if (p.kickoff_result === 'returned' || p.kickoff_result === 'fair_catch') landPos = p.kicked_to
        else if (p.kickoff_result === 'touchback') { landPos = { team: defTeam, yard: 0 }; row.tb++ }
        if (landPos) {
          const d = dist(p.possession, p.field_pos, landPos)
          if (d != null) row.yds += d
        }
      }

      if (p.kickoff_result === 'returned' && p.kick_returned_by) {
        const rLabel = playerShortLabel(p.kick_returned_by)
        if (rLabel) {
          let endPos = null
          if (['tackle', 'oob', 'eop'].includes(p.kick_return_result)) endPos = p.kick_return_at
          else if (p.kick_return_result === 'fumble') endPos = p.fumble_at
          const d = endPos ? dist(defTeam, p.kicked_to, endPos) : null
          if (d != null) {
            const key = `${defTeam}::${rLabel}`
            if (!kickReturns[key]) kickReturns[key] = { team: defTeam, label: rLabel, no: 0, yds: 0, long: 0 }
            kickReturns[key].no++
            kickReturns[key].yds += d
            if (d > kickReturns[key].long) kickReturns[key].long = d
          }
        }
      }
    }

    if (p.play_type === 'KICK' && p.kick_type === 'field_goal') {
      const result = p.fg_result === 'good' ? 'GOOD' : p.fg_result === 'blocked' ? 'BLOCKED' : p.fg_result === 'missed' ? 'MISSED' : null
      if (result) {
        fgs.push({ team: p.possession, quarter: p.quarter, clock: p.clock, distance: p.kick_distance ?? null, result })
      }
    }
  }

  return {
    punting:     Object.values(punting).sort((a, b) => b.yds - a.yds),
    kickoffs:    Object.values(kickoffs).sort((a, b) => b.yds - a.yds),
    fgs,
    kickReturns: Object.values(kickReturns).sort((a, b) => b.yds - a.yds),
    puntReturns: Object.values(puntReturns).sort((a, b) => b.yds - a.yds),
  }
}

// ── Fumbles (Individuales) ───────────────────────────────────────────────────
// Credited to whoever HAD the ball when it came loose (rush_by, the pass
// catcher on a completed reception, or the returner on a kick/punt return) —
// never the player who forced it (that's already tracked as FF in Defensiva).
// The "fumble happened" flag and its recovery fields share the same
// fumble_recovery_team/fumble_recovered_by names across every branch that can
// produce one (RUSH/PASS result=fumble, PASS return_result=fumble on a pick,
// KICK/PUNT return/block-return result=fumble) — only the flag that marks
// "did it happen on this play" differs per branch, so that part is checked
// per play_type/result field.
export function _fumbleOccurred(p) {
  return p.result === 'fumble' || p.return_result === 'fumble' || p.kick_return_result === 'fumble' ||
    p.fg_ret_result === 'fumble' || p.punt_return_result === 'fumble' || p.punt_block_ret_result === 'fumble'
}

export function _fumbleCarrier(p) {
  if (p.play_type === 'RUSH') return p.rush_by
  if (p.play_type === 'PASS') {
    if (p.pass_result === 'intercepted') return p.returned_by || p.intercepted_by
    if (p.pass_result === 'complete') return p.received_by
    return null
  }
  if (p.play_type === 'KICK' && p.kick_type === 'kickoff') return p.kick_returned_by
  if (p.play_type === 'KICK' && p.kick_type === 'field_goal') return p.fg_returned_by
  if (p.play_type === 'PUNT') return p.punt_result === 'blocked' ? p.punt_block_returned_by : p.punt_returned_by
  return null
}

export function computeFumbleStats(plays) {
  const out = {}
  for (const p of plays) {
    if (!_fumbleOccurred(p)) continue
    const carrier = _fumbleCarrier(p)
    const label = carrier ? playerShortLabel(carrier) : null
    if (!label || !p.possession) continue
    const key = `${p.possession}::${label}`
    if (!out[key]) out[key] = { team: p.possession, label, no: 0, lost: 0 }
    out[key].no++
    if (p.fumble_recovery_team && p.fumble_recovery_team !== p.possession) out[key].lost++
  }
  return Object.values(out)
}

// Same pre-sorted-map trick as computeAllPurposeMap, for the Fumbles table
// (sorted Lost desc, then No. desc).
export function fumbleStatsToMap(fumbleStats, homeAbbr, awayAbbr) {
  const raw = { [homeAbbr]: {}, [awayAbbr]: {} }
  fumbleStats.forEach(r => { if (raw[r.team]) raw[r.team][r.label] = { no: r.no, lost: r.lost } })
  const out = {}
  for (const team of [homeAbbr, awayAbbr]) {
    const sorted = Object.entries(raw[team] || {}).sort((a, b) => b[1].lost - a[1].lost || b[1].no - a[1].no)
    out[team] = Object.fromEntries(sorted)
  }
  return out
}

// ── Turnover return yards (interceptions + defensive fumble recoveries) ─────
// Feeds the FR/IR column of All-Purpose Yards. An interception's return
// distance runs from intercepted_at to whatever spot its return_result
// branch recorded (return_at for tackle/oob/eop, fumble_at if the returner
// himself fumbled); a defensive fumble recovery's return distance runs from
// the recovery spot (fumble_recovered_at / fumble_2_recovered_at) to the
// further-advance spot FUMBLE_RESULT_BRANCHES records for tackle/oob/eop
// (fumble_at_result / fumble_2_at_result) — 0 when the recovery spot was the
// final spot (no further advance captured).
// See computeTurnoverReturnYardsByTeam() below for the team-total, split-by-
// origin sibling used by Comparación's summary panel (INT vs FUM-YDS).
export function computeTurnoverReturnYards(plays, homeAbbr, awayAbbr, teams) {
  const map = {}
  function add(team, label, yds) {
    if (!team || !label || !yds) return
    const key = `${team}::${label}`
    if (!map[key]) map[key] = { team, label, yds: 0 }
    map[key].yds += yds
  }
  const dist = (team, from, to) =>
    (typeof calcNetYards === 'function' && from && to) ? calcNetYards(teams, team, from, to) : 0

  for (const p of plays) {
    if (p.play_type === 'PASS' && p.pass_result === 'intercepted' && p.intercepted_by) {
      const intTeam = p.possession === homeAbbr ? awayAbbr : (p.possession === awayAbbr ? homeAbbr : null)
      if (intTeam) {
        let endPos = null
        if (['tackle', 'oob', 'eop'].includes(p.return_result)) endPos = p.return_at
        else if (p.return_result === 'fumble') endPos = p.fumble_at
        const yds = endPos ? Math.max(dist(intTeam, p.intercepted_at, endPos), 0) : 0
        add(intTeam, playerShortLabel(p.intercepted_by), yds)
      }
    }

    for (const prefix of ['fumble_', 'fumble_2_']) {
      const recTeam = p[`${prefix}recovery_team`]
      const recBy   = p[`${prefix}recovered_by`]
      const recAt   = p[`${prefix}recovered_at`]
      if (!recTeam || !recBy || !recAt || recTeam === p.possession) continue
      const advField = prefix === 'fumble_' ? 'fumble_at_result' : 'fumble_2_at_result'
      const endPos = p[advField] || null
      const yds = endPos ? Math.max(dist(recTeam, recAt, endPos), 0) : 0
      add(recTeam, playerShortLabel(recBy), yds)
    }
  }

  return Object.values(map)
}

// Sibling of computeTurnoverReturnYards() above — same two source loops
// (interception returns, defensive fumble recoveries), but aggregated
// straight to TEAM totals and kept SEPARATE by origin (INT vs FUM-YDS),
// instead of merged into one per-player FR/IR figure. A new function
// rather than a modification of the original so its existing consumer
// (computeAllPurposeMap's combined FR/IR column, which wants the two
// merged) is untouched. If the return-distance resolution logic ever
// changes (e.g. a new return_result branch), update both copies.
export function computeTurnoverReturnYardsByTeam(plays, homeAbbr, awayAbbr, teams) {
  const out = { [homeAbbr]: { intYds: 0, fumYds: 0 }, [awayAbbr]: { intYds: 0, fumYds: 0 } }
  const dist = (team, from, to) =>
    (typeof calcNetYards === 'function' && from && to) ? calcNetYards(teams, team, from, to) : 0

  for (const p of plays) {
    if (p.play_type === 'PASS' && p.pass_result === 'intercepted' && p.intercepted_by) {
      const intTeam = p.possession === homeAbbr ? awayAbbr : (p.possession === awayAbbr ? homeAbbr : null)
      if (intTeam && out[intTeam]) {
        let endPos = null
        if (['tackle', 'oob', 'eop'].includes(p.return_result)) endPos = p.return_at
        else if (p.return_result === 'fumble') endPos = p.fumble_at
        const yds = endPos ? Math.max(dist(intTeam, p.intercepted_at, endPos), 0) : 0
        out[intTeam].intYds += yds
      }
    }

    for (const prefix of ['fumble_', 'fumble_2_']) {
      const recTeam = p[`${prefix}recovery_team`]
      const recAt   = p[`${prefix}recovered_at`]
      if (!recTeam || !recAt || recTeam === p.possession || !out[recTeam]) continue
      const advField = prefix === 'fumble_' ? 'fumble_at_result' : 'fumble_2_at_result'
      const endPos = p[advField] || null
      const yds = endPos ? Math.max(dist(recTeam, recAt, endPos), 0) : 0
      out[recTeam].fumYds += yds
    }
  }
  return out
}

// Second sibling of computeTurnoverReturnYards() — same two source loops and
// the exact same distance-resolution logic (intercepted_at→return_at/
// fumble_at; fumble_recovered_at→fumble_at_result), but grouped by
// INDIVIDUAL PLAYER instead of team, kept separate by origin, and adding a
// TD flag (via isTouchdown() against the resolved end spot — turnover plays
// never populate the raw `touchdown` field, see _turnoverScore's comment)
// and a Long (max single return). Feeds Comparación's Defense sub-tab
// (Interceptions / Fumble Returns sections).
export function computeTurnoverStatsByPlayer(plays, homeAbbr, awayAbbr, teams) {
  const interceptions = { [homeAbbr]: {}, [awayAbbr]: {} }
  const fumbleReturns = { [homeAbbr]: {}, [awayAbbr]: {} }

  function credit(map, team, player, yds, isTD) {
    if (!map[team] || !player) return
    const label = playerShortLabel(player)
    if (!label) return
    if (!map[team][label]) map[team][label] = { label, no: 0, yds: 0, td: 0, long: -Infinity }
    const row = map[team][label]
    row.no++
    row.yds += yds
    if (isTD) row.td++
    if (yds > row.long) row.long = yds
  }

  const dist = (team, from, to) =>
    (typeof calcNetYards === 'function' && from && to) ? calcNetYards(teams, team, from, to) : 0

  for (const p of plays) {
    if (p.play_type === 'PASS' && p.pass_result === 'intercepted' && p.intercepted_by) {
      const intTeam = p.possession === homeAbbr ? awayAbbr : (p.possession === awayAbbr ? homeAbbr : null)
      if (intTeam) {
        let endPos = null
        if (['tackle', 'oob', 'eop'].includes(p.return_result)) endPos = p.return_at
        else if (p.return_result === 'fumble') endPos = p.fumble_at
        const yds = endPos ? Math.max(dist(intTeam, p.intercepted_at, endPos), 0) : 0
        const isTD = !!(endPos && isTouchdown(teams, intTeam, endPos))
        credit(interceptions, intTeam, p.intercepted_by, yds, isTD)
      }
    }

    for (const prefix of ['fumble_', 'fumble_2_']) {
      const recTeam = p[`${prefix}recovery_team`]
      const recBy   = p[`${prefix}recovered_by`]
      const recAt   = p[`${prefix}recovered_at`]
      if (!recTeam || !recBy || !recAt || recTeam === p.possession) continue
      const advField = prefix === 'fumble_' ? 'fumble_at_result' : 'fumble_2_at_result'
      const endPos = p[advField] || null
      const yds = endPos ? Math.max(dist(recTeam, recAt, endPos), 0) : 0
      const isTD = !!(endPos && isTouchdown(teams, recTeam, endPos))
      credit(fumbleReturns, recTeam, recBy, yds, isTD)
    }
  }

  return { interceptions, fumbleReturns }
}

// Combines rushing/receiving yards (already keyed by team+player from
// buildOffenseMaps' own breakdown) with kick/punt-return and turnover-return
// yards into one per-player map, pre-sorted by Total descending within each
// team so callers that just walk object insertion order render it sorted
// without needing their own sort logic.
export function computeAllPurposeMap(rushers, receivers, kickReturns, puntReturns, turnoverReturns, homeAbbr, awayAbbr) {
  const raw = { [homeAbbr]: {}, [awayAbbr]: {} }
  function ensure(team, label) {
    if (!raw[team]) return null
    if (!raw[team][label]) raw[team][label] = { run: 0, rcv: 0, kr: 0, pr: 0, frir: 0 }
    return raw[team][label]
  }
  for (const team of [homeAbbr, awayAbbr]) {
    Object.entries(rushers[team] || {}).forEach(([label, d]) => { const r = ensure(team, label); if (r) r.run += d.yds })
    Object.entries(receivers[team] || {}).forEach(([label, d]) => { const r = ensure(team, label); if (r) r.rcv += d.yds })
  }
  kickReturns.forEach(({ team, label, yds }) => { const r = ensure(team, label); if (r) r.kr += yds })
  puntReturns.forEach(({ team, label, yds }) => { const r = ensure(team, label); if (r) r.pr += yds })
  turnoverReturns.forEach(({ team, label, yds }) => { const r = ensure(team, label); if (r) r.frir += yds })

  const out = {}
  for (const team of [homeAbbr, awayAbbr]) {
    const sorted = Object.entries(raw[team] || {})
      .map(([label, d]) => [label, { ...d, total: d.run + d.rcv + d.kr + d.pr + d.frir }])
      .filter(([, d]) => d.total !== 0)
      .sort((a, b) => b[1].total - a[1].total)
    out[team] = Object.fromEntries(sorted)
  }
  return out
}

// ── QB progression ───────────────────────────────────────────────────────────
export function computeQBProgression(plays) {
  const byQB = {}
  const sorted = plays
    .filter(p => p.play_type === 'PASS' && p.pass_by)
    .slice()
    .sort((a, b) => a.seq - b.seq)

  for (const p of sorted) {
    const label = playerShortLabel(p.pass_by)
    if (!label) continue
    const key = `${p.possession}::${label}`
    if (!byQB[key]) byQB[key] = { team: p.possession, label, rows: [], comp: 0, att: 0, yds: 0, td: 0, int: 0 }
    const qb = byQB[key]

    // Standard box-score convention: sacks/scrambles are plays the QB was
    // involved in, but not passing "attempts" — the QB never released the ball.
    // A play voided by an accepted penalty (stats_count: false, set by
    // wizard.js at save time) is excluded from the tally entirely — it's
    // still shown below as a row for context, just not counted.
    const isAttempt = p.stats_count !== false &&
      ['complete', 'incomplete', 'dropped', 'broken_up', 'intercepted'].includes(p.pass_result)
    if (isAttempt) {
      qb.att++
      if (p.pass_result === 'complete') { qb.comp++; qb.yds += (p.net_yards || 0) }
      if (p.touchdown) qb.td++
      if (p.pass_result === 'intercepted') qb.int++
    }

    let note = ''
    if (p.touchdown) note = 'TD'
    else if (p.pass_result === 'intercepted') note = 'INT'
    else if (p.pass_result === 'sack') note = 'SACK'

    qb.rows.push({
      isComplete: p.pass_result === 'complete',
      caTally: `${qb.comp}-${qb.att}`,
      netYards: p.net_yards,
      receiver: p.pass_result === 'complete' && p.received_by ? playerShortLabel(p.received_by) : null,
      note,
      context: typeof formatPlay === 'function' ? formatPlay(p) : p.play_type,
    })
  }

  return Object.values(byQB)
}

// ── Explosive plays ──────────────────────────────────────────────────────────
export function computeExplosivePlays(plays, teams) {
  const passing = []
  const rushing = []
  for (const p of plays) {
    const eff = _effectiveNetYards(p, teams)
    if (eff == null) continue
    // Carry the already-computed effective yardage along on a shallow copy
    // (_effYards) instead of recomputing it for sort/display — same value
    // the threshold check above just used, not the raw (pre-penalty) net_yards.
    if (p.play_type === 'PASS' && p.pass_result === 'complete' && eff >= 15) passing.push({ ...p, _effYards: eff })
    // A scramble is a rushing play (NCAA convention, see computeComparisonStats)
    // so it's judged against the same 10-yard rushing threshold as a RUSH play.
    else if ((p.play_type === 'RUSH' || (p.play_type === 'PASS' && p.pass_result === 'scramble')) && eff >= 10) rushing.push({ ...p, _effYards: eff })
  }
  return {
    passing: passing.slice().sort((a, b) => b._effYards - a._effYards),
    rushing: rushing.slice().sort((a, b) => b._effYards - a._effYards),
  }
}

// ── Offense per-player maps (passing/rushing/receiving) ──────────────────────
// Was an inline useMemo in viewer.html (~line 2612) building three keyed maps
// at once from one pass over `plays` — extracted verbatim as its own function,
// same field names, same NCAA scramble/sack-is-a-rush convention as
// computeComparisonStats.
export function buildOffenseMaps(plays, homeAbbr, awayAbbr) {
  const pa = {}, ru = {}, re = {}

  for (const p of plays) {
    const t = p.possession
    if (t !== homeAbbr && t !== awayAbbr) continue
    // A play voided by an accepted penalty (stats_count: false, set by
    // wizard.js at save time) isn't a real attempt for anyone involved —
    // excluded from RUSHING/PASSING/RECEIVING entirely, not just judged
    // by its (now-zero) net_yards.
    if (p.stats_count === false) continue

    if (p.play_type === 'RUSH') {
      const yds = p.net_yards || 0
      const key = p.rush_by ? playerShortLabel(p.rush_by) : 'Desconocido'
      if (!ru[t]) ru[t] = {}
      if (!ru[t][key]) ru[t][key] = { att:0, yds:0, td:0, gained:0, long:-Infinity }
      ru[t][key].att++
      ru[t][key].yds += yds
      if (yds > 0) ru[t][key].gained += yds
      if (yds > ru[t][key].long) ru[t][key].long = yds
      if (p.touchdown) ru[t][key].td++
    }

    // NCAA convention: a QB scramble or a sack is a rushing play credited
    // to the QB (pass_by), not a passing attempt — the ball was never
    // thrown either way, so both are folded into the RUSHING breakdown
    // instead of PASSING (matches computeComparisonStats' Rush Yds and the
    // isAttempt filter computeQBProgression already used for att/comp%).
    if (p.play_type === 'PASS' && (p.pass_result === 'scramble' || p.pass_result === 'sack')) {
      const yds = p.net_yards || 0
      const key = p.pass_by ? playerShortLabel(p.pass_by) : 'Desconocido'
      if (!ru[t]) ru[t] = {}
      if (!ru[t][key]) ru[t][key] = { att:0, yds:0, td:0, gained:0, long:-Infinity }
      ru[t][key].att++
      ru[t][key].yds += yds
      if (yds > 0) ru[t][key].gained += yds
      if (yds > ru[t][key].long) ru[t][key].long = yds
      if (p.touchdown) ru[t][key].td++

      // "Sacked" is tracked on the PASSER's own passing line (Comparación's
      // Offense table) even though the sack itself is credited to RUSHING
      // above for yardage purposes — same play, two different box-score
      // conventions, not a contradiction. Lazily inits pa[t][key] here since
      // a QB's first charted play of the game could be a sack, before the
      // passing block below ever runs for him.
      if (p.pass_result === 'sack') {
        if (!pa[t]) pa[t] = {}
        if (!pa[t][key]) pa[t][key] = { att:0, comp:0, yds:0, td:0, long:-Infinity, sacked:0, sackedYds:0 }
        pa[t][key].sacked++
        pa[t][key].sackedYds += Math.abs(yds)
      }
    }

    if (p.play_type === 'PASS' && p.pass_result !== 'scramble' && p.pass_result !== 'sack') {
      const key = p.pass_by ? playerShortLabel(p.pass_by) : 'Desconocido'
      if (!pa[t]) pa[t] = {}
      if (!pa[t][key]) pa[t][key] = { att:0, comp:0, yds:0, td:0, long:-Infinity, sacked:0, sackedYds:0 }
      pa[t][key].att++
      if (p.pass_result === 'complete') {
        const yds = p.net_yards || 0
        pa[t][key].comp++
        pa[t][key].yds += yds
        if (yds > pa[t][key].long) pa[t][key].long = yds
        if (p.touchdown) pa[t][key].td++
        if (p.received_by) {
          const rk = playerShortLabel(p.received_by)
          if (!re[t]) re[t] = {}
          if (!re[t][rk]) re[t][rk] = { rec:0, yds:0, td:0, long:-Infinity }
          re[t][rk].rec++
          re[t][rk].yds += yds
          if (yds > re[t][rk].long) re[t][rk].long = yds
          if (p.touchdown) re[t][rk].td++
        }
      }
    }
  }
  return { passers: pa, rushers: ru, receivers: re }
}

// ── Manual-capture path (Fase 3 of the stats-lib.js/Edge Function refactor,
// 2026-09-29) ──────────────────────────────────────────────────────────────
// Moved verbatim from viewer.html. These back BasicBoxScore — the box score
// shown for a game captured via manual_stats.html (team_game_stats_manual/
// player_game_stats_manual rows, no plays[]) — which stays a React component
// in viewer.html, same as SimpleStatTable/ManualOffenseTeamCard/
// TeamLeadersCard/BoxScoreLeaderLine; only the pure row/lookup logic moved.

// Classic NCAA/NFL passer rating (the "old" 0-158.3 formula), NOT ESPN's
// Total QBR — QBR is a proprietary model (win probability, garbage-time
// discounting, etc.) we don't have the inputs to reproduce, so this table
// uses the public formula instead:
//   a = clamp((Comp/Att - 0.3) * 5, 0, 2.375)
//   b = clamp((Yds/Att - 3) * 0.25, 0, 2.375)
//   c = clamp((TD/Att) * 20, 0, 2.375)
//   d = clamp(2.375 - (Int/Att) * 25, 0, 2.375)
//   rating = (a + b + c + d) / 6 * 100
export function _passerRating(comp, att, yds, td, int) {
  if (!att) return null
  const clamp = v => Math.max(0, Math.min(2.375, v))
  const a = clamp((comp / att - 0.3) * 5)
  const b = clamp((yds / att - 3) * 0.25)
  const c = clamp((td / att) * 20)
  const d = clamp(2.375 - (int / att) * 25)
  return ((a + b + c + d) / 6) * 100
}

// Highest non-zero value of `field` among a team's player_game_stats_manual
// rows, or null if nobody on that side has any (e.g. a team with no defensive
// leaders entered, or the whole category left blank).
export function _topManualStat(playerManualStats, teamId, field) {
  let best = null
  for (const r of playerManualStats) {
    if (r.player?.team_id !== teamId) continue
    const val = r[field] || 0
    if (val > 0 && (!best || val > best.val)) best = { player: r.player, val }
  }
  return best
}

// Manual-stats analogs of viewer.html's own _passingRows/_rushingRows/
// _receivingRows — same row shape SimpleStatTable already expects, sourced
// from player_game_stats_manual instead of a plays[]-derived map. Long/Sacked
// have no equivalent in manual capture, so they render as '—' (columns kept,
// not omitted, so the table looks identical between live and historical games).
export function _manualPassingRows(playerManualStats, teamId) {
  return playerManualStats
    .filter(r => r.player?.team_id === teamId && ((r.pass_att || 0) > 0 || (r.pass_yds || 0) > 0))
    .map(r => {
      const att = r.pass_att || 0, comp = r.pass_comp || 0, yds = r.pass_yds || 0, td = r.pass_td || 0, int = r.pass_int || 0
      const pct = att ? `${((comp / att) * 100).toFixed(1)}%` : '0.0%'
      const rating = _passerRating(comp, att, yds, td, int)
      return [playerShortLabel(r.player), comp, att, pct, yds, td, int, '—', '—', rating != null ? rating.toFixed(1) : '—']
    })
}

export function _manualRushingRows(playerManualStats, teamId) {
  return playerManualStats
    .filter(r => r.player?.team_id === teamId && ((r.rush_att || 0) > 0 || (r.rush_yds || 0) > 0))
    .map(r => {
      const att = r.rush_att || 0, yds = r.rush_yds || 0
      return [playerShortLabel(r.player), att, '—', yds, att ? (yds / att).toFixed(1) : '0.0', r.rush_td || 0, '—']
    })
}

export function _manualReceivingRows(playerManualStats, teamId) {
  return playerManualStats
    .filter(r => r.player?.team_id === teamId && ((r.rec || 0) > 0 || (r.rec_yds || 0) > 0))
    .map(r => {
      const rec = r.rec || 0, yds = r.rec_yds || 0
      return [playerShortLabel(r.player), rec, yds, rec ? (yds / rec).toFixed(1) : '0.0', r.rec_td || 0, '—']
    })
}
