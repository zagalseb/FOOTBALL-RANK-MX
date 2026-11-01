// Lógica pura de la tabla general (sin DOM).

export const POINTS_PER_WIN = 2;
export const PLAYOFF_SPOTS = 8;

export const CRITERIA = {
  PUNTOS: 'puntos',
  H2H: 'juego-entre-si',
  H2H_ALL: 'gano-a-todos',
  PC: 'puntos-en-contra',
  GA: 'goal-average',
  ALPHA: 'alfabetico',
};

const collator = new Intl.Collator('es', { sensitivity: 'base' });

const isScore = (v) => Number.isInteger(v) && v >= 0;

/**
 * Pronóstico efectivo de un juego pendiente.
 * pred = { w: 'L' | 'V', h?: number, a?: number }
 * Con ambos marcadores distintos manda el marcador; con marcador empatado el
 * pronóstico no cuenta; si no hay marcador completo cuenta solo el ganador.
 */
export function effectivePrediction(pred) {
  if (!pred) return null;
  if (isScore(pred.h) && isScore(pred.a)) {
    if (pred.h === pred.a) return null;
    return { winner: pred.h > pred.a ? 'L' : 'V', hs: pred.h, as: pred.a, scored: true };
  }
  if (pred.w === 'L' || pred.w === 'V') return { winner: pred.w, hs: null, as: null, scored: false };
  return null;
}

/** Une los juegos jugados con los pronósticos de los pendientes. */
export function buildResults(games, predictions = {}) {
  const results = [];
  for (const g of games) {
    if (g.played) {
      results.push({
        id: g.id, home: g.home, away: g.away, hs: g.hs, as: g.as,
        winner: g.hs > g.as ? 'L' : 'V', scored: true, predicted: false,
      });
      continue;
    }
    const eff = effectivePrediction(predictions[g.id]);
    if (eff) results.push({ id: g.id, home: g.home, away: g.away, ...eff, predicted: true });
  }
  return results;
}

/** Juegos pendientes que tienen solo ganador (sin marcador válido). */
export function countWinnerOnly(games, predictions = {}) {
  return games.filter((g) => !g.played && effectivePrediction(predictions[g.id])?.scored === false).length;
}

export function goalAverage(pf, pc) {
  return pc === 0 ? Infinity : pf / pc;
}

function tallies(teamNames, results) {
  const stats = new Map();
  for (const name of teamNames) {
    stats.set(name, { team: name, w: 0, l: 0, pf: 0, pc: 0, unscored: 0, beat: new Map() });
  }
  const get = (name) => {
    if (!stats.has(name)) stats.set(name, { team: name, w: 0, l: 0, pf: 0, pc: 0, unscored: 0, beat: new Map() });
    return stats.get(name);
  };
  for (const r of results) {
    const h = get(r.home);
    const a = get(r.away);
    const [win, lose] = r.winner === 'L' ? [h, a] : [a, h];
    win.w++;
    lose.l++;
    win.beat.set(lose.team, (win.beat.get(lose.team) ?? 0) + 1);
    if (r.scored) {
      h.pf += r.hs; h.pc += r.as;
      a.pf += r.as; a.pc += r.hs;
    } else if (r.predicted) {
      h.unscored++;
      a.unscored++;
    }
  }
  for (const s of stats.values()) {
    s.pts = s.w * POINTS_PER_WIN;
    s.ga = goalAverage(s.pf, s.pc);
  }
  return stats;
}

const winsOver = (a, b) => a.beat.get(b.team) ?? 0;
const played = (a, b) => winsOver(a, b) + winsOver(b, a) > 0;
const beats = (a, b) => winsOver(a, b) > winsOver(b, a);

export function formatGA(ga) {
  return ga === Infinity ? '∞' : ga.toFixed(3);
}

const list = (teams) => {
  const names = teams.map((t) => t.team);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`;
};

/**
 * Ordena un grupo empatado en puntos. Cada función devuelve el arreglo
 * ordenado y anota en cada equipo: criterion, notes, provisional.
 */
function resolveGroup(group) {
  if (group.length === 1) {
    group[0].criterion = CRITERIA.PUNTOS;
    return group;
  }
  if (group.length === 2) return resolveTwo(group[0], group[1]);

  const top = group.find((t) => group.every((o) => o === t || (played(t, o) && beats(t, o))));
  if (!top) {
    for (const t of group) t.notes.push('Ningún equipo del grupo le ganó a todos los demás; se desempata por puntos en contra.');
    return resolveByPC(group);
  }
  const rest = group.filter((t) => t !== top);
  top.criterion = CRITERIA.H2H_ALL;
  top.notes.push(`Quedó arriba de ${list(rest)} porque les ganó a todos en juego entre sí.`);
  for (const t of rest) t.notes.push(`Quedó abajo de ${top.team}, que les ganó a todos los empatados.`);
  return [top, ...(rest.length === 2 ? resolveTwo(rest[0], rest[1]) : resolveByPC(rest))];
}

function resolveTwo(a, b) {
  if (played(a, b) && winsOver(a, b) !== winsOver(b, a)) {
    const [w, l] = beats(a, b) ? [a, b] : [b, a];
    w.criterion = l.criterion = CRITERIA.H2H;
    w.notes.push(`Quedó arriba de ${l.team} por juego entre sí (le ganó).`);
    l.notes.push(`Quedó abajo de ${w.team} por juego entre sí (perdió ese juego).`);
    return [w, l];
  }
  const why = played(a, b) ? 'El juego entre sí no los separa' : 'No jugaron entre sí';
  a.notes.push(`${why} con ${b.team}; se desempata por puntos en contra.`);
  b.notes.push(`${why} con ${a.team}; se desempata por puntos en contra.`);
  return resolveByPC([a, b]);
}

function resolveByPC(set) {
  const sorted = [...set].sort(
    (x, y) => x.pc - y.pc || (y.ga === x.ga ? 0 : y.ga > x.ga ? 1 : -1) || collator.compare(x.team, y.team),
  );

  for (const t of sorted) {
    let crit = CRITERIA.PC;
    for (const o of sorted) {
      if (o === t) continue;
      const above = sorted.indexOf(t) < sorted.indexOf(o);
      const dir = above ? 'arriba' : 'abajo';
      if (t.pc !== o.pc) {
        t.notes.push(`Quedó ${dir} de ${o.team} por ${above ? 'menos' : 'más'} puntos en contra (${t.pc} vs ${o.pc}).`);
      } else if (t.ga !== o.ga) {
        if (crit === CRITERIA.PC) crit = CRITERIA.GA;
        t.notes.push(`Quedó ${dir} de ${o.team} por goal average (${formatGA(t.ga)} vs ${formatGA(o.ga)}; mismos puntos en contra).`);
      } else {
        crit = CRITERIA.ALPHA;
        t.unresolved = true;
        t.notes.push(`Empate sin resolver con ${o.team} (mismos PC y goal average): se ordenó alfabéticamente.`);
      }
    }
    t.criterion = crit;
  }

  const pending = sorted.filter((t) => t.unscored > 0);
  if (pending.length) {
    const reason =
      `Su desempate se decide por puntos en contra y ${list(pending)} ` +
      `${pending.length === 1 ? 'tiene' : 'tienen'} juegos pronosticados sin marcador. ` +
      'El orden se calculó solo con los juegos que tienen marcador y puede cambiar.';
    for (const t of sorted) {
      t.provisional = true;
      t.provisionalReason = reason;
      t.provisionalGroup = sorted.map((s) => s.team);
    }
  }
  return sorted;
}

/**
 * Calcula la tabla.
 * @param {string[]} teamNames
 * @param {Array} results  salida de buildResults
 * @returns {{ rows: Array, uncertainCut: boolean, uncertainTeams: string[] }}
 */
export function computeStandings(teamNames, results, { playoffSpots = PLAYOFF_SPOTS } = {}) {
  const stats = tallies(teamNames, results);
  const entries = [...stats.values()].map((s) => ({
    ...s,
    criterion: null,
    notes: [],
    provisional: false,
    provisionalReason: null,
    provisionalGroup: null,
    unresolved: false,
    tieGroup: [],
  }));

  const byPts = new Map();
  for (const e of entries) {
    if (!byPts.has(e.pts)) byPts.set(e.pts, []);
    byPts.get(e.pts).push(e);
  }

  const ordered = [];
  for (const pts of [...byPts.keys()].sort((a, b) => b - a)) {
    const group = byPts.get(pts).sort((a, b) => collator.compare(a.team, b.team));
    for (const t of group) t.tieGroup = group.filter((o) => o !== t).map((o) => o.team);
    ordered.push(...resolveGroup(group));
  }

  ordered.forEach((t, i) => { t.pos = i + 1; });

  // Un grupo provisional que cruza el corte 8/9 deja la clasificación incierta.
  const uncertainTeams = new Set();
  for (const t of ordered) {
    if (!t.provisional) continue;
    const positions = t.provisionalGroup.map((n) => ordered.find((o) => o.team === n).pos);
    if (Math.min(...positions) <= playoffSpots && Math.max(...positions) > playoffSpots) uncertainTeams.add(t.team);
  }

  const rows = ordered.map(({ beat, ...t }) => ({
    ...t,
    gp: t.w + t.l,
    qualified: t.pos <= playoffSpots,
    uncertainCut: uncertainTeams.has(t.team),
  }));

  return { rows, uncertainCut: uncertainTeams.size > 0, uncertainTeams: [...uncertainTeams] };
}

/** Lugares que subió (+) o bajó (−) cada equipo respecto a la tabla real. */
export function positionChanges(real, sim) {
  const realPos = new Map(real.rows.map((r) => [r.team, r.pos]));
  return new Map(sim.rows.map((r) => [r.team, realPos.get(r.team) - r.pos]));
}
