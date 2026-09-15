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

export function advanceGameState(state, play) {
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
            gameState.teams,
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
        _addPoints(state, play.possession, 3)
        state.down     = 0
        state.distance = 0
        return
      }

      if (res === 'missed') {
        const defTeam = play.possession === gameState.teams.home.name
          ? gameState.teams.away.name : gameState.teams.home.name
        state.possession = defTeam
        state.down       = 1
        state.distance   = 10
        return
      }

      if (res === 'blocked') {
        const retRes  = play.fg_return_result
        const defTeam = play.possession === gameState.teams.home.name
          ? gameState.teams.away.name : gameState.teams.home.name

        if (retRes === 'returned') {
          const retAt = play.fg_ret_at
          const isTD  = retAt ? isTouchdown(gameState.teams, defTeam, retAt) : false

          if (isTD) {
            _addPoints(state, defTeam, 6)
            state.possession = defTeam
            state.down       = 0
            state.distance   = 0
            if (retAt) state.field_pos = { ...retAt }
            return
          }

          if (play.fg_ret_result === 'fumble') {
            state.possession = defTeam
            _advanceFumble(state, play, '')
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
        const isTD = atResult ? isTouchdown(gameState.teams, recoveringTeam, atResult) : false

        state.possession = recoveringTeam

        if (isTD) {
          state.down     = 0
          state.distance = 0
          if (atResult) state.field_pos = { ...atResult }
          _addPoints(state, recoveringTeam, 6)
          return
        }

        // Safety: recoveringTeam is the one tackled/pinned in their own end
        // zone, so the OTHER team scores — but recoveringTeam is still the
        // one who owes the free kick next, so possession/field_pos (the
        // pre-filled starting point for that next captured KICK play) stay
        // on recoveringTeam, at their own 20. Not the bare "add 2 points and
        // leave state untouched" pattern RUSH's safety branch still has.
        if (snapResult === 'safety') {
          const scoringTeam = recoveringTeam === gameState.teams.home.name
            ? gameState.teams.away.name
            : gameState.teams.home.name
          _addPoints(state, scoringTeam, 2)
          state.possession = recoveringTeam
          state.field_pos  = { team: recoveringTeam, yard: 20 }
          state.down       = 0
          state.distance   = 0
          return
        }

        if (snapResult === 'fumble') {
          _advanceFumble(state, play, 'fumble_2_')
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
    const defTeam = play.possession === gameState.teams.home.name
      ? gameState.teams.away.name : gameState.teams.home.name

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
        const kickAbs = absYard(gameState.teams, play.field_pos.team, play.field_pos.yard)
        const dir     = play.possession === gameState.teams.home.name ? 1 : -1
        const spotAbs = Math.max(0, Math.min(100, kickAbs + dir * 25))
        state.field_pos = {
          team: defTeam,
          yard: defTeam === gameState.teams.home.name ? spotAbs : 100 - spotAbs,
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
      const isTD  = retAt ? isTouchdown(gameState.teams, defTeam, retAt) : false

      if (isTD) {
        _addPoints(state, defTeam, 6)
        state.possession = defTeam
        state.down       = 0
        state.distance   = 0
        if (retAt) state.field_pos = { ...retAt }
        return
      }

      if (play.kick_return_result === 'safety') {
        _addPoints(state, play.possession, 2)
      }

      if (play.kick_return_result === 'fumble') {
        state.possession = defTeam
        _advanceFumble(state, play, '')
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
    const defTeam = play.possession === gameState.teams.home.name
      ? gameState.teams.away.name : gameState.teams.home.name

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
      const isTD  = retAt ? isTouchdown(gameState.teams, defTeam, retAt) : false

      if (isTD) {
        _addPoints(state, defTeam, 6)
        state.possession = defTeam
        state.down       = 0
        state.distance   = 0
        if (retAt) state.field_pos = { ...retAt }
        return
      }

      if (play.punt_return_result === 'safety') {
        _addPoints(state, play.possession, 2)
      }

      if (play.punt_return_result === 'fumble') {
        state.possession = defTeam
        _advanceFumble(state, play, '')
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
      const isTD = atResult ? isTouchdown(gameState.teams, recoveringTeam, atResult) : false

      state.possession = recoveringTeam

      if (isTD) {
        state.down     = 0
        state.distance = 0
        if (atResult) state.field_pos = { ...atResult }
        _addPoints(state, recoveringTeam, 6)
        return
      }

      if (muffResult === 'safety') {
        const muffDefTeam = recoveringTeam === gameState.teams.home.name
          ? gameState.teams.away.name
          : gameState.teams.home.name
        _addPoints(state, muffDefTeam, 2)
        return
      }

      if (muffResult === 'fumble') {
        _advanceFumble(state, play, 'fumble_2_')
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
      const isTD = atResult ? isTouchdown(gameState.teams, recoveringTeam, atResult) : false

      state.possession = recoveringTeam

      if (isTD) {
        state.down     = 0
        state.distance = 0
        if (atResult) state.field_pos = { ...atResult }
        _addPoints(state, recoveringTeam, 6)
        return
      }

      // Safety: recoveringTeam is the one pinned in their own end zone, so
      // the OTHER team scores — but recoveringTeam still owes the free kick
      // next, so possession/field_pos stay on recoveringTeam, at their own
      // 20. See the matching fg_result === 'bad_snap' comment above for why
      // this differs from RUSH's minimal safety handling.
      if (snapResult === 'safety') {
        const scoringTeam = recoveringTeam === gameState.teams.home.name
          ? gameState.teams.away.name
          : gameState.teams.home.name
        _addPoints(state, scoringTeam, 2)
        state.possession = recoveringTeam
        state.field_pos  = { team: recoveringTeam, yard: 20 }
        state.down       = 0
        state.distance   = 0
        return
      }

      if (snapResult === 'fumble') {
        _advanceFumble(state, play, 'fumble_2_')
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
        const isTD    = retAt ? isTouchdown(gameState.teams, retTeam, retAt) : false

        if (isTD) {
          _addPoints(state, retTeam, 6)
          state.possession = retTeam
          state.down       = 0
          state.distance   = 0
          if (retAt) state.field_pos = { ...retAt }
          return
        }

        if (play.punt_block_ret_result === 'fumble') {
          state.possession = retTeam
          _advanceFumble(state, play, '')
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
    const isTD = atResult ? isTouchdown(gameState.teams, recoveringTeam, atResult) : false

    state.possession = recoveringTeam

    if (isTD) {
      state.down     = 0
      state.distance = 0
      if (atResult) state.field_pos = { ...atResult }
      _addPoints(state, recoveringTeam, 6)
      return
    }

    if (snapResult === 'safety') {
      const snapDefTeam = recoveringTeam === gameState.teams.home.name
        ? gameState.teams.away.name
        : gameState.teams.home.name
      _addPoints(state, snapDefTeam, 2)
      return
    }

    if (snapResult === 'fumble') {
      _advanceFumble(state, play, 'fumble_2_')
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
        _addPoints(state, play.possession, 1)
      }
      if (play.pat_block_result === 'good') {
        const defTeam = play.possession === gameState.teams.home.name
          ? gameState.teams.away.name : gameState.teams.home.name
        _addPoints(state, defTeam, 2)
      }

      // Bad snap to the holder. The offense's own side recovering and
      // scrambling into a real RUSH/PASS never reaches here — play_type is
      // already 'RUSH'/'PASS' by submit time (wizard.js's pat_bad_snap_type
      // retargeting). This only runs for the 'opponent recovers' terminal
      // case, overriding the down=0/distance=0/own-35 defaults set above.
      if (play.pat_kick_result === 'bad_snap') {
        const defTeam = play.possession === gameState.teams.home.name
          ? gameState.teams.away.name : gameState.teams.home.name
        const recoveryTeam = play.pat_bad_snap_recovery_team
        const recoveredAt  = play.pat_bad_snap_recovered_at
        const snapResult   = play.pat_bad_snap_result
        const atResult     = play.pat_bad_snap_at_result

        const recoveringTeam = recoveryTeam || defTeam
        const isTD = atResult ? isTouchdown(gameState.teams, recoveringTeam, atResult) : false

        state.possession = recoveringTeam

        if (isTD) {
          state.down     = 0
          state.distance = 0
          if (atResult) state.field_pos = { ...atResult }
          _addPoints(state, recoveringTeam, 2)
          return
        }

        if (snapResult === 'safety') {
          const scoringTeam = recoveringTeam === gameState.teams.home.name
            ? gameState.teams.away.name
            : gameState.teams.home.name
          _addPoints(state, scoringTeam, 2)
          state.possession = recoveringTeam
          state.field_pos  = { team: recoveringTeam, yard: 20 }
          state.down       = 0
          state.distance   = 0
          return
        }

        if (snapResult === 'fumble') {
          _advanceFumble(state, play, 'fumble_2_')
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
        _addPoints(state, play.possession, 2)
        return
      }
      if (play.result === 'fumble') {
        const fumbleAtResult = play.fumble_at_result
        if (fumbleAtResult) {
          const defTeam = play.possession === gameState.teams.home.name
            ? gameState.teams.away.name : gameState.teams.home.name
          const possChanged = play.fumble_recovery_team &&
            play.fumble_recovery_team !== play.possession
          if (possChanged &&
              isTouchdown(gameState.teams, play.fumble_recovery_team, fumbleAtResult)) {
            _addPoints(state, play.fumble_recovery_team, 2)
          }
        }
      }
      return
    }

    if (patType === 'pass') {
      const passRes = play.pass_result
      if (passRes === 'complete' && play.touchdown) {
        _addPoints(state, play.possession, 2)
        return
      }
      if (passRes === 'intercepted') {
        const returnPos = play.return_at || play.intercepted_at
        if (returnPos) {
          const defTeam = play.possession === gameState.teams.home.name
            ? gameState.teams.away.name : gameState.teams.home.name
          if (isTouchdown(gameState.teams, defTeam, returnPos)) {
            _addPoints(state, defTeam, 2)
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
        _advanceFumble(state, play, '')
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
        _addPoints(state, play.possession, 6)
        return
      }
      if (result === 'fumble') {
        _advanceFumble(state, play, '')
        return
      }
      if (at) state.field_pos = { ...at }
      _advanceDownDistance(state, play.net_yards ?? 0)
      return
    }

    if (passRes === 'intercepted') {
      const intTeam = state.possession === gameState.teams.home.name
        ? gameState.teams.away.name
        : gameState.teams.home.name

      const returnPos = play.return_at || play.intercepted_at
      const isTD = returnPos ? isTouchdown(gameState.teams, intTeam, returnPos) : false

      if (isTD) {
        _addPoints(state, intTeam, 6)
        state.possession = intTeam
        state.down       = 0
        state.distance   = 0
        if (returnPos) state.field_pos = { ...returnPos }
        return
      }

      if (play.return_result === 'safety') {
        _addPoints(state, play.possession, 2)
      }

      if (play.return_result === 'fumble') {
        state.possession = intTeam
        _advanceFumble(state, play, '')
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
        _addPoints(state, play.possession, 6)
        return
      }
      if (result === 'safety') {
        const defTeam = play.possession === gameState.teams.home.name
          ? gameState.teams.away.name
          : gameState.teams.home.name
        _addPoints(state, defTeam, 2)
      }
      if (result === 'fumble') {
        _advanceFumble(state, play, '')
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
    _addPoints(state, play.possession, 6)
    return
  }

  if (result === 'fumble') {
    _advanceFumble(state, play, '')
    return
  }

  if (at) state.field_pos = { ...at }
  _advanceDownDistance(state, net_yards ?? 0)

  if (result === 'safety') {
    const defensiveTeam = play.possession === gameState.teams.home.name
      ? gameState.teams.away.name
      : gameState.teams.home.name
    _addPoints(state, defensiveTeam, 2)
  }

}

export function applyFlags(state, play) {
  _applyFlag(state, play, 1)
  _applyFlag(state, play, 2)
}

function _applyFlag(state, play, num) {
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
        const net = calcNetYards(gameState.teams, state.possession, play.field_pos, newLos)
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
      gameState.teams,
      state.possession,
      play.field_pos,
      newLos
    )
    const newDist = play.distance - net
    state.distance = newDist > 0 ? newDist : 10
  }
}

function _addPoints(state, teamName, points) {
  if (teamName === gameState.teams.home.name) {
    state.score.home += points
  } else if (teamName === gameState.teams.away.name) {
    state.score.away += points
  }
}

function _advanceFumble(state, play, prefix) {
  const recoveryTeam   = play[`${prefix}fumble_recovery_team`]
  const recoveredAt    = play[`${prefix}fumble_recovered_at`]
  const fumbleResult   = play[`${prefix}fumble_result`]
  const fumbleAtResult = play[`${prefix}fumble_at_result`]

  const possessionChanged = recoveryTeam && recoveryTeam !== state.possession

  let isTD = false
  if (fumbleAtResult) {
    if (!possessionChanged) {
      isTD = isTouchdown(gameState.teams, state.possession, fumbleAtResult)
    } else {
      isTD = isTouchdown(gameState.teams, recoveryTeam, fumbleAtResult)
    }
  }

  if (possessionChanged) {
    state.possession = recoveryTeam
  }

  if (isTD) {
    state.down     = 0
    state.distance = 0
    if (fumbleAtResult) state.field_pos = { ...fumbleAtResult }
    if (possessionChanged) _addPoints(state, recoveryTeam, 6)
    return
  }

  if (fumbleResult === 'fumble') {
    _advanceFumble(state, play, 'fumble_2_')
    return
  }

  if (fumbleResult === 'safety') {
    const fumbleDefTeam = recoveryTeam === gameState.teams.home.name
      ? gameState.teams.away.name
      : gameState.teams.home.name
    _addPoints(state, fumbleDefTeam, 2)
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
        gameState.teams, state.possession,
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
