// Calendario de un equipo (lógica pura, sin DOM).
import { effectivePrediction } from './standings.js';

/**
 * @param {string} team
 * @param {Array} weeks  salida del parser (cada semana con games y byes)
 * @param {Object} predictions  id → pronóstico
 * @param {string[]} allTeams
 * @returns {{
 *   rows: Array,          // una fila por semana: juego o descanso
 *   played: Array,        // rivales ya enfrentados (con resultado real)
 *   pending: Array,       // rivales que faltan (con pronóstico, si hay)
 *   notScheduled: string[] // rivales que no están en su calendario
 * }}
 */
export function teamSchedule(team, weeks, predictions = {}, allTeams = []) {
  const rows = [];
  const played = [];
  const pending = [];

  for (const w of weeks) {
    const games = w.games.filter((g) => g.home === team || g.away === team);
    if (!games.length) {
      rows.push({ week: w.number, bye: w.byes.includes(team), game: null });
      continue;
    }
    for (const g of games) {
      const isHome = g.home === team;
      const rival = isHome ? g.away : g.home;
      const mySide = isHome ? 'L' : 'V';
      const row = { week: w.number, bye: false, game: g, isHome, rival, mySide };

      if (g.played) {
        row.status = 'jugado';
        row.teamPts = isHome ? g.hs : g.as;
        row.rivalPts = isHome ? g.as : g.hs;
        row.result = row.teamPts > row.rivalPts ? 'G' : 'P';
        played.push(row);
      } else {
        const eff = effectivePrediction(predictions[g.id]);
        if (eff) {
          row.status = 'pronosticado';
          row.result = eff.winner === mySide ? 'G' : 'P';
          row.scored = eff.scored;
          if (eff.scored) {
            row.teamPts = isHome ? eff.hs : eff.as;
            row.rivalPts = isHome ? eff.as : eff.hs;
          }
        } else {
          row.status = 'pendiente';
          row.result = null;
        }
        pending.push(row);
      }
      rows.push(row);
    }
  }

  const faced = new Set([...played, ...pending].map((r) => r.rival));
  const notScheduled = allTeams.filter((t) => t !== team && !faced.has(t));

  return { rows, played, pending, notScheduled };
}
