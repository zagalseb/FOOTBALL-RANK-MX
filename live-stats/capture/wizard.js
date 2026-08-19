import { setPlayField, resetCurrentPlay, getRoster, submitPlayWithSnap, currentPlay, plays, savePlays, syncPlayUpdate, notifyPlaysChanged, RESULT_OPTIONS, RESULT_BRANCHES, FUMBLE_RESULT_BRANCHES, FUMBLE_2_RESULT_BRANCHES, PASS_RESULT_OPTIONS, PASS_RESULT_BRANCHES, RETURN_RESULT_BRANCHES, PENALTY_RESULT_OPTIONS, PENALTY_DOWN_RESULT_OPTIONS, PENALTY_RESULT_BRANCHES, PENALTIES_LIST, KICK_TYPE_OPTIONS, KICKOFF_RESULT_OPTIONS, FG_RESULT_OPTIONS, FG_MISS_OPTIONS, FG_RETURN_RESULT_OPTIONS, KICK_TYPE_BRANCHES, KICKOFF_RESULT_BRANCHES, FG_RESULT_BRANCHES, FG_BLOCKED_RETURN_BRANCHES, KICK_RETURN_RESULT_BRANCHES, FG_RET_RESULT_BRANCHES, PAT_TYPE_OPTIONS, PAT_KICK_RESULT_OPTIONS, PAT_BLOCK_RESULT_OPTIONS, PAT_TYPE_BRANCHES, PAT_KICK_RESULT_BRANCHES, PUNT_RESULT_OPTIONS, PUNT_RESULT_BRANCHES, PUNT_BLOCK_RETURN_BRANCHES, PUNT_RETURN_RESULT_BRANCHES, PUNT_BLOCK_RET_RESULT_BRANCHES, parseATInput, isTouchdown, calcNetYards, gameState, formatPlay, deriveNextPlayContext, applyGameCtrl, GAME_CTRL_OPTIONS } from './engine.js'

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
let editSteps     = []
let editCursor    = -1

const RESULT_STEP_IDS = [
  'result', 'fumble_result', 'fumble_2_result',
  'pass_result', 'return_result', 'penalty_result',
  'kick_type', 'kickoff_result', 'fg_result',
  'fg_return_result', 'kick_return_result', 'fg_ret_result',
  'pat_type', 'pat_kick_result', 'pat_block_result',
  'punt_result', 'punt_return_result', 'punt_block_return_result', 'punt_block_ret_result',
]

// Resolves the extra steps that follow a RESULT_STEP_IDS step, given the
// chosen value. Shared by normal capture (_onStepComplete) and edit mode
// (_onEditStepComplete) so the branch rules can never drift between the two.
function resolveBranchSteps(stepId, value, playType) {
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
      const branchSteps = resolveBranchSteps(step.id, value, playType)
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
  editContext   = {
    clock:      play.clock,
    quarter:    play.quarter,
    down:       play.down,
    distance:   play.distance,
    field_pos:  play.field_pos ? { ...play.field_pos } : null,
    possession: play.possession,
  }
  editSteps  = _buildEditSteps(play)
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
  editSteps[idx] = { ...editSteps[idx], value }
  editingPlay[editSteps[idx].id] = value

  const stepId = editSteps[idx].id
  if (RESULT_STEP_IDS.includes(stepId)) {
    const playType  = editingPlay.play_type
    const newBranch = resolveBranchSteps(stepId, value, playType)
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

  if (editingPlay.at) {
    editingPlay.net_yards = calcNetYards(gameState.teams, editContext.possession, editContext.field_pos, editingPlay.at)
    editingPlay.touchdown = isTouchdown(gameState.teams, editContext.possession, editingPlay.at)
  }

  const target = plays.find(p => p.play_id === editingPlayId)
  if (target) {
    Object.assign(target, editingPlay, editContext)
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
  editSteps     = []
  editCursor    = -1
}

export function renderByMenu(config) {
  const { optional, multiple, onComplete } = config
  _setContext('BY')
  KEYBOARD_CONTEXTS.BY = { Escape: goBack }

  const roster = getRoster()
  let selections = []
  let typedDigits = ''
  const container = _container()

  function rebuild() {
    const pillsHTML = selections.map((p, i) => `
      <span class="player-pill">
        #${p.number}${p.position ? ' · ' + p.position : ''}${p.name ? ' · ' + p.name : ''}
        <button class="player-pill__remove" data-idx="${i}">×</button>
      </span>
    `).join('')

    const playerBtns = roster.map(p => {
      const isSelected = selections.some(s => s.number === p.number)
      const hasInfo = p.name || p.position
      return `<button class="player-btn${isSelected ? ' player-btn--selected' : ''}" data-number="${p.number}">
        <span class="player-btn__num">${p.number}</span>
        ${hasInfo ? `<span class="player-btn__pos">${p.position || ''}</span>` : ''}
      </button>`
    }).join('')

    const hint = multiple && selections.length === 1
      ? '<div class="by-hint">Agregar 2do jugador (opcional)</div>' : ''
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
      btn.addEventListener('click', () => _selectPlayer(parseInt(btn.dataset.number, 10)))
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

  function _selectPlayer(num) {
    const player = roster.find(p => p.number === num) || { number: num, name: '', position: '' }
    if (!multiple) { onComplete(player); return }
    if (selections.length >= 2 || selections.some(s => s.number === num)) return
    selections.push(player)
    typedDigits = ''
    rebuild()
    if (selections.length >= 2) onComplete(multiple ? selections : selections[0])
  }

  function _confirmTyped() {
    if (!typedDigits) return
    const num = parseInt(typedDigits, 10)
    typedDigits = ''
    _selectPlayer(num)
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

export function renderResultMenu(config) {
  const { options, onComplete } = config
  _setContext('RESULT')

  KEYBOARD_CONTEXTS.RESULT = { Escape: goBack }
  options.forEach(opt => {
    KEYBOARD_CONTEXTS.RESULT[opt.kbd.toLowerCase()] = () => onComplete(opt.key)
  })

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
    <div class="result-menu">
      ${options.map(opt => `
        <button class="result-btn ${COLOR_CLASS[opt.color] || 'result-btn--muted'}"
          data-key="${opt.key}">
          <span class="result-btn__label">${opt.label}</span>
          <span class="result-btn__kbd">${opt.kbd}</span>
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
  _container().innerHTML = `
    <div class="wizard-area__title">Select Play Type</div>
    <div class="play-grid">
      ${BUTTONS.map(btn => `
        <button class="play-btn${btn.disabled ? ' play-btn--disabled' : ''}"
          data-type="${btn.type}" ${btn.disabled ? 'disabled' : ''}>
          <span class="play-btn__label">${btn.label}</span>
          <span class="play-btn__key">${btn.key}</span>
        </button>
      `).join('')}
    </div>
  `
  _container().querySelectorAll('.play-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => _onPlayTypeSelected(btn.dataset.type))
  })
}

function _onPlayTypeSelected(type) {
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
    renderResultMenu({ options: RESULT_OPTIONS[step.config.optionsKey], onComplete })
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

  if (RESULT_STEP_IDS.includes(steps[stepIdx].id)) {
    const playType = steps.find(s => s.id === 'play_type')?.value
    const stepId = steps[stepIdx].id
    const branchSteps = resolveBranchSteps(stepId, value, playType)

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

  const playText = formatPlay(previewPlay)

  KEYBOARD_CONTEXTS.SUBMIT = {
    Escape: () => renderAddPlay(),
    Enter:  () => _confirmSubmit(previewPlay),
    e:      () => _startFlagCapture(previewPlay),
  }

  _container().innerHTML = `
    <div class="submit-screen">
      <div class="submit-play-text">${playText}</div>
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
  if (stepId.endsWith('_result') && stepId.includes('flag_')) {
    const branchSteps = PENALTY_RESULT_BRANCHES[value] ?? []
    const prefix = `flag_${_flagNumber}_`
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
  }

  _flagStepIdx = idx + 1
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
  if (previewPlay.net_yards != null) setPlayField('net_yards', previewPlay.net_yards)
  if (previewPlay.touchdown  != null) setPlayField('touchdown',  previewPlay.touchdown)

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

function _container() { return document.getElementById('wizard-container') }

function _playerLabel(p) {
  if (!p) return '—'
  return p.name ? `#${p.number} ${p.name}` : `#${p.number}`
}

function _stepValueLabel(step) {
  const val = step.value
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