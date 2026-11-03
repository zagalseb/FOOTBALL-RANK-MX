// settings-panel.js — reusable "Configuración" button + modal for the capture
// pages. Same convention as auth_gate.js: injects its own styles (hard-coded
// colours, `cc-` prefixed ids/classes) and puts its button in the page's
// <header>, so it doesn't depend on any page's markup or CSS variables.
//
// It knows nothing about what it configures: a page hands it `sections`
//   { id, label, render(container, ctx) -> (cleanup fn)? }
// and each one becomes a tab. Adding another kind of setting later = adding
// another section object, no change here.
//
//   import { mountSettingsPanel } from '../../shared/settings-panel.js'
//   import { hotkeysSection }     from '../../shared/settings-hotkeys.js'
//   mountSettingsPanel({ sections: [hotkeysSection(MY_HOTKEYS)] })
//
// While the modal is open <html data-cc-settings-open="1"> is set (shared/
// hotkeys.js suspends page hotkeys on it).

const STYLE_ID = 'cc-settings-style'
const GEAR_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    #cc-settings-btn {
      margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
      font-size: 12px; font-weight: 600; color: #8a95a3; font-family: inherit;
      background: transparent; border: 1px solid #2b3440; border-radius: 6px;
      padding: 6px 12px; cursor: pointer; flex-shrink: 0;
    }
    #cc-settings-btn:hover { color: #fff; border-color: #3b4552; }
    #cc-settings-btn + #cc-logout-btn { margin-left: 8px; }

    #cc-settings-overlay {
      position: fixed; inset: 0; z-index: 99998; background: rgba(5,8,12,0.72);
      display: flex; align-items: center; justify-content: center; padding: 20px;
      font-family: 'Inter', system-ui, sans-serif;
    }
    #cc-settings-overlay[hidden] { display: none; }
    .cc-settings-card {
      width: 560px; max-width: 100%; max-height: 100%; display: flex; flex-direction: column;
      background: #12181f; border: 1px solid #232b35; border-radius: 10px; color: #e8eaed; overflow: hidden;
    }
    .cc-settings-head { display: flex; align-items: center; padding: 14px 18px 0; }
    .cc-settings-title { font-size: 15px; font-weight: 800; color: #fff; letter-spacing: 0.3px; }
    .cc-settings-close {
      margin-left: auto; width: 26px; height: 26px; border-radius: 6px; border: 1px solid transparent;
      background: transparent; color: #8a95a3; font-size: 18px; line-height: 1; cursor: pointer;
    }
    .cc-settings-close:hover { color: #fff; border-color: #2b3440; }
    .cc-settings-tabs { display: flex; gap: 4px; padding: 10px 18px 0; border-bottom: 1px solid #232b35; }
    .cc-settings-tab {
      background: transparent; border: none; border-bottom: 2px solid transparent; color: #8a95a3;
      font-size: 12px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase;
      padding: 8px 10px; cursor: pointer; font-family: inherit;
    }
    .cc-settings-tab:hover { color: #fff; }
    .cc-settings-tab[aria-selected="true"] { color: #fff; border-bottom-color: #3b82f6; }
    .cc-settings-body { padding: 16px 18px 18px; overflow-y: auto; }
  `
  document.head.appendChild(style)
}

export function mountSettingsPanel({ sections, title = 'Configuración' }) {
  if (document.getElementById('cc-settings-btn')) return null   // already mounted
  injectStyles()

  const tabs = [...sections]
  let overlay = null, bodyEl = null, tabsEl = null
  let activeId = null, cleanup = null, opener = null

  // ── Button (next to "Cerrar sesión" when auth_gate.js put one in the header) ──
  const btn = document.createElement('button')
  btn.id = 'cc-settings-btn'
  btn.type = 'button'
  btn.title = title
  btn.innerHTML = `${GEAR_SVG}<span>${title}</span>`
  const header = document.querySelector('header')
  const logout = document.getElementById('cc-logout-btn')
  if (logout && logout.parentElement) logout.parentElement.insertBefore(btn, logout)
  else if (header) header.appendChild(btn)
  else document.body.appendChild(btn)

  // ── Modal ──
  function build() {
    overlay = document.createElement('div')
    overlay.id = 'cc-settings-overlay'
    overlay.hidden = true
    overlay.innerHTML = `
      <div class="cc-settings-card" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="cc-settings-head">
          <span class="cc-settings-title">${title}</span>
          <button type="button" class="cc-settings-close" aria-label="Cerrar">×</button>
        </div>
        <div class="cc-settings-tabs" role="tablist"></div>
        <div class="cc-settings-body"></div>
      </div>`
    document.body.appendChild(overlay)
    bodyEl = overlay.querySelector('.cc-settings-body')
    tabsEl = overlay.querySelector('.cc-settings-tabs')
    overlay.querySelector('.cc-settings-close').addEventListener('click', close)
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) close() })
  }

  function renderTabs() {
    tabsEl.innerHTML = ''
    for (const s of tabs) {
      const t = document.createElement('button')
      t.type = 'button'
      t.className = 'cc-settings-tab'
      t.setAttribute('role', 'tab')
      t.setAttribute('aria-selected', String(s.id === activeId))
      t.textContent = s.label
      t.addEventListener('click', () => select(s.id))
      tabsEl.appendChild(t)
    }
  }

  function select(id) {
    if (cleanup) { try { cleanup() } catch (e) { console.error(e) } cleanup = null }
    activeId = id
    renderTabs()
    bodyEl.innerHTML = ''
    const s = tabs.find(x => x.id === id)
    if (s) cleanup = s.render(bodyEl, { close }) || null
  }

  const onEsc = e => { if (e.key === 'Escape' && !e.defaultPrevented) close() }

  function open() {
    if (!overlay) build()
    if (!tabs.length) return
    opener = document.activeElement
    overlay.hidden = false
    document.documentElement.dataset.ccSettingsOpen = '1'
    document.addEventListener('keydown', onEsc)
    select(activeId && tabs.some(s => s.id === activeId) ? activeId : tabs[0].id)
    overlay.querySelector('.cc-settings-close').focus()
  }

  function close() {
    if (!overlay || overlay.hidden) return
    if (cleanup) { try { cleanup() } catch (e) { console.error(e) } cleanup = null }
    overlay.hidden = true
    delete document.documentElement.dataset.ccSettingsOpen
    document.removeEventListener('keydown', onEsc)
    if (opener && opener.focus) opener.focus()
  }

  btn.addEventListener('click', open)

  return {
    open, close,
    isOpen: () => !!overlay && !overlay.hidden,
    addSection(section) { tabs.push(section); if (overlay && !overlay.hidden) renderTabs() },
  }
}
