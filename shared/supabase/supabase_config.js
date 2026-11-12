export const SUPABASE_URL = 'https://rlttycaajdsqovxjdjvx.supabase.co'
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJsdHR5Y2FhamRzcW92eGpkanZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MTMyNDcsImV4cCI6MjEwMjQ4OTI0N30.XgFQSVBpjs6N8QdshnC_uSJc1Mql8v9ix5_BDemGuao'

// Modo entrenamiento: mismo proyecto/URL/anon key, solo cambia el schema.
// Orden: ruta '/staging/' > ?env=staging|prod (persistido en sessionStorage
// 'fr_env' para que sobreviva la navegación en la misma pestaña) > 'prod'.
function detectEnv() {
  if (location.pathname.includes('/staging/')) return 'staging'
  try {
    const env = new URLSearchParams(location.search).get('env')
    if (env === 'staging') sessionStorage.setItem('fr_env', 'staging')
    else if (env === 'prod') sessionStorage.removeItem('fr_env')
    return sessionStorage.getItem('fr_env') === 'staging' ? 'staging' : 'prod'
  } catch {
    return 'prod'
  }
}

export const ENV = detectEnv()
export const SCHEMA = ENV === 'staging' ? 'covercero_staging' : 'covercero'

// Claves de localStorage con estado del partido: prod conserva el nombre
// original (no se pierden datos existentes); staging usa un sufijo propio.
export const envKey = name => (ENV === 'staging' ? `${name}__staging` : name)

export const SUPABASE_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Accept-Profile': SCHEMA,
  'Content-Profile': SCHEMA,
}

if (ENV === 'staging') {
  const showTrainingBanner = () => {
    if (document.getElementById('fr-env-banner')) return
    if (!document.title.startsWith('[ENTRENAMIENTO] ')) document.title = '[ENTRENAMIENTO] ' + document.title
    const exitUrl = new URL(location.href)
    exitUrl.searchParams.set('env', 'prod')
    const pill = document.createElement('div')
    pill.id = 'fr-env-banner'
    pill.style.cssText = 'position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:2147483647;' +
      'background:#ff9800;color:#000;font:600 13px/1.3 system-ui,sans-serif;padding:8px 14px;border-radius:999px;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.35);max-width:calc(100vw - 32px);text-align:center;'
    pill.textContent = 'MODO ENTRENAMIENTO · datos separados, no cuentan para stats reales '
    const exit = document.createElement('a')
    exit.href = exitUrl.href
    exit.textContent = 'Salir'
    exit.style.cssText = 'color:#000;text-decoration:underline;margin-left:6px;font-weight:700;'
    pill.appendChild(exit)
    document.body.appendChild(pill)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showTrainingBanner)
  else showTrainingBanner()
}
