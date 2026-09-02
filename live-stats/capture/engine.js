import { SUPABASE_URL, SUPABASE_HEADERS } from '../../shared/supabase/supabase_config.js'

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
        ...SUPABASE_HEADERS,
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
          ...SUPABASE_HEADERS,
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
          ...SUPABASE_HEADERS,
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

export function fieldPosLabel(team, yard) {
  return `${team} ${yard}`
}

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

// Returns true if the AT position is a touchdown for the possessing team.
// TD = reaching yard 0 of the opponent's endzone.
export function isTouchdown(teams, possession, atPos) {
  const opponent = possession === teams.home.name ? teams.away.name : teams.home.name
  return atPos.team === opponent && atPos.yard === 0
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
  { key: 'good',    label: 'Good',    kbd: 'G', color: '--green'  },
  { key: 'missed',  label: 'Missed',  kbd: 'M', color: '--red'    },
  { key: 'blocked', label: 'Blocked', kbd: 'B', color: '--orange' },
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
  { key: 'good',    label: 'Good (1pt)', kbd: 'G', color: '--green'  },
  { key: 'missed',  label: 'Missed',     kbd: 'M', color: '--red'    },
  { key: 'blocked', label: 'Blocked',    kbd: 'B', color: '--orange' },
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

// ── Team comparison stats (Reports / Box Score) ──────────────────────────────
// ⚠️ DUPLICADO INTENCIONAL de viewer.html (computeComparisonStats y sus
// dependencias: computeDrives, driveEndLabel, _turnoverScore,
// _kickoffDriveOwner, _isFirstDownPlay, _effectiveNetYards — más
// computePenalties/_puntTerminalSpot un poco más abajo, para la fila
// "Penalties" de Comparación, que Comparación deriva por separado).
// Motivo: viewer.html no es módulo ES, mover estas funciones ahí rompería
// 10+ call sites síncronos (Drive Chart, play-by-play, Explosive Plays,
// banner de drive en vivo) que las usan fuera de cualquier guard async.
// Si se corrige una fórmula de Comparación en viewer.html, replicar el
// cambio aquí también. Única diferencia real con el original: aquí
// isTouchdown/calcNetYards/formatPlay/playerShortLabel se llaman directas
// (nativas del módulo) en vez de vía import() con guards typeof — misma
// lógica, sin el paso async.

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

function driveEndLabel(plays, isLastDrive, teams) {
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

function _isFirstDownPlay(p) {
  const byYards = p.stats_count !== false &&
    ((p.net_yards != null && p.distance != null && p.net_yards >= p.distance) || p.touchdown === true)
  const byPenalty = p.flag_1_down_result === 'first_down' ||
    p.flag_2_down_result === 'first_down' ||
    p.penalty_down_result === 'first_down'
  return byYards || byPenalty
}

function _effectiveNetYards(p, teams) {
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
    passCompletions: 0, rushPlays: 0, sackAdjRushYds: 0, sackAdjRushPlays: 0,
    firstDowns: 0, thirdAtt: 0, thirdConv: 0, fourthAtt: 0, fourthConv: 0,
    redZoneTrips: 0, redZoneTDs: 0,
    turnovers: 0, fumbles: 0, fumblesLost: 0,
    sacksMade: 0, sacksYds: 0, tflMade: 0, tflYds: 0,
  })
  const out = { [homeAbbr]: blank(), [awayAbbr]: blank() }
  const otherTeam = t => (t === homeAbbr ? awayAbbr : (t === awayAbbr ? homeAbbr : null))

  for (const p of plays) {
    if (p.play_type === 'GAME_CTRL') continue

    if (p.play_type === 'PASS' && p.pass_result === 'intercepted' && out[p.possession]) {
      out[p.possession].turnovers++
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
    } else if (p.play_type === 'PASS' && ['complete', 'incomplete', 'intercepted'].includes(p.pass_result)) {
      t.passYds += (_effectiveNetYards(p, teams) || 0)
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
// computeComparisonStats' own output) — same duplication rationale as above,
// _puntTerminalSpot included since computePenalties depends on it.
function _puntTerminalSpot(p) {
  if (p.punt_result === 'fair_catch') return p.punt_fair_catch_at || null
  if (p.punt_result === 'oob') return p.punt_oob_at || null
  if (p.punt_result === 'downed') return p.punt_downed_at || null
  if (p.punt_result === 'returned') {
    if (p.punt_return_result === 'fumble') return p.fumble_recovered_at || null
    return p.punt_return_at || null
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
// e.g. {number:22, nombre:'Juan', apellido:'Pérez'} → "#22 Pérez, J.".
// Plays captured before rosters had real names (or any incomplete playerRef)
// fall back to just "#{number}" instead of breaking.
export function playerShortLabel(playerRef) {
  if (!playerRef) return '—'
  const { number, nombre, apellido } = playerRef
  if (!apellido) return `#${number}`
  const initial = nombre ? `, ${nombre.charAt(0).toUpperCase()}.` : ''
  return `#${number} ${apellido}${initial}`
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
  return play.fake_punt ? `[FAKE PUNT] ${text}` : text
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
          ...SUPABASE_HEADERS,
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
    advanceGameState(state, lastPlay)
    applyFlags(state, lastPlay)
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
