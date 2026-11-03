// hotkeys.js — generic keyboard-shortcut engine for the capture pages.
// No Supabase, no page-specific code: a page passes its own action table as
//   config = { storageKey, actions: [{ id, label, keys: [combo, ...], repeat? }] }
// and a `run` map ({ [actionId]: fn }) to installHotkeys().
//
// The table is an operator preference, so it lives in localStorage (never
// Supabase). Stored shape, per config.storageKey:
//   { version: 1, bindings: { <actionId>: [ <combo>, ... ] } }
//
// Combo strings: optional "Shift+" prefix + a key name — KeyboardEvent.key
// lower-cased for single characters ("q", "1", "s"), "Space" for the space
// bar, the raw name otherwise ("ArrowLeft", "Enter"). Ctrl/Meta/Alt are never
// part of a combo (those chords belong to the browser).

export const HOTKEYS_VERSION = 1
export const HOTKEYS_CHANGED_EVENT = 'cc-hotkeys-changed'   // window event, detail: { storageKey }

// Combos that fire even while typing in an input/textarea/select (they never
// conflict with the numbers/letters typed into coordinate fields).
const TYPING_SAFE_COMBOS = new Set(['Space'])

export function defaultBindings(config) {
  return Object.fromEntries(config.actions.map(a => [a.id, [...a.keys]]))
}

// Merges whatever is stored over the defaults: unknown actions are dropped and
// actions missing/invalid in storage fall back to their default combos, so an
// old or hand-edited entry can never leave an action unbound by accident.
export function loadHotkeys(storage, config) {
  const bindings = defaultBindings(config)
  try {
    const raw = JSON.parse(storage.getItem(config.storageKey) || 'null')
    if (raw && raw.version === HOTKEYS_VERSION && raw.bindings && typeof raw.bindings === 'object') {
      for (const id of Object.keys(bindings)) {
        const v = raw.bindings[id]
        if (Array.isArray(v) && v.length && v.every(k => typeof k === 'string' && k)) bindings[id] = v
      }
    }
  } catch { /* storage unavailable or corrupt JSON: use defaults */ }
  return bindings
}

export function saveHotkeys(storage, config, bindings) {
  try {
    storage.setItem(config.storageKey, JSON.stringify({ version: HOTKEYS_VERSION, bindings }))
  } catch { return false }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(HOTKEYS_CHANGED_EVENT, { detail: { storageKey: config.storageKey } }))
  }
  return true
}

// First run: persist the defaults so the table is visible/editable in storage.
export function ensureHotkeysStored(storage, config) {
  try {
    if (storage.getItem(config.storageKey) == null) saveHotkeys(storage, config, defaultBindings(config))
  } catch { /* ignore */ }
}

// Map<combo, actionId>. If two actions claim the same combo the first one wins
// and the clash is listed in `conflicts`.
export function buildLookup(config, bindings) {
  const lookup = new Map()
  const conflicts = []
  for (const a of config.actions) {
    for (const combo of bindings[a.id] || []) {
      if (lookup.has(combo)) conflicts.push({ combo, actions: [lookup.get(combo), a.id] })
      else lookup.set(combo, a.id)
    }
  }
  return { lookup, conflicts }
}

// The action (other than the binding being edited) that already owns `combo`,
// or null. Used by the settings UI to refuse a duplicate instead of silently
// stealing the key. `except` = { actionId, index } of the slot being edited.
export function findConflict(config, bindings, combo, except) {
  for (const a of config.actions) {
    const combos = bindings[a.id] || []
    for (let i = 0; i < combos.length; i++) {
      if (except && a.id === except.actionId && i === except.index) continue
      if (combos[i] === combo) return a
    }
  }
  return null
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS'])
export const isModifierKey = e => MODIFIER_KEYS.has(e.key)

// Combo string for a keydown event, or null when Ctrl/Meta/Alt is held.
export function comboFromEvent(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  let key = e.key
  if (key === ' ') key = 'Space'
  else if (key && key.length === 1) key = key.toLowerCase()
  if (!key) return null
  return (e.shiftKey ? 'Shift+' : '') + key
}

const KEY_LABELS = { Space: 'Espacio', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' }
// "Shift+s" -> "Shift+S", "ArrowLeft" -> "←", "Space" -> "Espacio"
export function showCombo(combo) {
  const shift = combo.startsWith('Shift+')
  const key = shift ? combo.slice(6) : combo
  const label = KEY_LABELS[key] || (key.length === 1 ? key.toUpperCase() : key)
  return (shift ? 'Shift+' : '') + label
}

// Set on <html> by the settings panel while it is open; hotkeys are suspended
// then so re-binding a key never triggers the action it is bound to.
export const isSettingsOpen = () =>
  typeof document !== 'undefined' && document.documentElement.dataset.ccSettingsOpen === '1'

function isTypingTarget(el) {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

// Installs the document-level keydown handler.
//   run:       { [actionId]: () => void }
//   onChange:  (bindings) => void — called once now and whenever the table
//              changes (settings panel in this tab, or another tab)
// Rules: hotkeys are ignored while typing in an input/textarea/select, except
// Escape (blurs the field) and the typing-safe combos (Space).
export function installHotkeys({ config, run, onChange, storage = localStorage }) {
  ensureHotkeysStored(storage, config)
  let bindings, lookup
  const reload = () => {
    bindings = loadHotkeys(storage, config)
    lookup = buildLookup(config, bindings).lookup
    onChange?.(bindings)
  }
  reload()

  window.addEventListener(HOTKEYS_CHANGED_EVENT, e => { if (e.detail?.storageKey === config.storageKey) reload() })
  window.addEventListener('storage', e => { if (e.key === null || e.key === config.storageKey) reload() })

  const actionById = id => config.actions.find(a => a.id === id)

  document.addEventListener('keydown', e => {
    if (isSettingsOpen()) return
    const typing = isTypingTarget(e.target) || isTypingTarget(document.activeElement)
    if (e.key === 'Escape') {                       // the one non-bound key allowed while typing
      if (typing) document.activeElement.blur()
      return
    }
    if (e.isComposing) return
    const combo = comboFromEvent(e)
    if (!combo) return
    if (typing && !TYPING_SAFE_COMBOS.has(combo)) return
    const id = lookup.get(combo)
    if (!id) return
    e.preventDefault()                              // no page scroll, no space typed, no native button activation
    if (e.repeat && !actionById(id)?.repeat) return
    if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur()
    run[id]?.()
  })

  return { getBindings: () => bindings, reload }
}
