#!/usr/bin/env node
// debug/orphan_report.mjs — read-only: for each game id, resolves every player
// reference in its plays against the roster of the team it belongs to and
// reports how many resolved to a canonical players.id vs. orphans.
// Usage: node debug/orphan_report.mjs <game_id> [...]
import {
  buildRosterIndex, resolvePlayerKey, isOrphanKey, normName,
} from '../shared/stats-lib.js'

const SB_URL = 'https://rlttycaajdsqovxjdjvx.supabase.co'
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJsdHR5Y2FhamRzcW92eGpkanZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MTMyNDcsImV4cCI6MjEwMjQ4OTI0N30.XgFQSVBpjs6N8QdshnC_uSJc1Mql8v9ix5_BDemGuao'
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Accept-Profile': 'covercero' }
const get = async p => { const r = await fetch(`${SB_URL}/rest/v1/${p}`, { headers: H }); if (!r.ok) throw new Error(`HTTP ${r.status} ${p}`); return r.json() }

// [play field, which side the reference belongs to: 'off' = possession, 'def' = other team]
const OFF_FIELDS = ['rush_by', 'pass_by', 'received_by']
const DEF_SINGLE = ['sack_by', 'fumble_forced_by', 'fumble_2_forced_by', 'intercepted_by', 'qb_hurried_by', 'broken_up_by']
const DEF_ARRAYS = ['tackle_by', 'fumble_tackle_by', 'punt_block_ret_tackle_by', 'return_tackle_by']

for (const gameId of process.argv.slice(2)) {
  const [game] = await get(`games?select=id,home_team_id,away_team_id,home:home_team_id(abreviatura),away:away_team_id(abreviatura)&id=eq.${gameId}`)
  const plays = await get(`plays?select=possession,play_data&game_id=eq.${gameId}`)
  const teamIds = [game.home_team_id, game.away_team_id]
  const players = await get(`players?select=id,team_id,number,nombre,apellido&team_id=in.(${teamIds.join(',')})`)
  const abbrToTeam = { [game.home.abreviatura]: game.home_team_id, [game.away.abreviatura]: game.away_team_id }
  const idx = Object.fromEntries(teamIds.map(t => [t, buildRosterIndex(t, players.filter(p => p.team_id === t))]))
  const other = t => (t === game.home.abreviatura ? game.away.abreviatura : game.home.abreviatura)

  const refs = []   // { team, ref }
  for (const row of plays) {
    const pd = row.play_data || {}
    const off = row.possession, def = other(off)
    for (const f of OFF_FIELDS) if (pd[f]) refs.push({ team: off, f, ref: pd[f] })
    for (const f of DEF_SINGLE) if (pd[f]) refs.push({ team: def, f, ref: pd[f] })
    for (const f of DEF_ARRAYS) for (const r of (Array.isArray(pd[f]) ? pd[f] : [])) refs.push({ team: def, f, ref: r })
  }
  let ok = 0, orphan = 0; const orphanList = new Map()
  for (const { team, f, ref } of refs) {
    const tid = abbrToTeam[team]
    if (!tid) { orphan++; continue }
    const k = resolvePlayerKey(ref, idx[tid])
    if (isOrphanKey(k)) { orphan++; orphanList.set(k, (orphanList.get(k) || 0) + 1) } else ok++
  }
  console.log(`${game.home.abreviatura} vs ${game.away.abreviatura} (${gameId})`)
  console.log(`  refs: ${refs.length}  resolved: ${ok}  orphans: ${orphan}`)
  for (const [k, n] of orphanList) console.log(`    ${n}x ${k}`)
}
