// Corrección de tackles (rama proposal/defensa-tackles): computeDefenseStats
// por jugador y por equipo ANTES vs DESPUÉS, y Reports de captura
// (computePlayerStats) == viewer después del cambio.
// Uso:
//   mkdir -p /tmp/tk/antes /tmp/tk/despues
//   git show 341ca47:shared/stats-lib.js > /tmp/tk/antes/stats-lib.js
//   git show proposal/defensa-tackles:shared/stats-lib.js > /tmp/tk/despues/stats-lib.js
//   node debug/verify_individual/tackles_antes_despues.mjs /tmp/tk/antes/stats-lib.js /tmp/tk/despues/stats-lib.js
import { loadLib, loadGame, GAMES, ok, done } from './common.mjs'

const [beforePath, afterPath] = process.argv.slice(2)
if (!beforePath || !afterPath) { console.error('Faltan las rutas de stats-lib.js antes y después (ver cabecera).'); process.exit(2) }
const B = await loadLib(beforePath), A = await loadLib(afterPath)
const F = ['solo', 'ast', 'sacks', 'tfl', 'ff', 'int', 'sackYds', 'qbh', 'pbu']

for (const gid of Object.values(GAMES)) {
  const { plays, h, a, rosters: ros } = await loadGame(A, gid)
  const db = B.computeDefenseStats(plays, h, a, ros), da = A.computeDefenseStats(plays, h, a, ros)
  console.log(`\n######## ${gid.slice(0, 8)} (${a} @ ${h})`)
  const fields = {}
  for (const p of plays) for (const k of Object.keys(p)) if (/tackle_by$/.test(k) && Array.isArray(p[k]) && p[k].length) fields[k] = (fields[k] || 0) + 1
  console.log(' Campos de tackle con datos:', JSON.stringify(fields))
  for (const team of [a, h]) {
    const tot = d => F.reduce((o, f) => (o[f] = Object.values(d[team] || {}).reduce((s, r) => s + r[f], 0), o), {})
    const tb = tot(db), ta = tot(da)
    console.log(` ${team} — Tackles ${tb.solo + tb.ast} → ${ta.solo + ta.ast} (solo ${tb.solo}→${ta.solo}, ast ${tb.ast}→${ta.ast}) · Sacks ${tb.sacks}→${ta.sacks} · TFL ${tb.tfl}→${ta.tfl} · FF ${tb.ff}→${ta.ff} · INT ${tb.int}→${ta.int}`)
    for (const k of new Set([...Object.keys(db[team] || {}), ...Object.keys(da[team] || {})])) {
      const x = db[team]?.[k], y = da[team]?.[k]
      const diff = F.filter(f => (x?.[f] || 0) !== (y?.[f] || 0))
      if (diff.length) console.log(`   ${(x || y).label.padEnd(24)} ${diff.map(f => `${f} ${x?.[f] || 0}→${y?.[f] || 0}`).join(' · ')}${!x ? '  (NUEVO en este equipo)' : ''}${!y ? '  (SALE de este equipo)' : ''}`)
    }
  }
  let mism = 0, n = 0
  for (const team of [a, h]) for (const [k, d] of Object.entries(da[team] || {})) {
    const num = Number(/^#(\d+)/.exec(d.label)?.[1]); if (Number.isNaN(num)) continue
    const ps = A.computePlayerStats(plays, { id: k, number: num }, team, ros[team]).defense || {}
    n++
    for (const f of ['solo', 'ast', 'sacks', 'tfl', 'ff', 'int']) if ((ps[f] || 0) !== d[f]) { mism++; console.log(`   ✗ Reports ≠ viewer: ${team} ${d.label} ${f} ${ps[f] || 0} vs ${d[f]}`) }
  }
  ok(!mism, `Reports de captura (computePlayerStats) = viewer después del cambio (${n} jugadores)`)
}
done()
