// Shared enumerator of player references in a play (read-only tooling).
// Team attribution is heuristic, same convention as collectRoster in
// snapshot_stats.mjs: kicking/rushing/passing fields belong to the possession
// team; recovery fields to the recovering team when the play records it;
// everything else (tacklers, returners of kicks/punts, interceptors, pass
// defenders, forcers) to the other team. penalty_by is skipped (not a stat ref).
const OFFENSE = new Set(['rush_by', 'pass_by', 'received_by', 'punted_by', 'kicked_by'])
const SKIP = new Set(['penalty_by'])
export function playRefs(play, homeAbbr, awayAbbr) {
  const other = t => (t === homeAbbr ? awayAbbr : t === awayAbbr ? homeAbbr : null)
  const out = []
  for (const [field, val] of Object.entries(play)) {
    if (!/_by$/.test(field) && !/tackle_by$/.test(field)) continue
    if (SKIP.has(field) || !val) continue
    let team
    if (OFFENSE.has(field)) team = play.possession
    else if (/recovered_by$/.test(field)) {
      const rt = play[field.replace(/recovered_by$/, 'recovery_team')]
      team = rt || other(play.possession)
    } else team = other(play.possession)
    for (const ref of Array.isArray(val) ? val : [val]) if (ref && typeof ref === 'object') out.push({ team, field, ref })
  }
  return out
}
