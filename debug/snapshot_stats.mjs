#!/usr/bin/env node
// debug/snapshot_stats.mjs — Phase 0/4 baseline tool for the stats-lib.js /
// Edge Function refactor (read-only; never writes to Supabase).
//
// For each game id given, it:
//   1. Fetches games/plays/manual-stats exactly like viewer.html does
//      (same REST paths, same field lists).
//   2. Flattens plays the same way viewer.html's _flattenPlay() does.
//   3. Runs every stat-computing function the refactor cares about and
//      writes one JSON file per game under debug/snapshots/<label>.json.
//
// Function loading is dual-mode so the SAME script works before and after
// the refactor (the task asks for one reusable script, not two):
//   - Every function is first looked up as a real export of
//     shared/stats-lib.js (dynamic import). That's the only path once
//     Phase 1-3 land.
//   - Anything still missing after that (true only pre-refactor, for the
//     functions that today live inline in viewer.html) is recovered by
//     slicing its exact source text out of viewer.html (brace-counting,
//     not regex-guessing) and running it in a vm context alongside the
//     stats-lib.js exports it closes over. This is ONLY a baseline-capture
//     device — it doesn't change viewer.html, and it disappears on its own
//     once Phase 1-3 move those functions for real (the import above finds
//     them and this fallback is never reached).
//
// Usage: node debug/snapshot_stats.mjs <label>:<game_id> [<label>:<game_id> ...]

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OUT_DIR = path.join(HERE, 'snapshots')

const SB_URL = 'https://rlttycaajdsqovxjdjvx.supabase.co'
const SB_HEADERS = {
  apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJsdHR5Y2FhamRzcW92eGpkanZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MTMyNDcsImV4cCI6MjEwMjQ4OTI0N30.XgFQSVBpjs6N8QdshnC_uSJc1Mql8v9ix5_BDemGuao',
  Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJsdHR5Y2FhamRzcW92eGpkanZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MTMyNDcsImV4cCI6MjEwMjQ4OTI0N30.XgFQSVBpjs6N8QdshnC_uSJc1Mql8v9ix5_BDemGuao',
  'Accept-Profile': 'covercero',
}

async function sbFetch(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_HEADERS })
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`)
  return res.json()
}

// Mirrors viewer.html's _flattenPlay(): { ...columns, ...play_data } — every
// top-level column plus whatever the jsonb blob adds, jsonb keys winning on
// overlap (none expected in practice). NOT engine.js's _rowToPlay(), which
// additionally renames id->play_id and re-encodes submitted_at — a real
// behavior difference this refactor deliberately leaves alone (see report).
function flattenPlay(row) {
  const { play_data, ...rest } = row
  return { ...rest, ...(play_data || {}) }
}

// ── Dual-mode function loading ──────────────────────────────────────────────

async function loadStatsLib() {
  const mod = await import(path.join(ROOT, 'shared/stats-lib.js'))
  return mod
}

// Extracts `function NAME(...) { ... }` verbatim from a top-level-only
// (unindented) source file, by counting braces from the opening `{` — robust
// to nested braces/strings-with-braces inside, unlike a regex match.
function extractFunctionSource(src, name) {
  const re = new RegExp(`^function ${name}\\s*\\(`, 'm')
  const m = re.exec(src)
  if (!m) return null
  let i = src.indexOf('{', m.index)
  if (i === -1) return null
  let depth = 0, start = i
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break } }
  }
  return src.slice(m.index, i)
}

// The viewer-local wrapper these functions call instead of playerShortLabel
// directly (see stats-lib.js's own guard comment) — needed verbatim for the
// pre-refactor fallback path.
const PLAYER_LABEL_SRC = `function playerLabel(p) {
  if (!p) return null;
  return typeof playerShortLabel === 'function' ? playerShortLabel(p) : ('#' + p.number);
}`

// buildOffenseMaps(): the passers/rushers/receivers map construction that is
// inline inside a useMemo at viewer.html ~2612 today (not a standalone named
// function, so it can't be brace-extracted) — transcribed here verbatim as
// its own function for the pre-refactor fallback. Once Phase 1 exports a
// real stats-lib.js function for this, the import lookup below finds it and
// this copy is never used.
const BUILD_OFFENSE_MAPS_FALLBACK_SRC = `function buildOffenseMaps(plays, homeAbbr, awayAbbr) {
  const pa = {}, ru = {}, re = {};
  for (const p of plays) {
    const t = p.possession;
    if (t !== homeAbbr && t !== awayAbbr) continue;
    if (p.stats_count === false) continue;
    if (p.play_type === 'RUSH') {
      const yds = p.net_yards || 0;
      const key = p.rush_by ? playerLabel(p.rush_by) : 'Desconocido';
      if (!ru[t]) ru[t] = {};
      if (!ru[t][key]) ru[t][key] = { att:0, yds:0, td:0, gained:0, long:-Infinity };
      ru[t][key].att++;
      ru[t][key].yds += yds;
      if (yds > 0) ru[t][key].gained += yds;
      if (yds > ru[t][key].long) ru[t][key].long = yds;
      if (p.touchdown) ru[t][key].td++;
    }
    if (p.play_type === 'PASS' && (p.pass_result === 'scramble' || p.pass_result === 'sack')) {
      const yds = p.net_yards || 0;
      const key = p.pass_by ? playerLabel(p.pass_by) : 'Desconocido';
      if (!ru[t]) ru[t] = {};
      if (!ru[t][key]) ru[t][key] = { att:0, yds:0, td:0, gained:0, long:-Infinity };
      ru[t][key].att++;
      ru[t][key].yds += yds;
      if (yds > 0) ru[t][key].gained += yds;
      if (yds > ru[t][key].long) ru[t][key].long = yds;
      if (p.touchdown) ru[t][key].td++;
      if (p.pass_result === 'sack') {
        if (!pa[t]) pa[t] = {};
        if (!pa[t][key]) pa[t][key] = { att:0, comp:0, yds:0, td:0, long:-Infinity, sacked:0, sackedYds:0 };
        pa[t][key].sacked++;
        pa[t][key].sackedYds += Math.abs(yds);
      }
    }
    if (p.play_type === 'PASS' && p.pass_result !== 'scramble' && p.pass_result !== 'sack') {
      const key = p.pass_by ? playerLabel(p.pass_by) : 'Desconocido';
      if (!pa[t]) pa[t] = {};
      if (!pa[t][key]) pa[t][key] = { att:0, comp:0, yds:0, td:0, long:-Infinity, sacked:0, sackedYds:0 };
      pa[t][key].att++;
      if (p.pass_result === 'complete') {
        const yds = p.net_yards || 0;
        pa[t][key].comp++;
        pa[t][key].yds += yds;
        if (yds > pa[t][key].long) pa[t][key].long = yds;
        if (p.touchdown) pa[t][key].td++;
        if (p.received_by) {
          const rk = playerLabel(p.received_by);
          if (!re[t]) re[t] = {};
          if (!re[t][rk]) re[t][rk] = { rec:0, yds:0, td:0, long:-Infinity };
          re[t][rk].rec++;
          re[t][rk].yds += yds;
          if (yds > re[t][rk].long) re[t][rk].long = yds;
          if (p.touchdown) re[t][rk].td++;
        }
      }
    }
  }
  return { passers: pa, rushers: ru, receivers: re };
}`

const VIEWER_FALLBACK_NAMES = [
  'computeDefenseStats', 'computeSpecialTeamsStats', '_fumbleOccurred', '_fumbleCarrier',
  'computeFumbleStats', 'fumbleStatsToMap', 'computeTurnoverReturnYards',
  'computeTurnoverReturnYardsByTeam', 'computeTurnoverStatsByPlayer', 'computeAllPurposeMap',
  'computeQBProgression', 'computeExplosivePlays',
  '_passerRating', '_topManualStat', '_manualPassingRows', '_manualRushingRows', '_manualReceivingRows',
]

async function buildFunctionRegistry(statsLib) {
  const registry = { ...statsLib }

  // buildOffenseMaps is asked for under a name it doesn't have yet
  // (pre-refactor); only fall back if stats-lib.js doesn't export it.
  const missing = VIEWER_FALLBACK_NAMES.filter(n => typeof registry[n] !== 'function')
  const needsOffenseMaps = typeof registry.buildOffenseMaps !== 'function'
  if (!missing.length && !needsOffenseMaps) return { registry, source: 'stats-lib.js (fully migrated)' }

  const viewerSrc = fs.readFileSync(path.join(ROOT, 'live-stats/viewer/viewer.html'), 'utf8')
  const ctx = {
    ...statsLib,   // calcNetYards, isTouchdown, _effectiveNetYards, formatPlay, playerShortLabel, ...
    console,
  }
  vm.createContext(ctx)
  vm.runInContext(PLAYER_LABEL_SRC, ctx)
  for (const name of missing) {
    const src = extractFunctionSource(viewerSrc, name)
    if (!src) throw new Error(`Could not find function ${name} in viewer.html and it is not exported by stats-lib.js — Phase 0 baseline is incomplete.`)
    vm.runInContext(src, ctx)
    registry[name] = ctx[name]
  }
  if (needsOffenseMaps) {
    vm.runInContext(BUILD_OFFENSE_MAPS_FALLBACK_SRC, ctx)
    registry.buildOffenseMaps = ctx.buildOffenseMaps
  }
  return { registry, source: `stats-lib.js + viewer.html fallback for: ${missing.concat(needsOffenseMaps ? ['buildOffenseMaps'] : []).join(', ')}` }
}

// ── Player roster inference (no player table FK inside play_data — see the
// diagnosis report) — every distinct {number} that appears in any credited
// field, attributed to whichever team the field's credit rule says it
// belongs to (offense fields -> p.possession, defense fields -> the OTHER
// team). This is how a "stats for every player who showed up" sweep has to
// be built without a roster table join, and mirrors computePlayerStats' own
// per-field team attribution.
function collectRoster(plays, homeAbbr, awayAbbr) {
  const roster = new Set()   // "TEAM::number"
  const other = t => (t === homeAbbr ? awayAbbr : (t === awayAbbr ? homeAbbr : null))
  for (const p of plays) {
    const off = p.possession
    const def = other(off)
    const addOff = ref => { if (ref?.number != null && off) roster.add(`${off}::${ref.number}`) }
    const addDef = ref => { if (ref?.number != null && def) roster.add(`${def}::${ref.number}`) }
    addOff(p.rush_by); addOff(p.pass_by); addOff(p.received_by)
    ;[p.tackle_by, p.fumble_tackle_by, p.punt_block_ret_tackle_by, p.return_tackle_by].forEach(arr => {
      if (Array.isArray(arr)) arr.forEach(addDef)
    })
    addDef(p.sack_by); addDef(p.fumble_forced_by); addDef(p.fumble_2_forced_by); addDef(p.intercepted_by)
  }
  return [...roster].sort().map(key => {
    const [team, number] = key.split('::')
    return { team, number: Number(number) }
  })
}

async function snapshotGame(gameId) {
  const teamFields = 'nombre_corto,abreviatura,Apodo,Escuela,color_principal,color_texto,logo_url'
  const [gArr, pArr, tmArr, pmArr] = await Promise.all([
    sbFetch(`games?select=*,home:home_team_id(${teamFields}),away:away_team_id(${teamFields})&id=eq.${encodeURIComponent(gameId)}&limit=1`),
    sbFetch(`plays?select=*&game_id=eq.${encodeURIComponent(gameId)}&order=seq.asc`),
    sbFetch(`team_game_stats_manual?select=*&game_id=eq.${encodeURIComponent(gameId)}`),
    sbFetch(`player_game_stats_manual?select=*,player:player_id(id,number,nombre,apellido,team_id,position)&game_id=eq.${encodeURIComponent(gameId)}`),
  ])
  const game = gArr[0] || null
  if (!game) throw new Error(`game ${gameId} not found`)
  const plays = (pArr || []).map(flattenPlay)
  const homeAbbr = game.home?.abreviatura || ''
  const awayAbbr = game.away?.abreviatura || ''

  const statsLib = await loadStatsLib()
  const { registry: fn, source } = await buildFunctionRegistry(statsLib)

  const teamsFull = { home: { name: homeAbbr }, away: { name: awayAbbr } }
  const drives = fn.computeDrives(plays, homeAbbr, awayAbbr)
  const comparison = fn.computeComparisonStats(plays, drives, homeAbbr, awayAbbr, teamsFull)
  const penalties = fn.computePenalties(plays, homeAbbr)

  const roster = collectRoster(plays, homeAbbr, awayAbbr)
  const playerStats = roster.map(({ team, number }) => ({
    team, number, stats: fn.computePlayerStats(plays, { number }, team),
  }))

  const defenseStats = fn.computeDefenseStats(plays, homeAbbr, awayAbbr)
  const specialTeamsStats = fn.computeSpecialTeamsStats(plays, homeAbbr, awayAbbr, teamsFull)
  const fumbleStats = fn.computeFumbleStats(plays)
  const turnoverReturnYards = fn.computeTurnoverReturnYards(plays, homeAbbr, awayAbbr, teamsFull)
  const turnoverReturnYardsByTeam = fn.computeTurnoverReturnYardsByTeam(plays, homeAbbr, awayAbbr, teamsFull)
  const turnoverStatsByPlayer = fn.computeTurnoverStatsByPlayer(plays, homeAbbr, awayAbbr, teamsFull)
  const qbProgression = fn.computeQBProgression(plays)
  const explosivePlays = fn.computeExplosivePlays(plays, teamsFull)
  const { passers, rushers, receivers } = fn.buildOffenseMaps(plays, homeAbbr, awayAbbr)
  const allPurposeMap = fn.computeAllPurposeMap(
    rushers, receivers, specialTeamsStats.kickReturns, specialTeamsStats.puntReturns,
    turnoverReturnYards, homeAbbr, awayAbbr
  )

  // Manual-path functions (only meaningful when the game has no plays[], but
  // run unconditionally so the snapshot covers them for every game type).
  const manualLeaders = {}
  for (const [abbr, teamId] of [[homeAbbr, game.home_team_id], [awayAbbr, game.away_team_id]]) {
    manualLeaders[abbr] = {
      passer:   fn._topManualStat(pmArr || [], teamId, 'pass_yds'),
      rusher:   fn._topManualStat(pmArr || [], teamId, 'rush_yds'),
      receiver: fn._topManualStat(pmArr || [], teamId, 'rec_yds'),
      passingRows:   fn._manualPassingRows(pmArr || [], teamId),
      rushingRows:   fn._manualRushingRows(pmArr || [], teamId),
      receivingRows: fn._manualReceivingRows(pmArr || [], teamId),
    }
  }

  return {
    meta: { gameId, homeAbbr, awayAbbr, semana: game.semana, status: game.status, playCount: plays.length, functionSource: source },
    computeComparisonStats: comparison,
    computeDrives: drives.map(d => ({ possession: d.possession, playCount: d.plays.length, seqs: d.plays.map(p => p.seq) })),
    computePenalties: penalties,
    computePlayerStats: playerStats,
    computeDefenseStats: defenseStats,
    computeSpecialTeamsStats: specialTeamsStats,
    computeFumbleStats: fumbleStats,
    computeTurnoverReturnYards: turnoverReturnYards,
    computeTurnoverReturnYardsByTeam: turnoverReturnYardsByTeam,
    computeTurnoverStatsByPlayer: turnoverStatsByPlayer,
    computeQBProgression: qbProgression,
    computeExplosivePlays: {
      passing: explosivePlays.passing.map(p => ({ seq: p.seq, effYards: p._effYards })),
      rushing: explosivePlays.rushing.map(p => ({ seq: p.seq, effYards: p._effYards })),
    },
    buildOffenseMaps: { passers, rushers, receivers },
    computeAllPurposeMap: allPurposeMap,
    manualPathFunctions: manualLeaders,
    teamGameStatsManualRowCount: (tmArr || []).length,
    playerGameStatsManualRowCount: (pmArr || []).length,
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (!args.length) {
    console.error('Usage: node debug/snapshot_stats.mjs <label>:<game_id> [...]')
    process.exit(1)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  for (const arg of args) {
    const [label, gameId] = arg.split(':')
    console.log(`→ ${label} (${gameId})`)
    const snap = await snapshotGame(gameId)
    console.log(`  function source: ${snap.meta.functionSource}`)
    const outFile = path.join(OUT_DIR, `${label}.json`)
    fs.writeFileSync(outFile, JSON.stringify(snap, null, 2))
    console.log(`  wrote ${path.relative(ROOT, outFile)} (${snap.meta.playCount} plays)`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
