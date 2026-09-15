// Login gate for capture/ pages ONLY — games.html, setup.html and
// covercero_live.html each import this as their very first <script
// type="module">. Module scripts are deferred (they run after the document
// is fully parsed, in source order) regardless of where their <script> tag
// sits, so importing this first here guarantees the overlay is in the DOM
// and covering the viewport before that page's own main script does
// anything — that's the "before any content" requirement, not the position
// of this <script> tag on the page.
//
// Operator accounts are created manually in the Supabase dashboard
// (Authentication → Users) — there is no public sign-up flow here by design.
//
// viewer/ (index.html, viewer.html) must NEVER import this file — it stays
// fully public and unauthenticated.
import { signIn, signOut, getSession, onAuthStateChange } from './auth_client.js'

function _injectStyles() {
  const style = document.createElement('style')
  style.textContent = `
    #cc-auth-overlay {
      position: fixed; inset: 0; z-index: 99999;
      background: #0b0f14; display: flex; align-items: center; justify-content: center;
      font-family: 'Inter', system-ui, sans-serif;
    }
    #cc-auth-overlay.cc-hidden { display: none; }
    #cc-auth-card {
      width: 320px; max-width: calc(100vw - 40px); background: #12181f;
      border: 1px solid #232b35; border-radius: 10px; padding: 28px 26px;
    }
    #cc-auth-card h1 {
      margin: 0 0 4px; font-size: 18px; font-weight: 800; color: #fff; letter-spacing: 0.3px;
    }
    #cc-auth-card p.cc-sub { margin: 0 0 20px; font-size: 12px; color: #8a95a3; }
    #cc-auth-card label {
      display: block; font-size: 11px; font-weight: 600; color: #8a95a3;
      letter-spacing: 0.4px; margin-bottom: 5px; text-transform: uppercase;
    }
    #cc-auth-card input {
      width: 100%; box-sizing: border-box; padding: 9px 10px; margin-bottom: 14px;
      background: #0b0f14; border: 1px solid #232b35; border-radius: 6px; color: #fff; font-size: 13px;
    }
    #cc-auth-card input:focus { outline: none; border-color: #3b82f6; }
    #cc-auth-card button[type="submit"] {
      width: 100%; padding: 10px; background: #3b82f6; border: none; border-radius: 6px;
      color: #fff; font-weight: 700; font-size: 13px; cursor: pointer;
    }
    #cc-auth-card button[type="submit"]:disabled { opacity: 0.6; cursor: default; }
    #cc-auth-error { color: #f87171; font-size: 12px; margin: -6px 0 14px; min-height: 14px; }
    #cc-logout-btn {
      margin-left: auto; font-size: 12px; font-weight: 600; color: #8a95a3;
      background: transparent; border: 1px solid #2b3440; border-radius: 6px;
      padding: 6px 12px; cursor: pointer; flex-shrink: 0;
    }
    #cc-logout-btn:hover { color: #fff; border-color: #3b4552; }
  `
  document.head.appendChild(style)
}

function _renderOverlay() {
  const overlay = document.createElement('div')
  overlay.id = 'cc-auth-overlay'
  overlay.innerHTML = `
    <div id="cc-auth-card">
      <h1>Cover Cero — Operador</h1>
      <p class="cc-sub">Inicia sesión para capturar o editar datos.</p>
      <form id="cc-auth-form">
        <label for="cc-auth-email">Email</label>
        <input id="cc-auth-email" type="email" autocomplete="username" required />
        <label for="cc-auth-password">Contraseña</label>
        <input id="cc-auth-password" type="password" autocomplete="current-password" required />
        <div id="cc-auth-error"></div>
        <button type="submit">Entrar</button>
      </form>
    </div>
  `
  document.body.appendChild(overlay)

  const form   = overlay.querySelector('#cc-auth-form')
  const errBox = overlay.querySelector('#cc-auth-error')
  const btn    = overlay.querySelector('button[type="submit"]')

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    errBox.textContent = ''
    btn.disabled = true
    btn.textContent = 'Entrando…'
    const email    = overlay.querySelector('#cc-auth-email').value.trim()
    const password = overlay.querySelector('#cc-auth-password').value
    const { error } = await signIn(email, password)
    if (error) {
      errBox.textContent = 'Email o contraseña incorrectos.'
      btn.disabled = false
      btn.textContent = 'Entrar'
      return
    }
    btn.disabled = false
    btn.textContent = 'Entrar'
    // onAuthStateChange (wired below) hides the overlay once the session lands.
  })

  return overlay
}

// Appended into the page's own <header> (all 3 capture pages use a flex
// <header>), margin-left:auto pushes it to the far right — one consistent
// spot without depending on each page's differing header markup/classes.
function _injectLogoutButton() {
  if (document.getElementById('cc-logout-btn')) return
  const header = document.querySelector('header')
  if (!header) return
  const btn = document.createElement('button')
  btn.id = 'cc-logout-btn'
  btn.type = 'button'
  btn.textContent = 'Cerrar sesión'
  btn.addEventListener('click', () => signOut())
  header.appendChild(btn)
}

_injectStyles()
const _overlay = _renderOverlay()
_injectLogoutButton()

getSession().then(session => {
  if (session) _overlay.classList.add('cc-hidden')
})

onAuthStateChange((_event, session) => {
  if (session) _overlay.classList.add('cc-hidden')
  else _overlay.classList.remove('cc-hidden')
})
