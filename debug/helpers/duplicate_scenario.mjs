// Synthetic scenario shared by the duplicate-guard tests (importer, Líderes, setup alta).
// Everything here is INVENTED (names, ids): it reproduces two real incidents of 2026-10-28
// without any real data, so the repo can stay public.
//   Case A: one person with a roster row of the PREVIOUS season and another of the current one
//           (same team, same jersey): his stats ended up in both rows of the same game.
//   Case B: one person entered twice in the SAME season roster under different surnames
//           (same team, same jersey): the same game got a stats row under each.
import { PDF_TEAM_LABELS } from '../../shared/stats-import.js'

export const TA = PDF_TEAM_LABELS.TIGRES, TB = PDF_TEAM_LABELS.AZTECAS
export const G_A = 'game-a', G_B = 'game-b'
export const games = [
  { id: G_A, semana: '1', status: 'final', temporada: null, kickoff: '2026-09-05T18:00:00Z', home_team_id: TA, away_team_id: 'rival-a' },
  { id: G_B, semana: '1', status: 'final', temporada: null, kickoff: '2026-09-05T20:00:00Z', home_team_id: 'rival-b', away_team_id: TB },
]
export const P = (id, team_id, number, nombre, apellido, nombre_completo = null, temporada = '2026') =>
  ({ id, team_id, number, nombre, apellido, nombre_completo, temporada })

// Case A: "Alfa Beta" #17 of team A, roster 2025 and roster 2026
export const A25 = P('a-2025', TA, 17, 'Alfa', 'Beta', null, '2025')
export const A26 = P('a-2026', TA, 17, 'Alfa', 'Beta', 'Alfa Gamma Beta Delta')
// Case B: "Omar" #3 of team B entered twice in 2026 (the kept row has the full name)
export const B_DROP = P('b-drop', TB, 3, 'Omar', 'Rios')
export const B_KEEP = P('b-keep', TB, 3, 'Omar', 'Vega', 'Omar Del Vega Rios Soto')
// Same surname, different numbers/people: must never be flagged
export const H18 = P('h-18', TA, 18, 'Hugo', 'Diaz')
export const R8 = P('r-8', TA, 8, 'Raul', 'Diaz')
export const players = [A25, A26, H18, R8, B_DROP, B_KEEP, P('t-1', TA, 1, 'Nico', 'Sol'), P('u-1', TB, 1, 'Pablo', 'Mar')]

export const ZERO = { pass_att: 0, pass_comp: 0, pass_yds: 0, pass_td: 0, pass_int: 0, rush_att: 0, rush_yds: 0, rush_td: 0, rush_fum: 0, rec: 0, rec_yds: 0, rec_td: 0, rec_fum: 0 }
export const S = (game_id, player, o) => ({ id: `s-${game_id}-${player.id}`, game_id, player_id: player.id, ...ZERO, ...o, player })
export const stats = [
  S(G_A, A25, { pass_att: 25, pass_comp: 17, pass_yds: 278, pass_td: 4, rush_att: 0, rush_yds: 70 }),   // older manual capture (roster 2025)
  S(G_A, A26, { pass_att: 25, pass_comp: 17, pass_yds: 278, pass_td: 4, rush_att: 5, rush_yds: 29 }),   // later import (roster 2026)
  S(G_A, H18, { rec: 2, rec_yds: 30 }),
  S(G_A, R8, { rec: 1, rec_yds: 10 }),
  S(G_B, B_DROP, { rec: 3, rec_yds: 20 }),
  S(G_B, B_KEEP, { rec: 3, rec_yds: 20 }),
]

export const roster2026 = teamId => players.filter(p => p.team_id === teamId && p.temporada === '2026')
