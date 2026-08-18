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
  if (_onPlaySubmitted) _onPlaySubmitted()
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

async function _syncPlayToSupabase(play) {
  if (!_gameId) return
  if (_onSyncStatus) _onSyncStatus('saving')

  const play_data = {}
  for (const [k, v] of Object.entries(play)) {
    if (!_MAIN_KEYS.has(k)) play_data[k] = v
  }

  const row = {
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

export function loadPlays() {
  const saved = localStorage.getItem('covercero_plays')
  if (saved) plays.push(...JSON.parse(saved))
}

export function clearPlays() {
  plays.length = 0
  localStorage.removeItem('covercero_plays')
}

// ── Roster ────────────────────────────────────────────────────────────────────

let roster = []

export function getRoster() {
  if (roster.length > 0) return roster
  return Array.from({ length: 100 }, (_, i) => ({
    number: i,
    name: '',
    position: '',
  }))
}

export function loadRoster(data) {
  roster = data
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
  { key: 'blocked',    label: 'Blocked',      kbd: 'B', color: '--orange' },
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
        config: { stateKey: 'tackle_by', multiple: true, optional: true } },
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
        config: { stateKey: 'fumble_forced_by', multiple: false, optional: true } },
      { id: 'fumble_recovery_team', label: 'Recovery Team', component: 'TEAM',
        config: { stateKey: 'fumble_recovery_team' } },
      { id: 'fumble_recovered_by', label: 'Recovered By', component: 'BY',
        config: { stateKey: 'fumble_recovered_by', multiple: false, optional: true } },
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

export const FUMBLE_RESULT_BRANCHES = {
  tackle: [
    { id: 'fumble_tackle_by', label: 'Tackle By', component: 'BY',
      config: { stateKey: 'fumble_tackle_by', multiple: true, optional: true } },
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
      config: { stateKey: 'fumble_2_tackle_by', multiple: true, optional: true } },
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
      config: { stateKey: 'broken_up_by',  multiple: false, optional: true } },
    { id: 'qb_hurried_by', label: 'QB Hurried By', component: 'BY',
      config: { stateKey: 'qb_hurried_by', multiple: false, optional: true } },
  ],
  dropped: [
    { id: 'intended_for',  label: 'Intended For',  component: 'BY',
      config: { stateKey: 'intended_for',  multiple: false, optional: true } },
    { id: 'broken_up_by',  label: 'Broken Up By',  component: 'BY',
      config: { stateKey: 'broken_up_by',  multiple: false, optional: true } },
    { id: 'qb_hurried_by', label: 'QB Hurried By', component: 'BY',
      config: { stateKey: 'qb_hurried_by', multiple: false, optional: true } },
  ],
  broken_up: [
    { id: 'intended_for',  label: 'Intended For',  component: 'BY',
      config: { stateKey: 'intended_for',  multiple: false, optional: true } },
    { id: 'broken_up_by',  label: 'Broken Up By',  component: 'BY',
      config: { stateKey: 'broken_up_by',  multiple: false, optional: true } },
    { id: 'qb_hurried_by', label: 'QB Hurried By', component: 'BY',
      config: { stateKey: 'qb_hurried_by', multiple: false, optional: true } },
  ],
  sack: [
    { id: 'sack_by', label: 'Sack By', component: 'BY',
      config: { stateKey: 'sack_by', multiple: false, optional: false } },
    { id: 'at', label: 'AT', component: 'AT',
      config: { stateKey: 'at' } },
  ],
  scramble: [
    { id: 'result', label: 'Result', component: 'RESULT',
      config: { stateKey: 'result', optionsKey: 'STANDARD' } },
  ],
  intercepted: [
    { id: 'intercepted_by', label: 'Intercepted By', component: 'BY',
      config: { stateKey: 'intercepted_by', multiple: false, optional: false } },
    { id: 'intercepted_at', label: 'Intercepted AT', component: 'AT',
      config: { stateKey: 'intercepted_at' } },
    { id: 'returned_by', label: 'Returned By', component: 'BY',
      config: { stateKey: 'returned_by', multiple: false, optional: true } },
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
      config: { stateKey: 'fumble_recovered_by', multiple: false, optional: true } },
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
      config: { stateKey: 'kick_returned_by', multiple: false, optional: false } },
    { id: 'kick_return_result', label: 'Return Result', component: 'RESULT',
      config: { stateKey: 'kick_return_result', optionsKey: 'STANDARD' } },
  ],
  oob: [],
  fair_catch: [
    { id: 'kicked_to', label: 'Kicked To', component: 'AT',
      config: { stateKey: 'kicked_to' } },
    { id: 'fair_catch_by', label: 'Fair Catch By', component: 'BY',
      config: { stateKey: 'fair_catch_by', multiple: false, optional: false } },
    { id: 'fair_catch_at', label: 'AT', component: 'AT',
      config: { stateKey: 'fair_catch_at' } },
  ],
  touchback: [],
  onside: [
    { id: 'onside_recovery_team', label: 'Recovery Team', component: 'TEAM',
      config: { stateKey: 'onside_recovery_team' } },
    { id: 'onside_recovery_by', label: 'Recovered By', component: 'BY',
      config: { stateKey: 'onside_recovery_by', multiple: false, optional: true } },
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
      config: { stateKey: 'fg_blocked_by', multiple: false, optional: true } },
    { id: 'fg_recovery_team', label: 'Recovery Team', component: 'TEAM',
      config: { stateKey: 'fg_recovery_team' } },
    { id: 'fg_recovery_by', label: 'Recovered By', component: 'BY',
      config: { stateKey: 'fg_recovery_by', multiple: false, optional: true } },
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
      config: { stateKey: 'fg_returned_by', multiple: false, optional: false } },
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
      config: { stateKey: 'fumble_recovered_by', multiple: false, optional: true } },
    { id: 'fumble_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'fumble_recovered_at' } },
    { id: 'fumble_result', label: 'Fumble Result', component: 'RESULT',
      config: { stateKey: 'fumble_result', optionsKey: 'STANDARD' } },
  ],
}

export const FG_RET_RESULT_BRANCHES = {
  tackle: [
    { id: 'fg_ret_tackle_by', label: 'Tackle By', component: 'BY',
      config: { stateKey: 'fg_ret_tackle_by', multiple: true, optional: true } },
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
      config: { stateKey: 'fumble_recovered_by', multiple: false, optional: true } },
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
      config: { stateKey: 'pat_blocked_by', multiple: false, optional: true } },
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
      config: { stateKey: 'punt_returned_by', multiple: false, optional: false } },
    { id: 'punt_return_result', label: 'Return Result', component: 'RESULT',
      config: { stateKey: 'punt_return_result', optionsKey: 'STANDARD' } },
  ],
  fair_catch: [
    { id: 'punt_kicked_to', label: 'Kicked To', component: 'AT',
      config: { stateKey: 'punt_kicked_to' } },
    { id: 'punt_fair_catch_by', label: 'Fair Catch By', component: 'BY',
      config: { stateKey: 'punt_fair_catch_by', multiple: false, optional: false } },
    { id: 'punt_fair_catch_at', label: 'AT', component: 'AT',
      config: { stateKey: 'punt_fair_catch_at' } },
  ],
  touchback: [],
  oob: [
    { id: 'punt_oob_at', label: 'Out AT', component: 'AT',
      config: { stateKey: 'punt_oob_at' } },
  ],
  blocked: [
    { id: 'punt_blocked_by', label: 'Blocked By', component: 'BY',
      config: { stateKey: 'punt_blocked_by', multiple: false, optional: true } },
    { id: 'punt_recovery_team', label: 'Recovery Team', component: 'TEAM',
      config: { stateKey: 'punt_recovery_team' } },
    { id: 'punt_recovery_by', label: 'Recovered By', component: 'BY',
      config: { stateKey: 'punt_recovery_by', multiple: false, optional: true } },
    { id: 'punt_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'punt_recovered_at' } },
    { id: 'punt_block_return_result', label: 'Return Result', component: 'PUNT_BLOCK_RETURN',
      config: { stateKey: 'punt_block_return_result' } },
  ],
}

export const PUNT_BLOCK_RETURN_BRANCHES = {
  downed: [],
  returned: [
    { id: 'punt_block_returned_by', label: 'Returned By', component: 'BY',
      config: { stateKey: 'punt_block_returned_by', multiple: false, optional: false } },
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
      config: { stateKey: 'fumble_recovered_by', multiple: false, optional: true } },
    { id: 'fumble_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'fumble_recovered_at' } },
    { id: 'fumble_result', label: 'Fumble Result', component: 'RESULT',
      config: { stateKey: 'fumble_result', optionsKey: 'STANDARD' } },
  ],
}

export const PUNT_BLOCK_RET_RESULT_BRANCHES = {
  tackle: [
    { id: 'punt_block_ret_tackle_by', label: 'Tackle By', component: 'BY',
      config: { stateKey: 'punt_block_ret_tackle_by', multiple: true, optional: true } },
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
      config: { stateKey: 'fumble_recovered_by', multiple: false, optional: true } },
    { id: 'fumble_recovered_at', label: 'Recovered AT', component: 'AT',
      config: { stateKey: 'fumble_recovered_at' } },
    { id: 'fumble_result', label: 'Fumble Result', component: 'RESULT',
      config: { stateKey: 'fumble_result', optionsKey: 'STANDARD' } },
  ],
}

// ── Play text formatter ───────────────────────────────────────────────────────

function _playerStr(p) {
  if (!p) return '—'
  return p.name ? `#${p.number} ${p.name}` : `#${p.number}`
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

function _formatFlags(play) {
  const flags = []
  for (const num of [1, 2]) {
    const inf = play[`flag_${num}_infraction`]
    if (!inf) break
    const team   = play[`flag_${num}_team`] || '—'
    const res    = play[`flag_${num}_result`] || ''
    const by     = play[`flag_${num}_by`] ? ` on ${_playerStr(play[`flag_${num}_by`])}` : ''
    const newLos = play[`flag_${num}_new_los`] ? ` → ${_posStr(play[`flag_${num}_new_los`])}` : ''
    flags.push(`FLAG: ${inf.code} ${team}${by} (${res})${newLos}`)
  }
  return flags.length ? ' | ' + flags.join(' | ') : ''
}

// Formats a completed play object into a human-readable string.
// play must have at minimum: down, distance, field_pos, play_type
export function formatPlay(play) {
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
      const fumbleAtStr = `${play.fumble_at.team} ${play.fumble_at.yard}`
      const recTeam = play.fumble_recovery_team || '—'
      const recBy = play.fumble_recovered_by
        ? ` #${play.fumble_recovered_by.number}${play.fumble_recovered_by.name ? ' ' + play.fumble_recovered_by.name : ''}`
        : ''

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
          fumbleResultStr = ` to ${play.fumble_at_result.team} ${play.fumble_at_result.yard}${tackleBy}`
        } else if (play.fumble_result === 'oob' && play.fumble_at_result) {
          fumbleResultStr = ` to ${play.fumble_at_result.team} ${play.fumble_at_result.yard} (OOB)`
        } else if (play.fumble_result === 'eop' && play.fumble_at_result) {
          fumbleResultStr = ` to ${play.fumble_at_result.team} ${play.fumble_at_result.yard}`
        } else if (play.fumble_result === 'safety') {
          fumbleResultStr = ' SAFETY'
        }
      }

      return `${situation}: ${carrier} ${gainLoss} — FUMBLE at ${fumbleAtStr} (rec: ${recTeam}${recBy})${fumbleResultStr}${_formatFlags(play)}`
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
      return `${situation}: ${kickedBy} kickoff OUT OF BOUNDS${_formatFlags(play)}`
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
        const recTeam  = play.fumble_recovery_team || '—'
        const defScored = play.pat_two_pt_defense ? ' — DEFENSE 2pt' : ''
        return `PAT: ${carrier} rush FUMBLE (rec: ${recTeam})${defScored}${_formatFlags(play)}`
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
    if (puntRes === 'blocked') {
      return `${situation}: ${puntedBy} punt BLOCKED${blockedBy}${blkRetBy}${blkRetAt}${blkTD}${_formatFlags(play)}`
    }
    return `${situation}: ${puntedBy} punt${_formatFlags(play)}`
  }

  // Fallback for play types not yet formatted
  return `${situation}: ${play_type}${_formatFlags(play)}`
}

// ── Game state advancement ────────────────────────────────────────────────────

export function advanceGameState(play) {
  const { net_yards, touchdown, at, result } = play

  if (play.play_type === 'PENALTY') {
    const res = play.penalty_result

    if (res === 'declined' || res === 'offsetting') return

    if (res === 'accepted') {
      if (play.penalty_new_los) {
        gameState.field_pos = { ...play.penalty_new_los }
      }

      const downRes = play.penalty_down_result
      if (downRes === 'first_down') {
        gameState.down     = 1
        gameState.distance = 10
      } else if (downRes === 'loss_of_down') {
        if (gameState.down >= 4) {
          gameState.down     = 1
          gameState.distance = 10
        } else {
          gameState.down = gameState.down + 1
        }
      } else {
        // repeat_down — mismo down, recalcular distance desde nuevo LOS
        if (play.penalty_new_los) {
          const net = calcNetYards(
            gameState.teams,
            gameState.possession,
            play.field_pos,
            play.penalty_new_los
          )
          const newDist = gameState.distance - net
          gameState.distance = newDist > 0 ? newDist : 10
        }
      }
    }
    return
  }

  if (play.play_type === 'KICK') {

    if (play.kick_type === 'field_goal') {
      const res = play.fg_result

      if (res === 'good') {
        _addPoints(play.possession, 3)
        gameState.down     = 0
        gameState.distance = 0
        return
      }

      if (res === 'missed') {
        const defTeam = play.possession === gameState.teams.home.name
          ? gameState.teams.away.name : gameState.teams.home.name
        gameState.possession = defTeam
        gameState.down       = 1
        gameState.distance   = 10
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
            _addPoints(defTeam, 6)
            gameState.possession = defTeam
            gameState.down       = 0
            gameState.distance   = 0
            if (retAt) gameState.field_pos = { ...retAt }
            return
          }

          if (play.fg_ret_result === 'fumble') {
            gameState.possession = defTeam
            _advanceFumble(play, '')
            return
          }

          gameState.possession = defTeam
          if (retAt) gameState.field_pos = { ...retAt }
          gameState.down     = 1
          gameState.distance = 10
          return
        }

        // Downed
        if (play.fg_recovered_at) gameState.field_pos = { ...play.fg_recovered_at }
        gameState.possession = defTeam
        gameState.down       = 1
        gameState.distance   = 10
        return
      }
      return
    }

    // Kickoff
    const kickRes = play.kickoff_result
    const defTeam = play.possession === gameState.teams.home.name
      ? gameState.teams.away.name : gameState.teams.home.name

    gameState.down     = 0
    gameState.distance = 0

    if (kickRes === 'touchback') {
      gameState.possession = defTeam
      gameState.field_pos  = { team: defTeam, yard: 25 }
      gameState.down       = 1
      gameState.distance   = 10
      return
    }

    if (kickRes === 'oob') {
      gameState.possession = defTeam
      gameState.field_pos  = { team: defTeam, yard: 40 }
      gameState.down       = 1
      gameState.distance   = 10
      return
    }

    if (kickRes === 'fair_catch') {
      gameState.possession = defTeam
      gameState.field_pos  = { team: defTeam, yard: 25 }
      gameState.down       = 1
      gameState.distance   = 10
      return
    }

    if (kickRes === 'onside') {
      const recoveryTeam = play.onside_recovery_team || defTeam
      gameState.possession = recoveryTeam
      if (play.onside_recovered_at) gameState.field_pos = { ...play.onside_recovered_at }
      gameState.down       = 1
      gameState.distance   = 10
      return
    }

    if (kickRes === 'returned') {
      const retAt = play.kick_return_at
      const isTD  = retAt ? isTouchdown(gameState.teams, defTeam, retAt) : false

      if (isTD) {
        _addPoints(defTeam, 6)
        gameState.possession = defTeam
        gameState.down       = 0
        gameState.distance   = 0
        if (retAt) gameState.field_pos = { ...retAt }
        return
      }

      if (play.kick_return_result === 'safety') {
        _addPoints(play.possession, 2)
      }

      if (play.kick_return_result === 'fumble') {
        gameState.possession = defTeam
        _advanceFumble(play, '')
        return
      }

      gameState.possession = defTeam
      if (retAt) gameState.field_pos = { ...retAt }
      gameState.down       = 1
      gameState.distance   = 10
      return
    }
    return
  }

  if (play.play_type === 'PUNT') {
    const puntRes = play.punt_result
    const defTeam = play.possession === gameState.teams.home.name
      ? gameState.teams.away.name : gameState.teams.home.name

    if (puntRes === 'touchback') {
      gameState.possession = defTeam
      gameState.field_pos  = { team: defTeam, yard: 20 }
      gameState.down       = 1
      gameState.distance   = 10
      return
    }

    if (puntRes === 'oob') {
      gameState.possession = defTeam
      if (play.punt_oob_at) gameState.field_pos = { ...play.punt_oob_at }
      gameState.down       = 1
      gameState.distance   = 10
      return
    }

    if (puntRes === 'fair_catch') {
      gameState.possession = defTeam
      if (play.punt_fair_catch_at) gameState.field_pos = { ...play.punt_fair_catch_at }
      gameState.down       = 1
      gameState.distance   = 10
      return
    }

    if (puntRes === 'returned') {
      const retAt = play.punt_return_at
      const isTD  = retAt ? isTouchdown(gameState.teams, defTeam, retAt) : false

      if (isTD) {
        _addPoints(defTeam, 6)
        gameState.possession = defTeam
        gameState.down       = 0
        gameState.distance   = 0
        if (retAt) gameState.field_pos = { ...retAt }
        return
      }

      if (play.punt_return_result === 'safety') {
        _addPoints(play.possession, 2)
      }

      if (play.punt_return_result === 'fumble') {
        gameState.possession = defTeam
        _advanceFumble(play, '')
        return
      }

      gameState.possession = defTeam
      if (retAt) gameState.field_pos = { ...retAt }
      gameState.down       = 1
      gameState.distance   = 10
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
          _addPoints(retTeam, 6)
          gameState.possession = retTeam
          gameState.down       = 0
          gameState.distance   = 0
          if (retAt) gameState.field_pos = { ...retAt }
          return
        }

        if (play.punt_block_ret_result === 'fumble') {
          gameState.possession = retTeam
          _advanceFumble(play, '')
          return
        }

        gameState.possession = retTeam
        if (retAt) gameState.field_pos = { ...retAt }
        gameState.down       = 1
        gameState.distance   = 10
        return
      }

      gameState.possession = recovTeam
      if (play.punt_recovered_at) gameState.field_pos = { ...play.punt_recovered_at }
      gameState.down       = 1
      gameState.distance   = 10
      return
    }

    return
  }

  if (play.play_type === 'PAT_TRY') {
    const patType = play.pat_type

    gameState.down       = 0
    gameState.distance   = 0
    gameState.possession = play.possession
    gameState.field_pos  = { team: play.possession, yard: 35 }

    if (patType === 'kick') {
      if (play.pat_kick_result === 'good') {
        _addPoints(play.possession, 1)
      }
      if (play.pat_block_result === 'good') {
        const defTeam = play.possession === gameState.teams.home.name
          ? gameState.teams.away.name : gameState.teams.home.name
        _addPoints(defTeam, 2)
      }
      return
    }

    if (patType === 'run') {
      if (play.touchdown) {
        _addPoints(play.possession, 2)
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
            _addPoints(play.fumble_recovery_team, 2)
          }
        }
      }
      return
    }

    if (patType === 'pass') {
      const passRes = play.pass_result
      if (passRes === 'complete' && play.touchdown) {
        _addPoints(play.possession, 2)
        return
      }
      if (passRes === 'intercepted') {
        const returnPos = play.return_at || play.intercepted_at
        if (returnPos) {
          const defTeam = play.possession === gameState.teams.home.name
            ? gameState.teams.away.name : gameState.teams.home.name
          if (isTouchdown(gameState.teams, defTeam, returnPos)) {
            _addPoints(defTeam, 2)
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
      if (gameState.down >= 4) {
        gameState.down     = 1
        gameState.distance = 10
      } else {
        gameState.down = gameState.down + 1
      }
      return
    }

    if (passRes === 'sack') {
      if (play.at) gameState.field_pos = { ...play.at }
      _advanceDownDistance(play.net_yards ?? 0)
      return
    }

    if (passRes === 'scramble') {
      if (touchdown) {
        gameState.down     = 0
        gameState.distance = 0
        if (at) gameState.field_pos = { ...at }
        _addPoints(play.possession, 6)
        return
      }
      if (result === 'fumble') {
        _advanceFumble(play, '')
        return
      }
      if (at) gameState.field_pos = { ...at }
      _advanceDownDistance(play.net_yards ?? 0)
      return
    }

    if (passRes === 'intercepted') {
      const intTeam = gameState.possession === gameState.teams.home.name
        ? gameState.teams.away.name
        : gameState.teams.home.name

      const returnPos = play.return_at || play.intercepted_at
      const isTD = returnPos ? isTouchdown(gameState.teams, intTeam, returnPos) : false

      if (isTD) {
        _addPoints(intTeam, 6)
        gameState.possession = intTeam
        gameState.down       = 0
        gameState.distance   = 0
        if (returnPos) gameState.field_pos = { ...returnPos }
        return
      }

      if (play.return_result === 'safety') {
        _addPoints(play.possession, 2)
      }

      if (play.return_result === 'fumble') {
        gameState.possession = intTeam
        _advanceFumble(play, '')
        return
      }

      gameState.possession = intTeam
      if (play.return_at)           gameState.field_pos = { ...play.return_at }
      else if (play.intercepted_at) gameState.field_pos = { ...play.intercepted_at }
      gameState.down     = 1
      gameState.distance = 10
      return
    }

    if (passRes === 'complete') {
      if (touchdown) {
        gameState.down     = 0
        gameState.distance = 0
        if (at) gameState.field_pos = { ...at }
        _addPoints(play.possession, 6)
        return
      }
      if (result === 'safety') {
        const defTeam = play.possession === gameState.teams.home.name
          ? gameState.teams.away.name
          : gameState.teams.home.name
        _addPoints(defTeam, 2)
      }
      if (result === 'fumble') {
        _advanceFumble(play, '')
        return
      }
      if (at) gameState.field_pos = { ...at }
      _advanceDownDistance(play.net_yards ?? 0)
      return
    }

    return
  }

  if (touchdown) {
    gameState.down     = 0
    gameState.distance = 0
    if (at) gameState.field_pos = { ...at }
    _addPoints(play.possession, 6)
    return
  }

  if (result === 'fumble') {
    _advanceFumble(play, '')
    return
  }

  if (at) gameState.field_pos = { ...at }
  _advanceDownDistance(net_yards ?? 0)

  if (result === 'safety') {
    const defensiveTeam = play.possession === gameState.teams.home.name
      ? gameState.teams.away.name
      : gameState.teams.home.name
    _addPoints(defensiveTeam, 2)
  }

}

export function applyFlags(play) {
  _applyFlag(play, 1)
  _applyFlag(play, 2)
}

function _applyFlag(play, num) {
  const inf = play[`flag_${num}_infraction`]
  if (!inf) return

  const res = play[`flag_${num}_result`]
  if (res !== 'accepted') return

  const newLos  = play[`flag_${num}_new_los`]
  const downRes = play[`flag_${num}_down_result`]

  if (newLos) gameState.field_pos = { ...newLos }

  if (downRes === 'first_down') {
    gameState.down     = 1
    gameState.distance = 10
  } else if (downRes === 'loss_of_down') {
    if (gameState.down >= 4) {
      gameState.down     = 1
      gameState.distance = 10
    } else {
      gameState.down = gameState.down + 1
    }
  } else if (newLos) {
    // repeat_down
    const net = calcNetYards(
      gameState.teams,
      gameState.possession,
      play.field_pos,
      newLos
    )
    const newDist = gameState.distance - net
    gameState.distance = newDist > 0 ? newDist : 10
  }
}

function _addPoints(teamName, points) {
  if (teamName === gameState.teams.home.name) {
    gameState.score.home += points
  } else if (teamName === gameState.teams.away.name) {
    gameState.score.away += points
  }
}

function _advanceFumble(play, prefix) {
  const recoveryTeam   = play[`${prefix}fumble_recovery_team`]
  const recoveredAt    = play[`${prefix}fumble_recovered_at`]
  const fumbleResult   = play[`${prefix}fumble_result`]
  const fumbleAtResult = play[`${prefix}fumble_at_result`]

  const possessionChanged = recoveryTeam && recoveryTeam !== gameState.possession

  let isTD = false
  if (fumbleAtResult) {
    if (!possessionChanged) {
      isTD = isTouchdown(gameState.teams, gameState.possession, fumbleAtResult)
    } else {
      isTD = isTouchdown(gameState.teams, recoveryTeam, fumbleAtResult)
    }
  }

  if (possessionChanged) {
    gameState.possession = recoveryTeam
  }

  if (isTD) {
    gameState.down     = 0
    gameState.distance = 0
    if (fumbleAtResult) gameState.field_pos = { ...fumbleAtResult }
    if (possessionChanged) _addPoints(recoveryTeam, 6)
    return
  }

  if (fumbleResult === 'fumble') {
    _advanceFumble(play, 'fumble_2_')
    return
  }

  if (fumbleResult === 'safety') {
    const fumbleDefTeam = recoveryTeam === gameState.teams.home.name
      ? gameState.teams.away.name
      : gameState.teams.home.name
    _addPoints(fumbleDefTeam, 2)
    return
  }

  if (fumbleAtResult) {
    gameState.field_pos = { ...fumbleAtResult }
  } else if (recoveredAt) {
    gameState.field_pos = { ...recoveredAt }
  }

  if (possessionChanged) {
    gameState.down     = 1
    gameState.distance = 10
  } else {
    if (fumbleAtResult) {
      const net = calcNetYards(
        gameState.teams, gameState.possession,
        play.field_pos,
        fumbleAtResult
      )
      _advanceDownDistance(net)
    }
  }
}

function _advanceDownDistance(gained) {
  const newDistance = gameState.distance - gained
  if (newDistance <= 0) {
    gameState.down     = 1
    gameState.distance = 10
  } else if (gameState.down >= 4) {
    gameState.down     = 1
    gameState.distance = 10
  } else {
    gameState.down     = gameState.down + 1
    gameState.distance = newDistance
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

  switch (action) {
    case 'spot_ball':
      // data: { field_pos_team, field_pos_yard }
      gameState.field_pos = { team: data.field_pos_team, yard: data.field_pos_yard }
      break

    case 'set_clock':
      // data: { clock }
      gameState.clock = data.clock
      event.clock = data.clock
      break

    case 'set_quarter':
      // data: { quarter }
      gameState.quarter = data.quarter
      event.quarter = data.quarter
      break

    case 'set_down':
      // data: { down, distance }
      gameState.down = data.down
      gameState.distance = data.distance
      break

    case 'timeout':
      // data: { team, clock } — no muta gameState, solo registra
      break

    case 'start_drive':
      // data: { possession, field_pos_team, field_pos_yard, down, distance }
      gameState.possession = data.possession
      gameState.field_pos  = { team: data.field_pos_team, yard: data.field_pos_yard }
      gameState.down       = data.down
      gameState.distance   = data.distance
      break

    case 'set_score':
      // data: { home, away }
      gameState.score.home = data.home
      gameState.score.away = data.away
      break

    case 'set_possession':
      // data: { possession }
      gameState.possession = data.possession
      break

    case 'end_game':
      // No muta gameState, solo registra
      break
  }

  gameEvents.push(event)
  saveGameEvents()
  if (_onPlaySubmitted) _onPlaySubmitted()
}
