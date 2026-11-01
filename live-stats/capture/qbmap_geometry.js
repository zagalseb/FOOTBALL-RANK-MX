// qbmap_geometry.js — pure field-geometry/parsing helpers for QB Map
// (QBMAP.html). No DOM, no Supabase, no imports.
//
// Deliberately NOT built on stats-lib.js's absYard()/isTouchdown() or
// engine.js's parseATInput(): those assume yards in 0-50 / abs 0-100 and back
// live production data. QB Map needs endzone coordinates (team yard -10..50,
// abs -10..110), so the same team+yard <-> abs convention is reimplemented
// here, locally, with the wider range from day one.
//
// Convention (same as the rest of the app): abs 0 = home goal line, abs 100 =
// away goal line. Home attacks toward abs 100, away toward abs 0. A spot is
// { team, yard } with `team` = the team NAME (what plays.possession stores)
// and yard measured from that team's own goal line; yard < 0 = inside that
// team's own endzone.

export const FIELD_WIDTH = 53
export const HASHES      = [[19.2, 20], [33, 33.8]]   // units from one sideline
export const YARD_MIN    = -10
export const YARD_MAX    = 50
export const ABS_MIN     = -10
export const ABS_MAX     = 110
export const REL_BACK    = -10   // fixed yards shown behind the LOS
export const REL_FWD_DEF = 40    // default yards shown ahead of the LOS

// `teams` is play_data.teams: { home:{name,abreviatura}, away:{name,abreviatura} }

export function toAbs(teams, teamName, yard) {
  return teamName === teams.home.name ? yard : 100 - yard
}

// abs <= 50 lands on the home side (abs < 0 = home endzone), abs > 50 on the
// away side (abs > 100 = away endzone, yard = 100 - abs < 0).
export function fromAbs(teams, abs) {
  return abs <= 50
    ? { team: teams.home.name, yard: abs }
    : { team: teams.away.name, yard: 100 - abs }
}

export function makeSpot(teams, teamName, yard) {
  return { team: teamName, yard, abs: toAbs(teams, teamName, yard) }
}

export function spotFromAbs(teams, abs) {
  const { team, yard } = fromAbs(teams, abs)
  return { team, yard, abs }
}

// +1 when the team with the ball is home (attacks toward abs 100), else -1.
export function driveDir(teams, possession) {
  return possession === teams.home.name ? 1 : -1
}

export function abbrOf(teams, teamName) {
  if (teamName === teams.home.name) return teams.home.abreviatura || teamName
  if (teamName === teams.away.name) return teams.away.abreviatura || teamName
  return teamName
}

// "CCM34", "CCM-5". Negative yard = inside that team's own endzone.
export function formatSpot(teams, spot) {
  return spot ? `${abbrOf(teams, spot.team)}${spot.yard}` : ''
}

// Parses "CCM34" / "ccm-5" / "34" / "-5" into a spot. Team prefix is optional
// (defaults to `defaultTeam`, a team name). Accepts team yards -10..50, i.e.
// abs -10..110. Returns { spot } or { error }.
export function parseQbSpot(raw, teams, defaultTeam) {
  const s = String(raw ?? '').trim().toUpperCase()
  if (!s) return { error: 'vacío' }

  const prefixes = []
  for (const side of ['home', 'away']) {
    const t = teams[side]
    for (const p of [t.abreviatura, t.name]) {
      if (p) prefixes.push([String(p).toUpperCase(), t.name])
    }
  }
  prefixes.sort((a, b) => b[0].length - a[0].length)   // longest prefix wins

  let team = defaultTeam
  let rest = s
  for (const [p, name] of prefixes) {
    if (s.startsWith(p)) { team = name; rest = s.slice(p.length); break }
  }
  rest = rest.trim()

  if (!/^-?\d{1,2}$/.test(rest)) return { error: 'formato inválido (ej. CCM34, CCM-5)' }
  const yard = parseInt(rest, 10)
  if (yard < YARD_MIN || yard > YARD_MAX) {
    return { error: `yarda fuera de rango (${YARD_MIN} a ${YARD_MAX})` }
  }
  return { spot: makeSpot(teams, team, yard) }
}

// Lateral position, units 0-53 from one sideline. One decimal is kept.
export function parseLat(raw) {
  const s = String(raw ?? '').trim()
  if (!/^\d{1,2}(\.\d+)?$/.test(s)) return null
  const n = Math.round(parseFloat(s) * 10) / 10
  return n >= 0 && n <= FIELD_WIDTH ? n : null
}

// Yards ahead (+) / behind (-) of the LOS, in the offense's direction of travel.
export function relFromAbs(abs, losAbs, dir) { return dir * (abs - losAbs) }
export function absFromRel(rel, losAbs, dir) { return losAbs + dir * rel }

// Visible x-axis in rel-to-LOS yards. Back is fixed at -10, forward defaults
// to +40 and grows to the next decade (+50, +60, ...) if a point lands past
// it. Both ends are capped at the back of the endzones (abs -10 / 110), which
// is the end of the playable coordinate space.
export function axisRange(losAbs, dir, pointRels = []) {
  const backCap = dir === 1 ? losAbs - ABS_MIN : ABS_MAX - losAbs   // max yards visible behind
  const fwdCap  = dir === 1 ? ABS_MAX - losAbs : losAbs - ABS_MIN   // max yards visible ahead
  const maxRel  = pointRels.length ? Math.max(...pointRels) : 0
  const fwd     = Math.max(REL_FWD_DEF, Math.ceil(maxRel / 10) * 10)
  return {
    min: -Math.min(-REL_BACK, backCap),
    max: Math.min(fwd, fwdCap),
  }
}
