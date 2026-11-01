import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  computeStandings, buildResults, effectivePrediction, countWinnerOnly,
  positionChanges, goalAverage, CRITERIA,
} from '../js/standings.js';
import { parseWorkbook, parseRows, excelSerialToText, formatTime } from '../js/parser.js';
import { encodeScenario, decodeScenario, MODES } from '../js/scenario.js';
import { TEAM_NAMES, resolveTeam } from '../js/teams.js';
import { teamSchedule } from '../js/schedule.js';

// Resultado jugado: local, visita, marcador local, marcador visita.
const R = (home, away, hs, as) => ({
  home, away, hs, as, winner: hs > as ? 'L' : 'V', scored: true, predicted: false,
});
// Pronóstico solo con ganador.
const W = (home, away, winner) => ({
  home, away, hs: null, as: null, winner, scored: false, predicted: true,
});

const order = (table) => table.rows.map((r) => r.team);
const row = (table, team) => table.rows.find((r) => r.team === team);

describe('conteo básico', () => {
  test('2 puntos por victoria, PF/PC y goal average', () => {
    const t = computeStandings(['A', 'B'], [R('A', 'B', 21, 14)]);
    assert.deepEqual(order(t), ['A', 'B']);
    const a = row(t, 'A');
    assert.equal(a.pts, 2);
    assert.equal(a.w, 1);
    assert.equal(a.l, 0);
    assert.equal(a.pf, 21);
    assert.equal(a.pc, 14);
    assert.equal(a.ga, 1.5);
    assert.equal(row(t, 'B').pts, 0);
    assert.equal(a.criterion, CRITERIA.PUNTOS);
  });
});

describe('empate de 2 equipos', () => {
  test('con juego entre sí: gana quien ganó, aunque tenga más PC', () => {
    const t = computeStandings(['A', 'B', 'C', 'D'], [
      R('A', 'B', 10, 7),
      R('B', 'C', 50, 0),
      R('D', 'A', 60, 0),
      R('D', 'C', 7, 0),
    ]);
    // A y B con 2 pts; B tiene muchos menos PC, pero A le ganó.
    assert.ok(row(t, 'A').pc > row(t, 'B').pc);
    assert.deepEqual(order(t), ['D', 'A', 'B', 'C']);
    assert.equal(row(t, 'A').criterion, CRITERIA.H2H);
    assert.equal(row(t, 'B').criterion, CRITERIA.H2H);
    assert.match(row(t, 'A').notes.join(' '), /arriba de B por juego entre sí/);
  });

  test('sin juego entre sí: menos puntos en contra', () => {
    const t = computeStandings(['A', 'B', 'C', 'D'], [
      R('A', 'C', 10, 9),
      R('B', 'D', 30, 3),
    ]);
    // A: PC 9, B: PC 3 → B arriba.
    assert.deepEqual(order(t).slice(0, 2), ['B', 'A']);
    assert.equal(row(t, 'B').criterion, CRITERIA.PC);
    assert.match(row(t, 'B').notes.join(' '), /No jugaron entre sí/);
    assert.match(row(t, 'B').notes.join(' '), /arriba de A por menos puntos en contra \(3 vs 9\)/);
  });
});

describe('empate de 3 o más equipos', () => {
  test('uno le ganó a los otros dos: queda arriba; los otros 2 por juego entre sí', () => {
    const t = computeStandings(['A', 'B', 'C', 'X', 'Y'], [
      R('A', 'B', 10, 9),
      R('A', 'C', 1, 0),
      R('B', 'C', 1, 0),
      R('B', 'X', 1, 0),
      R('C', 'X', 1, 0),
      R('C', 'Y', 1, 0),
    ]);
    // A, B y C con 4 pts. C tiene menos PC (2) que B (9), pero B le ganó.
    assert.deepEqual(order(t).slice(0, 3), ['A', 'B', 'C']);
    assert.ok(row(t, 'C').pc < row(t, 'B').pc);
    assert.equal(row(t, 'A').criterion, CRITERIA.H2H_ALL);
    assert.equal(row(t, 'B').criterion, CRITERIA.H2H);
    assert.match(row(t, 'C').notes.join(' '), /abajo de A, que les ganó a todos/);
  });

  test('circular (A>B, B>C, C>A): cae a puntos en contra', () => {
    const t = computeStandings(['A', 'B', 'C'], [
      R('A', 'B', 40, 10),
      R('B', 'C', 17, 3),
      R('C', 'A', 14, 7),
    ]);
    // PC: A 10+14 = 24, B 40+3 = 43, C 17+7 = 24 → A y C empatan en PC;
    // GA: A 47/24, C 17/24 → A arriba.
    assert.deepEqual(order(t), ['A', 'C', 'B']);
    for (const r of t.rows) assert.equal(r.pts, 2);
    assert.equal(row(t, 'B').criterion, CRITERIA.PC);
    assert.equal(row(t, 'A').criterion, CRITERIA.GA);
    assert.match(row(t, 'A').notes.join(' '), /Ningún equipo del grupo le ganó a todos/);
  });

  test('circular con PC distintos: orden por menos PC', () => {
    const t = computeStandings(['A', 'B', 'C'], [
      R('A', 'B', 7, 6),
      R('B', 'C', 7, 3),
      R('C', 'A', 7, 0),
    ]);
    // PC: A 6 + 7 = 13, B 7 + 3 = 10, C 7 + 0 = 7.
    assert.deepEqual(order(t), ['C', 'B', 'A']);
    for (const r of t.rows) assert.equal(r.criterion, CRITERIA.PC);
  });

  test('sale uno y quedan 2 sin juego entre sí: se usa PC entre esos 2', () => {
    const t = computeStandings(['A', 'B', 'C', 'X', 'Y', 'Z'], [
      R('A', 'B', 10, 9),
      R('A', 'C', 10, 9),
      R('B', 'X', 10, 8),
      R('B', 'Y', 10, 8),
      R('C', 'X', 10, 1),
      R('C', 'Z', 10, 1),
    ]);
    // A, B, C con 4 pts. B y C no se enfrentaron. PC: B 9+16=25, C 9+2=11.
    assert.deepEqual(order(t).slice(0, 3), ['A', 'C', 'B']);
    assert.equal(row(t, 'A').criterion, CRITERIA.H2H_ALL);
    assert.equal(row(t, 'C').criterion, CRITERIA.PC);
    assert.match(row(t, 'C').notes.join(' '), /No jugaron entre sí con B/);
  });

  test('sale uno y quedan 3: esos 3 se ordenan por PC (aunque haya juego entre sí)', () => {
    const t = computeStandings(['A', 'B', 'C', 'D', 'X'], [
      R('A', 'B', 1, 0), R('A', 'C', 1, 0), R('A', 'D', 1, 0),
      R('B', 'C', 2, 1), R('B', 'X', 10, 9), R('B', 'X', 10, 9),
      R('C', 'X', 10, 0), R('C', 'X', 10, 0), R('C', 'X', 10, 0),
      R('D', 'X', 10, 5), R('D', 'X', 10, 5), R('D', 'X', 10, 5),
    ]);
    for (const n of ['A', 'B', 'C', 'D']) assert.equal(row(t, n).pts, 6, n);
    // PC: B 1+1+18 = 20, C 1+2 = 3, D 1+15 = 16. B le ganó a C, pero con 3 restantes manda PC.
    assert.deepEqual(order(t).slice(0, 4), ['A', 'C', 'D', 'B']);
    assert.equal(row(t, 'A').criterion, CRITERIA.H2H_ALL);
    for (const n of ['B', 'C', 'D']) assert.equal(row(t, n).criterion, CRITERIA.PC, n);
  });
});

describe('goal average y orden alfabético', () => {
  test('mismos PC: gana el mayor PF/PC', () => {
    const t = computeStandings(['A', 'B', 'C', 'D'], [
      R('A', 'C', 20, 10),
      R('B', 'D', 30, 10),
    ]);
    assert.deepEqual(order(t).slice(0, 2), ['B', 'A']);
    assert.equal(row(t, 'B').criterion, CRITERIA.GA);
    assert.equal(row(t, 'B').ga, 3);
    assert.equal(row(t, 'A').ga, 2);
  });

  test('PC = 0 da goal average infinito', () => {
    assert.equal(goalAverage(10, 0), Infinity);
    const t = computeStandings(['A', 'B', 'C', 'D'], [
      R('A', 'C', 7, 0),
      R('B', 'D', 35, 3),
    ]);
    assert.equal(row(t, 'A').ga, Infinity);
    assert.deepEqual(order(t).slice(0, 2), ['A', 'B']);
    assert.equal(row(t, 'A').criterion, CRITERIA.PC);
  });

  test('ambos con PC = 0 y mismo goal average: alfabético y sin resolver', () => {
    const t = computeStandings(['Zeta', 'Alfa', 'C', 'D'], [
      R('Zeta', 'C', 7, 0),
      R('Alfa', 'D', 14, 0),
    ]);
    assert.deepEqual(order(t).slice(0, 2), ['Alfa', 'Zeta']);
    assert.equal(row(t, 'Alfa').criterion, CRITERIA.ALPHA);
    assert.equal(row(t, 'Alfa').unresolved, true);
    assert.equal(row(t, 'Zeta').unresolved, true);
  });
});

describe('posiciones provisionales (modo simple)', () => {
  const teams = ['A', 'B', 'C', 'D'];
  const games = [
    { id: 'g1', home: 'A', away: 'C', hs: 20, as: 10, played: true },
    { id: 'g2', home: 'B', away: 'D', hs: 20, as: 3, played: true },
    { id: 'g3', home: 'A', away: 'D', hs: null, as: null, played: false },
    { id: 'g4', home: 'B', away: 'C', hs: null, as: null, played: false },
  ];

  test('empate que necesita PC con juegos sin marcador → provisional', () => {
    const preds = { g3: { w: 'L' }, g4: { w: 'L' } };
    const t = computeStandings(teams, buildResults(games, preds));
    const a = row(t, 'A');
    const b = row(t, 'B');
    assert.equal(a.pts, 4);
    assert.equal(b.pts, 4);
    // PC solo con juegos con marcador: A 10, B 3.
    assert.deepEqual(order(t).slice(0, 2), ['B', 'A']);
    assert.equal(a.provisional, true);
    assert.equal(b.provisional, true);
    assert.match(a.provisionalReason, /sin marcador/);
    assert.equal(countWinnerOnly(games, preds), 2);
  });

  test('al capturar los marcadores deja de ser provisional', () => {
    const preds = { g3: { w: 'L', h: 30, a: 0 }, g4: { w: 'L', h: 21, a: 20 } };
    const t = computeStandings(teams, buildResults(games, preds));
    // PC: A 10 + 0 = 10, B 3 + 20 = 23 → A arriba.
    assert.deepEqual(order(t).slice(0, 2), ['A', 'B']);
    assert.equal(row(t, 'A').provisional, false);
    assert.equal(row(t, 'B').provisional, false);
    assert.equal(countWinnerOnly(games, preds), 0);
  });

  test('empate resuelto por juego entre sí no es provisional aunque falten marcadores', () => {
    const g = [
      { id: 'x1', home: 'A', away: 'B', hs: null, as: null, played: false },
      { id: 'x2', home: 'B', away: 'C', hs: 10, as: 0, played: true },
    ];
    const t = computeStandings(teams, buildResults(g, { x1: { w: 'L' } }));
    assert.equal(row(t, 'A').pts, 2);
    assert.equal(row(t, 'B').pts, 2);
    assert.deepEqual(order(t).slice(0, 2), ['A', 'B']);
    assert.equal(row(t, 'A').criterion, CRITERIA.H2H);
    for (const r of t.rows) assert.equal(r.provisional, false, r.team);
  });

  test('marcador empatado en modo completo no cuenta', () => {
    assert.equal(effectivePrediction({ w: null, h: 14, a: 14 }), null);
    assert.equal(effectivePrediction({ w: 'L', h: 14 }).scored, false);
    assert.equal(effectivePrediction({ w: 'V', h: 14, a: 21 }).winner, 'V');
  });
});

describe('clasificación incierta en el corte 8/9', () => {
  const teams = Array.from({ length: 10 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`);
  const base = [];
  // T01 gana 9 veces, T02 8, ..., T07 3: puntos claramente separados.
  for (let i = 0; i < 7; i++) {
    for (let k = 0; k < 9 - i; k++) base.push(R(teams[i], 'T10', 10, 0));
  }

  test('grupo provisional que cruza el corte → incierta', () => {
    const results = [...base, W('T08', 'T10', 'L'), W('T09', 'T10', 'L')];
    const t = computeStandings(teams, results);
    assert.equal(row(t, 'T08').pts, 2);
    assert.equal(row(t, 'T09').pts, 2);
    assert.deepEqual([row(t, 'T08').pos, row(t, 'T09').pos].sort(), [8, 9]);
    assert.equal(t.uncertainCut, true);
    assert.deepEqual(t.uncertainTeams.sort(), ['T08', 'T09']);
    assert.equal(row(t, 'T08').uncertainCut, true);
    assert.equal(row(t, 'T01').uncertainCut, false);
  });

  test('con marcadores ya no hay incertidumbre', () => {
    const results = [...base, R('T08', 'T10', 10, 0), R('T09', 'T10', 10, 3)];
    const t = computeStandings(teams, results);
    assert.equal(t.uncertainCut, false);
    assert.equal(row(t, 'T08').pos, 8);
    assert.equal(row(t, 'T08').qualified, true);
    assert.equal(row(t, 'T09').qualified, false);
  });

  test('grupo provisional que no cruza el corte → no es incierta', () => {
    // T01 y T02 empatan arriba con juegos sin marcador; T08 sí tiene marcador.
    const results = [...base.slice(1), W('T01', 'T10', 'L'), W('T02', 'T10', 'L'), R('T08', 'T10', 10, 0)];
    const t = computeStandings(teams, results);
    assert.equal(row(t, 'T01').pts, row(t, 'T02').pts);
    assert.equal(row(t, 'T01').provisional, true);
    assert.equal(row(t, 'T08').provisional, false);
    assert.equal(t.uncertainCut, false);
  });
});

describe('movimiento contra la tabla real', () => {
  test('positionChanges', () => {
    const real = computeStandings(['A', 'B'], [R('A', 'B', 10, 0)]);
    const sim = computeStandings(['A', 'B'], [R('A', 'B', 10, 0), W('B', 'A', 'L'), W('B', 'A', 'L')]);
    const ch = positionChanges(real, sim);
    assert.equal(ch.get('B'), 1);
    assert.equal(ch.get('A'), -1);
  });
});

describe('escenario en el hash', () => {
  test('ida y vuelta, ignorando ids desconocidos', () => {
    const preds = { g1: { w: 'L' }, g2: { w: 'V', h: 7, a: 21 }, g3: { w: null, h: 3, a: 3 } };
    const hash = encodeScenario({ mode: MODES.FULL, predictions: preds });
    assert.equal(hash, 'm=c&p=g1:L,g2:7-21');
    const back = decodeScenario(`#${hash},zzz:L`, new Set(['g1', 'g2']));
    assert.equal(back.mode, MODES.FULL);
    assert.deepEqual(back.predictions, { g1: { w: 'L' }, g2: { w: 'V', h: 7, a: 21 } });
    assert.equal(back.ignored, 1);
    assert.equal(decodeScenario('', new Set()), null);
  });
});

describe('parser contra Calendario_2026.xlsx', () => {
  const file = fileURLToPath(new URL('../Calendario_2026.xlsx', import.meta.url));
  const cal = parseWorkbook(readFileSync(file));

  test('63 juegos: 31 jugados y 32 pendientes', () => {
    assert.equal(cal.games.length, 63);
    assert.equal(cal.games.filter((g) => g.played).length, 31);
    assert.equal(cal.games.filter((g) => !g.played).length, 32);
    assert.equal(cal.weeks.length, 10);
    assert.deepEqual(cal.warnings, []);
  });

  test('Tigres vs Borregos MTY (semana 5) es pendiente con su fecha tal cual', () => {
    const g = cal.games.find((x) => x.home === 'Auténticos Tigres UANL' && x.away === 'Borregos MTY');
    assert.ok(g);
    assert.equal(g.week, 5);
    assert.equal(g.played, false);
    assert.equal(g.date, 'Mar 3-nov');
    assert.equal(g.id, 's5-autenticos-tigres-uanl-vs-borregos-mty');
  });

  test('fechas seriales de la semana 8 convertidas', () => {
    assert.equal(excelSerialToText(46318), 'Vie 23-oct');
    assert.equal(excelSerialToText(46319), 'Sáb 24-oct');
    const w8 = cal.games.filter((g) => g.week === 8);
    assert.equal(w8.length, 6);
    assert.deepEqual([...new Set(w8.map((g) => g.date))], ['Vie 23-oct', 'Sáb 24-oct']);
  });

  test('horas, lugares y descansos', () => {
    assert.equal(formatTime(0.75), '18:00');
    assert.equal(formatTime(0.8125), '19:30');
    assert.equal(cal.games.find((g) => g.time === 'POR DEFINIR').home, 'Pumas CU');
    assert.ok(cal.games.some((g) => g.venue === 'EOU 68'));
    const w3 = cal.weeks.find((w) => w.number === 3);
    assert.deepEqual(w3.byes, ['Auténticos Tigres UANL', 'Borregos MTY']);
    // Todos los equipos del calendario son de la lista de 14.
    const used = new Set(cal.games.flatMap((g) => [g.home, g.away]));
    assert.equal(used.size, 14);
    for (const t of used) assert.ok(TEAM_NAMES.includes(t), t);
  });

  test('ids únicos y estables', () => {
    const ids = cal.games.map((g) => g.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.includes('s1-borregos-ccm-vs-borregos-mty'));
  });

  test('avisos ante filas que no entiende, sin tronar', () => {
    const r = parseRows([
      ['Fecha', 'Hora', 'Lugar', 'Local', 'Pts', 'Pts', 'Visita'],
      ['Semana 1'],
      ['Vie 4-sep', 0.75, 'X', 'Equipo Fantasma', 7, 3, 'Pumas CU'],
      ['Vie 4-sep', 0.75, 'X', 'Pumas CU', 7, null, 'Borregos CCM'],
      ['cosa rara'],
      ['Bye: Desconocidos FC'],
    ]);
    assert.equal(r.games.length, 1);
    assert.equal(r.games[0].played, false);
    assert.equal(r.warnings.length, 4);
    assert.equal(resolveTeam('Auténticos UANL'), 'Auténticos Tigres UANL');
  });
});

describe('calendario por equipo', () => {
  const file = fileURLToPath(new URL('../Calendario_2026.xlsx', import.meta.url));
  const cal = parseWorkbook(readFileSync(file));

  test('Borregos MTY: jugados, pendientes, descanso y rivales que no enfrenta', () => {
    const s = teamSchedule('Borregos MTY', cal.weeks, {}, TEAM_NAMES);
    assert.equal(s.rows.length, 10);
    assert.deepEqual(s.rows.find((r) => r.week === 3), { week: 3, bye: true, game: null });
    assert.deepEqual(
      s.played.map((r) => `${r.week} ${r.isHome ? 'vs' : '@'} ${r.rival} ${r.result} ${r.teamPts}-${r.rivalPts}`),
      ['1 @ Borregos CCM G 49-42', '2 @ Borregos PUE G 44-38', '4 vs Pumas CU G 73-20'],
    );
    assert.equal(s.pending.length, 6);
    assert.equal(s.pending[0].rival, 'Auténticos Tigres UANL');
    assert.equal(s.pending[0].status, 'pendiente');
    assert.deepEqual(s.notScheduled.sort(), ['Borregos CEM', 'Borregos GDL', 'Leones Anáhuac MX', 'Linces UVM']);
  });

  test('refleja los pronósticos desde la perspectiva del equipo', () => {
    const id = 's5-autenticos-tigres-uanl-vs-borregos-mty';
    const winOnly = teamSchedule('Borregos MTY', cal.weeks, { [id]: { w: 'L' } }, TEAM_NAMES);
    const r = winOnly.pending.find((x) => x.game.id === id);
    assert.equal(r.status, 'pronosticado');
    assert.equal(r.result, 'P');
    assert.equal(r.scored, false);

    const scored = teamSchedule('Borregos MTY', cal.weeks, { [id]: { w: 'V', h: 17, a: 24 } }, TEAM_NAMES);
    const r2 = scored.pending.find((x) => x.game.id === id);
    assert.equal(r2.result, 'G');
    assert.equal(r2.teamPts, 24);
    assert.equal(r2.rivalPts, 17);
  });

  test('cada equipo tiene 9 juegos y 4 rivales fuera de calendario', () => {
    for (const t of TEAM_NAMES) {
      const s = teamSchedule(t, cal.weeks, {}, TEAM_NAMES);
      assert.equal(s.played.length + s.pending.length, 9, t);
      assert.equal(s.notScheduled.length, 4, t);
    }
  });
});
