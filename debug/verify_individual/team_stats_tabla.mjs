// Team Stats: tabla "Game Stats" (derecha) vs la lista de barras (izquierda),
// Comparación (panel Team Summary) e Individual > Ofensiva.
// Solo lectura. Corre el código real de viewer.html: el bloque
// TS_GAMESTATS_START/END, _teamPenaltySummary, _sumByTeam y las expresiones
// awayVal/homeVal de cada <StatRow> de ComparisonTab.
// Uso: node debug/verify_individual/team_stats_tabla.mjs [ruta stats-lib.js] [-v]
import { loadLib, loadGame, GAMES, ok, done, extract, viewerHtml } from './common.mjs'

const args = process.argv.slice(2)
const VERBOSE = args.includes('-v')
const L = await loadLib(args.find(x => !x.startsWith('-')))

// ── Código del viewer ───────────────────────────────────────────────────────
const src = [
  extract(/function _teamPenaltySummary[\s\S]*?\n}\n/),
  extract(/function _sumByTeam[\s\S]*?\n}\n/),
  extract(/\/\/ TS_GAMESTATS_START[\s\S]*?\/\/ TS_GAMESTATS_END/),
].join('\n')
const { _gameStatsRows } = new Function(`${src}\nreturn { _gameStatsRows }`)()

// Expresiones de la lista (awayVal/homeVal de cada StatRow en ComparisonTab).
const compTab = extract(/function ComparisonTab\([\s\S]*?\n}\n/)
const fmtRatioSrc = compTab.match(/const fmtRatio = [^\n]*/)[0]
function braceExpr(s, i) { // s[i] === '{' → contenido hasta su '}' pareja
  let d = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') d++
    else if (s[j] === '}' && --d === 0) return s.slice(i + 1, j)
  }
  throw new Error('llave sin cerrar')
}
const LIST_ROWS = []
for (const m of compTab.matchAll(/<StatRow label="([^"]+)"/g)) {
  const rest = compTab.slice(m.index)
  const ai = rest.indexOf('awayVal={'), hi = rest.indexOf('homeVal={')
  LIST_ROWS.push({ label: m[1], away: braceExpr(rest, ai + 8), home: braceExpr(rest, hi + 8) })
}
const listFn = new Function('A', 'H', 'penA', 'penH', 'totalYdsA', 'totalYdsH',
  `${fmtRatioSrc}\nreturn {${LIST_ROWS.map(r => `${JSON.stringify(r.label)}: [${r.away}, ${r.home}]`).join(',')}}`)

// ── Mismo cableado que ComparisonTab ────────────────────────────────────────
function period(plays, drives, h, a, teams, rosters, q) {
  const pp = q === 'all' ? plays : plays.filter(p => p.quarter === q)
  const pd = q === 'all' ? drives : L.computeDrives(pp, h, a)
  const stats = L.computeComparisonStats(pp, pd, h, a, teams)
  const penalties = L.computePenalties(pp, h)
  const special = L.computeSpecialTeamsStats(pp, h, a, teams, rosters)
  const turnovers = L.computeTurnoverStatsByPlayer(pp, h, a, teams, rosters)
  const rows = _gameStatsRows({ stats, penalties, special, turnovers, homeAbbr: h, awayAbbr: a })
  const pen = t => penalties.filter(r => r.team === t && r.result === 'accepted')
  const penS = t => ({ count: pen(t).length, yards: pen(t).reduce((s, r) => s + (r.yards || 0), 0) })
  const A = stats[a], H = stats[h]
  const list = listFn(A, H, penS(a), penS(h), A.passYds + A.rushYds, H.passYds + H.rushYds)
  return { rows, list, stats, byKey: Object.fromEntries(rows.map(r => [r.key, r])) }
}

const nums = v => { const m = /^(-?\d+)-(-?\d+)(?:-(-?\d+))?$/.exec(String(v)); return m ? m.slice(1).filter(x => x != null).map(Number) : null }
const r1 = (n, d) => d > 0 ? (Math.round((n / d) * 10) / 10).toFixed(1) : '—'
const ADDITIVE = ['firstDowns', 'rushAtt', 'rushYds', 'rec', 'recYds', 'passYds', 'cai', 'playsYds', 'kr', 'pr', 'ints', 'fumRet', 'fumLost', 'pen', 'third', 'fourth']

for (const gid of Object.values(GAMES)) {
  const { plays, h, a, rosters, teams, g } = await loadGame(L, gid)
  const drives = L.computeDrives(plays, h, a)
  console.log(`\n######## ${gid.slice(0, 8)} ${a} @ ${h} (${g.away.nombre_corto} @ ${g.home.nombre_corto}) · ${plays.length} jugadas`)
  const T = period(plays, drives, h, a, teams, rosters, 'all')
  if (VERBOSE) for (const r of T.rows) console.log(`   ${r.label.padEnd(28)} ${String(r.away).padStart(9)} ${String(r.home).padStart(9)}  ${r.lead ? '← ' + r.lead : ''}`)

  for (const [side, t, i] of [['away', a, 0], ['home', h, 1]]) {
    const R = k => T.byKey[k][side]
    const Lv = lbl => T.list[lbl]?.[i]
    const s = T.stats[t]
    console.log(` ${t}`)
    // (a) filas repetidas lista ↔ tabla
    const [plays_, yds_] = nums(R('playsYds'))
    const pairs = [
      ['1st Downs', 'Primeros downs', Lv('1st Downs'), R('firstDowns')],
      ['Rush Yds', 'Yardas por tierra', Lv('Rush Yds'), R('rushYds')],
      ['Pass Yds', 'Yardas por aire', Lv('Pass Yds'), R('passYds')],
      ['Penalties', 'Penalizaciones', Lv('Penalties'), R('pen')],
      ['Fumbles-Lost', 'Fumbles perdidos', Lv('Fumbles-Lost'), R('fumLost')],
      ['Offensive Plays', 'Jugadas (de Jugadas-Yardas)', Lv('Offensive Plays'), plays_],
      ['Total Yds', 'Yardas (de Jugadas-Yardas)', Lv('Total Yds'), yds_],
      ['Avg Yds/Play', 'Yardas/Jugada', Lv('Avg Yds/Play'), R('ydsPerPlay')],
      ['Avg Yds/Rush', 'Promedio por acarreo', Lv('Avg Yds/Rush'), R('rushAvg')],
      ['Avg Yds/Completion', 'Promedio por recepción', Lv('Avg Yds/Completion'), R('recAvg')],
    ]
    // 3rd/4th Downs: la lista muestra "—" sin intentos (y oculta la fila si ningún equipo tiene); la tabla "0-0".
    for (const [lbl, key, att] of [['3rd Downs', 'third', s.thirdAtt], ['4th Downs', 'fourth', s.fourthAtt]]) {
      if (Lv(lbl) === undefined) console.log(`    · ${lbl}: la lista no muestra la fila (sin intentos); tabla ${R(key)}`)
      else if (att === 0) ok(Lv(lbl) === '—' && R(key) === '0-0', `(a) ${lbl}: lista "—" ↔ tabla "0-0" (sin intentos; solo cambia el formato)`)
      else pairs.push([lbl, key === 'third' ? '3er down' : '4to down', Lv(lbl), R(key)])
    }
    for (const [ll, tl, lv, tv] of pairs) ok(String(lv) === String(tv), `(a) ${ll} = ${tl}: ${lv} | ${tv}`)

    // (b) Acarreos + intentos de pase = Jugadas (sacks, scrambles y grounding ya van en Acarreos)
    const [, att] = nums(R('cai'))
    ok(R('rushAtt') + att === plays_, `(b) Acarreos ${R('rushAtt')} + intentos ${att} = Jugadas ${plays_}`)
    // (c) tierra + aire = Total Yds de la lista
    ok(R('rushYds') + R('passYds') === Lv('Total Yds'), `(c) ${R('rushYds')} + ${R('passYds')} = Total Yds ${Lv('Total Yds')}`)
    // (d) promedios
    const [comp] = nums(R('cai'))
    ok(R('rushAvg') === r1(R('rushYds'), R('rushAtt')) && R('recAvg') === r1(R('recYds'), R('rec')) && R('ydsPerPlay') === r1(yds_, plays_) && R('rec') === comp,
      `(d) promedios: acarreo ${R('rushAvg')} · recepción ${R('recAvg')} · jugada ${R('ydsPerPlay')}`)
    const pu = /^(\d+)-(\d+\.\d|0)$/.exec(R('punts'))
    const puRows = L.computeSpecialTeamsStats(plays, h, a, teams, rosters).punting.filter(r => r.team === t)
    const puNo = puRows.reduce((x, r) => x + r.no, 0), puYds = puRows.reduce((x, r) => x + r.yds, 0)
    ok(pu && Number(pu[1]) === puNo && (puNo ? pu[2] === (puYds / puNo).toFixed(1) : pu[2] === '0'), `(d) Despejes ${R('punts')} = ${puNo} despejes, ${puYds} yds`)
  }

  // (e) suma de cuartos = Totals (filas numéricas aditivas). Incluye OT si la hay.
  const qs = [...new Set(plays.map(p => p.quarter).filter(q => q != null))].sort()
  const P = qs.map(q => period(plays, drives, h, a, teams, rosters, q))
  for (const key of ADDITIVE) for (const side of ['away', 'home']) {
    const tot = [].concat(T.byKey[key][side]).flatMap(v => typeof v === 'number' ? [v] : nums(v))
    const sum = tot.map((_, j) => P.reduce((s, p) => { const v = p.byKey[key][side]; return s + (typeof v === 'number' ? v : nums(v)[j]) }, 0))
    ok(tot.join() === sum.join(), `(e) ${T.byKey[key].label} ${side}: Totals ${tot.join('-')} = Σ cuartos ${sum.join('-')}${qs.length > 4 ? ` (cuartos ${qs.join(',')})` : ''}`)
  }
  {
    const tot = ['away', 'home'].map(s => Number(T.byKey.punts[s].split('-')[0]))
    const sum = ['away', 'home'].map(s => P.reduce((x, p) => x + Number(p.byKey.punts[s].split('-')[0]), 0))
    ok(tot.join() === sum.join(), `(e) Despejes (cantidad): Totals ${tot.join('/')} = Σ cuartos ${sum.join('/')}`)
  }

  // (f) Recepciones / Yardas por recepción = suma de Individual > Ofensiva > Recepción
  const { receivers } = L.buildOffenseMaps(plays, h, a, rosters)
  for (const [side, t] of [['away', a], ['home', h]]) {
    const rec = Object.values(receivers[t] || {}).reduce((s, d) => s + d.rec, 0)
    const yds = Object.values(receivers[t] || {}).reduce((s, d) => s + d.yds, 0)
    ok(rec === T.byKey.rec[side] && yds === T.byKey.recYds[side], `(f) ${t} Individual Σ ${rec} rec ${yds} yds = tabla ${T.byKey.rec[side]} rec ${T.byKey.recYds[side]} yds`)
  }

  // (g) Comparación (panel Team Summary, mismo cálculo que ComparacionTab)
  const cStats = L.computeComparisonStats(plays, drives, h, a, teams)
  const cPen = L.computePenalties(plays, h)
  const cTurn = L.computeTurnoverReturnYardsByTeam(plays, h, a, teams)
  const cSt = L.computeSpecialTeamsStats(plays, h, a, teams, rosters)
  const sumT = (rows, t) => rows.filter(r => r.team === t).reduce((x, r) => ({ no: x.no + r.no, yds: x.yds + r.yds }), { no: 0, yds: 0 })
  for (const [side, t] of [['away', a], ['home', h]]) {
    const acc = cPen.filter(r => r.team === t && r.result === 'accepted')
    const pen = `${acc.length}-${acc.reduce((s, r) => s + (r.yards || 0), 0)}`
    ok(pen === T.byKey.pen[side], `(g) ${t} PEN Comparación ${pen} = Penalizaciones ${T.byKey.pen[side]}`)
    ok(cStats[t].firstDowns === T.byKey.firstDowns[side], `(g) ${t} 1st DWN Comparación ${cStats[t].firstDowns} = Primeros downs ${T.byKey.firstDowns[side]}`)
    // Extra: KR/PR/INT/FUM yardas contra el panel de Comparación
    const yd = k => nums(T.byKey[k][side])[1]
    ok(sumT(cSt.kickReturns, t).yds === yd('kr') && sumT(cSt.puntReturns, t).yds === yd('pr') &&
       cTurn[t].intYds === yd('ints') && cTurn[t].fumYds === yd('fumRet'),
       `(g+) ${t} KR-YDS ${sumT(cSt.kickReturns, t).yds}/${yd('kr')} · PR-YDS ${sumT(cSt.puntReturns, t).yds}/${yd('pr')} · INT ${cTurn[t].intYds}/${yd('ints')} · FUM-YDS ${cTurn[t].fumYds}/${yd('fumRet')}`)
    // INT hechas por este equipo = INT lanzadas por el rival
    const opp = t === h ? a : h
    ok(nums(T.byKey.ints[side])[0] === cStats[opp].intsThrown, `(g+) ${t} intercepciones ${nums(T.byKey.ints[side])[0]} = INT lanzadas por ${opp} ${cStats[opp].intsThrown}`)
  }
  ok(T.rows.every(r => r.key !== 'top' || (r.away === '—' && r.home === '—')), 'Posesión: "—" en ambos equipos')
}
done()
