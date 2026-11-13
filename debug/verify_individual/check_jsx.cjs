// Compila el <script type="text/babel"> de viewer.html con el mismo Babel
// standalone (7.29.0) que carga la página, para detectar errores de JSX sin
// abrir el navegador.
// Uso (Babel fuera del repo):
//   npm i --prefix /tmp/babel @babel/standalone@7.29.0
//   node debug/verify_individual/check_jsx.cjs /tmp/babel/node_modules/@babel/standalone
const fs = require('fs')
const path = require('path')
const babelPath = process.argv[2]
if (!babelPath) { console.error('Falta la ruta de @babel/standalone (ver cabecera).'); process.exit(2) }
const B = require(path.resolve(babelPath))
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'live-stats', 'viewer', 'viewer.html'), 'utf8')
const m = html.match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/)
try { B.transform(m[1], { presets: ['react'] }); console.log('OK: JSX compila') }
catch (e) { console.log('ERROR', e.message); process.exit(1) }
