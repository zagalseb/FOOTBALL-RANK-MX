// settings-hotkeys.js — "Hotkeys" section for shared/settings-panel.js.
// Lists every action of a page's hotkey table (shared/hotkeys.js config) with
// its assigned key(s). Click a key badge -> "press the new key" -> it is saved
// straight to localStorage (no Save button). A key already used by another
// action is REFUSED with a message; nothing is ever unbound silently.

import {
  loadHotkeys, saveHotkeys, defaultBindings, findConflict,
  comboFromEvent, isModifierKey, showCombo,
} from './hotkeys.js'

const STYLE_ID = 'cc-settings-hotkeys-style'

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .cc-hk-intro { font-size: 12px; color: #8a95a3; margin: 0 0 12px; line-height: 1.5; }
    .cc-hk-list { display: flex; flex-direction: column; border: 1px solid #232b35; border-radius: 8px; overflow: hidden; }
    .cc-hk-row { display: flex; align-items: center; gap: 10px; padding: 5px 12px; border-bottom: 1px solid #1c232c; background: #0e1319; }
    .cc-hk-row:last-child { border-bottom: none; }
    .cc-hk-label { flex: 1; font-size: 13px; color: #e8eaed; }
    .cc-hk-keys { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
    .cc-hk-key {
      min-width: 54px; padding: 3px 10px; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 12px; font-weight: 700;
      color: #e8eaed; background: #1a2029; border: 1px solid #2b3440; border-bottom-width: 2px; border-radius: 6px; cursor: pointer;
    }
    .cc-hk-key:hover { border-color: #3b82f6; }
    .cc-hk-key--waiting { color: #93c5fd; border-color: #3b82f6; background: rgba(59,130,246,0.14); font-family: inherit; font-weight: 600; }
    .cc-hk-msg { min-height: 18px; margin: 10px 0 0; font-size: 12px; color: #8a95a3; }
    .cc-hk-msg--error { color: #f87171; }
    .cc-hk-msg--ok { color: #4ade80; }
    .cc-hk-foot { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
    .cc-hk-reset {
      margin-left: auto; font-size: 12px; font-weight: 600; color: #8a95a3; font-family: inherit;
      background: transparent; border: 1px solid #2b3440; border-radius: 6px; padding: 6px 12px; cursor: pointer;
    }
    .cc-hk-reset:hover { color: #fff; border-color: #3b4552; }
  `
  document.head.appendChild(style)
}

// config: { storageKey, actions } — same object passed to installHotkeys().
export function hotkeysSection(config, { storage = localStorage } = {}) {
  return {
    id: 'hotkeys',
    label: 'Hotkeys',
    render(container) {
      injectStyles()
      let bindings = loadHotkeys(storage, config)
      let waiting = null            // { actionId, index } while listening for a key
      let message = { text: '', kind: '' }
      let stopListening = null

      const setMessage = (text, kind = '') => { message = { text, kind } }

      function endWait() {
        if (stopListening) { stopListening(); stopListening = null }
        waiting = null
      }

      function startWait(actionId, index) {
        endWait()
        waiting = { actionId, index }
        setMessage('Presiona la nueva tecla… (Esc para cancelar)')
        // window + capture phase: runs before every page/document handler, and
        // stopImmediatePropagation keeps the key from reaching them.
        const onKey = e => {
          e.preventDefault(); e.stopImmediatePropagation()
          if (e.key === 'Escape') { endWait(); setMessage(''); draw(); return }
          if (isModifierKey(e)) return                       // wait for the real key
          if (e.key === 'Tab') { setMessage('Tab no se puede asignar.', 'error'); draw(); return }
          const combo = comboFromEvent(e)
          if (!combo) { setMessage('Ctrl / Alt / Cmd no se pueden usar; prueba otra tecla.', 'error'); draw(); return }
          const clash = findConflict(config, bindings, combo, waiting)
          if (clash) {
            setMessage(`Esa tecla ya está en "${clash.label}". Elige otra o cámbiala primero allá.`, 'error')
            draw(); return
          }
          const next = { ...bindings, [waiting.actionId]: bindings[waiting.actionId].map((c, i) => i === waiting.index ? combo : c) }
          if (!saveHotkeys(storage, config, next)) { setMessage('No se pudo guardar (almacenamiento no disponible).', 'error'); draw(); return }
          bindings = next
          endWait()
          setMessage(`Guardado: ${showCombo(combo)}`, 'ok')
          draw()
        }
        window.addEventListener('keydown', onKey, true)
        stopListening = () => window.removeEventListener('keydown', onKey, true)
        draw()
      }

      function reset() {
        endWait()
        bindings = defaultBindings(config)
        saveHotkeys(storage, config, bindings)
        setMessage('Valores restablecidos.', 'ok')
        draw()
      }

      function draw() {
        container.innerHTML = ''
        const intro = document.createElement('p')
        intro.className = 'cc-hk-intro'
        intro.textContent = 'Haz clic en una tecla para reasignarla; se guarda al instante. Espacio siempre funciona aunque estés escribiendo en un campo.'
        container.appendChild(intro)

        const list = document.createElement('div')
        list.className = 'cc-hk-list'
        for (const a of config.actions) {
          const row = document.createElement('div')
          row.className = 'cc-hk-row'
          const label = document.createElement('span')
          label.className = 'cc-hk-label'
          label.textContent = a.label
          const keys = document.createElement('div')
          keys.className = 'cc-hk-keys'
          ;(bindings[a.id] || []).forEach((combo, i) => {
            const b = document.createElement('button')
            b.type = 'button'
            const isWaiting = waiting && waiting.actionId === a.id && waiting.index === i
            b.className = 'cc-hk-key' + (isWaiting ? ' cc-hk-key--waiting' : '')
            b.textContent = isWaiting ? 'Presiona una tecla…' : showCombo(combo)
            b.addEventListener('click', () => startWait(a.id, i))
            keys.appendChild(b)
          })
          row.append(label, keys)
          list.appendChild(row)
        }
        container.appendChild(list)

        const msg = document.createElement('p')
        msg.className = 'cc-hk-msg' + (message.kind ? ` cc-hk-msg--${message.kind}` : '')
        msg.textContent = message.text
        msg.setAttribute('role', 'status')
        container.appendChild(msg)

        const foot = document.createElement('div')
        foot.className = 'cc-hk-foot'
        const resetBtn = document.createElement('button')
        resetBtn.type = 'button'
        resetBtn.className = 'cc-hk-reset'
        resetBtn.textContent = 'Restablecer valores'
        resetBtn.addEventListener('click', reset)
        foot.appendChild(resetBtn)
        container.appendChild(foot)
      }

      draw()
      return endWait          // cleanup: panel closed / tab switched
    },
  }
}
