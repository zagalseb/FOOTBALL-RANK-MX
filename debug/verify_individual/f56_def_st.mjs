// Fases 5 y 6: Individual > Defensiva y Equipos Especiales (constructores
// reales de viewer.html) vs la columna Defensiva / Equipos Especiales de
// "{Apodo} Stats". Diferencias esperadas en Despejes: la pestaña nueva no
// cuenta despejes anulados por bandera, fake punts ni snaps malos, y mide los
// downed/muffed (la existente les pone 0 yardas).
// Uso: node debug/verify_individual/f56_def_st.mjs [-v] [ruta stats-lib.js]
import { loadLib, loadGame, GAMES, SRC, ok, done } from './common.mjs'

const args = process.argv.slice(2)
const VERBOSE = args.includes('-v')
const L = await loadLib(args.find(x => !x.startsWith('-')))
const Bld = new Function('L', `const { _playerKeyLabel, calcNetYards, isTouchdown, resolvePlay, _blockedPuntEnd, _blockedPuntRunner } = L;
${SRC.f56Builders()}\nreturn { _buildIndDefense, _buildIndSpecialTeams };`)(L)

for (const gid of Object.values(GAMES)) {
  const { plays, h, a, teams, rosters } = await loadGame(L, gid)
  const defS = L.computeDefenseStats(plays, h, a, rosters)
  const ints = L.computeTurnoverStatsByPlayer(plays, h, a, teams, rosters).interceptions
  const st = L.computeSpecialTeamsStats(plays, h, a, teams, rosters)
  console.log(`\n######## ${gid.slice(0, 8)} (${a} @ ${h})`)
  for (const tm of [a, h]) {
    // ---- Defensiva vs DefenseTable de "{Apodo} Stats" ----
    const D = Bld._buildIndDefense(defS, ints, tm)
    const byLabel = Object.fromEntries(D.tackles.map(r => [r.label, r]))
    const passBy = Object.fromEntries(D.pass.map(r => [r.label, r]))
    const mism = [], omitted = []
    for (const o of Object.values(defS[tm] || {})) {
      const n = byLabel[o.label]
      if (!n) { if (o.solo + o.ast + o.tfl + o.sacks + o.ff > 0) mism.push(`${o.label} falta`); else omitted.push(o.label) }
      else for (const [f, v] of [['solo', o.solo], ['ast', o.ast], ['total', o.solo + o.ast], ['tfl', o.tfl], ['sacks', o.sacks], ['ff', o.ff]]) if (n[f] !== v) mism.push(`${o.label} ${f} ${n[f]}≠${v}`)
      if ((passBy[o.label]?.int || 0) !== o.int) mism.push(`${o.label} INT ${passBy[o.label]?.int || 0}≠${o.int}`)
      if ((passBy[o.label]?.pbu || 0) !== o.pbu) mism.push(`${o.label} PBU ${passBy[o.label]?.pbu || 0}≠${o.pbu}`)
    }
    ok(!mism.length, `${tm} Defensiva = {Apodo} Stats: ${D.tackles.length} filas en Tackles, ${D.pass.length} en Defensa de pase${mism.length ? ' · ' + mism.join('; ') : ''}${omitted.length ? ` · fuera de Tackles (solo INT/PBU/QBH): ${omitted.join(', ')}` : ''}`)
    if (VERBOSE) {
      for (const r of D.tackles) console.log(`      T ${r.label.padEnd(22)} ${r.solo} ${r.ast} ${r.total} tfl${r.tfl} sk${r.sacks} ff${r.ff}`)
      for (const r of D.pass) console.log(`      P ${r.label.padEnd(22)} INT ${r.int} yds ${r.yds} PBU ${r.pbu}`)
    }

    // ---- Equipos Especiales vs columna 3 de "{Apodo} Stats" ----
    const E = Bld._buildIndSpecialTeams(plays, st, rosters, h, a, tm)
    const oldFg = st.fgs.filter(r => r.team === tm)
    const fga = E.kicking.reduce((s, r) => s + r.fga, 0), fgm = E.kicking.reduce((s, r) => s + r.fgm, 0)
    ok(fga === oldFg.length && fgm === oldFg.filter(r => r.result === 'GOOD').length, `${tm} FG ${fgm}-${fga} = tabla Field Goals existente (${oldFg.filter(r => r.result === 'GOOD').length}-${oldFg.length})`)
    for (const r of E.kicking) console.log(`      FG/PAT ${r.label.padEnd(20)} FG ${r.fgm}-${r.fga} largo ${r.long ?? '—'} · PAT ${r.patm}-${r.pata} · Pts ${r.pts}`)
    for (const o of st.punting.filter(r => r.team === tm)) {
      const n = E.punting.find(r => r.label === o.label)
      const same = n && n.no === o.no && n.yds === o.yds && n.long === o.long && n.in20 === o.in20
      console.log(`    ${same ? '✓' : '≠'} Despejes ${o.label}: existente No.${o.no} Yds ${o.yds} Largo ${o.long} In20 ${o.in20} · nuevo ${n ? `No.${n.no} Yds ${n.yds} Largo ${n.long} In20 ${n.in20}` : '(no aparece)'}`)
    }
    ok(JSON.stringify(E.kickoffs) === JSON.stringify(st.kickoffs.filter(r => r.team === tm)), `${tm} Kickoffs = existentes (${E.kickoffs.map(r => `${r.label} ${r.no}/${r.yds}/TB${r.tb}`).join(', ') || 'ninguno'})`)
    for (const [k, nm] of [['kickReturns', 'Ret. patadas'], ['puntReturns', 'Ret. despejes']]) {
      const o = st[k].filter(r => r.team === tm)
      ok(E[k].length === o.length && E[k].every((r, i) => r.no === o[i].no && r.yds === o[i].yds && r.long === o[i].long),
         `${tm} ${nm} = existentes (${E[k].map(r => `${r.label} ${r.no}/${r.yds}/L${r.long}/TD${r.td}`).join(', ') || 'ninguno'})`)
    }
  }
}
done()
