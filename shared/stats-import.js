// Weekly stats CSV import (Tableau PDFs → player_game_stats_manual). Pure
// functions only — no fetch, no DOM — so they run under `node --test`.
// UI: live-stats/capture/import_stats.html.
import { parseCSV } from './csv.js'
import { matchStatName, getGameTemporada, normalizeName, rosterFullName } from './stats-lib.js'

// Columns of the CSV that map 1:1 to player_game_stats_manual (no renames).
export const IMPORT_STAT_COLUMNS = [
  'pass_att', 'pass_comp', 'pass_yds', 'pass_td', 'pass_int',
  'rush_att', 'rush_yds', 'rush_td', 'rush_fum',
  'rec', 'rec_yds', 'rec_td', 'rec_fum',
]
// Team totals the import may write to team_game_stats_manual (summed over players).
export const TEAM_TOTAL_COLUMNS = ['pass_yds', 'rush_yds', 'total_yds']
const REQUIRED_COLUMNS = ['semana', 'equipo', 'nombre']

// PDF team label → covercero.teams.id (confirmed 2026-10-28). All 14 teams have a
// 2026 roster; a team whose roster is empty for the chosen season is still
// rejected by the classifier (status 'noroster'), decided from the data.
export const PDF_TEAM_LABELS = {
  'MTY': 'ebd0f661-6336-4c5b-a0cb-6405c3ec5974',
  'PUE': '55a1a31b-514f-4504-b665-d1651bbdf8bf',
  'CEM': '931e3f60-670d-4f54-b39e-fa8ab52dc00f',
  'CCM': '9a0c9951-9512-47ce-a0fd-07c8398e028f',
  'GDL': '4ecbe7f5-0daf-499a-98dd-c413db2e2870',
  'TIGRES': '641143d3-4969-4384-bb3b-2b872906d5b8',
  'PUMAS': '4f8f394e-8a9a-4ac6-9fcf-3a98999ee4cd',          // Pumas CU
  'AZTECAS': '4e3792e2-920b-4fc4-b236-3a51dfc398e3',
  'LEONES': '8cab9ef1-d858-4546-9d2c-ea5b43c87a92',
  'ZORROS': '36538700-2f80-492a-8b0e-a4ab387a0251',
  'LINCES': 'c108d882-b1ff-48bb-b563-19a109c521ef',
  'B BLANCOS': '8537dc45-4935-4808-9e9f-38241fc24fad',
  'A BLANCAS': '6391e8d4-89dc-408c-833d-63c46ffed7ae',
  'CANCUN': '56e50c8c-d259-4f52-964c-99e3427b18ee',
}

const normLabel = s => String(s ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
const normSemana = s => String(s ?? '').trim().toUpperCase()
const wordKey = s => normalizeName(s).split(' ').filter(Boolean).sort().join(' ')

// ── Parsing ─────────────────────────────────────────────────────────────────
// Header (case-insensitive): semana, equipo, nombre required; `jersey` optional
// (only a hint); stat columns are the DB names. Unknown columns are reported and
// ignored. A stat cell that is empty means "do not touch" (key absent); an
// explicit 0 is kept. Values are integers (negative allowed, e.g. rush_yds).
export function parseStatsCsv(text) {
  const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
  const raw = parseCSV(clean)
  if (!raw.length) return { error: 'El archivo está vacío.' }
  const header = raw[0].map(h => h.trim().toLowerCase())
  const missing = REQUIRED_COLUMNS.filter(c => !header.includes(c))
  if (missing.length) return { error: `Faltan columnas obligatorias: ${missing.join(', ')}.` }
  const statColumns = IMPORT_STAT_COLUMNS.filter(c => header.includes(c))
  if (!statColumns.length) return { error: 'El CSV no trae ninguna columna de stats.' }
  const known = new Set([...REQUIRED_COLUMNS, 'jersey', ...IMPORT_STAT_COLUMNS])
  const unknownColumns = header.filter(h => h && !known.has(h))
  const idx = Object.fromEntries(header.map((h, i) => [h, i]))
  const cell = (cols, name) => (idx[name] === undefined ? '' : (cols[idx[name]] ?? '')).trim()

  const dataRows = raw.slice(1).filter(r => r.some(c => c.trim() !== ''))
  if (!dataRows.length) return { error: 'El CSV no tiene filas de datos.' }

  const rows = dataRows.map((cols, i) => {
    const row = {
      line: i + 2, // 1-based, header is line 1
      semana: normSemana(cell(cols, 'semana')),
      equipo: normLabel(cell(cols, 'equipo')),
      nombre: cell(cols, 'nombre'),
      jersey: null,
      stats: {},
      errors: [],
    }
    if (!row.equipo) row.errors.push('Equipo vacío')
    if (!row.nombre) row.errors.push('Nombre vacío')
    const j = cell(cols, 'jersey')
    if (j !== '') { if (/^\d{1,2}$/.test(j)) row.jersey = parseInt(j, 10); else row.errors.push(`jersey inválido: "${j}"`) }
    for (const c of statColumns) {
      const v = cell(cols, c)
      if (v === '') continue
      if (/^-?\d+$/.test(v)) row.stats[c] = parseInt(v, 10)
      else row.errors.push(`${c}: valor inválido "${v}"`)
    }
    return row
  })
  return { rows, statColumns, unknownColumns, hasJersey: header.includes('jersey') }
}

// Rows whose `semana` differs from the week chosen on screen (empty counts as
// different). The UI blocks the import while this list is non-empty.
export function weekMismatches(rows, semana) {
  const want = normSemana(semana)
  return rows.filter(r => r.semana !== want).map(r => ({ line: r.line, semana: r.semana }))
}

// ── Game lookup ─────────────────────────────────────────────────────────────
// Game of a team in the chosen week and season. games.temporada is mostly null,
// so the season comes from getGameTemporada (kickoff year as fallback).
export function findTeamGame(teamId, games, semana, temporada) {
  const want = normSemana(semana)
  const found = (games || []).filter(g =>
    normSemana(g.semana) === want &&
    String(getGameTemporada(g)) === String(temporada) &&
    (g.home_team_id === teamId || g.away_team_id === teamId))
  if (found.length === 1) return { status: 'one', game: found[0] }
  if (found.length === 0) return { status: 'none', games: [] }
  return { status: 'multiple', games: found }
}

// ── Same-number conflicts ───────────────────────────────────────────────────
// A team cannot have two players with the same jersey in one game. If the game
// already has a stats row of ANOTHER player_id of the same team with the same
// number, the matched roster player is probably the same person under another
// roster row (previous season, duplicate roster entry): writing would double-count
// them (two real cases, 2026-10-28). `existingPlayer` rows carry the joined
// `player` ({ team_id, number, ... }). Returns the conflicting existing rows.
export function findNumberConflicts(existingPlayer, gameId, teamId, player) {
  const out = []
  for (const r of existingPlayer.values()) {
    const p = r.player
    if (r.game_id !== gameId || !p || r.player_id === player.id) continue
    if (p.team_id !== teamId || Number(p.number) !== Number(player.number)) continue
    out.push({ playerId: r.player_id, player: p, row: r })
  }
  return out
}

// ── Classification ──────────────────────────────────────────────────────────
// ctx: {
//   semana, temporada, games,
//   rostersByTeam: { [teamId]: players of that team AND season },
//   existing: { player: Map('gameId|playerId' → row WITH joined `player`), team: Map('gameId|teamId' → row) },
//   choices: { players: { [line]: playerId | 'skip' }, games: { [teamId]: gameId },
//              conflicts: { [line]: 'new' | 'existing:<playerId>' } },
// }
// Row statuses: ok | ambiguous | none | rest | pickgame | noroster | skipped |
//               duplicate | conflict | error. Only `ok` rows are written.
// `conflict`: same team + same number + another player_id already has stats in that
// game; blocked until the operator picks 'existing:<id>' (update that row instead) or
// 'new' (another person: create the row), or skips the line.
export function classifyStatsImport(rows, ctx) {
  const choices = ctx.choices || {}
  const existingPlayer = ctx.existing?.player || new Map()
  const out = rows.map(row => {
    const base = { ...row, status: 'error', reason: null }
    const skipped = choices.players?.[row.line] === 'skip'   // the operator may skip a bad row
    if (row.errors.length) return { ...base, ...(skipped ? { status: 'skipped' } : {}), reason: skipped ? 'Omitida por el operador' : row.errors.join('; ') }
    const teamId = PDF_TEAM_LABELS[row.equipo]
    if (!teamId) return { ...base, ...(skipped ? { status: 'skipped' } : {}), reason: skipped ? 'Omitida por el operador' : `Equipo desconocido: "${row.equipo}"` }
    const roster = ctx.rostersByTeam?.[teamId] || []
    if (!roster.length) return { ...base, status: 'noroster', teamId, reason: `${row.equipo} no tiene roster ${ctx.temporada}: fila rechazada` }

    let lookup = findTeamGame(teamId, ctx.games, ctx.semana, ctx.temporada)
    if (lookup.status === 'multiple') {
      const picked = lookup.games.find(g => g.id === choices.games?.[teamId])
      if (!picked) return { ...base, status: 'pickgame', teamId, gameCandidates: lookup.games, reason: `${row.equipo} tiene ${lookup.games.length} partidos en la semana ${ctx.semana}: elige uno` }
      lookup = { status: 'one', game: picked }
    }
    if (lookup.status === 'none') return { ...base, status: 'rest', teamId, reason: `${row.equipo} no tiene partido en la semana ${ctx.semana} (descanso): fila omitida` }
    const game = lookup.game
    const common = { ...base, teamId, gameId: game.id }

    const choice = choices.players?.[row.line]
    if (choice === 'skip') return { ...common, status: 'skipped', reason: 'Omitida por el operador' }

    let player = null, level = null, candidates = null
    if (choice) {
      player = roster.find(p => p.id === choice)
      if (!player) return { ...common, reason: 'El jugador elegido no está en el roster de ese equipo y temporada' }
      level = 'manual'
    } else {
      const m = matchStatName(row.nombre, roster)
      level = m.level
      if (m.player) player = m.player
      if (m.candidates) candidates = m.candidates
    }

    if (!player) {
      // The jersey (optional) only pre-selects; the operator still confirms.
      const pool = candidates || roster
      const sameNumber = row.jersey == null ? [] : pool.filter(p => p.number === row.jersey)
      return {
        ...common,
        status: level === 'ambiguous' ? 'ambiguous' : 'none',
        level, candidates: candidates || [], hint: sameNumber.length === 1 ? sameNumber[0] : null,
        reason: level === 'ambiguous' ? 'Varios jugadores empatan con ese nombre' : 'Sin jugador en el roster con ese nombre',
      }
    }

    const conflicts = findNumberConflicts(existingPlayer, game.id, teamId, player)
    let target = player, conflictChoice = null
    if (conflicts.length) {
      const pick = choices.conflicts?.[row.line]
      const hit = pick?.startsWith('existing:') ? conflicts.find(c => c.playerId === pick.slice(9)) : null
      if (pick !== 'new' && !hit) {
        const who = conflicts.map(c => `#${c.player.number} ${rosterFullName(c.player)} (temporada ${c.player.temporada ?? '?'})`).join(' / ')
        return { ...common, status: 'conflict', level, player, conflicts, reason: `Este partido ya tiene stats del mismo número en ${row.equipo}: ${who}. ¿Es la misma persona?` }
      }
      conflictChoice = pick
      if (hit) { target = hit.player; level = 'existing' }
    }

    const prev = existingPlayer.get(`${game.id}|${target.id}`) || null
    const diff = {}
    for (const [c, v] of Object.entries(row.stats)) diff[c] = { old: prev ? prev[c] ?? null : null, new: v }

    // nombre_completo is offered when the PDF name taught us something. Never
    // overwritten silently: a different existing value is a conflict, off by default.
    let nameSave = { offer: false, default: false, conflict: false }
    if (level !== 'exact' && target === player) {
      const hasOwn = !!(player.nombre_completo || '').trim()
      if (!hasOwn) nameSave = { offer: true, default: true, conflict: false }
      else if (wordKey(player.nombre_completo) !== wordKey(row.nombre)) nameSave = { offer: true, default: false, conflict: true }
    }
    return {
      ...common, status: 'ok', level, player: target, rosterPlayer: player, conflictChoice, kind: prev ? 'update' : 'new', diff, nameSave,
      jerseyMismatch: row.jersey != null && row.jersey !== target.number ? { csv: row.jersey, roster: target.number } : null,
      reason: null,
    }
  })

  // Two CSV rows resolving to the same player of the same game: neither is written.
  const seen = new Map()
  out.forEach((r, i) => { if (r.status === 'ok') { const k = `${r.gameId}|${r.player.id}`; (seen.get(k) || seen.set(k, []).get(k)).push(i) } })
  for (const idxs of seen.values()) {
    if (idxs.length < 2) continue
    const lines = idxs.map(i => out[i].line)
    for (const i of idxs) out[i] = { ...out[i], status: 'duplicate', reason: `Las filas ${lines.join(' y ')} del CSV son el mismo jugador (${rosterFullName(out[i].player)})` }
  }

  const summary = {}
  for (const r of out) summary[r.status] = (summary[r.status] || 0) + 1
  return { rows: out, summary }
}

// ── Team totals ─────────────────────────────────────────────────────────────
// Per team, sum pass_yds / rush_yds over the `ok` rows (total_yds = pass + rush,
// only if both columns are in the CSV). `pending` counts rows of that team that
// are not written (unresolved or skipped), so the UI can warn the total is partial.
export function computeTeamTotals(classifiedRows, existingTeam = new Map()) {
  const byTeam = new Map()
  for (const r of classifiedRows) {
    if (!r.teamId || !r.gameId) continue
    const t = byTeam.get(r.teamId) ?? byTeam.set(r.teamId, { teamId: r.teamId, gameId: r.gameId, label: r.equipo, ok: [], pending: 0 }).get(r.teamId)
    if (r.status === 'ok') t.ok.push(r)
    else if (['ambiguous', 'none', 'skipped', 'duplicate', 'conflict'].includes(r.status)) t.pending++
  }
  const totals = []
  for (const t of byTeam.values()) {
    if (!t.ok.length) continue
    const hasCol = c => t.ok.some(r => r.stats[c] !== undefined)
    const sum = c => t.ok.reduce((a, r) => a + (r.stats[c] ?? 0), 0)
    const values = {}
    if (hasCol('pass_yds')) values.pass_yds = sum('pass_yds')
    if (hasCol('rush_yds')) values.rush_yds = sum('rush_yds')
    if (hasCol('pass_yds') && hasCol('rush_yds')) values.total_yds = sum('pass_yds') + sum('rush_yds')
    if (!Object.keys(values).length) continue
    const prev = existingTeam.get(`${t.gameId}|${t.teamId}`) || null
    const diff = {}
    const warnings = []
    for (const [c, v] of Object.entries(values)) {
      const old = prev ? prev[c] ?? null : null
      diff[c] = { old, new: v }
      if (old != null && old > v) warnings.push(`${c}: el total del PDF (${v}) es menor al guardado (${old}); puede faltar gente en el CSV`)
    }
    if (t.pending) warnings.push(`${t.pending} fila${t.pending > 1 ? 's' : ''} sin resolver u omitida${t.pending > 1 ? 's' : ''}: el total está incompleto`)
    totals.push({ teamId: t.teamId, gameId: t.gameId, label: t.label, diff, warnings, kind: prev ? 'update' : 'new' })
  }
  return totals
}

// ── Payloads (only columns with a value; empty cell = not sent) ─────────────
export function buildPlayerPayload(classifiedRow) {
  return { game_id: classifiedRow.gameId, player_id: classifiedRow.player.id, ...classifiedRow.stats }
}

export function buildTeamPayload(total, columns = TEAM_TOTAL_COLUMNS) {
  const body = { game_id: total.gameId, team_id: total.teamId }
  for (const c of columns) if (total.diff[c]) body[c] = total.diff[c].new
  return body
}

// ── Write planning ──────────────────────────────────────────────────────────
// PostgREST rejects a bulk body whose objects have different keys (PGRST102,
// "All object keys must match"), and "empty cell = do not touch" means rows carry
// different keys. So rows are split into requests whose rows share ONE key set:
//   new     → one request per game: every CSV stat column present, missing ones
//             as 0 (the table default, so nothing is lost);
//   update  → one request per identical key set, sending only the non-empty cells.
// `existingPlayer` is the CURRENT state ('gameId|playerId' → row), read right
// before writing, so a row created since the preview is treated as an update.
export function uniformKeys(rows) {
  if (!rows.length) return true
  const sig = o => Object.keys(o).sort().join(',')
  const first = sig(rows[0])
  return rows.every(r => sig(r) === first)
}

export function planPlayerWrites(okRows, existingPlayer, statColumns) {
  const requests = new Map()
  for (const r of okRows) {
    const exists = existingPlayer.has(`${r.gameId}|${r.player.id}`)
    let payload, cols
    if (!exists) {
      cols = [...statColumns]
      payload = { game_id: r.gameId, player_id: r.player.id, ...Object.fromEntries(statColumns.map(c => [c, r.stats[c] ?? 0])) }
    } else {
      cols = Object.keys(r.stats).sort()
      payload = buildPlayerPayload(r)
    }
    const key = `${r.teamId}|${r.gameId}|${exists ? 'update' : 'new'}|${cols.join(',')}`
    const req = requests.get(key) ?? requests.set(key, { teamId: r.teamId, label: r.equipo, gameId: r.gameId, kind: exists ? 'update' : 'new', columns: cols, rows: [], players: [] }).get(key)
    req.rows.push(payload)
    req.players.push({ line: r.line, nombre: r.nombre, player: r.player })
  }
  const order = { new: 0, update: 1 }
  return [...requests.values()].sort((a, b) => a.teamId.localeCompare(b.teamId) || order[a.kind] - order[b.kind] || a.columns.join().localeCompare(b.columns.join()))
}
