// settings-visualization.js — "Visualización" section for shared/settings-panel.js.
// Display preferences of a viewer page (toggles and small choice pickers). Same
// conventions as settings-hotkeys.js: every change is saved straight to
// localStorage (no Save button), "Restablecer valores" restores the defaults,
// and a window event tells the page to repaint. It is operator preference, not
// game data, so it never touches Supabase.
//
//   config = { storageKey, options: [
//     { id, label, type: 'toggle', default: true },
//     { id, label, type: 'choice', default: 'md', choices: [{ value, label }, ...] },
//   ] }
//
// Stored shape per storageKey: { version: 1, values: { [optionId]: value } }.
// Missing/invalid values fall back to the option's default.

export const VIEW_SETTINGS_VERSION = 1
export const VIEW_SETTINGS_CHANGED_EVENT = 'cc-view-settings-changed'   // window event, detail: { storageKey }

export function defaultViewSettings(config) {
  return Object.fromEntries(config.options.map(o => [o.id, o.default]))
}

function valid(opt, v) {
  return opt.type === 'toggle' ? typeof v === 'boolean' : opt.choices.some(c => c.value === v)
}

export function loadViewSettings(storage, config) {
  const out = defaultViewSettings(config)
  try {
    const raw = JSON.parse(storage.getItem(config.storageKey) || 'null')
    if (raw && raw.version === VIEW_SETTINGS_VERSION && raw.values) {
      for (const o of config.options) if (valid(o, raw.values[o.id])) out[o.id] = raw.values[o.id]
    }
  } catch { /* storage unavailable or corrupt JSON: use defaults */ }
  return out
}

export function saveViewSettings(storage, config, values) {
  try {
    storage.setItem(config.storageKey, JSON.stringify({ version: VIEW_SETTINGS_VERSION, values }))
  } catch { /* still repaint below with the in-memory values */ }
  window.dispatchEvent(new CustomEvent(VIEW_SETTINGS_CHANGED_EVENT, { detail: { storageKey: config.storageKey } }))
}

const STYLE_ID = 'cc-settings-visualization-style'

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .cc-vz-intro { font-size: 12px; color: #8a95a3; margin: 0 0 12px; line-height: 1.5; }
    .cc-vz-list { display: flex; flex-direction: column; border: 1px solid #232b35; border-radius: 8px; overflow: hidden; }
    .cc-vz-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid #1c232c; background: #0e1319; }
    .cc-vz-row:last-child { border-bottom: none; }
    .cc-vz-label { flex: 1; font-size: 13px; color: #e8eaed; }
    .cc-vz-switch {
      position: relative; width: 36px; height: 20px; border-radius: 10px; border: 1px solid #2b3440;
      background: #1a2029; cursor: pointer; padding: 0; flex-shrink: 0;
    }
    .cc-vz-switch::after {
      content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
      background: #8a95a3; transition: left 0.12s, background 0.12s;
    }
    .cc-vz-switch[aria-checked="true"] { background: rgba(59,130,246,0.25); border-color: #3b82f6; }
    .cc-vz-switch[aria-checked="true"]::after { left: 18px; background: #93c5fd; }
    .cc-vz-choices { display: flex; gap: 4px; }
    .cc-vz-choice {
      font-size: 12px; font-weight: 600; font-family: inherit; color: #8a95a3; background: #1a2029;
      border: 1px solid #2b3440; border-radius: 6px; padding: 4px 10px; cursor: pointer;
    }
    .cc-vz-choice:hover { color: #fff; }
    .cc-vz-choice[aria-pressed="true"] { color: #fff; border-color: #3b82f6; background: rgba(59,130,246,0.18); }
    .cc-vz-foot { display: flex; margin-top: 12px; }
    .cc-vz-reset {
      margin-left: auto; font-size: 12px; font-weight: 600; color: #8a95a3; font-family: inherit;
      background: transparent; border: 1px solid #2b3440; border-radius: 6px; padding: 6px 12px; cursor: pointer;
    }
    .cc-vz-reset:hover { color: #fff; border-color: #3b4552; }
  `
  document.head.appendChild(style)
}

export function visualizationSection(config, { storage = localStorage } = {}) {
  return {
    id: 'visualization',
    label: 'Visualización',
    render(container) {
      injectStyles()
      let values = loadViewSettings(storage, config)

      function set(id, value) {
        values = { ...values, [id]: value }
        saveViewSettings(storage, config, values)
        draw()
      }

      function draw() {
        container.innerHTML = ''
        const intro = document.createElement('p')
        intro.className = 'cc-vz-intro'
        intro.textContent = 'Los cambios se aplican al instante y se guardan en este navegador.'
        container.appendChild(intro)

        const list = document.createElement('div')
        list.className = 'cc-vz-list'
        for (const o of config.options) {
          const row = document.createElement('div')
          row.className = 'cc-vz-row'
          const label = document.createElement('span')
          label.className = 'cc-vz-label'
          label.textContent = o.label
          row.appendChild(label)

          if (o.type === 'toggle') {
            const sw = document.createElement('button')
            sw.type = 'button'
            sw.className = 'cc-vz-switch'
            sw.setAttribute('role', 'switch')
            sw.setAttribute('aria-checked', String(values[o.id]))
            sw.setAttribute('aria-label', o.label)
            sw.addEventListener('click', () => set(o.id, !values[o.id]))
            row.appendChild(sw)
          } else {
            const group = document.createElement('div')
            group.className = 'cc-vz-choices'
            for (const c of o.choices) {
              const b = document.createElement('button')
              b.type = 'button'
              b.className = 'cc-vz-choice'
              b.setAttribute('aria-pressed', String(values[o.id] === c.value))
              b.textContent = c.label
              b.addEventListener('click', () => set(o.id, c.value))
              group.appendChild(b)
            }
            row.appendChild(group)
          }
          list.appendChild(row)
        }
        container.appendChild(list)

        const foot = document.createElement('div')
        foot.className = 'cc-vz-foot'
        const reset = document.createElement('button')
        reset.type = 'button'
        reset.className = 'cc-vz-reset'
        reset.textContent = 'Restablecer valores'
        reset.addEventListener('click', () => {
          values = defaultViewSettings(config)
          saveViewSettings(storage, config, values)
          draw()
        })
        foot.appendChild(reset)
        container.appendChild(foot)
      }

      draw()
    },
  }
}
