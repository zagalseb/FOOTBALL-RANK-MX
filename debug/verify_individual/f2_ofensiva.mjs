// Fase 2: Individual > Ofensiva vs "{Apodo} Stats" y Team Stats.
// Uso: node debug/verify_individual/f2_ofensiva.mjs [ruta stats-lib.js]
import { loadLib, loadGame, GAMES, ok, done } from './common.mjs'

const L = await loadLib(process.argv[2])
const split = l => { const m = /^#(\S+)\s*(.*)$/.exec(String(l || '').trim()); return m ? [m[1], m[2] || '—'] : ['—', l || 'Desconocido'] }
const avg = (n, d) => d ? (n / d).toFixed(1) : '—'

for (const gid of Object.values(GAMES)) {
  const { plays, h, a, rosters, g } = await loadGame(L, gid)
  const { passers, rushers, receivers } = L.buildOffenseMaps(plays, h, a, rosters)
  const qbInt = {}; L.computeQBProgression(plays, rosters).forEach(q => { qbInt[`${q.team}::${q.key}`] = q.int })
  console.log(`\n######## ${gid.slice(0, 8)} ${a} (${g.away.nombre_corto}) @ ${h} (${g.home.nombre_corto}) · ${plays.length} jugadas`)
  for (const t of [a, h]) {
    console.log(` ${t} PASE  Uni Nombre | Rating Comp Att Int % Yds TD Largo Capturas`)
    for (const [k, d] of Object.entries(passers[t] || {}).sort((x, y) => y[1].att - x[1].att)) {
      const int = qbInt[`${t}::${k}`] || 0, r = L._passerRating(d.comp, d.att, d.yds, d.td, int)
      console.log(`   ${split(d.label).join(' ')} | ${r != null ? r.toFixed(1) : '—'} ${d.comp} ${d.att} ${int} ${d.att ? (100 * d.comp / d.att).toFixed(1) : '—'} ${d.yds} ${d.td} ${d.long} ${d.sacked ? `${d.sacked}-${d.sackedYds}` : 0}`)
    }
    console.log(` ${t} RECEPCIÓN  Rec Yds Prom TD Largo`)
    for (const d of Object.values(receivers[t] || {}).sort((x, y) => y.yds - x.yds)) console.log(`   ${split(d.label).join(' ')} | ${d.rec} ${d.yds} ${avg(d.yds, d.rec)} ${d.td} ${d.long}`)
    console.log(` ${t} CARRERA  Att Ganadas Netas Prom TD Largo`)
    for (const d of Object.values(rushers[t] || {}).sort((x, y) => y.yds - x.yds)) console.log(`   ${split(d.label).join(' ')} | ${d.att} ${d.gained || 0} ${d.yds} ${avg(d.yds, d.att)} ${d.td} ${d.long}`)
    // Mismos mapas que "{Apodo} Stats" (buildRows) → por construcción idénticos; se comparan los totales con Team Stats.
    const cs = L.computeComparisonStats(plays, L.computeDrives(plays, h, a), h, a, { home: { name: h }, away: { name: a } })[t]
    const sum = (m, f) => Object.values(m[t] || {}).reduce((s, d) => s + d[f], 0)
    ok(sum(passers, 'comp') === cs.passCompletions && sum(passers, 'att') === cs.passAttempts && sum(passers, 'yds') === cs.passYds &&
       sum(rushers, 'att') === cs.rushPlays && sum(rushers, 'yds') === cs.rushYds,
       `${t} totales = Team Stats: pase ${sum(passers, 'comp')}-${sum(passers, 'att')} ${sum(passers, 'yds')} yds · carrera ${sum(rushers, 'att')}-${sum(rushers, 'yds')}`)
  }
}
done()
