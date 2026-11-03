import { setPlayField, resetCurrentPlay, getRoster, submitPlayWithSnap, currentPlay, plays, savePlays, syncPlayUpdate, notifyPlaysChanged, RESULT_OPTIONS, RESULT_BRANCHES, FUMBLE_RESULT_BRANCHES, FUMBLE_2_RESULT_BRANCHES, PASS_RESULT_OPTIONS, PASS_RESULT_BRANCHES, RETURN_RESULT_BRANCHES, PENALTY_RESULT_OPTIONS, PENALTY_DOWN_RESULT_OPTIONS, PENALTY_RESULT_BRANCHES, PENALTIES_LIST, KICK_TYPE_OPTIONS, KICKOFF_RESULT_OPTIONS, FG_RESULT_OPTIONS, FG_MISS_OPTIONS, FG_RETURN_RESULT_OPTIONS, KICK_TYPE_BRANCHES, KICKOFF_RESULT_BRANCHES, FG_RESULT_BRANCHES, FG_BLOCKED_RETURN_BRANCHES, KICK_RETURN_RESULT_BRANCHES, FG_RET_RESULT_BRANCHES, PAT_TYPE_OPTIONS, PAT_KICK_RESULT_OPTIONS, PAT_BLOCK_RESULT_OPTIONS, PAT_TYPE_BRANCHES, PAT_KICK_RESULT_BRANCHES, PUNT_RESULT_OPTIONS, PUNT_RESULT_BRANCHES, PUNT_MUFF_RESULT_BRANCHES, PUNT_BLOCK_RETURN_BRANCHES, PUNT_RETURN_RESULT_BRANCHES, PUNT_BLOCK_RET_RESULT_BRANCHES, SNAP_FUMBLE_RECOVERY_BRANCHES, SNAP_FUMBLE_RESULT_BRANCHES, PUNT_BAD_SNAP_RECOVERY_BRANCHES, PUNT_BAD_SNAP_RESULT_BRANCHES, FG_BAD_SNAP_RECOVERY_BRANCHES, FG_BAD_SNAP_RESULT_BRANCHES, PAT_BAD_SNAP_RECOVERY_BRANCHES, PAT_BAD_SNAP_RESULT_BRANCHES, parseATInput, isTouchdown, calcNetYards, gameState, formatPlay, deriveNextPlayContext, applyGameCtrl, GAME_CTRL_OPTIONS, playerShortLabel } from './engine.js'
import { flagOutcome, flagEnforcement, playTouchdown } from '../../shared/stats-lib.js'

// ── Keyboard context system ───────────────────────────────────────────────────
// One listener, always active. Each screen replaces entries in KEYBOARD_CONTEXTS.

let activeContext = 'ADD_PLAY'
let _byKeyHandler      = null  // closure for BY digit handling (needs local state)
let _atKeyHandler      = null  // closure for AT input handling
let _penaltyKeyHandler = null  // closure for PENALTY_CODE input handling

const KEYBOARD_CONTEXTS = {
  ADD_PLAY:        {},
  BY:              {},
  RESULT:          {},
  AT:              {},
  TEAM:            {},
  PASS_RESULT:     {},
  PENALTY_CODE:    {},
  PENALTY_RESULT:  {},
  PENALTY_DOWN:    {},
  YES_NO:          {},
  SUBMIT:          {},
  PLACEHOLDER:     {},
  GAME_CTRL:       {},
  GAME_CTRL_FORM:  {},
  KICK_TYPE:       {},
  KICKOFF_RESULT:  {},
  FG_RESULT:       {},
  FG_MISS:         {},
  FG_RETURN:       {},
  NUMBER:          {},
  PAT_TYPE:         {},
  PAT_KICK_RESULT:  {},
  PAT_BLOCK_RESULT: {},
  PUNT_RESULT:      {},
  PUNT_BLOCK_RETURN: {},
  EDIT_SUMMARY:     {},
}

document.addEventListener('keydown', (e) => {
  // Escape fires even when an input is focused
  if (e.key === 'Escape') {
    const fn = KEYBOARD_CONTEXTS[activeContext]?.['Escape']
    if (fn) { e.preventDefault(); fn(); return }
  }

  // Enter also fires regardless of context (same pattern as Escape)
  if (e.key === 'Enter') {
    const fn = KEYBOARD_CONTEXTS[activeContext]?.['Enter']
    if (fn) { e.preventDefault(); fn(); return }
  }

  // BY context: digits/backspace/enter handled by closure (needs selections state)
  if (activeContext === 'BY' && _byKeyHandler) {
    _byKeyHandler(e)
    return
  }

  // AT context: all typing handled by closure
  if (activeContext === 'AT' && _atKeyHandler) {
    _atKeyHandler(e)
    return
  }

  // PENALTY_CODE context: all typing handled by closure
  if (activeContext === 'PENALTY_CODE' && _penaltyKeyHandler) {
    _penaltyKeyHandler(e)
    return
  }

  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

  const key = e.key.toLowerCase()
  const fn = KEYBOARD_CONTEXTS[activeContext]?.[key]
  if (fn) { e.preventDefault(); fn() }
})

function _setContext(ctx) {
  activeContext = ctx
  if (ctx !== 'BY')           _byKeyHandler      = null
  if (ctx !== 'AT')           _atKeyHandler      = null
  if (ctx !== 'PENALTY_CODE') _penaltyKeyHandler = null
}

// ── Button / step definitions ─────────────────────────────────────────────────

const BUTTONS = [
  { label: 'Rush',      key: 'R', type: 'RUSH',      disabled: false },
  { label: 'Pass',      key: 'P', type: 'PASS',      disabled: false },
  { label: 'Penalty',   key: 'E', type: 'PENALTY',   disabled: false },
  { label: 'Punt',      key: 'U', type: 'PUNT',      disabled: false },
  { label: 'Kick',      key: 'K', type: 'KICK',      disabled: false },
  { label: 'PAT Try',   key: 'A', type: 'PAT_TRY',   disabled: false },
  { label: 'Comment',   key: 'C', type: 'COMMENT',   disabled: true  },
  { label: 'Snap Fumble', key: 'S', type: 'SNAP_FUMBLE', disabled: false },
  { label: 'Game CTRL', key: 'G', type: 'GAME_CTRL', disabled: false },
]

const STEPS_BY_TYPE = {
  RUSH: [
    { id: 'play_type', label: 'Rush' },
    { id: 'rush_by',   label: 'Rush By', component: 'BY',
      config: { stateKey: 'rush_by', multiple: false, optional: false } },
    { id: 'result',    label: 'Result',  component: 'RESULT',
      config: { stateKey: 'result', optionsKey: 'RUSH' } },
  ],
  PASS: [
    { id: 'play_type',   label: 'Pass' },
    { id: 'pass_by',     label: 'Passed By', component: 'BY',
      config: { stateKey: 'pass_by', multiple: false, optional: false } },
    { id: 'pass_result', label: 'Result', component: 'PASS_RESULT',
      config: { stateKey: 'pass_result' } },
  ],
  PENALTY: [
    { id: 'play_type',          label: 'Penalty' },
    { id: 'penalty_infraction', label: 'Infraction', component: 'PENALTY_CODE',
      config: { stateKey: 'penalty_infraction' } },
    { id: 'penalty_team',       label: 'Team',       component: 'TEAM',
      config: { stateKey: 'penalty_team' } },
    { id: 'penalty_result',     label: 'Result',     component: 'PENALTY_RESULT',
      config: { stateKey: 'penalty_result' } },
  ],
  KICK: [
    { id: 'play_type', label: 'Kick' },
    { id: 'kick_type', label: 'Kick Type', component: 'KICK_TYPE',
      config: { stateKey: 'kick_type' } },
  ],
  PAT_TRY: [
    { id: 'play_type', label: 'PAT Try' },
    { id: 'pat_type',  label: 'PAT Type', component: 'PAT_TYPE',
      config: { stateKey: 'pat_type' } },
  ],
  PUNT: [
    { id: 'play_type',   label: 'Punt' },
    { id: 'punted_by',   label: 'Punted By', component: 'BY',
      config: { stateKey: 'punted_by', multiple: false, optional: false } },
    { id: 'punt_result', label: 'Punt Result', component: 'PUNT_RESULT',
      config: { stateKey: 'punt_result' } },
  ],
  // Bad center snap, before the play develops. snap_fumble_recovery_team's
  // branch (own offense vs opponent) is resolved dynamically in
  // resolveBranchSteps() by comparing the chosen team against the play's
  // actual possession, not by a fixed lookup here.
  SNAP_FUMBLE: [
    { id: 'play_type', label: 'Fumble de Snap' },
    { id: 'snap_fumble_at', label: 'Fumble AT', component: 'AT',
      config: { stateKey: 'snap_fumble_at' } },
    { id: 'snap_fumble_recovery_team', label: 'Recovery Team', component: 'TEAM',
      config: { stateKey: 'snap_fumble_recovery_team' } },
  ],
}

// ── Wizard state ──────────────────────────────────────────────────────────────

let steps = []
let currentStepIdx = 0

let _flagSteps   = []
let _flagStepIdx = 0
let _flagNumber  = 1
let _flagMode    = false
let _previewPlay = null

// ── Edit-mode state ───────────────────────────────────────────────────────────
// Separate from currentPlay/steps on purpose: editing an old play must never
// touch the in-progress new-play capture buffer.

let editMode      = false
let editingPlayId = null
let editingPlay   = null   // buffer of play_type-specific fields being edited
let editContext   = null   // buffer of clock/quarter/down/distance/field_pos/possession
let editOriginal  = null   // the play as stored, to tell whether anything was edited
let editDirty     = false  // some step value changed (see _onEditStepComplete)
let editSteps     = []
let editCursor    = -1

const RESULT_STEP_IDS = [
  'result', 'fumble_result', 'fumble_2_result',
  'pass_result', 'return_result', 'penalty_result',
  'kick_type', 'kickoff_result', 'fg_result',
  'fg_return_result', 'kick_return_result', 'fg_ret_result',
  'pat_type', 'pat_kick_result', 'pat_block_result',
  'punt_result', 'punt_return_result', 'punt_block_return_result', 'punt_block_ret_result',
  'fake_punt_type', 'punt_muff_result',
  'snap_fumble_recovery_team', 'snap_fumble_type', 'snap_fumble_result',
  'punt_bad_snap_recovery_team', 'punt_bad_snap_type', 'punt_bad_snap_result',
  'fg_bad_snap_recovery_team', 'fg_bad_snap_type', 'fg_bad_snap_result',
  'pat_bad_snap_recovery_team', 'pat_bad_snap_type', 'pat_bad_snap_result',
]

// A fake punt is captured with the exact same step trees as a real RUSH/PASS
// play (rush_by/result, pass_by/pass_result) — sliced straight from
// STEPS_BY_TYPE so there is no second copy of that tree to drift out of
// sync. _onStepComplete retargets play_type to RUSH/PASS (and sets
// fake_punt:true) the moment 'fake_punt_type' resolves, so every downstream
// consumer (advanceGameState, stat aggregation, formatPlay) sees a genuine
// RUSH/PASS play.
const FAKE_PUNT_TYPE_BRANCHES = {
  run:  STEPS_BY_TYPE.RUSH.slice(1),
  pass: STEPS_BY_TYPE.PASS.slice(1),
}

// Bad snap to the punter, own snapper/punter recovers, but still gets the
// kick away despite the botched exchange. Unlike 'run'/'pass' (which reuse
// FAKE_PUNT_TYPE_BRANCHES's retarget-to-RUSH/PASS mechanism), 'kick' never
// retargets play_type — it's already 'PUNT' — it just re-enters the normal
// punt_result step fresh (STEPS_BY_TYPE.PUNT's tail after punted_by).
const PUNT_BAD_SNAP_TYPE_BRANCHES = {
  ...FAKE_PUNT_TYPE_BRANCHES,
  kick: STEPS_BY_TYPE.PUNT.slice(2),
}

// Resolves the extra steps that follow a RESULT_STEP_IDS step, given the
// chosen value. Shared by normal capture (_onStepComplete) and edit mode
// (_onEditStepComplete) so the branch rules can never drift between the two.
// `possession` is only used by the various *_recovery_team steps' own/
// opponent split (snap_fumble_recovery_team, punt_bad_snap_recovery_team,
// fg_bad_snap_recovery_team, pat_bad_snap_recovery_team) — it must be the
// possession AT THE TIME OF THAT PLAY, not whatever gameState.possession
// happens to be right now (which, in edit mode, is almost always a later,
// unrelated point in the game). Every call site below passes the correct
// value for its own context.
function resolveBranchSteps(stepId, value, playType, possession) {
  if (stepId === 'result')                    return RESULT_BRANCHES[playType]?.[value] ?? []
  if (stepId === 'fumble_result')             return FUMBLE_RESULT_BRANCHES[value] ?? []
  if (stepId === 'fumble_2_result')           return FUMBLE_2_RESULT_BRANCHES[value] ?? []
  if (stepId === 'pass_result')               return PASS_RESULT_BRANCHES[value] ?? []
  if (stepId === 'return_result')             return RETURN_RESULT_BRANCHES[value] ?? []
  if (stepId === 'penalty_result')            return PENALTY_RESULT_BRANCHES[value] ?? []
  if (stepId === 'kick_type')                 return KICK_TYPE_BRANCHES[value] ?? []
  if (stepId === 'kickoff_result')            return KICKOFF_RESULT_BRANCHES[value] ?? []
  if (stepId === 'fg_result')                 return FG_RESULT_BRANCHES[value] ?? []
  if (stepId === 'fg_return_result')          return FG_BLOCKED_RETURN_BRANCHES[value] ?? []
  if (stepId === 'kick_return_result')        return KICK_RETURN_RESULT_BRANCHES[value] ?? []
  if (stepId === 'fg_ret_result')             return FG_RET_RESULT_BRANCHES[value] ?? []
  if (stepId === 'pat_type')                  return PAT_TYPE_BRANCHES[value] ?? []
  if (stepId === 'pat_kick_result')           return PAT_KICK_RESULT_BRANCHES[value] ?? []
  if (stepId === 'pat_block_result')          return []
  if (stepId === 'punt_result')               return PUNT_RESULT_BRANCHES[value] ?? []
  if (stepId === 'punt_return_result')        return PUNT_RETURN_RESULT_BRANCHES[value] ?? []
  if (stepId === 'punt_block_return_result')  return PUNT_BLOCK_RETURN_BRANCHES[value] ?? []
  if (stepId === 'punt_block_ret_result')     return PUNT_BLOCK_RET_RESULT_BRANCHES[value] ?? []
  if (stepId === 'fake_punt_type')            return FAKE_PUNT_TYPE_BRANCHES[value] ?? []
  if (stepId === 'punt_muff_result')          return PUNT_MUFF_RESULT_BRANCHES[value] ?? []
  if (stepId === 'snap_fumble_recovery_team') {
    return value === possession
      ? SNAP_FUMBLE_RECOVERY_BRANCHES.own
      : SNAP_FUMBLE_RECOVERY_BRANCHES.opponent
  }
  if (stepId === 'snap_fumble_type')          return FAKE_PUNT_TYPE_BRANCHES[value] ?? []
  if (stepId === 'snap_fumble_result')        return SNAP_FUMBLE_RESULT_BRANCHES[value] ?? []
  if (stepId === 'punt_bad_snap_recovery_team') {
    return value === possession
      ? PUNT_BAD_SNAP_RECOVERY_BRANCHES.own
      : PUNT_BAD_SNAP_RECOVERY_BRANCHES.opponent
  }
  if (stepId === 'punt_bad_snap_type')        return PUNT_BAD_SNAP_TYPE_BRANCHES[value] ?? []
  if (stepId === 'punt_bad_snap_result')      return PUNT_BAD_SNAP_RESULT_BRANCHES[value] ?? []
  if (stepId === 'fg_bad_snap_recovery_team') {
    return value === possession
      ? FG_BAD_SNAP_RECOVERY_BRANCHES.own
      : FG_BAD_SNAP_RECOVERY_BRANCHES.opponent
  }
  if (stepId === 'fg_bad_snap_type')          return FAKE_PUNT_TYPE_BRANCHES[value] ?? []
  if (stepId === 'fg_bad_snap_result')        return FG_BAD_SNAP_RESULT_BRANCHES[value] ?? []
  if (stepId === 'pat_bad_snap_recovery_team') {
    return value === possession
      ? PAT_BAD_SNAP_RECOVERY_BRANCHES.own
      : PAT_BAD_SNAP_RECOVERY_BRANCHES.opponent
  }
  if (stepId === 'pat_bad_snap_type')         return FAKE_PUNT_TYPE_BRANCHES[value] ?? []
  if (stepId === 'pat_bad_snap_result')       return PAT_BAD_SNAP_RESULT_BRANCHES[value] ?? []
  return []
}

// ── Public API ────────────────────────────────────────────────────────────────

export function renderAddPlay() {
  steps = []
  currentStepIdx = 0
  resetCurrentPlay()
  deriveNextPlayContext()
  _setContext('ADD_PLAY')

  KEYBOARD_CONTEXTS.ADD_PLAY = {
    r: () => _onPlayTypeSelected('RUSH'),
    p: () => _onPlayTypeSelected('PASS'),
    e: () => _onPlayTypeSelected('PENALTY'),
    u: () => _onPlayTypeSelected('PUNT'),
    k: () => _onPlayTypeSelected('KICK'),
    a: () => _onPlayTypeSelected('PAT_TRY'),
    s: () => _onPlayTypeSelected('SNAP_FUMBLE'),
    g: () => _onPlayTypeSelected('GAME_CTRL'),
  }

  _renderProgress()
  _renderPlayGrid()

  // Fired here — not inside submitPlayWithSnap — because gameState.down/
  // distance/field_pos/possession are only correct as of the
  // deriveNextPlayContext() call above. Firing earlier (inside
  // submitPlayWithSnap) painted the HUD with the pre-derive state.
  notifyPlaysChanged()
}

// ── Edit mode ─────────────────────────────────────────────────────────────────
// Reuses the same STEPS_BY_TYPE / *_BRANCHES trees and step widgets as normal
// capture, but walks them with values already known (from the stored play)
// instead of waiting for clicks, and writes into editingPlay/editContext
// instead of currentPlay/gameState. Saving overwrites the existing play
// in-place (same play_id/seq) — no cascade recalculation of other plays.

// Rebuilds the full step list for a play_type using values already stored on
// `play`, expanding branches with resolveBranchSteps exactly like the live
// capture flow would have — just replayed with known answers.
function _buildEditSteps(play) {
  const playType = play.play_type
  const base = STEPS_BY_TYPE[playType]
  if (!base) return []

  const result = [{ ...base[0], value: playType }]
  let queue = base.slice(1).map(s => ({ ...s }))

  while (queue.length) {
    const step = queue.shift()
    const value = play[step.id] ?? null
    result.push({ ...step, value })
    if (RESULT_STEP_IDS.includes(step.id) && value != null) {
      const branchSteps = resolveBranchSteps(step.id, value, playType, play.possession)
      queue = [...branchSteps.map(s => ({ ...s })), ...queue]
    }
  }
  return result
}

// Opens the edit wizard for an existing play. play_type is fixed — not
// editable here. Returns false (and blocks) if a new-play capture is
// mid-flight, since editingPlay/editContext must never share state with
// currentPlay/gameState.
export function renderEditPlay(play) {
  if (steps.length > 0) {
    alert('Termina o cancela la jugada actual antes de editar una jugada anterior.')
    return false
  }

  editMode      = true
  editingPlayId = play.play_id
  editingPlay   = { ...play }
  editOriginal  = play
  editDirty     = false
  editContext   = {
    clock:      play.clock,
    quarter:    play.quarter,
    down:       play.down,
    distance:   play.distance,
    field_pos:  play.field_pos ? { ...play.field_pos } : null,
    possession: play.possession,
  }
  editSteps  = [..._buildEditSteps(play), ..._buildFlagEditSteps(play)]
  editCursor = -1

  const progressEl = document.getElementById('step-progress')
  if (progressEl) progressEl.innerHTML = ''

  _renderEditSummary()
  return true
}

function _openEditStep(idx) {
  editCursor = idx
  _renderStepByComponent(editSteps[idx], (val) => _onEditStepComplete(idx, val))
}

function _onEditStepComplete(idx, value) {
  if (JSON.stringify(editSteps[idx].value ?? null) !== JSON.stringify(value ?? null)) editDirty = true
  editSteps[idx] = { ...editSteps[idx], value }
  editingPlay[editSteps[idx].id] = value

  const stepId = editSteps[idx].id
  if (/^flag_[12]_/.test(stepId)) { _onEditFlagStep(idx); return }
  if (RESULT_STEP_IDS.includes(stepId)) {
    const playType  = editingPlay.play_type
    const newBranch = resolveBranchSteps(stepId, value, playType, editingPlay.possession)
    const oldSuffix = editSteps.slice(idx + 1)
    const sameShape = oldSuffix.length === newBranch.length &&
      oldSuffix.every((s, i) => s.id === newBranch[i].id)

    if (!sameShape) {
      // The chosen value leads down a different branch than before — the old
      // suffix no longer applies, so replace it and collect fresh values for
      // the new branch. Siblings before this step are left untouched.
      editSteps = editSteps.slice(0, idx + 1).concat(newBranch.map(s => ({ ...s, value: null })))
      const nextIdx = idx + 1
      if (nextIdx < editSteps.length) {
        _openEditStep(nextIdx)
        return
      }
    }
  }

  editCursor = -1
  _renderEditSummary()
}

// A play's flags in edit mode: the same steps live capture asks, with the
// stored values. A play captured before flag_N_enforced shows the value
// stats-lib.js maps it to (mappedValue, display only): nothing is written
// unless the operator picks one.
function _buildFlagEditSteps(play) {
  return [1, 2].filter(n => play[`flag_${n}_infraction`]).flatMap(n => _flagEditBlock(play, n))
}

function _flagEditBlock(play, num) {
  const prefix = `flag_${num}_`
  const withValue = st => ({ ...st, value: play[st.id] ?? null })
  const block = _buildFlagSteps(num).map(withValue)
  const result = play[`${prefix}result`]
  block.push(...(PENALTY_RESULT_BRANCHES[result] ?? []).map(st => withValue({
    ...st,
    id: st.id.replace(/^penalty_/, prefix),
    config: { ...st.config, stateKey: st.config.stateKey?.replace(/^penalty_/, prefix) },
  })))
  if (result !== 'accepted') return block
  const enf = withValue(_flagEnforcementStep(num, play, false))
  if (enf.id === `${prefix}enforced` && !enf.value) {
    // Mapped only while the flag is still the one that was stored.
    const o = editOriginal
    const same = o && o[`${prefix}result`] === 'accepted' &&
      o[`${prefix}infraction`]?.code === play[`${prefix}infraction`]?.code && o[`${prefix}team`] === play[`${prefix}team`]
    if (same) enf.mappedValue = flagEnforcement(o, num)
  }
  block.push(enf)
  if (play[`${prefix}enforced`] === 'foul_spot') block.push(withValue(_flagFoulSpotStep(num)))
  return block
}

// A flag step was edited: rebuild that flag's steps from editingPlay, drop
// the fields that no longer apply (so no orphans reach the row), and ask the
// next required step that has no value yet.
function _onEditFlagStep(idx) {
  const stepId = editSteps[idx].id
  const num = Number(stepId[5])
  const prefix = `flag_${num}_`
  if (stepId === `${prefix}enforced`) editingPlay[`${prefix}timing`] = editingPlay[stepId] === 'previous' ? 'live' : 'dead'

  const block = _flagEditBlock(editingPlay, num)
  const ids = new Set(block.map(st => st.id))
  if (ids.has(`${prefix}enforced`)) ids.add(`${prefix}timing`)
  Object.keys(editingPlay).filter(k => k.startsWith(prefix) && !ids.has(k)).forEach(k => delete editingPlay[k])

  const start = editSteps.findIndex(st => st.id.startsWith(prefix))
  let end = start
  while (end < editSteps.length && editSteps[end].id.startsWith(prefix)) end++
  editSteps = [...editSteps.slice(0, start), ...block, ...editSteps.slice(end)]

  const pos = block.findIndex(st => st.id === stepId)
  const next = block.findIndex((st, i) => i > pos && st.value == null && !st.mappedValue && !st.config?.optional)
  if (next >= 0) { _openEditStep(start + next); return }
  editCursor = -1
  _renderEditSummary()
}

function _renderEditSummary() {
  _setContext('EDIT_SUMMARY')
  KEYBOARD_CONTEXTS.EDIT_SUMMARY = { Escape: () => _cancelEdit(), Enter: () => _saveEdit() }

  const quarters = ['Q1', 'Q2', 'Q3', 'Q4', 'OT']
  const qOpts = quarters.map(q => {
    const val = q === 'OT' ? 'OT' : parseInt(q[1])
    return `<option value="${val}" ${editContext.quarter === val ? 'selected' : ''}>${q}</option>`
  }).join('')
  const teamOpts = [gameState.teams.home.name, gameState.teams.away.name]
    .map(t => `<option value="${t}" ${editContext.possession === t ? 'selected' : ''}>${t}</option>`)
    .join('')
  const fpStr = editContext.field_pos ? `${editContext.field_pos.team} ${editContext.field_pos.yard}` : ''

  const stepRows = editSteps.slice(1).map((step, i) => {
    const idx = i + 1
    return `<button class="edit-step-row" data-idx="${idx}">
      <span class="edit-step-row__label">${step.label}</span>
      <span class="edit-step-row__value">${_stepValueLabel(step)}</span>
    </button>`
  }).join('')

  _container().innerHTML = `
    <div class="submit-screen edit-summary">
      <div class="wizard-area__title">Editar Jugada #${editingPlay.seq} — ${editingPlay.play_type}</div>

      <div class="edit-panel__title">Contexto</div>
      <div class="edit-summary__context">
        <div class="edit-field"><label>Clock</label>
          <input class="edit-input" id="es-clock" value="${editContext.clock || ''}"></div>
        <div class="edit-field"><label>Quarter</label>
          <select class="edit-input" id="es-quarter">${qOpts}</select></div>
        <div class="edit-field"><label>Field Pos</label>
          <input class="edit-input" id="es-fp" value="${fpStr}"></div>
        <div class="edit-field"><label>Possession</label>
          <select class="edit-input" id="es-poss">${teamOpts}</select></div>
        <div class="edit-field"><label>Down</label>
          <input class="edit-input" type="number" id="es-down" min="0" max="4" value="${editContext.down ?? ''}"></div>
        <div class="edit-field"><label>Distance</label>
          <input class="edit-input" type="number" id="es-dist" min="0" max="99" value="${editContext.distance ?? ''}"></div>
      </div>

      <div class="edit-panel__title">Jugada</div>
      <div class="edit-summary__steps">${stepRows}</div>

      <div class="submit-actions">
        <button class="submit-btn submit-btn--confirm" id="edit-save">Guardar <span class="submit-kbd">↵</span></button>
        <button class="submit-btn submit-btn--cancel" id="edit-cancel">Cancelar <span class="submit-kbd">Esc</span></button>
      </div>
    </div>
  `

  _container().querySelectorAll('.edit-step-row').forEach(btn => {
    btn.addEventListener('click', () => _openEditStep(parseInt(btn.dataset.idx, 10)))
  })
  document.getElementById('edit-save').addEventListener('click', _saveEdit)
  document.getElementById('edit-cancel').addEventListener('click', _cancelEdit)
}

function _saveEdit() {
  const fpRaw  = document.getElementById('es-fp').value.trim().split(/\s+/)
  const fpTeam = fpRaw[0] || editContext.field_pos?.team
  const fpYard = parseInt(fpRaw[1])
  const qRaw   = document.getElementById('es-quarter').value

  editContext.clock      = document.getElementById('es-clock').value
  editContext.quarter    = isNaN(parseInt(qRaw)) ? qRaw : parseInt(qRaw)
  editContext.field_pos  = { team: fpTeam, yard: isNaN(fpYard) ? editContext.field_pos?.yard : fpYard }
  editContext.possession = document.getElementById('es-poss').value
  editContext.down       = parseInt(document.getElementById('es-down').value) || 0
  editContext.distance   = parseInt(document.getElementById('es-dist').value) || 0

  // A play with flags saved with nothing edited is left exactly as stored
  // (an old row is not rewritten with recomputed values).
  const o = editOriginal
  const hasFlags = [1, 2].some(n => o[`flag_${n}_infraction`])
  const contextChanged =
    String(editContext.clock ?? '') !== String(o.clock ?? '') ||
    String(editContext.quarter) !== String(o.quarter) ||
    editContext.possession !== o.possession ||
    editContext.down !== (o.down ?? 0) || editContext.distance !== (o.distance ?? 0) ||
    editContext.field_pos?.team !== o.field_pos?.team || editContext.field_pos?.yard !== o.field_pos?.yard
  if (hasFlags && !editDirty && !contextChanged) {
    _exitEditMode()
    renderAddPlay()
    return
  }

  if (editingPlay.at) {
    editingPlay.net_yards = calcNetYards(gameState.teams, editContext.possession, editContext.field_pos, editingPlay.at)
    editingPlay.touchdown = isTouchdown(gameState.teams, editContext.possession, editingPlay.at)
  }
  // Same rule as a new submit (_confirmSubmit): flagOutcome() decides.
  const outcome = flagOutcome({ ...editingPlay, ...editContext })
  if (outcome) {
    editingPlay.net_yards = outcome.net_yards
    editingPlay.touchdown = outcome.touchdown
    if (outcome.voided) editingPlay.stats_count = false
    else delete editingPlay.stats_count
  } else if (hasFlags) {
    // No accepted flag left (e.g. changed to declined): nothing voids it.
    delete editingPlay.stats_count
  }

  const target = plays.find(p => p.play_id === editingPlayId)
  if (target) {
    Object.assign(target, editingPlay, editContext)
    // Fields dropped while editing a flag (see _onEditFlagStep).
    Object.keys(target).filter(k => !(k in editingPlay) && !(k in editContext)).forEach(k => delete target[k])
    savePlays()
    syncPlayUpdate(target)
    // notifyPlaysChanged() is not called here — renderAddPlay() below fires
    // it after deriveNextPlayContext() has re-derived gameState from the
    // (possibly just-edited) last play, same as after a normal submit.
  }

  _exitEditMode()
  renderAddPlay()
}

function _cancelEdit() {
  _exitEditMode()
  renderAddPlay()
}

function _exitEditMode() {
  editMode      = false
  editingPlayId = null
  editingPlay   = null
  editContext   = null
  editOriginal  = null
  editDirty     = false
  editSteps     = []
  editCursor    = -1
}

export function renderByMenu(config) {
  const { optional, multiple, onComplete, team, teamFrom, invertTeamFrom } = config
  _setContext('BY')
  KEYBOARD_CONTEXTS.BY = { Escape: goBack }

  // team: 'opponent' — used by return steps (kick/punt/INT return) where the
  // player is always on the team that did NOT have possession when the play
  // started (possession isn't flipped to the receiving team until after
  // submit, so it can't be read directly off gameState here).
  // teamFrom: '<stateKey>' — used by blocked-kick return steps, where the
  // returning team was already chosen earlier in the same flow (e.g.
  // fg_recovery_team/punt_recovery_team) and can go to either side, so it
  // can't be inferred as a fixed opponent.
  // invertTeamFrom: true — used by tackle steps that follow a variable
  // recovery (e.g. fumble_tackle_by after fumble_recovery_team): the tackler
  // is always the side OPPOSITE whoever recovered, not the recovery team itself.
  let teamName
  if (team === 'opponent') {
    teamName = gameState.possession === gameState.teams.home.name
      ? gameState.teams.away.name
      : gameState.teams.home.name
  } else if (teamFrom) {
    const fromTeam = currentPlay[teamFrom]
    teamName = invertTeamFrom
      ? (fromTeam === gameState.teams.home.name ? gameState.teams.away.name : gameState.teams.home.name)
      : fromTeam
  }

  const roster = getRoster(teamName)
  let selections = []
  let typedDigits = ''
  let notice = ''
  const container = _container()

  // Numbers can repeat within a team (league rule). A repeated number is shown
  // with the player's name in the grid; a player with no name gets "#N (sin nombre)".
  const numCount = {}
  roster.forEach(p => { numCount[p.number] = (numCount[p.number] || 0) + 1 })
  const _titleOf = p => [p.nombre, p.apellido].filter(Boolean).join(' ').trim() || `#${p.number} (sin nombre)`
  // Same player in a selection: by roster identity (number + names), not number alone.
  const _sameAsRoster = (sel, p) => sel.number === p.number && (sel.nombre || '') === (p.nombre || '') && (sel.apellido || '') === (p.apellido || '')

  function rebuild() {
    const pillsHTML = selections.map((p, i) => `
      <span class="player-pill">
        ${playerShortLabel(p)}${p.position ? ' · ' + p.position : ''}
        <button class="player-pill__remove" data-idx="${i}">×</button>
      </span>
    `).join('')

    const playerBtns = roster.map((p, ri) => {
      const isSelected = selections.some(s => _sameAsRoster(s, p))
      const hasInfo = p.nombre || p.apellido || p.position
      const dup = numCount[p.number] > 1
      return `<button class="player-btn${isSelected ? ' player-btn--selected' : ''}" data-number="${p.number}" data-ridx="${ri}">
        <span class="player-btn__num">${p.number}</span>
        ${dup ? `<span class="player-btn__name">${_titleOf(p)}</span>` : ''}
        ${hasInfo ? `<span class="player-btn__pos">${p.position || ''}</span>` : ''}
      </button>`
    }).join('')

    const hint = notice
      ? `<div class="by-hint">${notice}</div>`
      : (multiple && selections.length === 1 ? '<div class="by-hint">Agregar 2do jugador (opcional)</div>' : '')
    const showContinue = multiple && selections.length >= 1

    container.innerHTML = `
      <div class="by-menu">
        <div class="by-input-row">
          <input id="by-input" class="by-input" type="text" inputmode="numeric"
            placeholder="Escribe # y Enter" autocomplete="off" value="${typedDigits}">
          ${optional ? '<button class="btn-skip" id="btn-skip">Omitir →</button>' : ''}
        </div>
        ${pillsHTML ? `<div class="by-pills">${pillsHTML}</div>` : ''}
        ${hint}
        <div class="by-grid" id="by-grid">${playerBtns}</div>
        ${showContinue ? '<button class="btn-continue" id="btn-continue">Continuar →</button>' : ''}
      </div>
    `

    const input = document.getElementById('by-input')
    input.focus()
    if (typedDigits) _highlightNum(parseInt(typedDigits, 10))

    container.querySelectorAll('.player-btn').forEach(btn => {
      btn.addEventListener('click', () => _selectPlayer(roster[parseInt(btn.dataset.ridx, 10)]))
    })
    container.querySelectorAll('.player-pill__remove').forEach(btn => {
      btn.addEventListener('click', () => {
        selections.splice(parseInt(btn.dataset.idx, 10), 1)
        typedDigits = ''
        rebuild()
      })
    })
    const skipBtn = document.getElementById('btn-skip')
    if (skipBtn) skipBtn.addEventListener('click', () => onComplete(null))
    const continueBtn = document.getElementById('btn-continue')
    if (continueBtn) continueBtn.addEventListener('click', () => {
      onComplete(multiple ? selections : selections[0])
    })
  }

  function _highlightNum(num) {
    container.querySelectorAll('.player-btn--highlighted').forEach(b =>
      b.classList.remove('player-btn--highlighted'))
    const btn = container.querySelector(`.player-btn[data-number="${num}"]`)
    if (btn) {
      btn.classList.add('player-btn--highlighted')
      btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }

  // rosterPlayer: the roster row the operator chose (click, or a typed number that
  // maps to exactly one player). num: only for a number that is not on the roster.
  function _selectPlayer(rosterPlayer, num = null) {
    // Only number/nombre/apellido/position get persisted onto the play — not
    // the players-table id/team_id/created_at, which have no meaning once
    // baked into a play's play_data.
    // player_id (B2) pins the reference to its roster row; refs without it
    // (older plays, or a number not on the roster) still resolve by number.
    const player = rosterPlayer
      ? { ...(rosterPlayer.id ? { player_id: rosterPlayer.id } : {}), number: rosterPlayer.number, nombre: rosterPlayer.nombre || '', apellido: rosterPlayer.apellido || '', position: rosterPlayer.position || '' }
      : { number: num, nombre: '', apellido: '', position: '' }
    if (!multiple) { onComplete(player); return }
    if (selections.length >= 2 || selections.some(s => (rosterPlayer ? _sameAsRoster(s, rosterPlayer) : s.number === num))) return
    selections.push(player)
    typedDigits = ''
    notice = ''
    rebuild()
    if (selections.length >= 2) onComplete(multiple ? selections : selections[0])
  }

  function _confirmTyped() {
    if (!typedDigits) return
    const num = parseInt(typedDigits, 10)
    typedDigits = ''
    const matches = roster.filter(p => p.number === num)
    if (matches.length > 1) {
      // Several players wear this number: the operator picks one from the grid.
      notice = `Hay ${matches.length} jugadores con #${num}: elige uno de la lista.`
      rebuild()
      _highlightNum(num)
      return
    }
    _selectPlayer(matches[0] || null, num)
  }

  // Digit/backspace/enter — closure because it needs selections + typedDigits
  _byKeyHandler = (e) => {
    const input = document.getElementById('by-input')
    if (!input) return
    if (e.key >= '0' && e.key <= '9') {
      e.preventDefault()
      typedDigits = (typedDigits + e.key).slice(0, 2)
      input.value = typedDigits
      input.focus()
      _highlightNum(parseInt(typedDigits, 10))
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      typedDigits = typedDigits.slice(0, -1)
      input.value = typedDigits
      if (typedDigits) {
        _highlightNum(parseInt(typedDigits, 10))
      } else {
        container.querySelectorAll('.player-btn--highlighted').forEach(b =>
          b.classList.remove('player-btn--highlighted'))
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (typedDigits) {
        _confirmTyped()
      } else if (selections.length >= 1) {
        // Enter with no digits typed = confirm current selections and advance
        onComplete(multiple ? selections : selections[0])
      } else if (optional) {
        // Enter with nothing typed and nothing selected on an optional field = skip it
        onComplete(null)
      }
    }
    // Escape is caught by the global listener before _byKeyHandler is called
  }

  rebuild()
}

export function renderATField(config) {
  const { onComplete, snapPos: snapPosOverride, possession: possessionOverride } = config
  _setContext('AT')
  KEYBOARD_CONTEXTS.AT = { Escape: goBack }

  const teams      = gameState.teams
  const snapPos    = snapPosOverride    || gameState.field_pos   // where the play started
  const possession = possessionOverride || gameState.possession
  const container = _container()
  let rawInput = ''

  function _parse(raw) {
    return parseATInput(raw, teams)
  }

  function _netYardsLabel(pos) {
    if (!pos) return ''
    const net = calcNetYards(teams, possession, snapPos, pos)
    if (net === 0) return 'Sin ganancia'
    return net > 0 ? `+${net} yds` : `${net} yds`
  }

  function rebuild() {
    const parsed   = _parse(rawInput)
    const td       = parsed ? isTouchdown(teams, possession, parsed) : false
    const netLabel = parsed && !td ? _netYardsLabel(parsed) : ''
    const posLabel = parsed ? `${parsed.team} ${parsed.yard}` : ''

    const feedbackHTML = rawInput
      ? td
        ? `<div class="at-feedback at-feedback--td">🏈 TOUCHDOWN</div>`
        : parsed
          ? `<div class="at-feedback at-feedback--valid">${posLabel} · <span class="at-net">${netLabel}</span></div>`
          : `<div class="at-feedback at-feedback--invalid">Posición inválida</div>`
      : `<div class="at-feedback at-feedback--hint">
            Escribe posición: <code>${teams.home.abreviatura}40</code> · <code>${teams.away.abreviatura}30</code> · o solo <code>40</code> para campo local
          </div>`

    const hintLine = `
      <div class="at-team-hint">
        <span class="at-team-chip">${teams.home.abreviatura} = ${teams.home.name}</span>
        <span class="at-team-chip">${teams.away.abreviatura} = ${teams.away.name}</span>
        <span class="at-snap-chip">Snap: ${snapPos.team} ${snapPos.yard}</span>
      </div>`

    container.innerHTML = `
      <div class="at-field">
        ${hintLine}
        <div class="at-input-row">
          <input id="at-input" class="at-input${td ? ' at-input--td' : ''}" type="text"
            inputmode="text" autocomplete="off"
            placeholder="${teams.home.abreviatura}40 · ${teams.away.abreviatura}30 · 40"
            value="${rawInput}" spellcheck="false">
        </div>
        ${feedbackHTML}
      </div>
    `

    const input = document.getElementById('at-input')
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }

  _atKeyHandler = (e) => {
    const input = document.getElementById('at-input')
    if (!input) return

    if (e.key === 'Enter') {
      e.preventDefault()
      const parsed = _parse(rawInput)
      if (!parsed) return
      onComplete(parsed)
      return
    }

    // Let the browser handle typing naturally in the input, then sync rawInput
    // We only intercept Enter above; everything else falls through to the input element.
    // But since the AT context catches all events before the INPUT guard, we need to
    // manually forward printable chars and Backspace.
    if (e.key === 'Backspace') {
      e.preventDefault()
      rawInput = rawInput.slice(0, -1)
      rebuild()
      return
    }

    if (e.key.length === 1) {
      e.preventDefault()
      rawInput = (rawInput + e.key).slice(0, 6)  // max "CCM50" = 5 chars
      rebuild()
      return
    }
  }

  rebuild()
}

// title/preselect are optional (only the flag enforcement step uses them):
// a preselected option is highlighted and Enter confirms it.
export function renderResultMenu(config) {
  const { options, onComplete, title, preselect } = config
  _setContext('RESULT')

  KEYBOARD_CONTEXTS.RESULT = { Escape: goBack }
  options.forEach(opt => {
    KEYBOARD_CONTEXTS.RESULT[opt.kbd.toLowerCase()] = () => onComplete(opt.key)
  })
  if (preselect) KEYBOARD_CONTEXTS.RESULT.Enter = () => onComplete(preselect)

  const COLOR_CLASS = {
    '--yellow': 'result-btn--yellow',
    '--accent': 'result-btn--accent',
    '--text2':  'result-btn--muted',
    '--orange': 'result-btn--orange',
    '--red':    'result-btn--red',
    '--green':  'result-btn--green',
    '--purple': 'result-btn--purple',
  }

  _container().innerHTML = `
    ${title ? `<div class="wizard-area__title">${title}</div>` : ''}
    <div class="result-menu">
      ${options.map(opt => `
        <button class="result-btn ${COLOR_CLASS[opt.color] || 'result-btn--muted'}${opt.key === preselect ? ' result-btn--preselected' : ''}"
          data-key="${opt.key}">
          <span class="result-btn__label">${opt.label}</span>
          <span class="result-btn__kbd">${opt.kbd}${opt.key === preselect ? ' / ↵' : ''}</span>
        </button>
      `).join('')}
    </div>
  `

  _container().querySelectorAll('.result-btn').forEach(btn => {
    btn.addEventListener('click', () => onComplete(btn.dataset.key))
  })
}

export function renderTeamSelector(config) {
  const { stateKey, onComplete } = config
  _setContext('TEAM')

  const home = gameState.teams.home.name
  const away = gameState.teams.away.name

  KEYBOARD_CONTEXTS.TEAM = {
    Escape: goBack,
    h: () => onComplete(home),
    a: () => onComplete(away),
  }

  _container().innerHTML = `
    <div class="result-menu">
      <button class="result-btn result-btn--accent" data-team="${home}">
        <span class="result-btn__label">${home}</span>
        <span class="result-btn__kbd">H</span>
      </button>
      <button class="result-btn result-btn--muted" data-team="${away}">
        <span class="result-btn__label">${away}</span>
        <span class="result-btn__kbd">A</span>
      </button>
    </div>
  `

  _container().querySelectorAll('.result-btn').forEach(btn => {
    btn.addEventListener('click', () => onComplete(btn.dataset.team))
  })
}

export function renderPenaltyCodeField(config) {
  const { onComplete } = config
  _setContext('PENALTY_CODE')
  KEYBOARD_CONTEXTS.PENALTY_CODE = { Escape: goBack }

  let typed = ''
  const container = _container()

  function rebuild() {
    const filtered = typed.length === 0
      ? PENALTIES_LIST
      : PENALTIES_LIST.filter(p => p.code.startsWith(typed.toUpperCase()))

    container.innerHTML = `
      <div class="at-field">
        <div class="at-field__label">Infraction Code</div>
        <input id="penalty-input" class="at-input" type="text"
          maxlength="2" placeholder="AB, HO, PI..."
          autocomplete="off" value="${typed}">
        <div class="at-field__hint">Escribe código de 2 letras</div>
      </div>
      <div class="penalty-list" id="penalty-list">
        ${filtered.map(p => `
          <div class="penalty-item${typed.length > 0 && p.code === typed.toUpperCase()
            ? ' penalty-item--match' : ''}"
            data-code="${p.code}">
            <span class="penalty-item__code">${p.code}</span>
            <span class="penalty-item__label">${p.label}</span>
          </div>
        `).join('')}
      </div>
    `

    const input = document.getElementById('penalty-input')
    input.focus()
    input.setSelectionRange(typed.length, typed.length)

    container.querySelectorAll('.penalty-item').forEach(item => {
      item.addEventListener('click', () => {
        const penalty = PENALTIES_LIST.find(p => p.code === item.dataset.code)
        if (penalty) onComplete(penalty)
      })
    })
  }

  _penaltyKeyHandler = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); goBack(); return }

    if (e.key === 'Backspace') {
      e.preventDefault()
      typed = typed.slice(0, -1)
      rebuild()
      return
    }

    if (/^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault()
      typed = (typed + e.key).slice(0, 2).toUpperCase()

      if (typed.length === 2) {
        const match = PENALTIES_LIST.find(p => p.code === typed)
        if (match) { onComplete(match); return }
      }
      rebuild()
    }
  }

  rebuild()
}

// ── Play grid ─────────────────────────────────────────────────────────────────

function _renderPlayGrid() {
  // Game CTRL stays enabled even after end_game (e.g. to fix the score via
  // Set Score) — only play-capture buttons are locked out.
  const locked = gameState.ended
  _container().innerHTML = `
    <div class="wizard-area__title">Select Play Type</div>
    <div class="play-grid">
      ${BUTTONS.map(btn => {
        const disabled = btn.disabled || (locked && btn.type !== 'GAME_CTRL')
        return `
        <button class="play-btn${disabled ? ' play-btn--disabled' : ''}"
          data-type="${btn.type}" ${disabled ? 'disabled' : ''}>
          <span class="play-btn__label">${btn.label}</span>
          <span class="play-btn__key">${btn.key}</span>
        </button>
      `
      }).join('')}
    </div>
  `
  _container().querySelectorAll('.play-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => _onPlayTypeSelected(btn.dataset.type))
  })
}

function _onPlayTypeSelected(type) {
  if (gameState.ended && type !== 'GAME_CTRL') return
  console.log('Play selected:', type)
  setPlayField('play_type', type)

  if (type === 'GAME_CTRL') {
    _renderGameCtrlMenu()
    return
  }

  const stepDefs = STEPS_BY_TYPE[type]
  if (!stepDefs) return

  steps = stepDefs.map(s => ({ ...s, value: null }))
  steps[0].value = type
  currentStepIdx = 1
  _renderProgress()
  _renderCurrentStep()
}

// ── Game CTRL ─────────────────────────────────────────────────────────────────

const _GC_COLOR_CLASS = {
  '--yellow': 'result-btn--yellow',
  '--accent': 'result-btn--accent',
  '--text2':  'result-btn--muted',
  '--orange': 'result-btn--orange',
  '--red':    'result-btn--red',
  '--green':  'result-btn--green',
  '--purple': 'result-btn--purple',
}

let _gameCtrlFormState = {}
let _gameCtrlActiveAction = null

function _renderGameCtrlMenu() {
  _setContext('GAME_CTRL')

  KEYBOARD_CONTEXTS.GAME_CTRL = {
    Escape: () => renderAddPlay(),
    b: () => _openGameCtrlForm('spot_ball'),
    c: () => _openGameCtrlForm('set_clock'),
    q: () => _openGameCtrlForm('set_quarter'),
    d: () => _openGameCtrlForm('set_down'),
    t: () => _openGameCtrlForm('timeout'),
    s: () => _openGameCtrlForm('start_drive'),
    x: () => _openGameCtrlForm('set_score'),
    p: () => _openGameCtrlForm('set_possession'),
    e: () => _openGameCtrlForm('end_game'),
  }

  _container().innerHTML = `
    <div class="wizard-area__title">Game Control</div>
    <div class="result-menu">
      ${GAME_CTRL_OPTIONS.map(opt => `
        <button class="result-btn ${_GC_COLOR_CLASS[opt.color] || 'result-btn--muted'}"
          data-key="${opt.key}">
          <span class="result-btn__label">${opt.label}</span>
          <span class="result-btn__kbd">${opt.kbd}</span>
        </button>
      `).join('')}
    </div>
  `

  _container().querySelectorAll('.result-btn').forEach(btn => {
    btn.addEventListener('click', () => _openGameCtrlForm(btn.dataset.key))
  })
}

function _openGameCtrlForm(action) {
  _gameCtrlActiveAction = action
  _gameCtrlFormState = _gcDefaultState(action)
  _rebuildGameCtrlForm()
  const firstInput = _container().querySelector('input')
  if (firstInput) firstInput.focus()
}

function _gcDefaultState(action) {
  switch (action) {
    case 'spot_ball':   return { at_raw: '' }
    case 'set_clock':   return { clock: gameState.clock }
    case 'set_quarter': return { quarter: gameState.quarter }
    case 'set_down':    return { down: gameState.down, distance: gameState.distance }
    case 'timeout':     return { team: null, clock: gameState.clock }
    case 'start_drive': return { possession: null, at_raw: '', down: 1, distance: 10 }
    case 'set_score':   return { home: gameState.score.home, away: gameState.score.away }
    default:            return {}
  }
}

function _rebuildGameCtrlForm() {
  _setContext('GAME_CTRL_FORM')

  const action = _gameCtrlActiveAction
  const state  = _gameCtrlFormState
  const teams  = gameState.teams
  const title  = GAME_CTRL_OPTIONS.find(o => o.key === action)?.label || action

  KEYBOARD_CONTEXTS.GAME_CTRL_FORM = {
    Escape: () => _renderGameCtrlMenu(),
    Enter:  () => _submitGameCtrlForm(),
  }

  let bodyHTML = ''

  if (action === 'spot_ball') {
    const parsed = state.at_raw ? parseATInput(state.at_raw, teams) : null
    const fb = state.at_raw
      ? parsed
        ? `<div class="at-feedback at-feedback--valid">${parsed.team} ${parsed.yard}</div>`
        : `<div class="at-feedback at-feedback--invalid">Posición inválida</div>`
      : `<div class="at-feedback at-feedback--hint">Escribe posición</div>`
    bodyHTML = `
      <div class="at-field">
        <div class="at-team-hint">
          <span class="at-team-chip">${teams.home.abreviatura} = ${teams.home.name}</span>
          <span class="at-team-chip">${teams.away.abreviatura} = ${teams.away.name}</span>
        </div>
        <div class="at-input-row">
          <input id="gc-at" class="at-input" type="text" inputmode="text"
            autocomplete="off" placeholder="${teams.home.abreviatura}40 · ${teams.away.abreviatura}30 · 40"
            value="${state.at_raw}" spellcheck="false">
        </div>
        ${fb}
      </div>
    `
  }
  else if (action === 'set_clock') {
    bodyHTML = `
      <div class="at-field">
        <div class="at-input-row">
          <input id="gc-clock" class="at-input" type="text" inputmode="text"
            placeholder="MM:SS" value="${state.clock}" autocomplete="off" spellcheck="false">
        </div>
      </div>
    `
  }
  else if (action === 'set_quarter') {
    const quarters = [
      { label: 'Q1', value: 1, kbd: '1' },
      { label: 'Q2', value: 2, kbd: '2' },
      { label: 'Q3', value: 3, kbd: '3' },
      { label: 'Q4', value: 4, kbd: '4' },
      { label: 'OT', value: 5, kbd: '5' },
    ]
    quarters.forEach(q => {
      KEYBOARD_CONTEXTS.GAME_CTRL_FORM[q.kbd] = () => {
        _gameCtrlFormState.quarter = q.value
        _rebuildGameCtrlForm()
      }
    })
    bodyHTML = `
      <div class="result-menu">
        ${quarters.map(q => `
          <button class="result-btn ${state.quarter === q.value ? 'result-btn--green' : 'result-btn--muted'}"
            data-field="quarter" data-value="${q.value}">
            <span class="result-btn__label">${q.label}</span>
            <span class="result-btn__kbd">${q.kbd}</span>
          </button>
        `).join('')}
      </div>
    `
  }
  else if (action === 'set_down') {
    const downs = [1, 2, 3, 4]
    downs.forEach(d => {
      KEYBOARD_CONTEXTS.GAME_CTRL_FORM[String(d)] = () => {
        _gameCtrlFormState.down = d
        _rebuildGameCtrlForm()
      }
    })
    bodyHTML = `
      <div class="at-field">
        <div class="at-team-hint">Down</div>
        <div class="result-menu">
          ${downs.map(d => `
            <button class="result-btn ${state.down === d ? 'result-btn--green' : 'result-btn--muted'}"
              data-field="down" data-value="${d}">
              <span class="result-btn__label">${d}</span>
              <span class="result-btn__kbd">${d}</span>
            </button>
          `).join('')}
        </div>
        <div class="at-team-hint">Distance</div>
        <div class="at-input-row">
          <input id="gc-dist" class="at-input" type="number" inputmode="numeric"
            min="1" max="99" value="${state.distance}">
        </div>
      </div>
    `
  }
  else if (action === 'timeout') {
    const teamOpts = [
      { label: teams.home.name, value: teams.home.name, kbd: 'H' },
      { label: teams.away.name, value: teams.away.name, kbd: 'A' },
    ]
    teamOpts.forEach(t => {
      KEYBOARD_CONTEXTS.GAME_CTRL_FORM[t.kbd.toLowerCase()] = () => {
        _gameCtrlFormState.team = t.value
        _rebuildGameCtrlForm()
      }
    })
    bodyHTML = `
      <div class="at-field">
        <div class="at-team-hint">Team</div>
        <div class="result-menu">
          ${teamOpts.map(t => `
            <button class="result-btn ${state.team === t.value ? 'result-btn--green' : 'result-btn--muted'}"
              data-field="team" data-value="${t.value}">
              <span class="result-btn__label">${t.label}</span>
              <span class="result-btn__kbd">${t.kbd}</span>
            </button>
          `).join('')}
        </div>
        <div class="at-team-hint">Clock</div>
        <div class="at-input-row">
          <input id="gc-clock" class="at-input" type="text" inputmode="text"
            placeholder="MM:SS" value="${state.clock}" autocomplete="off" spellcheck="false">
        </div>
      </div>
    `
  }
  else if (action === 'start_drive') {
    const teamOpts = [
      { label: teams.home.name, value: teams.home.name, kbd: 'H' },
      { label: teams.away.name, value: teams.away.name, kbd: 'A' },
    ]
    teamOpts.forEach(t => {
      KEYBOARD_CONTEXTS.GAME_CTRL_FORM[t.kbd.toLowerCase()] = () => {
        _gameCtrlFormState.possession = t.value
        _rebuildGameCtrlForm()
      }
    })
    const downs = [1, 2, 3, 4]
    downs.forEach(d => {
      KEYBOARD_CONTEXTS.GAME_CTRL_FORM[String(d)] = () => {
        _gameCtrlFormState.down = d
        _rebuildGameCtrlForm()
      }
    })
    const parsed = state.at_raw ? parseATInput(state.at_raw, teams) : null
    const fb = state.at_raw
      ? parsed
        ? `<div class="at-feedback at-feedback--valid">${parsed.team} ${parsed.yard}</div>`
        : `<div class="at-feedback at-feedback--invalid">Posición inválida</div>`
      : `<div class="at-feedback at-feedback--hint">Escribe posición</div>`
    bodyHTML = `
      <div class="at-field">
        <div class="at-team-hint">Possession</div>
        <div class="result-menu">
          ${teamOpts.map(t => `
            <button class="result-btn ${state.possession === t.value ? 'result-btn--green' : 'result-btn--muted'}"
              data-field="possession" data-value="${t.value}">
              <span class="result-btn__label">${t.label}</span>
              <span class="result-btn__kbd">${t.kbd}</span>
            </button>
          `).join('')}
        </div>
        <div class="at-team-hint">Field Position</div>
        <div class="at-team-hint">
          <span class="at-team-chip">${teams.home.abreviatura} = ${teams.home.name}</span>
          <span class="at-team-chip">${teams.away.abreviatura} = ${teams.away.name}</span>
        </div>
        <div class="at-input-row">
          <input id="gc-at" class="at-input" type="text" inputmode="text"
            autocomplete="off" placeholder="${teams.home.abreviatura}40 · ${teams.away.abreviatura}30 · 40"
            value="${state.at_raw}" spellcheck="false">
        </div>
        ${fb}
        <div class="at-team-hint">Down</div>
        <div class="result-menu">
          ${downs.map(d => `
            <button class="result-btn ${state.down === d ? 'result-btn--green' : 'result-btn--muted'}"
              data-field="down" data-value="${d}">
              <span class="result-btn__label">${d}</span>
              <span class="result-btn__kbd">${d}</span>
            </button>
          `).join('')}
        </div>
        <div class="at-team-hint">Distance</div>
        <div class="at-input-row">
          <input id="gc-dist" class="at-input" type="number" inputmode="numeric"
            min="1" max="99" value="${state.distance}">
        </div>
      </div>
    `
  }
  else if (action === 'set_score') {
    bodyHTML = `
      <div style="display:flex; gap:16px; align-items:flex-end; margin-bottom:20px;">
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:11px; color:var(--text3); text-transform:uppercase; letter-spacing:0.08em; font-family:'IBM Plex Mono',monospace;">
            ${gameState.teams.home.name}
          </label>
          <input id="score-home" class="at-input" type="number"
            min="0" max="999" style="width:100px;"
            value="${state.home}">
        </div>
        <div style="font-size:24px; color:var(--text3); padding-bottom:10px; font-family:'IBM Plex Mono',monospace;">
          —
        </div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:11px; color:var(--text3); text-transform:uppercase; letter-spacing:0.08em; font-family:'IBM Plex Mono',monospace;">
            ${gameState.teams.away.name}
          </label>
          <input id="score-away" class="at-input" type="number"
            min="0" max="999" style="width:100px;"
            value="${state.away}">
        </div>
      </div>
    `
  }
  else if (action === 'end_game') {
    bodyHTML = `<div class="submit-play-text">¿Terminar el partido?</div>`
  }
  else if (action === 'set_possession') {
    const home = gameState.teams.home.name
    const away = gameState.teams.away.name

    _gameCtrlFormState = { possession: gameState.possession }

    _container().innerHTML = `
      <div class="submit-screen">
        <div class="wizard-area__title">Set Possession</div>
        <div class="result-menu">
          <button class="result-btn ${gameState.possession === home
            ? 'result-btn--accent' : 'result-btn--muted'}" id="poss-home">
            <span class="result-btn__label">${home}</span>
            <span class="result-btn__kbd">H</span>
          </button>
          <button class="result-btn ${gameState.possession === away
            ? 'result-btn--accent' : 'result-btn--muted'}" id="poss-away">
            <span class="result-btn__label">${away}</span>
            <span class="result-btn__kbd">A</span>
          </button>
        </div>
      </div>
    `

    KEYBOARD_CONTEXTS.GAME_CTRL_FORM = {
      Escape: () => _renderGameCtrlMenu(),
      h: () => { applyGameCtrl('set_possession', { possession: home }); renderAddPlay() },
      a: () => { applyGameCtrl('set_possession', { possession: away }); renderAddPlay() },
    }

    document.getElementById('poss-home')?.addEventListener('click', () => {
      applyGameCtrl('set_possession', { possession: home })
      renderAddPlay()
    })
    document.getElementById('poss-away')?.addEventListener('click', () => {
      applyGameCtrl('set_possession', { possession: away })
      renderAddPlay()
    })

    return
  }

  _container().innerHTML = `
    <div class="submit-screen">
      <div class="wizard-area__title">${title}</div>
      ${bodyHTML}
      <div class="submit-actions">
        <button class="submit-btn submit-btn--confirm" id="gc-confirm">Confirm <span class="submit-kbd">↵</span></button>
        <button class="submit-btn submit-btn--cancel"  id="gc-cancel">Cancel  <span class="submit-kbd">Esc</span></button>
      </div>
    </div>
  `

  // Generic click handler for button group selectors (data-field + data-value)
  _container().querySelectorAll('.result-btn[data-field]').forEach(btn => {
    btn.addEventListener('click', () => {
      const field = btn.dataset.field
      const raw   = btn.dataset.value
      _gameCtrlFormState[field] = isNaN(raw) ? raw : Number(raw)
      _rebuildGameCtrlForm()
    })
  })

  // Live AT position feedback — update only the feedback element to preserve focus
  const atInput = document.getElementById('gc-at')
  if (atInput) {
    atInput.addEventListener('input', () => {
      _gameCtrlFormState.at_raw = atInput.value
      const parsed = parseATInput(atInput.value, teams)
      const fb = _container().querySelector('.at-feedback')
      if (!fb) return
      if (!atInput.value) {
        fb.className = 'at-feedback at-feedback--hint'
        fb.textContent = 'Escribe posición'
      } else if (parsed) {
        fb.className = 'at-feedback at-feedback--valid'
        fb.textContent = `${parsed.team} ${parsed.yard}`
      } else {
        fb.className = 'at-feedback at-feedback--invalid'
        fb.textContent = 'Posición inválida'
      }
    })
  }

  document.getElementById('gc-confirm').addEventListener('click', _submitGameCtrlForm)
  document.getElementById('gc-cancel').addEventListener('click', _renderGameCtrlMenu)

  if (action === 'set_score') {
    KEYBOARD_CONTEXTS.GAME_CTRL_FORM.Enter = () => {
      const focused = document.activeElement?.id
      if (focused === 'score-home') {
        const away = document.getElementById('score-away')
        if (away) { away.focus(); away.select() }
        return
      }
      _submitGameCtrlForm()
    }
    document.getElementById('score-home')?.addEventListener('keydown', e => {
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.stopPropagation()
        e.preventDefault()
        const away = document.getElementById('score-away')
        if (away) { away.focus(); away.select() }
      }
    })
    document.getElementById('score-away')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.stopPropagation()
        e.preventDefault()
        _submitGameCtrlForm()
      }
    })
  }
}

function _submitGameCtrlForm() {
  const action = _gameCtrlActiveAction
  const state  = _gameCtrlFormState
  const teams  = gameState.teams

  switch (action) {
    case 'spot_ball': {
      const parsed = parseATInput(document.getElementById('gc-at')?.value ?? state.at_raw ?? '', teams)
      if (!parsed) return
      applyGameCtrl('spot_ball', { field_pos_team: parsed.team, field_pos_yard: parsed.yard })
      break
    }
    case 'set_clock': {
      const clock = document.getElementById('gc-clock')?.value ?? state.clock
      applyGameCtrl('set_clock', { clock })
      break
    }
    case 'set_quarter': {
      applyGameCtrl('set_quarter', { quarter: state.quarter })
      break
    }
    case 'set_down': {
      const distance = parseInt(document.getElementById('gc-dist')?.value) || state.distance
      applyGameCtrl('set_down', { down: state.down, distance })
      break
    }
    case 'timeout': {
      if (!state.team) return
      const clock = document.getElementById('gc-clock')?.value ?? state.clock
      applyGameCtrl('timeout', { team: state.team, clock })
      break
    }
    case 'start_drive': {
      if (!state.possession) return
      const parsed = parseATInput(document.getElementById('gc-at')?.value ?? state.at_raw ?? '', teams)
      if (!parsed) return
      const distance = parseInt(document.getElementById('gc-dist')?.value) || state.distance
      applyGameCtrl('start_drive', {
        possession:     state.possession,
        field_pos_team: parsed.team,
        field_pos_yard: parsed.yard,
        down:           state.down,
        distance,
      })
      break
    }
    case 'set_score': {
      const home = parseInt(document.getElementById('score-home')?.value ?? '0')
      const away = parseInt(document.getElementById('score-away')?.value ?? '0')
      if (isNaN(home) || isNaN(away)) return
      applyGameCtrl('set_score', { home, away })
      break
    }
    case 'end_game': {
      applyGameCtrl('end_game', {})
      break
    }
  }

  renderAddPlay()
}

// ── Step flow ─────────────────────────────────────────────────────────────────

function _renderStepByComponent(step, onComplete) {
  if (step.component === 'BY') {
    renderByMenu({ ...step.config, label: step.label, onComplete })
    return
  }

  if (step.component === 'RESULT') {
    renderResultMenu({
      options: RESULT_OPTIONS[step.config.optionsKey], onComplete,
      title: step.config.title, preselect: step.config.preselect?.() ?? null,
    })
    return
  }

  if (step.component === 'PASS_RESULT') {
    renderResultMenu({ options: PASS_RESULT_OPTIONS, onComplete })
    return
  }

  if (step.component === 'KICK_TYPE') {
    renderResultMenu({ options: KICK_TYPE_OPTIONS, onComplete })
    return
  }

  if (step.component === 'KICKOFF_RESULT') {
    renderResultMenu({ options: KICKOFF_RESULT_OPTIONS, onComplete })
    return
  }

  if (step.component === 'FG_RESULT') {
    renderResultMenu({ options: FG_RESULT_OPTIONS, onComplete })
    return
  }

  if (step.component === 'FG_MISS') {
    renderResultMenu({ options: FG_MISS_OPTIONS, onComplete })
    return
  }

  if (step.component === 'FG_RETURN') {
    renderResultMenu({ options: FG_RETURN_RESULT_OPTIONS, onComplete })
    return
  }

  if (step.component === 'PUNT_RESULT') {
    renderResultMenu({ options: PUNT_RESULT_OPTIONS, onComplete })
    return
  }

  if (step.component === 'PUNT_BLOCK_RETURN') {
    renderResultMenu({ options: FG_RETURN_RESULT_OPTIONS, onComplete })
    return
  }

  if (step.component === 'PAT_TYPE') {
    renderResultMenu({ options: PAT_TYPE_OPTIONS, onComplete })
    return
  }

  if (step.component === 'PAT_KICK_RESULT') {
    renderResultMenu({ options: PAT_KICK_RESULT_OPTIONS, onComplete })
    return
  }

  if (step.component === 'PAT_BLOCK_RESULT') {
    renderResultMenu({ options: PAT_BLOCK_RESULT_OPTIONS, onComplete })
    return
  }

  if (step.component === 'NUMBER') {
    _setContext('AT')
    KEYBOARD_CONTEXTS.AT = { Escape: goBack }
    const { placeholder = '', min, max } = step.config
    _container().innerHTML = `
      <div class="at-field">
        <div class="at-field__label">${step.label}</div>
        <input id="number-input" class="at-input" type="number"
          placeholder="${placeholder}"
          ${min != null ? `min="${min}"` : ''}
          ${max != null ? `max="${max}"` : ''}
          autocomplete="off">
      </div>
    `
    const input = document.getElementById('number-input')
    input?.focus()
    _atKeyHandler = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); goBack(); return }
      if (e.key === 'Enter') {
        e.preventDefault()
        const val = parseInt(input?.value)
        if (!isNaN(val)) onComplete(val)
      }
    }
    return
  }

  if (step.component === 'PENALTY_CODE') {
    renderPenaltyCodeField({ ...step.config, onComplete })
    return
  }

  if (step.component === 'PENALTY_RESULT') {
    renderResultMenu({ options: PENALTY_RESULT_OPTIONS, onComplete })
    return
  }

  if (step.component === 'PENALTY_DOWN') {
    renderResultMenu({ options: PENALTY_DOWN_RESULT_OPTIONS, onComplete })
    return
  }

  if (step.component === 'YES_NO') {
    _setContext('YES_NO')
    KEYBOARD_CONTEXTS.YES_NO = {
      Escape: goBack,
      y: () => onComplete(true),
      n: () => onComplete(false),
    }
    _container().innerHTML = `
      <div class="result-menu">
        <button class="result-btn result-btn--accent" id="yn-yes">
          <span class="result-btn__label">Yes</span>
          <span class="result-btn__kbd">Y</span>
        </button>
        <button class="result-btn result-btn--muted" id="yn-no">
          <span class="result-btn__label">No</span>
          <span class="result-btn__kbd">N</span>
        </button>
      </div>
    `
    document.getElementById('yn-yes')?.addEventListener('click', () => onComplete(true))
    document.getElementById('yn-no')?.addEventListener('click', () => onComplete(false))
    return
  }

  if (step.component === 'AT') {
    const overrides = editMode
      ? { snapPos: editContext.field_pos, possession: editContext.possession }
      : {}
    renderATField({ ...step.config, ...overrides, label: step.label, onComplete })
    return
  }

  if (step.component === 'TEAM') {
    renderTeamSelector({ ...step.config, label: step.label, onComplete })
    return
  }

  if (step.component === 'TIME') {
    _setContext('AT')
    KEYBOARD_CONTEXTS.AT = { Escape: goBack }
    _container().innerHTML = `
      <div class="at-field">
        <div class="at-field__label">${step.label}</div>
        <input id="time-input" class="at-input" type="text"
          placeholder="MM:SS" autocomplete="off">
      </div>
    `
    const input = document.getElementById('time-input')
    input?.focus()
    _atKeyHandler = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); goBack(); return }
      if (e.key === 'Enter') { e.preventDefault(); onComplete(input?.value || null) }
    }
    return
  }
}

function _renderCurrentStep() {
  const step = steps[currentStepIdx]
  if (!step) return
  _renderStepByComponent(step, (val) => _onStepComplete(currentStepIdx, val))
}

function _onStepComplete(stepIdx, value) {
  steps[stepIdx].value = value
  setPlayField(steps[stepIdx].id, value)

  const stepId = steps[stepIdx].id

  // Fake punt: from here on this is a genuine RUSH/PASS play, not a PUNT.
  // Retarget play_type (in both currentPlay and the wizard's own play_type
  // step slot) BEFORE resolving branch steps below, so every later
  // RESULT_STEP_IDS step (e.g. the RUSH/PASS 'result' step) looks up
  // RESULT_BRANCHES[playType] against 'RUSH'/'PASS', not 'PUNT'.
  if (stepId === 'fake_punt_type') {
    const newType = value === 'run' ? 'RUSH' : 'PASS'
    setPlayField('play_type', newType)
    setPlayField('fake_punt', true)
    const playTypeStep = steps.find(s => s.id === 'play_type')
    if (playTypeStep) playTypeStep.value = newType
  }

  // Snap fumble, own offense recovered and the play developed into a real
  // RUSH/PASS: same retargeting mechanism as fake_punt_type above, so every
  // later RESULT_STEP_IDS step (rush_by/result, pass_by/pass_result) looks
  // up RESULT_BRANCHES[playType] against 'RUSH'/'PASS', not 'SNAP_FUMBLE'.
  if (stepId === 'snap_fumble_type') {
    const newType = value === 'run' ? 'RUSH' : 'PASS'
    setPlayField('play_type', newType)
    setPlayField('snap_fumble', true)
    const playTypeStep = steps.find(s => s.id === 'play_type')
    if (playTypeStep) playTypeStep.value = newType
  }

  // Bad snap (long snapper) on a PUNT/FG/PAT_KICK, own side recovered and
  // scrambled into a real run/pass: same retargeting mechanism again. PUNT's
  // 'kick' option deliberately does NOT retarget — play_type is already
  // 'PUNT' and stays there, it just re-enters the normal punt_result step
  // (see PUNT_BAD_SNAP_TYPE_BRANCHES.kick above).
  if (stepId === 'punt_bad_snap_type' || stepId === 'fg_bad_snap_type' || stepId === 'pat_bad_snap_type') {
    setPlayField('bad_snap', true)
    if (value === 'run' || value === 'pass') {
      const newType = value === 'run' ? 'RUSH' : 'PASS'
      setPlayField('play_type', newType)
      const playTypeStep = steps.find(s => s.id === 'play_type')
      if (playTypeStep) playTypeStep.value = newType
    }
    // 'kick' (PUNT only): no retargeting — play_type stays 'PUNT', but the
    // bad_snap:true marker set above still lets formatPlay() flag that this
    // otherwise-normal-looking punt started with a bad snap.
  }

  if (RESULT_STEP_IDS.includes(stepId)) {
    const playType = steps.find(s => s.id === 'play_type')?.value
    const branchSteps = resolveBranchSteps(stepId, value, playType, gameState.possession)

    steps = steps.slice(0, stepIdx + 1)
    steps.push(...branchSteps.map(s => ({ ...s, value: null })))
  }

  currentStepIdx = stepIdx + 1
  _renderProgress()

  if (currentStepIdx >= steps.length) {
    _renderPlaceholder()
    return
  }
  _renderCurrentStep()
}

function _renderPlaceholder() {
  _renderSubmit()
}

function _renderSubmit(preview) {
  _setContext('SUBMIT')

  // Build a preview play object from current state + currentPlay (includes any flag_ fields)
  const previewPlay = preview ?? { ...gameState, ...currentPlay }
  _previewPlay = previewPlay

  // Calculate net_yards and touchdown if AT is present
  if (previewPlay.at && previewPlay.field_pos) {
    previewPlay.net_yards = calcNetYards(
      gameState.teams, gameState.possession, previewPlay.field_pos, previewPlay.at
    )
    previewPlay.touchdown = isTouchdown(gameState.teams, gameState.possession, previewPlay.at)
  }
  // A play that still counts shows the net yards that get stored (flagOutcome,
  // e.g. to the spot of the foul), not the raw yards to `at`. A voided play
  // keeps showing what happened on the field.
  const shown = flagOutcome(previewPlay)
  if (shown && !shown.voided && shown.net_yards != null) {
    previewPlay.net_yards = shown.net_yards
    previewPlay.touchdown = shown.touchdown
  }

  const playText = formatPlay(previewPlay)
  const kickoffNotice = _endFlagOnTouchdown(previewPlay)
    ? `<div class="wizard-area__title" style="color:var(--yellow)">Aplicada en el kickoff: captúrala en el PAT</div>`
    : ''

  KEYBOARD_CONTEXTS.SUBMIT = {
    Escape: () => renderAddPlay(),
    Enter:  () => _confirmSubmit(previewPlay),
    e:      () => _startFlagCapture(previewPlay),
  }

  _container().innerHTML = `
    <div class="submit-screen">
      <div class="submit-play-text">${playText}</div>
      ${kickoffNotice}
      <div class="submit-actions">
        <button class="submit-btn submit-btn--confirm" id="btn-submit">Submit <span class="submit-kbd">↵</span></button>
        <button class="submit-btn submit-btn--penalty" id="btn-penalty">Penalty <span class="submit-kbd">E</span></button>
        <button class="submit-btn submit-btn--cancel" id="btn-cancel">Cancel <span class="submit-kbd">Esc</span></button>
      </div>
    </div>
  `

  document.getElementById('btn-submit').addEventListener('click', () => _confirmSubmit(previewPlay))
  document.getElementById('btn-cancel').addEventListener('click', () => renderAddPlay())
  document.getElementById('btn-penalty').addEventListener('click', () => _startFlagCapture(previewPlay))
}

// A flag enforced from the end of a touchdown play is enforced on the
// kickoff, which this play does not record (§14 Art.4 A.R.3): the operator
// captures it on the try instead. Only that case — nothing else warns.
function _endFlagOnTouchdown(play) {
  if (play.play_type !== 'RUSH' && play.play_type !== 'PASS') return false
  return [1, 2].some(n => play[`flag_${n}_result`] === 'accepted' && play[`flag_${n}_enforced`] === 'end') &&
    playTouchdown(play)
}

function _startFlagCapture(preview) {
  _previewPlay = preview
  _flagMode    = true
  _flagNumber  = _hasFlagData(1) ? 2 : 1
  _flagSteps   = _buildFlagSteps(_flagNumber)
  _flagStepIdx = 0
  _renderFlagStep()
}

function _hasFlagData(num) {
  return !!currentPlay[`flag_${num}_infraction`]
}

function _buildFlagSteps(num) {
  const p = `flag_${num}_`
  return [
    { id: `${p}infraction`, label: 'Infraction', component: 'PENALTY_CODE',
      config: { stateKey: `${p}infraction` } },
    { id: `${p}team`,       label: 'Team',        component: 'TEAM',
      config: { stateKey: `${p}team` } },
    { id: `${p}result`,     label: 'Result',      component: 'PENALTY_RESULT',
      config: { stateKey: `${p}result` } },
  ]
}

function _renderFlagStep() {
  const step = _flagSteps[_flagStepIdx]
  if (!step) {
    if (_flagNumber === 1 && !_hasFlagData(2)) {
      _askSecondFlag()
    } else {
      _returnToSubmit()
    }
    return
  }
  _renderStepByComponent(step, (val) => _onFlagStepComplete(_flagStepIdx, val))
}

function _onFlagStepComplete(idx, value) {
  const step = _flagSteps[idx]
  step.value = value
  setPlayField(step.id, value)

  const stepId = step.id
  const prefix = `flag_${_flagNumber}_`
  if (stepId === `${prefix}result`) {
    const branchSteps = PENALTY_RESULT_BRANCHES[value] ?? []
    const prefixed = branchSteps.map(s => ({
      ...s,
      id: s.id.replace(/^penalty_/, prefix),
      config: {
        ...s.config,
        stateKey: s.config.stateKey?.replace(/^penalty_/, prefix),
      },
    }))
    _flagSteps = _flagSteps.slice(0, idx + 1)
    _flagSteps.push(...prefixed.map(s => ({ ...s, value: null })))

    // Only an accepted flag affects the play; declined/offsetting ask nothing
    // more. Asked last, after the down_result (see FLAG_ENFORCEMENT in engine.js
    // and stats-lib.js flagOutcome() for how it is consumed).
    if (value === 'accepted') _flagSteps.push(_flagEnforcementStep(_flagNumber))
  }

  // Where the foul was enforced from. 'foul_spot' asks for that spot next;
  // any other choice drops it. flag_N_timing is still written, derived, so
  // code that only knows live/dead keeps reading these plays sensibly.
  if (stepId === `${prefix}enforced`) {
    _flagSteps = _flagSteps.slice(0, idx + 1)
    setPlayField(`${prefix}foul_spot`, undefined)
    setPlayField(`${prefix}timing`, value === 'previous' ? 'live' : 'dead')
    if (value === 'foul_spot') _flagSteps.push(_flagFoulSpotStep(_flagNumber))
  }

  _flagStepIdx = idx + 1
  _renderFlagStep()
}

// Intentional grounding by the passing team (same rule as stats-lib.js
// _groundingFlag): the play is the passer's rush to the flag's new_los, so
// there is no enforcement spot to ask — only who pressured him (optional).
function _isGroundingFlag(play, num) {
  return play.play_type === 'PASS' && play[`flag_${num}_infraction`]?.code === 'IG' &&
    play[`flag_${num}_team`] === play.possession
}

function _flagEnforcementStep(num, play = { ..._previewPlay, ...currentPlay }, suggest = true) {
  const prefix = `flag_${num}_`
  if (_isGroundingFlag(play, num)) {
    return { id: `${prefix}pressured_by`, label: 'Presionado por (opcional)', component: 'BY',
      config: { stateKey: `${prefix}pressured_by`, multiple: false, optional: true, team: 'opponent' }, value: null }
  }
  return {
    id: `${prefix}enforced`, label: 'Aplicada desde', component: 'RESULT',
    config: {
      stateKey: `${prefix}enforced`, optionsKey: 'FLAG_ENFORCEMENT',
      title: '¿Desde dónde se aplicó la penalidad?',
      preselect: suggest ? () => _suggestEnforcement({ ..._previewPlay, ...currentPlay }, num) : null,
    },
    value: null,
  }
}

function _flagFoulSpotStep(num) {
  const prefix = `flag_${num}_`
  return { id: `${prefix}foul_spot`, label: 'Spot de la falta', component: 'AT',
    config: { stateKey: `${prefix}foul_spot` }, value: null }
}

// Fouls at the snap: always enforced from the previous spot (§14 Art.6).
const _SNAP_FOUL_CODES = ['OD', 'OS', 'EN', 'FS', 'DG', 'FO', 'MO', 'SH', 'SU', 'PR']

// Preselected enforcement for the operator to confirm, or null to force an
// explicit choice. Only a suggestion: the operator always confirms.
//   - Kicks (punt, kickoff, try): roughing the kicker (previous spot) and a
//     foul after the kick (end) look the same here — no suggestion.
//   - Defensive foul on a completed pass: during the pass (previous spot) or
//     roughing/after the catch (end) — no suggestion.
//   - Defensive foul on a run (rush, sack, scramble) that ended beyond the
//     line: end of the run (§14 Art.2); on/behind the line: previous (Art.3).
//   - Anything else, and fouls at the snap: previous spot.
function _suggestEnforcement(play, num) {
  if (['PUNT', 'KICK', 'PAT_TRY'].includes(play.play_type)) return null
  if (_SNAP_FOUL_CODES.includes(play[`flag_${num}_infraction`]?.code)) return 'previous'
  const byDefense = !!play[`flag_${num}_team`] && play[`flag_${num}_team`] !== play.possession
  if (byDefense && play.play_type === 'PASS' && play.pass_result === 'complete') return null
  const isRun = play.play_type === 'RUSH' ||
    (play.play_type === 'PASS' && ['sack', 'scramble'].includes(play.pass_result))
  if (byDefense && isRun && play.at && play.field_pos) {
    return calcNetYards(gameState.teams, play.possession, play.field_pos, play.at) > 0 ? 'end' : 'previous'
  }
  return 'previous'
}

// Escape inside the flag sub-wizard: one flag step back, clearing that step
// and every later one (branch steps included), so a half-captured flag never
// leaves orphan flag_N_* fields. From the first step it drops this flag
// entirely and returns to the submit screen.
function _flagGoBack() {
  const prefix = `flag_${_flagNumber}_`
  if (_flagStepIdx <= 0) {
    Object.keys(currentPlay).filter(k => k.startsWith(prefix)).forEach(k => setPlayField(k, undefined))
    _returnToSubmit()
    return
  }
  const backIdx = _flagStepIdx - 1
  _flagSteps.slice(backIdx).forEach(s => { s.value = null; setPlayField(s.id, undefined) })
  // Derived from flag_N_enforced (see _onFlagStepComplete).
  if (currentPlay[`${prefix}enforced`] === undefined) setPlayField(`${prefix}timing`, undefined)
  _flagStepIdx = backIdx
  _renderFlagStep()
}

function _askSecondFlag() {
  _setContext('YES_NO')
  KEYBOARD_CONTEXTS.YES_NO = {
    Escape: () => _returnToSubmit(),
    y: () => {
      _flagNumber  = 2
      _flagSteps   = _buildFlagSteps(2)
      _flagStepIdx = 0
      _renderFlagStep()
    },
    n: () => _returnToSubmit(),
  }

  _container().innerHTML = `
    <div class="submit-screen">
      <div class="wizard-area__title">¿Hay segundo flag?</div>
      <div class="result-menu">
        <button class="result-btn result-btn--accent" id="yn-yes">
          <span class="result-btn__label">Sí</span>
          <span class="result-btn__kbd">Y</span>
        </button>
        <button class="result-btn result-btn--muted" id="yn-no">
          <span class="result-btn__label">No</span>
          <span class="result-btn__kbd">N</span>
        </button>
      </div>
    </div>
  `
  document.getElementById('yn-yes')?.addEventListener('click', () => {
    _flagNumber  = 2
    _flagSteps   = _buildFlagSteps(2)
    _flagStepIdx = 0
    _renderFlagStep()
  })
  document.getElementById('yn-no')?.addEventListener('click', () => _returnToSubmit())
}

function _returnToSubmit() {
  _flagMode = false
  _renderSubmit()
}

function _confirmSubmit(previewPlay) {
  // The play's own net_yards/touchdown were computed from its raw AT, blind
  // to any flag. stats-lib.js flagOutcome() is the rule (the same one every
  // read applies, so games already captured follow later fixes too); storing
  // its result here keeps the row itself consistent. Plays without an
  // accepted flag get null and are stored exactly as before.
  const outcome = flagOutcome(previewPlay)
  if (outcome?.voided) {
    setPlayField('net_yards', 0)
    setPlayField('touchdown', false)
    setPlayField('stats_count', false)
  } else {
    const net = outcome ? outcome.net_yards : previewPlay.net_yards
    const td  = outcome ? outcome.touchdown : previewPlay.touchdown
    if (net != null) setPlayField('net_yards', net)
    if (td  != null) setPlayField('touchdown', td)
  }

  // Standalone PENALTY plays: 'accepted' always pairs with one of the same
  // 3 down_result values above (that branch has no other option), so it
  // always means "this row doesn't count" too — unify with the flag case
  // above instead of leaving penalty_stats_count only ever set by the
  // operator-driven 'offsetting' widget.
  if (previewPlay.play_type === 'PENALTY' && previewPlay.penalty_result === 'accepted') {
    setPlayField('penalty_stats_count', false)
  }

  // Snapshot del estado ANTES de avanzar
  const snapState = {
    quarter:    gameState.quarter,
    clock:      gameState.clock,
    possession: gameState.possession,
    field_pos:  { ...gameState.field_pos },
    down:       gameState.down,
    distance:   gameState.distance,
    score_home: gameState.score.home,
    score_away: gameState.score.away,
  }

  submitPlayWithSnap(snapState)
  renderAddPlay()
}



function goBack() {
  // Step widgets (BY/AT/RESULT/TEAM/PENALTY_CODE/...) all wire Escape to this
  // same function. In edit mode it must return to the edit summary instead of
  // touching the normal-capture steps/currentStepIdx — those are untouched
  // while editing, so falling through would wrongly bounce to renderAddPlay().
  if (editMode) { editCursor = -1; _renderEditSummary(); return }
  if (_flagMode) { _flagGoBack(); return }
  if (currentStepIdx <= 1) { renderAddPlay(); return }
  const backIdx = currentStepIdx - 1
  steps.slice(backIdx).forEach(s => { s.value = null; setPlayField(s.id, undefined) })
  currentStepIdx = backIdx
  _renderProgress()
  _renderCurrentStep()
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function _renderProgress() {
  const el = document.getElementById('step-progress')
  if (!el) return
  if (!steps.length) { el.innerHTML = ''; return }

  const items = steps.map((step, i) => {
    const isDone = i < currentStepIdx
    if (isDone) {
      const label = i === 0 ? step.label : _stepValueLabel(step)
      return `<button class="progress-step progress-step--done" data-step="${i}">${label}</button>`
    }
    if (i === currentStepIdx) {
      return `<span class="progress-step progress-step--active">${step.label} ▶</span>`
    }
    return `<span class="progress-step progress-step--future">${step.label}</span>`
  })

  el.innerHTML = `<div class="progress-bar">${
    items.join('<span class="progress-sep">›</span>')
  }</div>`

  el.querySelectorAll('.progress-step--done[data-step]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.step, 10)
      if (idx === 0) { renderAddPlay(); return }
      steps.slice(idx).forEach(s => { s.value = null; setPlayField(s.id, undefined) })
      currentStepIdx = idx
      _renderProgress()
      _renderCurrentStep()
    })
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Value shown for a flag step (edit summary), or null to use the generic one.
function _flagStepValueLabel(step) {
  const val = step.value
  if (step.component === 'RESULT' && !val && step.mappedValue) {
    const opts = RESULT_OPTIONS[step.config?.optionsKey] || []
    return `${opts.find(o => o.key === step.mappedValue)?.label || step.mappedValue} (mapeado)`
  }
  if (!val) return null
  if (step.component === 'PENALTY_CODE') return `${val.code} ${val.label ?? ''}`.trim()
  if (step.component === 'TEAM') return val
  if (step.component === 'PENALTY_RESULT') return PENALTY_RESULT_OPTIONS.find(o => o.key === val)?.label || val
  if (step.component === 'PENALTY_DOWN') return PENALTY_DOWN_RESULT_OPTIONS.find(o => o.key === val)?.label || val
  return null
}

function _container() { return document.getElementById('wizard-container') }

function _playerLabel(p) {
  return playerShortLabel(p)
}

function _stepValueLabel(step) {
  const val = step.value
  if (step.id?.startsWith('flag_')) {
    const flagLabel = _flagStepValueLabel(step)
    if (flagLabel) return flagLabel
  }
  if (!val) return step.label
  if (step.component === 'RESULT') {
    const opts = RESULT_OPTIONS[step.config?.optionsKey] || []
    return opts.find(o => o.key === val)?.label || val
  }
  if (step.component === 'BY') {
    const p = Array.isArray(val) ? val[0] : val
    return _playerLabel(p)
  }
  if (step.component === 'AT') {
    return val ? `${val.team} ${val.yard}` : step.label
  }
  return step.label
}