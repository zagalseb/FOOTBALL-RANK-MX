import { SUPABASE_URL, SUPABASE_HEADERS } from '../../shared/supabase/supabase_config.js'
// getAuthHeaders() carries the signed-in operator's session token (see
// auth_gate.js) — used ONLY for writes (plays/games), since those tables'
// INSERT/UPDATE RLS policies now require role=authenticated. Reads
// (loadPlays/loadRoster below) stay on the static anon SUPABASE_HEADERS —
// SELECT is still public.
import { getAuthHeaders } from '../../shared/supabase/auth_client.js'

// stats-lib.js holds the pure calculation/display logic shared with
// viewer/ (split out 2026-09-08 — see its own file header). engine.js only
// uses gameState/absYard/advanceGameState/applyFlags internally below; the
// rest (isTouchdown, calcNetYards, formatPlay, playerShortLabel) are
// re-exported at the bottom of this file purely so wizard.js's existing
// `import {...} from './engine.js'` keeps working unchanged — capture/
// components should feel free to import those two straight from
// stats-lib.js instead, going forward.
import {
  gameState, absYard, advanceGameState, applyFlags,
  isTouchdown, calcNetYards, formatPlay, playerShortLabel,
} from '../../shared/stats-lib.js'

// ── Play storage ──────────────────────────────────────────────────────────────

export const plays = []
export const currentPlay = {}

export function setPlayField(key, value) {
  if (value === undefined) {
    delete currentPlay[key]
  } else {
    currentPlay[key] = value
  }
}

export function resetCurrentPlay() {
  for (const key in currentPlay) delete currentPlay[key]
}

export function generatePlayId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2)
}

let _onPlaySubmitted = null
export function onPlaySubmitted(fn) { _onPlaySubmitted = fn }

export function submitPlay() {
  const playObj = {
    ...currentPlay,
    quarter:      gameState.quarter,
    clock:        gameState.clock,
    possession:   gameState.possession,
    field_pos:    { ...gameState.field_pos },
    down:         gameState.down,
    distance:     gameState.distance,
    teams:        gameState.teams,
    play_id:      generatePlayId(),
    submitted_at: Date.now(),
    score_home:   gameState.score.home,
    score_away:   gameState.score.away,
    yardline_100: calcYardline100(gameState.teams, gameState.possession, gameState.field_pos),
  }
  const absFields = _calcAllAbsYards(playObj, gameState.teams)
  addPlay({ ...playObj, ...absFields })
  resetCurrentPlay()
  if (_onPlaySubmitted) _onPlaySubmitted()
}

export function submitPlayWithSnap(snapState) {
  const playObj = {
    ...currentPlay,
    quarter:      snapState.quarter,
    clock:        snapState.clock,
    possession:   snapState.possession,
    field_pos:    snapState.field_pos,
    down:         snapState.down,
    distance:     snapState.distance,
    teams:        gameState.teams,
    play_id:      generatePlayId(),
    submitted_at: Date.now(),
    score_home:   snapState.score_home,
    score_away:   snapState.score_away,
    yardline_100: calcYardline100(gameState.teams, snapState.possession, snapState.field_pos),
  }
  const absFields = _calcAllAbsYards(playObj, gameState.teams)
  addPlay({ ...playObj, ...absFields })
  resetCurrentPlay()
  // _onPlaySubmitted is NOT fired here on purpose — gameState.down/distance
  // haven't been corrected yet at this point (that only happens inside the
  // renderAddPlay() → deriveNextPlayContext() call that follows). Firing here
  // made the HUD repaint one play too early, off the pre-derive state.
  // See notifyPlaysChanged(), called at the end of renderAddPlay() instead.
}

export function addPlay(playObj) {
  const play = { ...playObj, seq: gameState.seq++ }
  plays.push(play)
  savePlays()
  _syncPlayToSupabase(play)
}

// ── Persistence ───────────────────────────────────────────────────────────────

export function savePlays() {
  localStorage.setItem('covercero_plays', JSON.stringify(plays))
}

// ── Supabase sync ─────────────────────────────────────────────────────────────

let _supabase     = null
let _gameId       = null
let _onSyncStatus = null

export function setSupabaseClient(client) { _supabase = client }

export function setGameId(id) {
  _gameId = id
  if (id) localStorage.setItem('covercero_game_id', id)
  else     localStorage.removeItem('covercero_game_id')
}

export function getGameId() { return _gameId }

export function onSyncStatus(fn) { _onSyncStatus = fn }

// Keys that map directly to DB columns — everything else goes into play_data.
const _MAIN_KEYS = new Set([
  'play_id', 'seq', 'play_type', 'quarter', 'clock', 'possession',
  'field_pos', 'down', 'distance', 'score_home', 'score_away',
  'yardline_100', 'net_yards', 'result', 'submitted_at',
])

function _buildPlayRow(play) {
  const play_data = {}
  for (const [k, v] of Object.entries(play)) {
    if (!_MAIN_KEYS.has(k)) play_data[k] = v
  }

  return {
    id:           play.play_id,
    game_id:      _gameId,
    seq:          play.seq,
    play_type:    play.play_type,
    quarter:      play.quarter,
    clock:        play.clock,
    possession:   play.possession,
    field_pos:    play.field_pos    ?? null,
    down:         play.down         ?? null,
    distance:     play.distance     ?? null,
    score_home:   play.score_home   ?? null,
    score_away:   play.score_away   ?? null,
    yardline_100: play.yardline_100 ?? null,
    net_yards:    play.net_yards    ?? null,
    result:       play.result       ?? null,
    play_data,
    submitted_at: new Date(play.submitted_at).toISOString(),
  }
}

async function _syncPlayToSupabase(play) {
  if (!_gameId) return
  if (_onSyncStatus) _onSyncStatus('saving')

  const row = _buildPlayRow(play)

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/plays`, {
      method: 'POST',
      headers: {
        ...(await getAuthHeaders()),
        'Content-Type': 'application/json',
        'Prefer':       'return=minimal',
      },
      body: JSON.stringify(row),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    if (_onSyncStatus) _onSyncStatus('saved')
  } catch (err) {
    console.error('[Supabase sync]', err)
    if (_onSyncStatus) _onSyncStatus('error')
  }
}

// PATCH a una jugada ya existente en Supabase (edición desde el panel de
// edición). A diferencia de _syncPlayToSupabase (INSERT al crear la jugada),
// esto actualiza la fila por id — no dispara ningún recálculo de otras filas.
export async function syncPlayUpdate(play) {
  if (!_gameId) return
  if (_onSyncStatus) _onSyncStatus('saving')

  const row = _buildPlayRow(play)
  delete row.id
  delete row.game_id

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/plays?id=eq.${encodeURIComponent(play.play_id)}`,
      {
        method: 'PATCH',
        headers: {
          ...(await getAuthHeaders()),
          'Content-Type': 'application/json',
          'Prefer':       'return=minimal',
        },
        body: JSON.stringify(row),
      }
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    if (_onSyncStatus) _onSyncStatus('saved')
  } catch (err) {
    console.error('[Supabase update]', err)
    if (_onSyncStatus) _onSyncStatus('error')
  }
}

// PATCH games.status/score_home/score_away for the active game. Pass
// status=null to update only the score (e.g. a manual Set Score correction)
// without touching status. Reused by applyGameCtrl for both 'end_game'
// (status → 'final') and 'set_score' (score only).
async function syncGameStatus(status, scoreHome, scoreAway) {
  if (!_gameId) return
  if (_onSyncStatus) _onSyncStatus('saving')

  const body = { score_home: scoreHome, score_away: scoreAway }
  if (status != null) body.status = status

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/games?id=eq.${encodeURIComponent(_gameId)}`,
      {
        method: 'PATCH',
        headers: {
          ...(await getAuthHeaders()),
          'Content-Type': 'application/json',
          'Prefer':       'return=minimal',
        },
        body: JSON.stringify(body),
      }
    )
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ''}`)
    }
    if (_onSyncStatus) _onSyncStatus('saved')
  } catch (err) {
    console.error('[Supabase syncGameStatus]', err)
    if (_onSyncStatus) _onSyncStatus('error')
  }
}

// Lets external code (e.g. the edit wizard) reuse the same "plays changed"
// notification that normally fires after a new play is submitted.
export function notifyPlaysChanged() {
  if (_onPlaySubmitted) _onPlaySubmitted()
}

// Reverses _buildPlayRow(): turns a Supabase `plays` row (flat columns +
// play_data jsonb) back into the flat in-memory play object the rest of the
// app expects. submitted_at comes back from Supabase as an ISO string — it
// must be converted back to a numeric epoch here, since deriveNextPlayContext()
// compares it directly against gameEvents' numeric occurred_at timestamps.
function _rowToPlay(row) {
  return {
    play_id:      row.id,
    seq:          row.seq,
    play_type:    row.play_type,
    quarter:      row.quarter,
    clock:        row.clock,
    possession:   row.possession,
    field_pos:    row.field_pos,
    down:         row.down,
    distance:     row.distance,
    score_home:   row.score_home,
    score_away:   row.score_away,
    yardline_100: row.yardline_100,
    net_yards:    row.net_yards,
    result:       row.result,
    submitted_at: row.submitted_at ? new Date(row.submitted_at).getTime() : Date.now(),
    ...(row.play_data || {}),
  }
}

// gameState.seq is the next seq to hand out (addPlay does gameState.seq++).
// Must be re-derived after (re)loading plays from any source, or a page
// refresh mid-game would start renumbering from 1 again.
function _syncSeqFromPlays() {
  const maxSeq = plays.reduce((m, p) => Math.max(m, p.seq || 0), 0)
  gameState.seq = maxSeq + 1
}

// Loads plays for the current game. Supabase is the source of truth — a play
// deleted there must disappear locally on refresh, and every device/browser
// working the same game must converge on the same list. localStorage is only
// a fallback for when the fetch can't happen (offline, no game_id yet) so the
// operator isn't blocked; if Supabase succeeds, its data overwrites whatever
// was cached locally.
export async function loadPlays() {
  if (_gameId) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/plays?game_id=eq.${encodeURIComponent(_gameId)}&order=seq.asc`,
        { headers: SUPABASE_HEADERS }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const rows = await res.json()

      plays.length = 0
      plays.push(...rows.map(_rowToPlay))
      _syncSeqFromPlays()
      savePlays()
      if (_onSyncStatus) _onSyncStatus('saved')
      return
    } catch (err) {
      console.error('[Supabase loadPlays]', err)
      if (_onSyncStatus) _onSyncStatus('offline')
      // fall through to the localStorage fallback below
    }
  }

  const saved = localStorage.getItem('covercero_plays')
  plays.length = 0
  if (saved) plays.push(...JSON.parse(saved))
  _syncSeqFromPlays()
}

export function clearPlays() {
  plays.length = 0
  localStorage.removeItem('covercero_plays')
}

// ── Roster ────────────────────────────────────────────────────────────────────

let rosterHome = []
let rosterAway = []

// Fetches a team's real roster from covercero.players. Returns [] (rather than
// throwing) on failure so the wizard falls back to the generic 0-99 placeholder
// instead of breaking play capture when offline or Setup hasn't been used yet.
export async function loadRoster(teamId) {
  if (!teamId) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/players?team_id=eq.${encodeURIComponent(teamId)}&order=number.asc`,
      { headers: SUPABASE_HEADERS }
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    console.error('[Cover Cero] loadRoster failed:', err)
    return []
  }
}

// Stores the home/away rosters fetched via loadRoster() so getRoster() can
// serve the real list. Called once at init (see covercero_live.html).
export function setRosters(home, away) {
  rosterHome = home || []
  rosterAway = away || []
}

// Returns the roster for `teamName`, or for whichever team currently has
// possession when `teamName` is omitted (default — preserves prior behavior
// for BY steps where the player is always on the possession team, e.g.
// rush_by/pass_by/sack_by). Falls back to a generic 0-99 placeholder (no
// names) if that team's real roster hasn't been loaded — keeps the BY menu
// usable even without Setup data.
export function getRoster(teamName) {
  const team = teamName ?? gameState.possession
  const side = team === gameState.teams.home.name ? rosterHome : rosterAway
  if (side.length > 0) return side
  return Array.from({ length: 100 }, (_, i) => ({
    number: i,
    nombre: '',
    apellido: '',
    position: '',
  }))
}

// ── Field position helpers ────────────────────────────────────────────────────


// Parses AT shorthand input into { team, yard } or null if invalid.
// Accepts: "M40" "m40" "U30" "u30" "40" "0" "50"
// Pure numbers default to the home team side.
// Returns null if the input is out of range or empty.
export function parseATInput(raw, teams) {
  if (!raw) return null
  const s = raw.trim().toUpperCase()

  let teamName = null
  let yardStr  = null

  const hp = teams.home.abreviatura.toUpperCase()
  const ap = teams.away.abreviatura.toUpperCase()

  if (s.startsWith(hp)) {
    teamName = teams.home.name
    yardStr  = s.slice(hp.length)
  } else if (s.startsWith(ap)) {
    teamName = teams.away.name
    yardStr  = s.slice(ap.length)
  } else {
    teamName = teams.home.name
    yardStr  = s
  }

  if (!/^\d{1,2}$/.test(yardStr)) return null
  const yard = parseInt(yardStr, 10)
  if (yard < 0 || yard > 50) return null   // each side only goes 0-50

  return { team: teamName, yard }
}

export function calcYardline100(teams, possession, field_pos) {
  if (!field_pos) return null
  const abs = absYard(teams, field_pos.team, field_pos.yard)
  return possession === teams.home.name ? (100 - abs) : abs
}

function _calcAllAbsYards(playObj, teams) {
  const result = {}
  for (const [key, val] of Object.entries(playObj)) {
    const isPosField =
      key === 'field_pos' ||
      key.endsWith('_at') ||
      key.endsWith('_los') ||
      key.endsWith('_pos')
    if (!isPosField) continue
    if (!val || typeof val !== 'object') continue
    if (val.team == null || val.yard == null) continue
    result[`${key}_abs`] = absYard(teams, val.team, val.yard)
  }
  return result
}


// ── Result option sets ────────────────────────────────────────────────────────

// Reutilizable para: RUN, PASS complete, returns post-INT, kick returns.
// fieldPrefix distinguishes which context each invocation writes to in the flat play object.
export const RESULT_OPTIONS = {
  STANDARD: [
    { key: 'tackle',  label: 'Tackle',        kbd: 'T', color: '--yellow' },
    { key: 'oob',     label: 'Out of Bounds', kbd: 'O', color: '--accent' },
    { key: 'eop',     label: 'End of Play',   kbd: 'E', color: '--text2'  },
    { key: 'fumble',  label: 'Fumble',        kbd: 'F', color: '--orange' },
    { key: 'safety',  label: 'Safety',        kbd: 'S', color: '--red'    },
  ],
}
// Backward-compat alias — wizard.js imports RESULT_OPTIONS.RUSH until updated
RESULT_OPTIONS.RUSH = RESULT_OPTIONS.STANDARD

// Receiving team's choice when a kickoff goes out of bounds (NCAA foul on
// the kicking team) — operator picks manually, never auto-selected.
RESULT_OPTIONS.KICKOFF_OOB_SPOT = [
  { key: 'actual_spot', label: 'Spot Real (donde salió)', kbd: 'S', color: '--accent' },
  { key: 'twenty_five', label: '25 Yardas desde el Kick', kbd: 'Y', color: '--green'  },
]

// When a flag attached to another play (never a standalone PENALTY play) is
// accepted: 'live' = foul happened during the play and negates its result
// (offensive holding on a run — the play never counted); 'dead' = foul
// happened after the play already ended (personal foul after the tackle) —
// the play's own yards/attempt still count, only the down/distance/field
// position for the NEXT down absorbs the penalty on top of it.
RESULT_OPTIONS.FLAG_TIMING = [
  { key: 'live', label: 'Durante la Jugada (anula)',   kbd: 'L', color: '--red'   },
  { key: 'dead', label: 'Después de la Jugada (suma)', kbd: 'D', color: '--green' },
]

// Chosen after a PUNT play is flagged 'fake' — the wizard.js branch that
// consumes this retargets play_type to RUSH/PASS and sets fake_punt:true,
// so from this point on the play is captured with the real RUSH/PASS
// step trees (rush_by/result or pass_by/pass_result), not PUNT fields.
RESULT_OPTIONS.FAKE_PUNT_TYPE = [
  { key: 'run',  label: 'Run',  kbd: 'R', color: '--yellow' },
  { key: 'pass', label: 'Pass', kbd: 'P', color: '--green'  },
]

// Chosen after a punt's own snapper/punter recovers a bad snap ('own' branch
// of PUNT_RESULT_BRANCHES.bad_snap). Unlike FG/PAT_KICK's equivalent (which
// only offer run/pass — there's no realistic way to reset a botched hold),
// a punter recovering a bad snap can still realistically get the kick away,
// so this adds a third 'kick' option that does NOT retarget play_type (it's
// already 'PUNT') — it just re-enters the normal punt_result step.
RESULT_OPTIONS.BAD_SNAP_PUNT_TYPE = [
  { key: 'run',  label: 'Run',  kbd: 'R', color: '--yellow' },
  { key: 'pass', label: 'Pass', kbd: 'P', color: '--green'  },
  { key: 'kick', label: 'Kick', kbd: 'K', color: '--accent' },
]

export const PASS_RESULT_OPTIONS = [
  { key: 'complete',    label: 'Complete',    kbd: 'C', color: '--green'  },
  { key: 'incomplete',  label: 'Incomplete',  kbd: 'I', color: '--text2'  },
  { key: 'dropped',     label: 'Dropped',     kbd: 'D', color: '--text2'  },
  { key: 'broken_up',   label: 'Broken Up',   kbd: 'B', color: '--accent' },
  { key: 'sack',        label: 'Sack',        kbd: 'S', color: '--red'    },
  { key: 'scramble',    label: 'Scramble',    kbd: 'R', color: '--yellow' },
  { key: 'intercepted', label: 'Intercepted', kbd: 'N', color: '--orange' },
]

export const KICK_TYPE_OPTIONS = [
  { key: 'kickoff',    label: 'Kickoff',    kbd: 'K', color: '--accent' },
  { key: 'field_goal', label: 'Field Goal', kbd: 'F', color: '--green'  },
]

export const KICKOFF_RESULT_OPTIONS = [
  { key: 'returned',   label: 'Returned',      kbd: 'R', color: '--green'  },
  { key: 'oob',        label: 'Out of Bounds', kbd: 'O', color: '--accent' },
  { key: 'fair_catch', label: 'Fair Catch',    kbd: 'F', color: '--yellow' },
  { key: 'touchback',  label: 'Touchback',     kbd: 'T', color: '--text2'  },
  { key: 'onside',     label: 'Onside',        kbd: 'N', color: '--orange' },
]

export const FG_RESULT_OPTIONS = [
  { key: 'good',     label: 'Good',     kbd: 'G', color: '--green'  },
  { key: 'missed',   label: 'Missed',   kbd: 'M', color: '--red'    },
  { key: 'blocked',  label: 'Blocked',  kbd: 'B', color: '--orange' },
  { key: 'bad_snap', label: 'Bad Snap', kbd: 'S', color: '--red'    },
]

export const FG_MISS_OPTIONS = [
  { key: 'wide_left',  label: 'Wide Left',  kbd: 'L', color: '--text2' },
  { key: 'wide_right', label: 'Wide Right', kbd: 'R', color: '--text2' },
  { key: 'short',      label: 'Short',      kbd: 'S', color: '--text2' },
  { key: 'crossbar',   label: 'Crossbar',   kbd: 'C', color: '--text2' },
]

export const PAT_TYPE_OPTIONS = [
  { key: 'run',  label: 'Run',  kbd: 'R', color: '--green'  },
  { key: 'pass', label: 'Pass', kbd: 'P', color: '--accent' },
  { key: 'kick', label: 'Kick', kbd: 'K', color: '--purple' },
]

export const PAT_RUN_RESULT_OPTIONS = [
  { key: 'good',   label: 'Good (2pt)', kbd: 'G', color: '--green'  },
  { key: 'missed', label: 'Missed',     kbd: 'M', color: '--red'    },
  { key: 'fumble', label: 'Fumble',     kbd: 'F', color: '--orange' },
]

export const PAT_PASS_RESULT_OPTIONS = [
  { key: 'good',        label: 'Good (2pt)',  kbd: 'G', color: '--green'  },
  { key: 'missed',      label: 'Missed',      kbd: 'M', color: '--red'    },
  { key: 'blocked',     label: 'Blocked',     kbd: 'B', color: '--orange' },
  { key: 'fumble',      label: 'Fumble',      kbd: 'F', color: '--orange' },
  { key: 'intercepted', label: 'Intercepted', kbd: 'N', color: '--red'    },
]

export const PAT_KICK_RESULT_OPTIONS = [
  { key: 'good',     label: 'Good (1pt)', kbd: 'G', color: '--green'  },
  { key: 'missed',   label: 'Missed',     kbd: 'M', color: '--red'    },
  { key: 'blocked',  label: 'Blocked',    kbd: 'B', color: '--orange' },
  { key: 'bad_snap', label: 'Bad Snap',   kbd: 'S', color: '--red'    },
]

export const PAT_BLOCK_RESULT_OPTIONS = [
  { key: 'good',   label: 'Good (2pt def)', kbd: 'G', color: '--green' },
  { key: 'downed', label: 'Downed',         kbd: 'D', color: '--text2' },
]

export const PENALTY_RESULT_OPTIONS = [
  { key: 'accepted',   label: 'Accepted',   kbd: 'A', color: '--green'  },
  { key: 'declined',   label: 'Declined',   kbd: 'D', color: '--text2'  },
  { key: 'offsetting', label: 'Offsetting', kbd: 'O', color: '--yellow' },
]

export const PENALTY_DOWN_RESULT_OPTIONS = [
  { key: 'repeat_down',  label: 'Repeat Down', kbd: 'R', color: '--yellow' },
  { key: 'loss_of_down', label: 'Loss of Down', kbd: 'L', color: '--red'   },
  { key: 'first_down',   label: 'First Down',   kbd: 'F', color: '--green' },
]


export const PENALTIES_LIST = [
  { code: 'AB', label: 'Abuse of officials' },
  { code: 'CL', label: 'Clipping' },
  { code: 'DG', label: 'Delay of game' },
  { code: 'EN', label: 'Encroachment' },
  { code: 'FN', label: 'Face mask' },
  { code: 'FS', label: 'False start' },
  { code: 'HR', label: 'Helping runner' },
  { code: 'HO', label: 'Holding' },
  { code: 'BB', label: 'Illegal batting' },
  { code: 'FC', label: 'Illegal fair catch signal' },
  { code: 'FO', label: 'Illegal formation' },
  { code: 'FP', label: 'Illegal forward pass' },
  { code: 'HC', label: 'Illegal helmet contact' },
  { code: 'MO', label: 'Illegal motion' },
  { code: 'PA', label: 'Illegal participation' },
  { code: 'PR', label: 'Illegal procedure' },
  { code: 'SH', label: 'Illegal shift' },
  { code: 'TO', label: 'Illegal touching' },
  { code: 'KK', label: 'Illegal kicking' },
  { code: 'UH', label: 'Illegal use of the hands' },
  { code: 'ID', label: 'Ineligible man down field' },
  { code: 'IG', label: 'Intentional grounding' },
  { code: 'KI', label: 'Kick catching interference' },
  { code: 'NF', label: 'Non-contact' },
  { code: 'OD', label: 'Offsides defense' },
  { code: 'OS', label: 'Offsides' },
  { code: 'PI', label: 'Pass interference' },
  { code: 'PF', label: 'Personal foul' },
  { code: 'PD', label: 'Player disqualification' },
  { code: 'RH', label: 'Roughing the holder' },
  { code: 'RK', label: 'Roughing the kicker' },
  { code: 'RP', label: 'Roughing the passer' },
  { code: 'SI', label: 'Sideline interference' },
  { code: 'SU', label: 'Substitution infraction' },
  { code: 'TR', label: 'Tripping' },
  { code: 'UC', label: 'Unsportsmanlike conduct' },
  { code: 'EG', label: 'Wrong equipment (knee pads)' },
  { code: 'UN', label: 'Unidentified' },
]

export const FG_RETURN_RESULT_OPTIONS = [
  { key: 'downed',   label: 'Downed',   kbd: 'D', color: '--text2' },
  { key: 'returned', label: 'Returned', kbd: 'R', color: '--green' },
]

export const PUNT_RESULT_OPTIONS = [
  { key: 'returned',   label: 'Returned',     kbd: 'R', color: '--green'  },
  { key: 'fair_catch', label: 'Fair Catch',   kbd: 'F', color: '--yellow' },
  { key: 'touchback',  label: 'Touchback',    kbd: 'T', color: '--text2'  },
  { key: 'oob',        label: 'Out of Bounds', kbd: 'O', color: '--accent' },
  { key: 'downed',     label: 'Downed',       kbd: 'D', color: '--text2'  },
  { key: 'blocked',    label: 'Blocked',      kbd: 'B', color: '--orange' },
  { key: 'fake',       label: 'Fake Punt',    kbd: 'X', color: '--purple' },
  // Distinct from 'returned' + fumble: the returner never had controlled
  // possession here, so this must never share fumble_* field names (see
  // punt_muff_* fields below) — that's what keeps computeFumbleStats() in
  // viewer.html from crediting the returner with a fumble he never had.
  { key: 'muffed',     label: 'Muffed',       kbd: 'M', color: '--red'    },
  // A bad LONG SNAP to the punter — distinct from 'muffed' (which is the
  // returner failing to catch a clean punt downfield) and from 'blocked'
  // (a defensive play at the line). This is a pre-kick execution error, same
  // spirit as SNAP_FUMBLE for scrimmage plays but nested here since play_type
  // is already correctly 'PUNT' — no reason to retarget it away.
  { key: 'bad_snap',   label: 'Bad Snap',     kbd: 'S', color: '--red'    },
]

// ── Result branch definitions ─────────────────────────────────────────────────
// Maps play_type → result_key → extra steps appended after the RESULT step.
// Each step follows the same shape as STEPS_BY_TYPE entries.
//
// fieldPrefix in RESULT config determines which keys each invocation writes
// in the flat play object:
//   ''          → main result  (RUSH, PASS complete)
//   'fumble_'   → fumble recovery level 1
//   'fumble_2_' → fumble recovery level 2 (allowFumble: false)
//   'return_'   → returned_by context (INT return, kick return)

export const RESULT_BRANCHES = {
  RUSH: {
    tackle: [
      { id: 'tackle_by', label: 'Tackle By', component: 'BY',
        config: { stateKey: 'tackle_by', multiple: true, optional: true, team: 'opponent' } },
      { id: 'at', label: 'AT', component: 'AT',
        config: { stateKey: 'at' } },
    ],
    oob: [
      { id: 'at', label: 'AT', component: 'AT',
        config: { stateKey: 'at' } },
    ],
    eop: [
      { id: 'at', label: 'AT', component: 'AT',
        config: { stateKey: 'at' } },
    ],
    safety: [
      { id: 'safety_time', label: 'Time', component: 'TIME',
        config: { stateKey: 'safety_time' } },
    ],
    fumble: [
      { id: 'fumble_at', label: 'Fumble AT', component: 'AT',
        config: { stateKey: 'fumble_at' } },
      { id: 'fumble_forced_by', label: 'Forced By', component: 'BY',
        // Level-1 forced fumble — the ball hasn't been recovered yet, so the
        // forcer is unambiguously the defense (opponent of whoever had
        // possession when the fumble happened). Unlike fumble_2_forced_by
        // (after a recovery has already happened, so either side could be
        // the one forcing the next fumble), this one is never ambiguous.
        config: { stateKey: 'fumble_forced_by', multiple: false, optional: true, team: 'opponent' } },
      { id: 'fumble_recovery_team', label: 'Recovery Team', component: 'TEAM',
        config: { stateKey: 'fumble_recovery_team' } },
      { id: 'fumble_recovered_by', label: 'Recovered By', component: 'BY',
        config: { stateKey: 'fumble_recovered_by', multiple: false, optional: true, teamFrom: 'fumble_recovery_team' } },
      { id: 'fumble_recovered_at', label: 'Recovered AT', component: 'AT',
        config: { stateKey: 'fumble_recovered_at' } },
      { id: 'fumble_result', label: 'Fumble Result', component: 'RESULT',
        config: { stateKey: 'fumble_result', optionsKey: 'STANDARD' } },
    ],
  },

  // Fumble level-2 branches — keyed by the fumble_ result value.
  // Used when fumble_result === 'fumble' inside a RUSH fumble branch.
  RUSH_FUMBLE: {
    fumble: [
      { id: 'fumble_2_at', label: 'Fumble AT', component: 'AT',
        config: { stateKey: 'fumble_2_at' } },
      { id: 'fumble_2_forced_by', label: 'Forced By', component: 'BY',
        config: { stateKey: 'fumble_2_forced_by', multiple: false, optional: true } },
      { id: 'fumble_2_recovery_team', label: 'Recovery Team', component: 'TEAM',
        config: { stateKey: 'fumble_2_recovery_team' } },
      { id: 'fumble_2_recovered_by', label: 'Recovered By', component: 'BY',
        config: { stateKey: 'fumble_2_recovered_by', multiple: false, optional: true } },
      { id: 'fumble_2_recovered_at', label: 'Recovered AT', component: 'AT',
        config: { stateKey: 'fumble_2_recovered_at' } },
      { id: 'fumble_2_result', label: 'Result', component: 'RESULT',
        config: { fieldPrefix: 'fumble_2_', allowFumble: false } },
    ],
  },

  // KICK, PAT_TRY, PENALTY branches added in a later step.
}

// PASS complete and scramble reuse RUSH result branches (same field names).
RESULT_BRANCHES.PASS = RESULT_BRANCHES.RUSH

// PAT_TYPE_BRANCHES.run's 'result' step (rush_by + result/optionsKey:STANDARD)
// is the same shape as STEPS_BY_TYPE.RUSH's tail, so it resolves through this
// same lookup — without this alias, resolveBranchSteps('result', value,
// 'PAT_TRY') found no entry and silently returned [], meaning a PAT run or
// PAT pass-complete that ended in tackle/oob/eop/fumble/safety never got the
// follow-up steps (fumble_forced_by, fumble_recovery_team, etc.) at all.
RESULT_BRANCHES.PAT_TRY = RESULT_BRANCHES.RUSH

export const FUMBLE_RESULT_BRANCHES = {
  tackle: [
    { id: 'fumble_tackle_by', label: 'Tackle By', component: 'BY',
      config: { stateKey: 'fumble_tackle_by', multiple: true, optional: true, teamFrom: 'fumble_recovery_team', invertTeamFrom: true } },
    { id: 'fumble_at_result', label: 'AT', component: 'AT',
      config: { stateKey: 'fumble_at_result' } },
  ],
  oob: [
    { id: 'fumble_at_result', label: 'AT', component: 'AT',
      config: { stateKey: 'fumble_at_result' } },
  ],
  eop: [
    { id: 'fumble_at_result', label: 'AT', component: 'AT',
      config: { stateKey: 'fumble_at_result' } },
  ],
  safety: [
    { id: 'fumble_safety_time', label: 'Set Time', component: 'TIME',
      config: { stateKey: 'fumble_safety_time' } },
  ],
  fumble: [
    { id: 'fumble_2_at', label: 'Fumble AT', component: 'AT',
      config: { stateKey: 'fumble_2_at' } },
    { id: 'fumble_2_forced_by', label: 'Forced By', component: 'BY',
      config: { stateKey: 'fumble_2_forced_by', multiple: false, optional: true } },
    { id: 'fumble_2_recovery_team', label: 'Recovery Team', component: 'TEAM',
      config: { stateKey: 'fumble_2_recovery_team' } },
    { id: 'fumble_2_recovered_by', label: 'Recovered By', component: 'BY',
      config: { stateKey: 'fumble_2_recovered_by', multiple: false, optional: true } },
    { id: 'fumble_2_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'fumble_2_recovered_at' } },
    { id: 'fumble_2_result', label: 'Fumble Result', component: 'RESULT',
      config: { stateKey: 'fumble_2_result', optionsKey: 'STANDARD' } },
  ],
}

export const FUMBLE_2_RESULT_BRANCHES = {
  tackle: [
    { id: 'fumble_2_tackle_by', label: 'Tackle By', component: 'BY',
      config: { stateKey: 'fumble_2_tackle_by', multiple: true, optional: true, teamFrom: 'fumble_2_recovery_team', invertTeamFrom: true } },
    { id: 'fumble_2_at_result', label: 'AT', component: 'AT',
      config: { stateKey: 'fumble_2_at_result' } },
  ],
  oob: [
    { id: 'fumble_2_at_result', label: 'AT', component: 'AT',
      config: { stateKey: 'fumble_2_at_result' } },
  ],
  eop: [
    { id: 'fumble_2_at_result', label: 'AT', component: 'AT',
      config: { stateKey: 'fumble_2_at_result' } },
  ],
  safety: [
    { id: 'fumble_2_safety_time', label: 'Set Time', component: 'TIME',
      config: { stateKey: 'fumble_2_safety_time' } },
  ],
  // no level-3 fumble
}

export const PASS_RESULT_BRANCHES = {
  complete: [
    { id: 'received_by', label: 'Received By', component: 'BY',
      config: { stateKey: 'received_by', multiple: false, optional: false } },
    { id: 'result', label: 'Result', component: 'RESULT',
      config: { stateKey: 'result', optionsKey: 'STANDARD' } },
  ],
  incomplete: [
    { id: 'intended_for',  label: 'Intended For',  component: 'BY',
      config: { stateKey: 'intended_for',  multiple: false, optional: true } },
    { id: 'broken_up_by',  label: 'Broken Up By',  component: 'BY',
      config: { stateKey: 'broken_up_by',  multiple: false, optional: true, team: 'opponent' } },
    { id: 'qb_hurried_by', label: 'QB Hurried By', component: 'BY',
      config: { stateKey: 'qb_hurried_by', multiple: false, optional: true, team: 'opponent' } },
  ],
  dropped: [
    { id: 'intended_for',  label: 'Intended For',  component: 'BY',
      config: { stateKey: 'intended_for',  multiple: false, optional: true } },
    { id: 'broken_up_by',  label: 'Broken Up By',  component: 'BY',
      config: { stateKey: 'broken_up_by',  multiple: false, optional: true, team: 'opponent' } },
    { id: 'qb_hurried_by', label: 'QB Hurried By', component: 'BY',
      config: { stateKey: 'qb_hurried_by', multiple: false, optional: true, team: 'opponent' } },
  ],
  broken_up: [
    { id: 'intended_for',  label: 'Intended For',  component: 'BY',
      config: { stateKey: 'intended_for',  multiple: false, optional: true } },
    { id: 'broken_up_by',  label: 'Broken Up By',  component: 'BY',
      config: { stateKey: 'broken_up_by',  multiple: false, optional: true, team: 'opponent' } },
    { id: 'qb_hurried_by', label: 'QB Hurried By', component: 'BY',
      config: { stateKey: 'qb_hurried_by', multiple: false, optional: true, team: 'opponent' } },
  ],
  sack: [
    { id: 'sack_by', label: 'Sack By', component: 'BY',
      config: { stateKey: 'sack_by', multiple: false, optional: false, team: 'opponent' } },
    // 'result' here resolves via RESULT_BRANCHES[playType] same as a normal
    // RUSH — playType really is 'PASS' the whole time a sack is being
    // captured (unlike a PAT_TRY/fake-punt reuse attempt, where playType
    // never becomes 'RUSH'/'PASS'), so RESULT_BRANCHES.PASS (aliased to
    // RESULT_BRANCHES.RUSH) resolves correctly, tackle/fumble included.
    // Tackle (no fumble) still ends in a flat 'at' field, same shape as
    // before this change — fully compatible with already-captured sacks.
    { id: 'result', label: 'Result', component: 'RESULT',
      config: { stateKey: 'result', optionsKey: 'STANDARD' } },
  ],
  scramble: [
    { id: 'result', label: 'Result', component: 'RESULT',
      config: { stateKey: 'result', optionsKey: 'STANDARD' } },
  ],
  intercepted: [
    { id: 'intercepted_by', label: 'Intercepted By', component: 'BY',
      config: { stateKey: 'intercepted_by', multiple: false, optional: false, team: 'opponent' } },
    { id: 'intercepted_at', label: 'Intercepted AT', component: 'AT',
      config: { stateKey: 'intercepted_at' } },
    { id: 'returned_by', label: 'Returned By', component: 'BY',
      config: { stateKey: 'returned_by', multiple: false, optional: true, team: 'opponent' } },
    { id: 'return_result', label: 'Return Result', component: 'RESULT',
      config: { stateKey: 'return_result', optionsKey: 'STANDARD' } },
  ],
}

export const RETURN_RESULT_BRANCHES = {
  tackle: [
    { id: 'return_tackle_by', label: 'Tackle By', component: 'BY',
      config: { stateKey: 'return_tackle_by', multiple: true, optional: true } },
    { id: 'return_at', label: 'AT', component: 'AT',
      config: { stateKey: 'return_at' } },
  ],
  oob: [
    { id: 'return_at', label: 'AT', component: 'AT',
      config: { stateKey: 'return_at' } },
  ],
  eop: [
    { id: 'return_at', label: 'AT', component: 'AT',
      config: { stateKey: 'return_at' } },
  ],
  safety: [
    { id: 'return_safety_time', label: 'Set Time', component: 'TIME',
      config: { stateKey: 'return_safety_time' } },
  ],
  fumble: [
    { id: 'fumble_at', label: 'Fumble AT', component: 'AT',
      config: { stateKey: 'fumble_at' } },
    { id: 'fumble_forced_by', label: 'Forced By', component: 'BY',
      config: { stateKey: 'fumble_forced_by', multiple: false, optional: true } },
    { id: 'fumble_recovery_team', label: 'Recovery Team', component: 'TEAM',
      config: { stateKey: 'fumble_recovery_team' } },
    { id: 'fumble_recovered_by', label: 'Recovered By', component: 'BY',
      config: { stateKey: 'fumble_recovered_by', multiple: false, optional: true, teamFrom: 'fumble_recovery_team' } },
    { id: 'fumble_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'fumble_recovered_at' } },
    { id: 'fumble_result', label: 'Fumble Result', component: 'RESULT',
      config: { stateKey: 'fumble_result', optionsKey: 'STANDARD' } },
  ],
}

export const PENALTY_RESULT_BRANCHES = {
  accepted: [
    { id: 'penalty_by', label: 'Penalty By', component: 'BY',
      config: { stateKey: 'penalty_by', multiple: false, optional: true } },
    { id: 'penalty_new_los', label: 'New LOS', component: 'AT',
      config: { stateKey: 'penalty_new_los' } },
    { id: 'penalty_down_result', label: 'Down Result', component: 'PENALTY_DOWN',
      config: { stateKey: 'penalty_down_result' } },
  ],
  declined: [],
  offsetting: [
    { id: 'penalty_stats_count', label: 'Stats Count?', component: 'YES_NO',
      config: { stateKey: 'penalty_stats_count' } },
  ],
}

export const KICK_TYPE_BRANCHES = {
  kickoff: [
    { id: 'kicked_by', label: 'Kicked By', component: 'BY',
      config: { stateKey: 'kicked_by', multiple: false, optional: false } },
    { id: 'kickoff_result', label: 'Kickoff Result', component: 'KICKOFF_RESULT',
      config: { stateKey: 'kickoff_result' } },
  ],
  field_goal: [
    { id: 'kicked_by', label: 'Kicked By', component: 'BY',
      config: { stateKey: 'kicked_by', multiple: false, optional: false } },
    { id: 'kick_distance', label: 'Distance', component: 'NUMBER',
      config: { stateKey: 'kick_distance', placeholder: 'Yardas', min: 1, max: 99 } },
    { id: 'fg_result', label: 'FG Result', component: 'FG_RESULT',
      config: { stateKey: 'fg_result' } },
  ],
}

export const KICKOFF_RESULT_BRANCHES = {
  returned: [
    { id: 'kicked_to', label: 'Kicked To', component: 'AT',
      config: { stateKey: 'kicked_to' } },
    { id: 'kick_returned_by', label: 'Returned By', component: 'BY',
      config: { stateKey: 'kick_returned_by', multiple: false, optional: false, team: 'opponent' } },
    { id: 'kick_return_result', label: 'Return Result', component: 'RESULT',
      config: { stateKey: 'kick_return_result', optionsKey: 'STANDARD' } },
  ],
  oob: [
    { id: 'kickoff_oob_at', label: 'Out AT (donde salió)', component: 'AT',
      config: { stateKey: 'kickoff_oob_at' } },
    { id: 'kickoff_oob_spot_choice', label: 'Spot del Receptor', component: 'RESULT',
      config: { stateKey: 'kickoff_oob_spot_choice', optionsKey: 'KICKOFF_OOB_SPOT' } },
  ],
  fair_catch: [
    { id: 'kicked_to', label: 'Kicked To', component: 'AT',
      config: { stateKey: 'kicked_to' } },
    { id: 'fair_catch_by', label: 'Fair Catch By', component: 'BY',
      config: { stateKey: 'fair_catch_by', multiple: false, optional: false, team: 'opponent' } },
    { id: 'fair_catch_at', label: 'AT', component: 'AT',
      config: { stateKey: 'fair_catch_at' } },
  ],
  touchback: [],
  onside: [
    { id: 'onside_recovery_team', label: 'Recovery Team', component: 'TEAM',
      config: { stateKey: 'onside_recovery_team' } },
    { id: 'onside_recovery_by', label: 'Recovered By', component: 'BY',
      config: { stateKey: 'onside_recovery_by', multiple: false, optional: true, teamFrom: 'onside_recovery_team' } },
    { id: 'onside_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'onside_recovered_at' } },
  ],
}

export const FG_RESULT_BRANCHES = {
  good: [],
  missed: [
    { id: 'fg_miss_type', label: 'Miss Type', component: 'FG_MISS',
      config: { stateKey: 'fg_miss_type' } },
  ],
  blocked: [
    { id: 'fg_blocked_by', label: 'Blocked By', component: 'BY',
      config: { stateKey: 'fg_blocked_by', multiple: false, optional: true, team: 'opponent' } },
    { id: 'fg_recovery_team', label: 'Recovery Team', component: 'TEAM',
      config: { stateKey: 'fg_recovery_team' } },
    { id: 'fg_recovery_by', label: 'Recovered By', component: 'BY',
      config: { stateKey: 'fg_recovery_by', multiple: false, optional: true, teamFrom: 'fg_recovery_team' } },
    { id: 'fg_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'fg_recovered_at' } },
    { id: 'fg_return_result', label: 'Return Result', component: 'FG_RETURN',
      config: { stateKey: 'fg_return_result' } },
  ],
  // Bad snap to the holder — no realistic way to reset the hold, so unlike
  // PUNT's equivalent there's no "kick anyway" option here: the kicker/holder
  // recovering just falls on it (an ordinary 0-yard RUSH, no special option
  // needed) or scrambles into a real run/pass via FAKE_PUNT_TYPE_BRANCHES.
  bad_snap: [
    { id: 'fg_bad_snap_at', label: 'Bad Snap AT', component: 'AT',
      config: { stateKey: 'fg_bad_snap_at' } },
    { id: 'fg_bad_snap_recovery_team', label: 'Recovery Team', component: 'TEAM',
      config: { stateKey: 'fg_bad_snap_recovery_team' } },
  ],
}

export const FG_BLOCKED_RETURN_BRANCHES = {
  downed: [],
  returned: [
    { id: 'fg_returned_by', label: 'Returned By', component: 'BY',
      config: { stateKey: 'fg_returned_by', multiple: false, optional: false, teamFrom: 'fg_recovery_team' } },
    { id: 'fg_ret_result', label: 'Return Result', component: 'RESULT',
      config: { stateKey: 'fg_ret_result', optionsKey: 'STANDARD' } },
  ],
}

export const KICK_RETURN_RESULT_BRANCHES = {
  tackle: [
    { id: 'kick_return_tackle_by', label: 'Tackle By', component: 'BY',
      config: { stateKey: 'kick_return_tackle_by', multiple: true, optional: true } },
    { id: 'kick_return_at', label: 'AT', component: 'AT',
      config: { stateKey: 'kick_return_at' } },
  ],
  oob: [
    { id: 'kick_return_at', label: 'AT', component: 'AT',
      config: { stateKey: 'kick_return_at' } },
  ],
  eop: [
    { id: 'kick_return_at', label: 'AT', component: 'AT',
      config: { stateKey: 'kick_return_at' } },
  ],
  safety: [
    { id: 'kick_return_safety_time', label: 'Set Time', component: 'TIME',
      config: { stateKey: 'kick_return_safety_time' } },
  ],
  fumble: [
    { id: 'fumble_at', label: 'Fumble AT', component: 'AT',
      config: { stateKey: 'fumble_at' } },
    { id: 'fumble_forced_by', label: 'Forced By', component: 'BY',
      config: { stateKey: 'fumble_forced_by', multiple: false, optional: true } },
    { id: 'fumble_recovery_team', label: 'Recovery Team', component: 'TEAM',
      config: { stateKey: 'fumble_recovery_team' } },
    { id: 'fumble_recovered_by', label: 'Recovered By', component: 'BY',
      config: { stateKey: 'fumble_recovered_by', multiple: false, optional: true, teamFrom: 'fumble_recovery_team' } },
    { id: 'fumble_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'fumble_recovered_at' } },
    { id: 'fumble_result', label: 'Fumble Result', component: 'RESULT',
      config: { stateKey: 'fumble_result', optionsKey: 'STANDARD' } },
  ],
}

export const FG_RET_RESULT_BRANCHES = {
  tackle: [
    { id: 'fg_ret_tackle_by', label: 'Tackle By', component: 'BY',
      config: { stateKey: 'fg_ret_tackle_by', multiple: true, optional: true, teamFrom: 'fg_recovery_team', invertTeamFrom: true } },
    { id: 'fg_ret_at', label: 'AT', component: 'AT',
      config: { stateKey: 'fg_ret_at' } },
  ],
  oob: [
    { id: 'fg_ret_at', label: 'AT', component: 'AT',
      config: { stateKey: 'fg_ret_at' } },
  ],
  eop: [
    { id: 'fg_ret_at', label: 'AT', component: 'AT',
      config: { stateKey: 'fg_ret_at' } },
  ],
  safety: [
    { id: 'fg_ret_safety_time', label: 'Set Time', component: 'TIME',
      config: { stateKey: 'fg_ret_safety_time' } },
  ],
  fumble: [
    { id: 'fumble_at', label: 'Fumble AT', component: 'AT',
      config: { stateKey: 'fumble_at' } },
    { id: 'fumble_forced_by', label: 'Forced By', component: 'BY',
      config: { stateKey: 'fumble_forced_by', multiple: false, optional: true } },
    { id: 'fumble_recovery_team', label: 'Recovery Team', component: 'TEAM',
      config: { stateKey: 'fumble_recovery_team' } },
    { id: 'fumble_recovered_by', label: 'Recovered By', component: 'BY',
      config: { stateKey: 'fumble_recovered_by', multiple: false, optional: true, teamFrom: 'fumble_recovery_team' } },
    { id: 'fumble_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'fumble_recovered_at' } },
    { id: 'fumble_result', label: 'Fumble Result', component: 'RESULT',
      config: { stateKey: 'fumble_result', optionsKey: 'STANDARD' } },
  ],
}

export const PAT_TYPE_BRANCHES = {
  run: [
    { id: 'rush_by', label: 'Rush By', component: 'BY',
      config: { stateKey: 'rush_by', multiple: false, optional: false } },
    { id: 'result', label: 'Result', component: 'RESULT',
      config: { stateKey: 'result', optionsKey: 'STANDARD' } },
  ],
  pass: [
    { id: 'pass_by', label: 'Pass By', component: 'BY',
      config: { stateKey: 'pass_by', multiple: false, optional: false } },
    { id: 'pass_result', label: 'Pass Result', component: 'PASS_RESULT',
      config: { stateKey: 'pass_result' } },
  ],
  kick: [
    { id: 'kicked_by', label: 'Kicked By', component: 'BY',
      config: { stateKey: 'kicked_by', multiple: false, optional: false } },
    { id: 'pat_kick_result', label: 'PAT Result', component: 'PAT_KICK_RESULT',
      config: { stateKey: 'pat_kick_result' } },
  ],
}

export const PAT_KICK_RESULT_BRANCHES = {
  good:    [],
  missed:  [],
  blocked: [
    { id: 'pat_blocked_by', label: 'Blocked By', component: 'BY',
      config: { stateKey: 'pat_blocked_by', multiple: false, optional: true, team: 'opponent' } },
    { id: 'pat_block_returned_by', label: 'Returned By', component: 'BY',
      config: { stateKey: 'pat_block_returned_by', multiple: false, optional: true } },
    { id: 'pat_block_result', label: 'Block Result', component: 'PAT_BLOCK_RESULT',
      config: { stateKey: 'pat_block_result' } },
  ],
  // Same reasoning as FG's bad_snap: no realistic way to reset the hold, so
  // no "kick anyway" option — the holder/kicker recovering just falls on it
  // (an ordinary 0-yard RUSH) or scrambles via FAKE_PUNT_TYPE_BRANCHES.
  bad_snap: [
    { id: 'pat_bad_snap_at', label: 'Bad Snap AT', component: 'AT',
      config: { stateKey: 'pat_bad_snap_at' } },
    { id: 'pat_bad_snap_recovery_team', label: 'Recovery Team', component: 'TEAM',
      config: { stateKey: 'pat_bad_snap_recovery_team' } },
  ],
}

export const PUNT_RESULT_BRANCHES = {
  returned: [
    { id: 'punt_kicked_to', label: 'Kicked To', component: 'AT',
      config: { stateKey: 'punt_kicked_to' } },
    { id: 'punt_returned_by', label: 'Returned By', component: 'BY',
      config: { stateKey: 'punt_returned_by', multiple: false, optional: false, team: 'opponent' } },
    { id: 'punt_return_result', label: 'Return Result', component: 'RESULT',
      config: { stateKey: 'punt_return_result', optionsKey: 'STANDARD' } },
  ],
  fair_catch: [
    { id: 'punt_kicked_to', label: 'Kicked To', component: 'AT',
      config: { stateKey: 'punt_kicked_to' } },
    { id: 'punt_fair_catch_by', label: 'Fair Catch By', component: 'BY',
      config: { stateKey: 'punt_fair_catch_by', multiple: false, optional: false, team: 'opponent' } },
    { id: 'punt_fair_catch_at', label: 'AT', component: 'AT',
      config: { stateKey: 'punt_fair_catch_at' } },
  ],
  touchback: [],
  oob: [
    { id: 'punt_oob_at', label: 'Out AT', component: 'AT',
      config: { stateKey: 'punt_oob_at' } },
  ],
  downed: [
    { id: 'punt_downed_at', label: 'Downed At', component: 'AT',
      config: { stateKey: 'punt_downed_at' } },
  ],
  blocked: [
    { id: 'punt_blocked_by', label: 'Blocked By', component: 'BY',
      config: { stateKey: 'punt_blocked_by', multiple: false, optional: true, team: 'opponent' } },
    { id: 'punt_recovery_team', label: 'Recovery Team', component: 'TEAM',
      config: { stateKey: 'punt_recovery_team' } },
    { id: 'punt_recovery_by', label: 'Recovered By', component: 'BY',
      config: { stateKey: 'punt_recovery_by', multiple: false, optional: true, teamFrom: 'punt_recovery_team' } },
    { id: 'punt_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'punt_recovered_at' } },
    { id: 'punt_block_return_result', label: 'Return Result', component: 'PUNT_BLOCK_RETURN',
      config: { stateKey: 'punt_block_return_result' } },
  ],
  // Retargeted to a genuine RUSH/PASS play by wizard.js's _onStepComplete
  // when 'fake_punt_type' completes — see FAKE_PUNT_TYPE_BRANCHES there.
  fake: [
    { id: 'fake_punt_type', label: 'Fake Punt Type', component: 'RESULT',
      config: { stateKey: 'fake_punt_type', optionsKey: 'FAKE_PUNT_TYPE' } },
  ],
  // The returner never had controlled possession — deliberately its own
  // punt_muff_* field namespace, NOT fumble_*/fumble_2_*, so this can never
  // be picked up by computeFumbleStats()/_fumbleCarrier() in viewer.html
  // (those only read fumble_* fields). There's no "muffed by" step here on
  // purpose — see PUNT_MUFF_RESULT_BRANCHES below for why a subsequent loss
  // of the ball at the recovery stage IS captured as a real fumble_2_*.
  muffed: [
    { id: 'punt_muff_at', label: 'Muff AT', component: 'AT',
      config: { stateKey: 'punt_muff_at' } },
    { id: 'punt_muff_recovery_team', label: 'Recovery Team', component: 'TEAM',
      config: { stateKey: 'punt_muff_recovery_team' } },
    { id: 'punt_muff_recovered_by', label: 'Recovered By', component: 'BY',
      config: { stateKey: 'punt_muff_recovered_by', multiple: false, optional: true, teamFrom: 'punt_muff_recovery_team' } },
    { id: 'punt_muff_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'punt_muff_recovered_at' } },
    { id: 'punt_muff_result', label: 'Result', component: 'RESULT',
      config: { stateKey: 'punt_muff_result', optionsKey: 'STANDARD' } },
  ],
  // Bad LONG SNAP to the punter — a pre-kick execution error, distinct from
  // both 'blocked' (a defensive play at the line) and 'muffed' (the returner
  // failing to field a clean punt downfield). own-vs-opponent recovery split
  // resolved dynamically in wizard.js's resolveBranchSteps (see
  // PUNT_BAD_SNAP_RECOVERY_BRANCHES below), same mechanism as SNAP_FUMBLE.
  bad_snap: [
    { id: 'punt_bad_snap_at', label: 'Bad Snap AT', component: 'AT',
      config: { stateKey: 'punt_bad_snap_at' } },
    { id: 'punt_bad_snap_recovery_team', label: 'Recovery Team', component: 'TEAM',
      config: { stateKey: 'punt_bad_snap_recovery_team' } },
  ],
}

// Level-2 branches for a muff's RECOVERY result. tackle/oob/eop/safety get
// their own punt_muff_* fields (still isolated from fumble_*, since nobody
// controlled the ball before the muff). 'fumble' is the one exception on
// purpose: once punt_muff_recovered_by actually has the ball, losing it from
// there on is a genuine fumble (real possession, then lost) — so that leaf
// reuses FUMBLE_RESULT_BRANCHES.fumble verbatim (the existing fumble_2_*
// fields/branches), not a third namespace, since it IS the same kind of
// event the rest of the app already tracks as a fumble.
export const PUNT_MUFF_RESULT_BRANCHES = {
  tackle: [
    { id: 'punt_muff_tackle_by', label: 'Tackle By', component: 'BY',
      config: { stateKey: 'punt_muff_tackle_by', multiple: true, optional: true, teamFrom: 'punt_muff_recovery_team', invertTeamFrom: true } },
    { id: 'punt_muff_at_result', label: 'AT', component: 'AT',
      config: { stateKey: 'punt_muff_at_result' } },
  ],
  oob: [
    { id: 'punt_muff_at_result', label: 'AT', component: 'AT',
      config: { stateKey: 'punt_muff_at_result' } },
  ],
  eop: [
    { id: 'punt_muff_at_result', label: 'AT', component: 'AT',
      config: { stateKey: 'punt_muff_at_result' } },
  ],
  safety: [
    { id: 'punt_muff_safety_time', label: 'Set Time', component: 'TIME',
      config: { stateKey: 'punt_muff_safety_time' } },
  ],
  fumble: FUMBLE_RESULT_BRANCHES.fumble,
}

// ── Snap fumble (bad center snap, before the play develops) ─────────────────
// Distinct from a real in-play fumble: this is an execution error, not a
// defensive play, so there's deliberately no "forced_by" field anywhere here.
// wizard.js's resolveBranchSteps picks 'own' vs 'opponent' by comparing the
// chosen snap_fumble_recovery_team against the play's actual possession —
// not a static lookup keyed by team abbreviation (that varies per game).
export const SNAP_FUMBLE_RECOVERY_BRANCHES = {
  // Offense recovers its own botched snap and the play develops into a real
  // RUSH or PASS — snap_fumble_type mirrors fake_punt_type's retargeting
  // mechanism exactly (wizard.js's _onStepComplete sets play_type to
  // RUSH/PASS, then resolveBranchSteps splices in that type's own remaining
  // steps via FAKE_PUNT_TYPE_BRANCHES, reused verbatim here).
  own: [
    { id: 'snap_fumble_recovered_by', label: 'Recovered By', component: 'BY',
      config: { stateKey: 'snap_fumble_recovered_by', multiple: false, optional: true } },
    { id: 'snap_fumble_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'snap_fumble_recovered_at' } },
    { id: 'snap_fumble_type', label: 'Snap Fumble Type', component: 'RESULT',
      config: { stateKey: 'snap_fumble_type', optionsKey: 'FAKE_PUNT_TYPE' } },
  ],
  // Opponent recovers — immediate turnover, no RUSH/PASS ever developed.
  // play_type stays 'SNAP_FUMBLE' (never retargeted) so this can never be
  // counted as anyone's rush/pass attempt in viewer.html's stat maps, which
  // are keyed strictly by play_type === 'RUSH'/'PASS'.
  opponent: [
    { id: 'snap_fumble_recovered_by', label: 'Recovered By', component: 'BY',
      config: { stateKey: 'snap_fumble_recovered_by', multiple: false, optional: true, team: 'opponent' } },
    { id: 'snap_fumble_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'snap_fumble_recovered_at' } },
    { id: 'snap_fumble_result', label: 'Result', component: 'RESULT',
      config: { stateKey: 'snap_fumble_result', optionsKey: 'STANDARD' } },
  ],
}

// Level-2 branches for the 'opponent recovers' terminal case above. 'fumble'
// reuses FUMBLE_RESULT_BRANCHES.fumble verbatim (same reasoning as
// PUNT_MUFF_RESULT_BRANCHES.fumble above) — once the recovering player has
// the ball, losing it again is a real fumble, not part of the snap-fumble
// namespace.
export const SNAP_FUMBLE_RESULT_BRANCHES = {
  tackle: [
    { id: 'snap_fumble_tackle_by', label: 'Tackle By', component: 'BY',
      config: { stateKey: 'snap_fumble_tackle_by', multiple: true, optional: true, teamFrom: 'snap_fumble_recovery_team', invertTeamFrom: true } },
    { id: 'snap_fumble_at_result', label: 'AT', component: 'AT',
      config: { stateKey: 'snap_fumble_at_result' } },
  ],
  oob: [
    { id: 'snap_fumble_at_result', label: 'AT', component: 'AT',
      config: { stateKey: 'snap_fumble_at_result' } },
  ],
  eop: [
    { id: 'snap_fumble_at_result', label: 'AT', component: 'AT',
      config: { stateKey: 'snap_fumble_at_result' } },
  ],
  safety: [
    { id: 'snap_fumble_safety_time', label: 'Set Time', component: 'TIME',
      config: { stateKey: 'snap_fumble_safety_time' } },
  ],
  fumble: FUMBLE_RESULT_BRANCHES.fumble,
}

// ── Bad snap (long snapper) for PUNT/FG/PAT_KICK ─────────────────────────────
// Same shape/reasoning as SNAP_FUMBLE_RECOVERY_BRANCHES/SNAP_FUMBLE_RESULT_
// BRANCHES above, nested per-tree instead of a top-level play_type since
// play_type is already correctly PUNT/KICK/PAT_TRY by the time a bad snap
// happens here — there's no reason to retarget away from it. Only the 'own
// recovers, scrambles into a real run/pass' leaf ever changes play_type
// (via *_bad_snap_type, reusing FAKE_PUNT_TYPE_BRANCHES verbatim in
// wizard.js) — the 'kick anyway' (PUNT only) and 'opponent recovers' leaves
// never do, exactly like 'blocked'/'muffed' already don't.

export const PUNT_BAD_SNAP_RECOVERY_BRANCHES = {
  own: [
    { id: 'punt_bad_snap_recovered_by', label: 'Recovered By', component: 'BY',
      config: { stateKey: 'punt_bad_snap_recovered_by', multiple: false, optional: true } },
    { id: 'punt_bad_snap_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'punt_bad_snap_recovered_at' } },
    // 3-way (run/pass/kick) — see RESULT_OPTIONS.BAD_SNAP_PUNT_TYPE above for
    // why PUNT alone gets a "kick anyway" option that FG/PAT_KICK don't.
    { id: 'punt_bad_snap_type', label: 'Bad Snap Type', component: 'RESULT',
      config: { stateKey: 'punt_bad_snap_type', optionsKey: 'BAD_SNAP_PUNT_TYPE' } },
  ],
  opponent: [
    { id: 'punt_bad_snap_recovered_by', label: 'Recovered By', component: 'BY',
      config: { stateKey: 'punt_bad_snap_recovered_by', multiple: false, optional: true, team: 'opponent' } },
    { id: 'punt_bad_snap_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'punt_bad_snap_recovered_at' } },
    { id: 'punt_bad_snap_result', label: 'Result', component: 'RESULT',
      config: { stateKey: 'punt_bad_snap_result', optionsKey: 'STANDARD' } },
  ],
}

export const PUNT_BAD_SNAP_RESULT_BRANCHES = {
  tackle: [
    { id: 'punt_bad_snap_tackle_by', label: 'Tackle By', component: 'BY',
      config: { stateKey: 'punt_bad_snap_tackle_by', multiple: true, optional: true, teamFrom: 'punt_bad_snap_recovery_team', invertTeamFrom: true } },
    { id: 'punt_bad_snap_at_result', label: 'AT', component: 'AT',
      config: { stateKey: 'punt_bad_snap_at_result' } },
  ],
  oob: [
    { id: 'punt_bad_snap_at_result', label: 'AT', component: 'AT',
      config: { stateKey: 'punt_bad_snap_at_result' } },
  ],
  eop: [
    { id: 'punt_bad_snap_at_result', label: 'AT', component: 'AT',
      config: { stateKey: 'punt_bad_snap_at_result' } },
  ],
  safety: [
    { id: 'punt_bad_snap_safety_time', label: 'Set Time', component: 'TIME',
      config: { stateKey: 'punt_bad_snap_safety_time' } },
  ],
  fumble: FUMBLE_RESULT_BRANCHES.fumble,
}

export const FG_BAD_SNAP_RECOVERY_BRANCHES = {
  own: [
    { id: 'fg_bad_snap_recovered_by', label: 'Recovered By', component: 'BY',
      config: { stateKey: 'fg_bad_snap_recovered_by', multiple: false, optional: true } },
    { id: 'fg_bad_snap_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'fg_bad_snap_recovered_at' } },
    { id: 'fg_bad_snap_type', label: 'Bad Snap Type', component: 'RESULT',
      config: { stateKey: 'fg_bad_snap_type', optionsKey: 'FAKE_PUNT_TYPE' } },
  ],
  opponent: [
    { id: 'fg_bad_snap_recovered_by', label: 'Recovered By', component: 'BY',
      config: { stateKey: 'fg_bad_snap_recovered_by', multiple: false, optional: true, team: 'opponent' } },
    { id: 'fg_bad_snap_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'fg_bad_snap_recovered_at' } },
    { id: 'fg_bad_snap_result', label: 'Result', component: 'RESULT',
      config: { stateKey: 'fg_bad_snap_result', optionsKey: 'STANDARD' } },
  ],
}

export const FG_BAD_SNAP_RESULT_BRANCHES = {
  tackle: [
    { id: 'fg_bad_snap_tackle_by', label: 'Tackle By', component: 'BY',
      config: { stateKey: 'fg_bad_snap_tackle_by', multiple: true, optional: true, teamFrom: 'fg_bad_snap_recovery_team', invertTeamFrom: true } },
    { id: 'fg_bad_snap_at_result', label: 'AT', component: 'AT',
      config: { stateKey: 'fg_bad_snap_at_result' } },
  ],
  oob: [
    { id: 'fg_bad_snap_at_result', label: 'AT', component: 'AT',
      config: { stateKey: 'fg_bad_snap_at_result' } },
  ],
  eop: [
    { id: 'fg_bad_snap_at_result', label: 'AT', component: 'AT',
      config: { stateKey: 'fg_bad_snap_at_result' } },
  ],
  safety: [
    { id: 'fg_bad_snap_safety_time', label: 'Set Time', component: 'TIME',
      config: { stateKey: 'fg_bad_snap_safety_time' } },
  ],
  fumble: FUMBLE_RESULT_BRANCHES.fumble,
}

export const PAT_BAD_SNAP_RECOVERY_BRANCHES = {
  own: [
    { id: 'pat_bad_snap_recovered_by', label: 'Recovered By', component: 'BY',
      config: { stateKey: 'pat_bad_snap_recovered_by', multiple: false, optional: true } },
    { id: 'pat_bad_snap_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'pat_bad_snap_recovered_at' } },
    { id: 'pat_bad_snap_type', label: 'Bad Snap Type', component: 'RESULT',
      config: { stateKey: 'pat_bad_snap_type', optionsKey: 'FAKE_PUNT_TYPE' } },
  ],
  opponent: [
    { id: 'pat_bad_snap_recovered_by', label: 'Recovered By', component: 'BY',
      config: { stateKey: 'pat_bad_snap_recovered_by', multiple: false, optional: true, team: 'opponent' } },
    { id: 'pat_bad_snap_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'pat_bad_snap_recovered_at' } },
    { id: 'pat_bad_snap_result', label: 'Result', component: 'RESULT',
      config: { stateKey: 'pat_bad_snap_result', optionsKey: 'STANDARD' } },
  ],
}

export const PAT_BAD_SNAP_RESULT_BRANCHES = {
  tackle: [
    { id: 'pat_bad_snap_tackle_by', label: 'Tackle By', component: 'BY',
      config: { stateKey: 'pat_bad_snap_tackle_by', multiple: true, optional: true, teamFrom: 'pat_bad_snap_recovery_team', invertTeamFrom: true } },
    { id: 'pat_bad_snap_at_result', label: 'AT', component: 'AT',
      config: { stateKey: 'pat_bad_snap_at_result' } },
  ],
  oob: [
    { id: 'pat_bad_snap_at_result', label: 'AT', component: 'AT',
      config: { stateKey: 'pat_bad_snap_at_result' } },
  ],
  eop: [
    { id: 'pat_bad_snap_at_result', label: 'AT', component: 'AT',
      config: { stateKey: 'pat_bad_snap_at_result' } },
  ],
  safety: [
    { id: 'pat_bad_snap_safety_time', label: 'Set Time', component: 'TIME',
      config: { stateKey: 'pat_bad_snap_safety_time' } },
  ],
  fumble: FUMBLE_RESULT_BRANCHES.fumble,
}

export const PUNT_BLOCK_RETURN_BRANCHES = {
  downed: [],
  returned: [
    { id: 'punt_block_returned_by', label: 'Returned By', component: 'BY',
      config: { stateKey: 'punt_block_returned_by', multiple: false, optional: false, teamFrom: 'punt_recovery_team' } },
    { id: 'punt_block_ret_result', label: 'Return Result', component: 'RESULT',
      config: { stateKey: 'punt_block_ret_result', optionsKey: 'STANDARD' } },
  ],
}

export const PUNT_RETURN_RESULT_BRANCHES = {
  tackle: [
    { id: 'punt_return_tackle_by', label: 'Tackle By', component: 'BY',
      config: { stateKey: 'punt_return_tackle_by', multiple: true, optional: true } },
    { id: 'punt_return_at', label: 'AT', component: 'AT',
      config: { stateKey: 'punt_return_at' } },
  ],
  oob: [
    { id: 'punt_return_at', label: 'AT', component: 'AT',
      config: { stateKey: 'punt_return_at' } },
  ],
  eop: [
    { id: 'punt_return_at', label: 'AT', component: 'AT',
      config: { stateKey: 'punt_return_at' } },
  ],
  safety: [
    { id: 'punt_return_safety_time', label: 'Set Time', component: 'TIME',
      config: { stateKey: 'punt_return_safety_time' } },
  ],
  fumble: [
    { id: 'fumble_at', label: 'Fumble AT', component: 'AT',
      config: { stateKey: 'fumble_at' } },
    { id: 'fumble_forced_by', label: 'Forced By', component: 'BY',
      config: { stateKey: 'fumble_forced_by', multiple: false, optional: true } },
    { id: 'fumble_recovery_team', label: 'Recovery Team', component: 'TEAM',
      config: { stateKey: 'fumble_recovery_team' } },
    { id: 'fumble_recovered_by', label: 'Recovered By', component: 'BY',
      config: { stateKey: 'fumble_recovered_by', multiple: false, optional: true, teamFrom: 'fumble_recovery_team' } },
    { id: 'fumble_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'fumble_recovered_at' } },
    { id: 'fumble_result', label: 'Fumble Result', component: 'RESULT',
      config: { stateKey: 'fumble_result', optionsKey: 'STANDARD' } },
  ],
}

export const PUNT_BLOCK_RET_RESULT_BRANCHES = {
  tackle: [
    { id: 'punt_block_ret_tackle_by', label: 'Tackle By', component: 'BY',
      config: { stateKey: 'punt_block_ret_tackle_by', multiple: true, optional: true, teamFrom: 'punt_recovery_team', invertTeamFrom: true } },
    { id: 'punt_block_ret_at', label: 'AT', component: 'AT',
      config: { stateKey: 'punt_block_ret_at' } },
  ],
  oob: [
    { id: 'punt_block_ret_at', label: 'AT', component: 'AT',
      config: { stateKey: 'punt_block_ret_at' } },
  ],
  eop: [
    { id: 'punt_block_ret_at', label: 'AT', component: 'AT',
      config: { stateKey: 'punt_block_ret_at' } },
  ],
  safety: [
    { id: 'punt_block_ret_safety_time', label: 'Set Time', component: 'TIME',
      config: { stateKey: 'punt_block_ret_safety_time' } },
  ],
  fumble: [
    { id: 'fumble_at', label: 'Fumble AT', component: 'AT',
      config: { stateKey: 'fumble_at' } },
    { id: 'fumble_forced_by', label: 'Forced By', component: 'BY',
      config: { stateKey: 'fumble_forced_by', multiple: false, optional: true } },
    { id: 'fumble_recovery_team', label: 'Recovery Team', component: 'TEAM',
      config: { stateKey: 'fumble_recovery_team' } },
    { id: 'fumble_recovered_by', label: 'Recovered By', component: 'BY',
      config: { stateKey: 'fumble_recovered_by', multiple: false, optional: true, teamFrom: 'fumble_recovery_team' } },
    { id: 'fumble_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'fumble_recovered_at' } },
    { id: 'fumble_result', label: 'Fumble Result', component: 'RESULT',
      config: { stateKey: 'fumble_result', optionsKey: 'STANDARD' } },
  ],
}

// ── Game CTRL ─────────────────────────────────────────────────────────────────

export const GAME_CTRL_OPTIONS = [
  { key: 'spot_ball',   label: 'Spot Ball',   kbd: 'B', color: '--accent' },
  { key: 'set_clock',   label: 'Set Clock',   kbd: 'C', color: '--text2'  },
  { key: 'set_quarter', label: 'Set Quarter', kbd: 'Q', color: '--text2'  },
  { key: 'set_down',    label: 'Set Down',    kbd: 'D', color: '--text2'  },
  { key: 'timeout',     label: 'Timeout',     kbd: 'T', color: '--yellow' },
  { key: 'start_drive', label: 'Start Drive', kbd: 'S', color: '--green'  },
  { key: 'set_score',   label: 'Set Score',   kbd: 'X', color: '--green'  },
  { key: 'set_possession', label: 'Set Possession', kbd: 'P', color: '--accent' },
  { key: 'end_game',    label: 'End Game',    kbd: 'E', color: '--red'    },
]

export const gameEvents = []

export function saveGameEvents() {
  localStorage.setItem('covercero_events', JSON.stringify(gameEvents))
}

export function loadGameEvents() {
  const saved = localStorage.getItem('covercero_events')
  if (saved) gameEvents.push(...JSON.parse(saved))
}

export function clearGameEvents() {
  gameEvents.length = 0
  localStorage.removeItem('covercero_events')
}

// Mutates `state` (down/distance/field_pos/possession/quarter/clock/score) per a
// stored gameEvent. Shared by the live applyGameCtrl() and by deriveNextPlayContext()
// replaying events that happened after the last recorded play.
function _applyGameCtrlEventToState(state, event) {
  switch (event.event_type) {
    case 'spot_ball':
      // event: { field_pos_team, field_pos_yard }
      state.field_pos = { team: event.field_pos_team, yard: event.field_pos_yard }
      break

    case 'set_clock':
      // event: { clock }
      state.clock = event.clock
      break

    case 'set_quarter':
      // event: { quarter }
      state.quarter = event.quarter
      break

    case 'set_down':
      // event: { down, distance }
      state.down = event.down
      state.distance = event.distance
      break

    case 'timeout':
      // event: { team, clock } — no muta el estado, solo se registra
      break

    case 'start_drive':
      // event: { possession, field_pos_team, field_pos_yard, down, distance }
      state.possession = event.possession
      state.field_pos  = { team: event.field_pos_team, yard: event.field_pos_yard }
      state.down       = event.down
      state.distance   = event.distance
      break

    case 'set_score':
      // event: { home, away }
      state.score.home = event.home
      state.score.away = event.away
      break

    case 'set_possession':
      // event: { possession }
      state.possession = event.possession
      break

    case 'end_game':
      // event: {} — marks the game as finished; score is left untouched here,
      // it's whatever gameState.score already holds.
      state.ended = true
      break
  }
}

// Direct status change from the operator's status dropdown (scheduled/live/
// halftime/final) — unlike applyGameCtrl's 'end_game', this doesn't record a
// gameEvent/play, it's just a straight PATCH of games.status. Score is left
// untouched (passes gameState's current score along, same as syncGameStatus
// always requires).
export function setGameStatus(status) {
  syncGameStatus(status, gameState.score.home, gameState.score.away)
}

// Called once, when the operator picks who kicks off first on the "Start
// Game" screen (covercero_live.html, game.status === 'scheduled'). Persists
// both status → 'live' and opening_kickoff_team_id in a single PATCH, then
// sets gameState.possession/field_pos so capture can start immediately
// without a reload. Throws on failure so the caller keeps the Start Game
// screen up instead of opening capture against unpersisted state. Who kicks
// off the 2nd half is NOT handled here — the operator still corrects
// possession manually via set_possession (key P).
export async function startGame(openingKickoffTeamId, openingKickerName) {
  if (!_gameId) return
  if (_onSyncStatus) _onSyncStatus('saving')

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/games?id=eq.${encodeURIComponent(_gameId)}`,
      {
        method: 'PATCH',
        headers: {
          ...(await getAuthHeaders()),
          'Content-Type': 'application/json',
          'Prefer':       'return=minimal',
        },
        body: JSON.stringify({ status: 'live', opening_kickoff_team_id: openingKickoffTeamId }),
      }
    )
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ''}`)
    }
    gameState.possession = openingKickerName
    gameState.field_pos  = { team: openingKickerName, yard: 35 }
    if (_onSyncStatus) _onSyncStatus('saved')
  } catch (err) {
    console.error('[Supabase startGame]', err)
    if (_onSyncStatus) _onSyncStatus('error')
    throw err
  }
}

export function applyGameCtrl(action, data) {
  const event = {
    event_id: generatePlayId(),
    game_id: null,
    event_type: action,
    occurred_at: Date.now(),
    clock: gameState.clock,
    quarter: gameState.quarter,
    ...data,
  }

  _applyGameCtrlEventToState(gameState, event)

  gameEvents.push(event)
  saveGameEvents()
  if (_onPlaySubmitted) _onPlaySubmitted()

  if (action === 'end_game') {
    syncGameStatus('final', gameState.score.home, gameState.score.away)
  } else if (action === 'set_score') {
    syncGameStatus(null, gameState.score.home, gameState.score.away)
  }
}

// ── Derive next-play context from history ────────────────────────────────────
//
// Instead of trusting the incrementally-mutated `gameState` singleton, this
// rebuilds the starting context (down/distance/possession/field_pos/quarter/
// clock/score) for a NEW play from the recorded history:
//   1. Start from the last play's own pre-snap snapshot.
//   2. Advance it using that same play's stored result fields (advanceGameState
//      + applyFlags), exactly like at submit time.
//   3. Replay any gameEvents (Spot Ball, Set Clock, Start Drive, ...) that
//      happened after that play, in order.
// This makes edits to any past play (via the edit panel) take effect
// automatically the next time a new play is started — no cascade recompute
// of the plays in between is needed.
export function deriveNextPlayContext() {
  let state
  let baseline

  if (plays.length === 0) {
    state = {
      quarter:    gameState.quarter,
      clock:      gameState.clock,
      possession: gameState.possession,
      field_pos:  { ...gameState.field_pos },
      down:       gameState.down,
      distance:   gameState.distance,
      score:      { ...gameState.score },
    }
    baseline = 0
  } else {
    const lastPlay = plays.reduce((a, b) => (b.seq > a.seq ? b : a), plays[0])
    state = {
      quarter:    lastPlay.quarter,
      clock:      lastPlay.clock,
      possession: lastPlay.possession,
      field_pos:  { ...lastPlay.field_pos },
      down:       lastPlay.down,
      distance:   lastPlay.distance,
      score:      { home: lastPlay.score_home, away: lastPlay.score_away },
    }
    advanceGameState(state, lastPlay, gameState.teams)
    applyFlags(state, lastPlay, gameState.teams)
    baseline = lastPlay.submitted_at
  }

  const laterEvents = gameEvents
    .filter(e => e.occurred_at > baseline)
    .sort((a, b) => a.occurred_at - b.occurred_at)
  for (const ev of laterEvents) _applyGameCtrlEventToState(state, ev)

  gameState.quarter    = state.quarter
  gameState.clock      = state.clock
  gameState.possession = state.possession
  gameState.field_pos  = state.field_pos
  gameState.down       = state.down
  gameState.distance   = state.distance
  gameState.score.home = state.score.home
  gameState.score.away = state.score.away

  return state
}

// ── Re-exports (pass-through) ─────────────────────────────────────────────────
// Purely so wizard.js's `import { isTouchdown, calcNetYards, gameState,
// formatPlay, playerShortLabel } from './engine.js'` keeps working unchanged
// after the stats-lib.js split — these all live in stats-lib.js now.
export { gameState, isTouchdown, calcNetYards, formatPlay, playerShortLabel }
