// UI y estado del simulador.
import { loadCalendar } from './parser.js';
import {
  computeStandings, buildResults, effectivePrediction, countWinnerOnly,
  positionChanges, formatGA, CRITERIA, PLAYOFF_SPOTS,
} from './standings.js';
import { encodeScenario, decodeScenario, MODES } from './scenario.js';
import { TEAM_NAMES, LOGOS_BASE, teamInfo, initials } from './teams.js';
import { teamSchedule } from './schedule.js';

const CALENDAR_URL = 'Calendario_2026.xlsx';
const STORAGE_KEY = 'onefa2026-simulador-v1';
const MAX_SCORE = 199;

const CRITERION_LABEL = {
  [CRITERIA.PUNTOS]: 'Sin empate en puntos',
  [CRITERIA.H2H]: 'Juego entre sí',
  [CRITERIA.H2H_ALL]: 'Le ganó a todos los empatados',
  [CRITERIA.PC]: 'Menos puntos en contra',
  [CRITERIA.GA]: 'Goal average (PF ÷ PC)',
  [CRITERIA.ALPHA]: 'Orden alfabético (empate sin resolver)',
};

const state = {
  mode: MODES.SIMPLE,
  predictions: {}, // id → { w: 'L'|'V'|null, h?: number|null, a?: number|null }
  tab: 'pronosticos',
  showPlayed: false,
  expanded: null,
  team: null, // equipo elegido en la vista Equipos
};

let cal = null;
let pendingIds = new Set();
let realTable = null;
let storageWarned = false;

const $ = (sel) => document.querySelector(sel);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// ---------- Logos ----------

function logoHTML(team) {
  const info = teamInfo(team);
  const ini = esc(initials(team));
  if (!info?.logo) return `<span class="logo-fallback" aria-hidden="true">${ini}</span>`;
  return `<img class="logo" src="${esc(LOGOS_BASE + encodeURI(info.logo))}" alt="" loading="lazy" data-initials="${ini}">`;
}

// Si un logo no carga, se reemplaza por un círculo con las iniciales.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('logo')) return;
  const span = document.createElement('span');
  span.className = 'logo-fallback';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = img.dataset.initials ?? '';
  img.replaceWith(span);
}, true);

// ---------- Avisos ----------

function notice(html, { kind = 'info', id = null, dismissible = true } = {}) {
  const box = $('#notices');
  if (id) box.querySelector(`[data-notice="${id}"]`)?.remove();
  const el = document.createElement('div');
  el.className = `banner banner-${kind}`;
  if (id) el.dataset.notice = id;
  el.innerHTML = `<div>${html}</div>${dismissible ? '<button type="button" class="close" aria-label="Cerrar aviso">×</button>' : ''}`;
  el.querySelector('.close')?.addEventListener('click', () => el.remove());
  box.append(el);
  return el;
}

function removeNotice(id) {
  $(`#notices [data-notice="${id}"]`)?.remove();
}

// ---------- Persistencia ----------

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: state.mode, predictions: state.predictions }));
  } catch {
    if (!storageWarned) {
      storageWarned = true;
      notice('No se pudo guardar en este navegador. El simulador funciona, pero tus pronósticos se perderán al cerrar la página (puedes usar “Compartir” para conservarlos).', { kind: 'warn', id: 'storage' });
    }
  }
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const toScore = (v) => (Number.isInteger(v) && v >= 0 && v <= MAX_SCORE ? v : null);

/** Deja solo pronósticos de juegos pendientes conocidos y con forma válida. */
function sanitize(preds) {
  const out = {};
  if (!preds || typeof preds !== 'object') return out;
  for (const [id, p] of Object.entries(preds)) {
    if (!pendingIds.has(id) || !p || typeof p !== 'object') continue;
    const clean = { w: p.w === 'L' || p.w === 'V' ? p.w : null, h: toScore(p.h), a: toScore(p.a) };
    if (clean.w || clean.h !== null || clean.a !== null) out[id] = clean;
  }
  return out;
}

function applyHash() {
  const sc = decodeScenario(location.hash, pendingIds);
  if (!sc) return false;
  state.mode = sc.mode;
  state.predictions = sc.predictions;
  const n = Object.keys(sc.predictions).length;
  let msg = `Se cargó un escenario compartido con ${n} pronóstico${n === 1 ? '' : 's'}.`;
  if (sc.ignored) msg += ` Se ignoraron ${sc.ignored} que no corresponden a juegos pendientes.`;
  notice(msg, { id: 'shared' });
  history.replaceState(null, '', location.pathname + location.search);
  save();
  return true;
}

// ---------- Cálculo ----------

function simTable() {
  return computeStandings(TEAM_NAMES, buildResults(cal.games, state.predictions));
}

// ---------- Tabla ----------

function renderTable() {
  const sim = simTable();
  const moves = positionChanges(realTable, sim);
  const body = $('#standings-body');
  const rows = [];

  for (const r of sim.rows) {
    const mv = moves.get(r.team);
    const mov = mv > 0
      ? `<span class="mov up" title="Subió ${mv} lugar${mv === 1 ? '' : 'es'} vs la tabla real">▲${mv}</span>`
      : mv < 0
        ? `<span class="mov down" title="Bajó ${-mv} lugar${mv === -1 ? '' : 'es'} vs la tabla real">▼${-mv}</span>`
        : '<span class="mov same" title="Mismo lugar que en la tabla real">–</span>';
    const prov = r.provisional
      ? `<span class="prov" title="${esc(`Posición provisional. ${r.provisionalReason}`)}" aria-label="Posición provisional">≈</span>`
      : '';
    const unres = r.unresolved && !r.provisional
      ? '<span class="unres" title="Empate sin resolver: se ordenó alfabéticamente">A–Z</span>'
      : '';
    const cls = ['team-row', r.qualified && 'qualified', r.uncertainCut && 'uncertain'].filter(Boolean).join(' ');
    const open = state.expanded === r.team;
    rows.push(`
      <tr class="${cls}" data-team="${esc(r.team)}" tabindex="0" role="button" aria-expanded="${open}">
        <td class="c-pos">${r.pos}</td>
        <td class="c-mov">${mov}</td>
        <td class="c-team"><div class="team-cell">${logoHTML(r.team)}<span class="name">${esc(r.team)}${prov}${unres}</span></div></td>
        <td>${r.w}</td>
        <td>${r.l}</td>
        <td class="pts">${r.pts}</td>
        <td>${r.pf}</td>
        <td>${r.pc}</td>
      </tr>`);
    if (open) rows.push(`<tr class="detail"><td colspan="8">${detailHTML(r, sim)}</td></tr>`);
    if (r.pos === PLAYOFF_SPOTS && sim.rows.length > PLAYOFF_SPOTS) {
      rows.push('<tr class="cutline" aria-hidden="true"><td colspan="8"><span>Corte de playoffs</span></td></tr>');
    }
  }
  body.innerHTML = rows.join('');

  const un = $('#uncertain-notice');
  if (sim.uncertainCut) {
    un.innerHTML = `<div class="banner banner-warn" role="status"><div><strong>Clasificación incierta:</strong>
      ${esc(listNames(sim.uncertainTeams))} están empatados alrededor del corte entre el lugar ${PLAYOFF_SPOTS} y el ${PLAYOFF_SPOTS + 1}.
      Su desempate depende de puntos en contra de juegos pronosticados sin marcador.</div></div>`;
  } else {
    un.innerHTML = '';
  }
}

function listNames(names) {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`;
}

function detailHTML(r, sim) {
  const realPos = realTable.rows.find((x) => x.team === r.team).pos;
  const parts = [];
  parts.push(`<h4>${esc(r.team)} — lugar ${r.pos}</h4>`);
  parts.push(`<p class="muted">Lugar en la tabla real: ${realPos}. Juegos contados: ${r.gp}. Goal average: ${formatGA(r.ga)}.</p>`);
  if (r.tieGroup.length) {
    parts.push(`<p>Empatado en ${r.pts} pts con ${esc(listNames(r.tieGroup))}. Criterio: <strong>${esc(CRITERION_LABEL[r.criterion])}</strong>.</p>`);
    parts.push(`<ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`);
  } else {
    parts.push(`<p>No tiene empate en puntos (${r.pts} pts).</p>`);
  }
  if (r.provisional) parts.push(`<p class="warn"><strong>Posición provisional.</strong> ${esc(r.provisionalReason)}</p>`);
  if (r.uncertainCut) parts.push('<p class="warn"><strong>Clasificación incierta:</strong> su grupo empatado abarca el corte de playoffs.</p>');
  parts.push(`<button type="button" class="link-btn" data-action="open-team" data-team="${esc(r.team)}">Ver calendario de ${esc(r.team)}</button>`);
  return `<div class="detail">${parts.join('')}</div>`;
}

// ---------- Pronósticos ----------

function cardState(g) {
  const p = state.predictions[g.id];
  const eff = effectivePrediction(p);
  const tie = p && Number.isInteger(p.h) && Number.isInteger(p.a) && p.h === p.a;
  return { p, eff, tie };
}

function gameMessage(g) {
  if (g.played) return { text: '', cls: '' };
  const { eff, tie } = cardState(g);
  if (tie) return { text: 'No puede haber empate: corrige el marcador. Mientras tanto este juego no cuenta.', cls: 'warn' };
  if (state.mode === MODES.FULL && eff && !eff.scored) {
    const w = eff.winner === 'L' ? g.home : g.away;
    return { text: `Solo ganador (${w}). Captura el marcador para que cuente en PF y PC.`, cls: 'warn' };
  }
  return { text: '', cls: '' };
}

function sideHTML(g, side) {
  const team = side === 'L' ? g.home : g.away;
  const tag = side === 'L' ? 'Local' : 'Visita';
  const base = `${logoHTML(team)}<span class="name">${esc(team)}</span><span class="tag">${tag}</span>`;

  if (g.played) {
    const won = side === 'L' ? g.hs > g.as : g.as > g.hs;
    return `<div class="side ${won ? 'winner' : 'loser'}">${base}<span class="score">${side === 'L' ? g.hs : g.as}</span></div>`;
  }

  const { p, eff } = cardState(g);
  if (state.mode === MODES.SIMPLE) {
    const picked = eff?.winner === side;
    const score = eff?.scored ? `<span class="score">${side === 'L' ? eff.hs : eff.as}</span>` : '';
    return `<button type="button" class="side" data-action="pick" data-side="${side}" aria-pressed="${picked}"
      aria-label="Gana ${esc(team)}">${base}${score}<span class="check" aria-hidden="true">✓</span></button>`;
  }

  const val = side === 'L' ? p?.h : p?.a;
  const picked = eff?.winner === side;
  return `<label class="side ${picked ? 'winner-pick' : ''}">${base}
    <input type="number" inputmode="numeric" min="0" max="${MAX_SCORE}" step="1" data-side="${side}"
      value="${Number.isInteger(val) ? val : ''}" aria-label="Puntos de ${esc(team)}" placeholder="–"></label>`;
}

function gameHTML(g) {
  const { p, eff, tie } = cardState(g);
  const cls = ['game', g.played && 'locked', eff && 'has-pred', tie && 'invalid'].filter(Boolean).join(' ');
  const when = [g.date, g.time].filter(Boolean).join(' · ');
  const right = g.played
    ? '<span class="lock" title="Juego jugado: no se puede editar">🔒 Jugado</span>'
    : p ? '<button type="button" class="clear" data-action="clear-game" title="Quitar pronóstico">Quitar ×</button>' : '';
  const msg = gameMessage(g);
  return `<article class="${cls}" data-id="${esc(g.id)}">
    <div class="game-meta"><span class="when">${esc(when)}</span>${g.venue ? `<span class="venue">· ${esc(g.venue)}</span>` : ''}${right}</div>
    ${sideHTML(g, 'L')}
    ${sideHTML(g, 'V')}
    <p class="game-msg ${msg.cls}">${esc(msg.text)}</p>
  </article>`;
}

function renderPredictions() {
  const out = [];
  for (const w of cal.weeks) {
    const games = w.games.filter((g) => state.showPlayed || !g.played);
    if (!games.length) continue;
    const pending = w.games.filter((g) => !g.played);
    const hasPreds = pending.some((g) => state.predictions[g.id]);
    const byes = w.byes.length ? `Descansan: ${w.byes.join(', ')}` : '';
    out.push(`<section class="week" data-week="${w.number}">
      <div class="week-head">
        <h3>Semana ${w.number}</h3>
        <span class="byes">${esc(byes)}</span>
        ${pending.length ? `<button type="button" class="btn btn-small btn-ghost" data-action="clear-week" ${hasPreds ? '' : 'disabled'}>Limpiar semana</button>` : ''}
      </div>
      <div class="games">${games.map(gameHTML).join('')}</div>
    </section>`);
  }
  $('#weeks').innerHTML = out.join('') || '<p class="empty">No hay juegos pendientes.</p>';
  renderSummary();
}

function renderSummary() {
  const total = pendingIds.size;
  const done = cal.games.filter((g) => !g.played && effectivePrediction(state.predictions[g.id])).length;
  const winnerOnly = countWinnerOnly(cal.games, state.predictions);
  let txt = `${done} de ${total} juegos pendientes pronosticados.`;
  if (state.mode === MODES.FULL && winnerOnly) txt += ` ${winnerOnly} con solo ganador.`;
  $('#preds-summary').textContent = txt;
  $('#tab-count').textContent = `(${done}/${total})`;
}

/** Actualiza una tarjeta sin re-renderizarla (para no perder el foco del input). */
function refreshCard(id) {
  const g = cal.games.find((x) => x.id === id);
  const card = document.querySelector(`.game[data-id="${CSS.escape(id)}"]`);
  if (!g || !card) return;
  const { p, eff, tie } = cardState(g);
  card.classList.toggle('has-pred', !!eff);
  card.classList.toggle('invalid', !!tie);
  for (const lab of card.querySelectorAll('label.side')) {
    lab.classList.toggle('winner-pick', eff?.winner === lab.querySelector('input').dataset.side);
  }
  const meta = card.querySelector('.game-meta');
  const clear = meta.querySelector('.clear');
  if (p && !clear) meta.insertAdjacentHTML('beforeend', '<button type="button" class="clear" data-action="clear-game" title="Quitar pronóstico">Quitar ×</button>');
  if (!p && clear) clear.remove();
  const msg = gameMessage(g);
  const el = card.querySelector('.game-msg');
  el.className = `game-msg ${msg.cls}`;
  el.textContent = msg.text;
  const week = card.closest('.week');
  const btn = week?.querySelector('[data-action="clear-week"]');
  if (btn) btn.disabled = !cal.games.some((x) => x.week === g.week && !x.played && state.predictions[x.id]);
}

function changed() {
  save();
  renderTable();
  renderSummary();
}

// ---------- Calendario por equipo ----------

const collator = new Intl.Collator('es');

function populateTeamSelect() {
  const sel = $('#team-select');
  sel.innerHTML = [...TEAM_NAMES].sort(collator.compare)
    .map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  sel.value = state.team;
}

function teamSummaryHTML(team) {
  const real = realTable.rows.find((r) => r.team === team);
  const sim = simTable().rows.find((r) => r.team === team);
  const line = (label, r) =>
    `<span>${label}: <strong>${r.w}-${r.l}</strong> · lugar <strong>${r.pos}</strong> · PF ${r.pf} · PC ${r.pc}</span>`;
  const withPreds = Object.keys(state.predictions).length ? line('Con tus pronósticos', sim) : '';
  return `<div class="team-summary">${logoHTML(team)}<div><h3>${esc(team)}</h3>
    <div class="stats">${line('Real', real)}${withPreds}</div></div></div>`;
}

/** Resultado (jugado) o controles de pronóstico desde la perspectiva del equipo. */
function teamResultHTML(r) {
  if (r.status === 'jugado') {
    return `<span class="res res-${r.result}">${r.result}</span><span class="res-score">${r.teamPts}-${r.rivalPts}</span>`;
  }
  const rivalSide = r.mySide === 'L' ? 'V' : 'L';
  if (state.mode === MODES.SIMPLE) {
    const btn = (wl, side) => `<button type="button" class="wl" data-action="pick" data-side="${side}" data-wl="${wl}"
      aria-pressed="${r.result === wl}">${wl === 'G' ? 'Gana' : 'Pierde'}</button>`;
    const score = r.scored ? `<span class="res-score">${r.teamPts}-${r.rivalPts}</span>` : '';
    return `${btn('G', r.mySide)}${btn('P', rivalSide)}${score}`;
  }
  const p = state.predictions[r.game.id];
  const val = (side) => {
    const v = side === 'L' ? p?.h : p?.a;
    return Number.isInteger(v) ? v : '';
  };
  const input = (side, team) => `<input type="number" inputmode="numeric" min="0" max="${MAX_SCORE}" step="1"
    data-side="${side}" value="${val(side)}" placeholder="–" aria-label="Puntos de ${esc(team)}">`;
  const clear = p ? '<button type="button" class="clear" data-action="clear-game" title="Quitar pronóstico" aria-label="Quitar pronóstico">×</button>' : '';
  return `${input(r.mySide, state.team)}<span aria-hidden="true">–</span>${input(rivalSide, r.rival)}${clear}`;
}

function teamRowHTML(r) {
  if (!r.game) {
    return `<li class="tg bye"><span class="tg-week">S${r.week}</span><span>${r.bye ? 'Descansa' : 'Sin juego'}</span></li>`;
  }
  const g = r.game;
  const { tie } = cardState(g);
  const cls = ['tg', r.status === 'pronosticado' && 'pred', tie && 'invalid'].filter(Boolean).join(' ');
  const when = [g.date, g.time, g.venue].filter(Boolean).join(' · ');
  const tag = r.status === 'jugado' ? '' : r.status === 'pronosticado' ? ' · tu pronóstico' : ' · pendiente';
  const msg = gameMessage(g);
  return `<li class="${cls}" data-id="${esc(g.id)}">
    <span class="tg-week">S${r.week}</span>
    <div>
      <div class="tg-rival"><span class="ha" title="${r.isHome ? 'Local' : 'Visita'}">${r.isHome ? 'vs' : '@'}</span>${logoHTML(r.rival)}<span class="name">${esc(r.rival)}</span></div>
      <div class="tg-meta">${esc(when)}${tag}</div>
    </div>
    <div class="tg-res">${teamResultHTML(r)}</div>
    <p class="game-msg ${msg.cls}">${esc(msg.text)}</p>
  </li>`;
}

function rivalsHTML(s) {
  const item = (team, extra = '') => `<li>${logoHTML(team)}<span class="name">${esc(team)}</span>${extra}</li>`;
  const played = s.played.map((r) => item(r.rival,
    `<span class="res res-${r.result}">${r.result}</span><span class="res-score">${r.teamPts}-${r.rivalPts}</span>`));
  const pending = s.pending.map((r) => item(r.rival, `<span class="wk">Sem ${r.week}</span>${
    r.status === 'pronosticado'
      ? `<span class="res res-${r.result}" title="Tu pronóstico">${r.result}</span>`
      : '<span class="res res-pend" title="Sin pronóstico">?</span>'}`));
  const none = s.notScheduled.map((t) => item(t));
  const block = (title, items, empty, note = '') => `<div class="rivals">
    <h4>${title} <span class="n">(${items.length})</span></h4>
    ${items.length ? `<ul>${items.join('')}</ul>` : `<p class="none">${empty}</p>`}${note}</div>`;
  return block('Ya jugó contra', played, 'Todavía no juega.')
    + block('Le falta jugar contra', pending, 'Ya jugó todos sus juegos.')
    + block('No se enfrentan en temporada regular', none, 'Se enfrenta a todos.',
      none.length ? '<p class="hint">Si empata en puntos con alguno de ellos, no hay juego entre sí y el desempate pasa a puntos en contra.</p>' : '');
}

function renderTeamView() {
  if (!cal || !state.team) return;
  const s = teamSchedule(state.team, cal.weeks, state.predictions, TEAM_NAMES);
  $('#team-view').innerHTML = `${teamSummaryHTML(state.team)}
    <div class="team-grid">
      <div><h4>Calendario <span class="hint">· vs = local, @ = visita</span></h4><ul class="tg-list">${s.rows.map(teamRowHTML).join('')}</ul></div>
      <div id="team-rivals">${rivalsHTML(s)}</div>
    </div>`;
}

/** Tras capturar un marcador en la vista Equipos: actualiza sin tocar los inputs. */
function refreshTeamRow(id) {
  const li = document.querySelector(`#team-view .tg[data-id="${CSS.escape(id)}"]`);
  const g = cal.games.find((x) => x.id === id);
  if (!li || !g) return;
  const { eff, tie } = cardState(g);
  li.classList.toggle('pred', !!eff);
  li.classList.toggle('invalid', !!tie);
  const msg = gameMessage(g);
  const el = li.querySelector('.game-msg');
  el.className = `game-msg ${msg.cls}`;
  el.textContent = msg.text;
  const res = li.querySelector('.tg-res');
  const clear = res.querySelector('.clear');
  if (state.predictions[id] && !clear) res.insertAdjacentHTML('beforeend', '<button type="button" class="clear" data-action="clear-game" title="Quitar pronóstico" aria-label="Quitar pronóstico">×</button>');
  if (!state.predictions[id] && clear) clear.remove();
  const s = teamSchedule(state.team, cal.weeks, state.predictions, TEAM_NAMES);
  $('#team-rivals').innerHTML = rivalsHTML(s);
  $('#team-view .team-summary').outerHTML = teamSummaryHTML(state.team);
}

/** Vuelve a dibujar el elemento donde se hizo el cambio (tarjeta o fila de equipo). */
function rerenderItem(el, id) {
  if (el.classList.contains('game')) {
    el.outerHTML = gameHTML(cal.games.find((g) => g.id === id));
    refreshCard(id);
  } else {
    renderTeamView();
  }
}

function renderAll() {
  renderPredictions();
  renderTable();
  if (state.tab === 'equipos') renderTeamView();
}

// ---------- Eventos ----------

function onPredsClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const item = btn.closest('[data-id]');
  const id = item?.dataset.id;

  switch (btn.dataset.action) {
    case 'pick': {
      const side = btn.dataset.side;
      const cur = effectivePrediction(state.predictions[id]);
      if (cur?.winner === side) delete state.predictions[id];
      else state.predictions[id] = { w: side, h: null, a: null };
      rerenderItem(item, id);
      changed();
      break;
    }
    case 'clear-game': {
      delete state.predictions[id];
      rerenderItem(item, id);
      changed();
      break;
    }
    case 'clear-week': {
      const week = Number(btn.closest('.week').dataset.week);
      for (const g of cal.games) if (g.week === week) delete state.predictions[g.id];
      renderPredictions();
      changed();
      break;
    }
  }
}

function onScoreInput(e) {
  const input = e.target;
  if (!(input instanceof HTMLInputElement) || input.type !== 'number') return;
  const item = input.closest('[data-id]');
  const id = item.dataset.id;
  const raw = input.value.trim();
  let v = raw === '' ? null : Number(raw);
  if (v !== null && (!Number.isInteger(v) || v < 0)) v = null;
  if (v !== null && v > MAX_SCORE) { v = MAX_SCORE; input.value = String(v); }

  const p = { w: null, h: null, a: null, ...state.predictions[id] };
  p[input.dataset.side === 'L' ? 'h' : 'a'] = v;
  if (p.h !== null && p.a !== null) p.w = p.h === p.a ? null : p.h > p.a ? 'L' : 'V';
  if (!p.w && p.h === null && p.a === null) delete state.predictions[id];
  else state.predictions[id] = p;

  if (item.classList.contains('game')) refreshCard(id);
  else refreshTeamRow(id);
  changed();
}

function setMode(mode) {
  if (mode === state.mode) return;
  const from = state.mode;
  state.mode = mode;
  applyModeUI();
  removeNotice('mode-switch');
  if (from === MODES.SIMPLE && mode === MODES.FULL) {
    const n = countWinnerOnly(cal.games, state.predictions);
    if (n) {
      notice(`${n} juego${n === 1 ? ' tiene' : 's tienen'} solo ganador. Captura su marcador para que cuenten en puntos a favor y en contra; mientras tanto se cuentan solo como victoria/derrota.`, { kind: 'warn', id: 'mode-switch' });
    }
  }
  save();
  renderAll();
}

function applyModeUI() {
  document.body.dataset.mode = state.mode;
  for (const b of document.querySelectorAll('.segmented [data-mode]')) {
    b.setAttribute('aria-checked', String(b.dataset.mode === state.mode));
  }
}

function setTab(tab) {
  const prev = state.tab;
  state.tab = tab;
  document.body.dataset.tab = tab;
  for (const b of document.querySelectorAll('.tabs [data-tab]')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  }
  // Cada vista se redibuja al mostrarse para reflejar lo capturado en la otra.
  if (!cal) return;
  if (tab === 'equipos') renderTeamView();
  else if (prev === 'equipos') renderPredictions();
}

function openTeam(team) {
  state.team = team;
  $('#team-select').value = team;
  setTab('equipos');
  $('#view-equipos').scrollIntoView({ block: 'start' });
}

function toggleTeam(team) {
  state.expanded = state.expanded === team ? null : team;
  renderTable();
  document.querySelector(`tr.team-row[data-team="${CSS.escape(team)}"]`)?.focus({ preventScroll: true });
}

async function copyShare() {
  const input = $('#share-url');
  const status = $('#share-status');
  try {
    await navigator.clipboard.writeText(input.value);
    status.textContent = '¡Link copiado!';
  } catch {
    input.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* sin portapapeles */ }
    status.textContent = ok ? '¡Link copiado!' : 'No se pudo copiar automáticamente; selecciona el link y cópialo.';
  }
}

function openShare() {
  const panel = $('#share-panel');
  const url = `${location.href.split('#')[0]}#${encodeScenario(state)}`;
  $('#share-url').value = url;
  $('#share-status').textContent = 'Quien abra este link verá tus pronósticos y el modo actual.';
  panel.hidden = false;
  $('#share-url').select();
}

function bindEvents() {
  for (const b of document.querySelectorAll('.segmented [data-mode]')) {
    b.addEventListener('click', () => setMode(b.dataset.mode));
  }
  for (const b of document.querySelectorAll('.tabs [data-tab]')) {
    b.addEventListener('click', () => setTab(b.dataset.tab));
  }
  $('#weeks').addEventListener('click', onPredsClick);
  $('#weeks').addEventListener('input', onScoreInput);
  $('#team-view').addEventListener('click', onPredsClick);
  $('#team-view').addEventListener('input', onScoreInput);
  $('#team-select').addEventListener('change', (e) => {
    state.team = e.target.value;
    renderTeamView();
  });
  $('#show-played').addEventListener('change', (e) => {
    state.showPlayed = e.target.checked;
    renderPredictions();
  });
  $('#standings-body').addEventListener('click', (e) => {
    const link = e.target.closest('[data-action="open-team"]');
    if (link) {
      openTeam(link.dataset.team);
      return;
    }
    const tr = e.target.closest('tr.team-row');
    if (tr) toggleTeam(tr.dataset.team);
  });
  $('#standings-body').addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr.team-row');
    if (tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      toggleTeam(tr.dataset.team);
    }
  });
  $('#share-btn').addEventListener('click', openShare);
  $('#copy-btn').addEventListener('click', copyShare);
  $('#reset-btn').addEventListener('click', () => {
    if (!Object.keys(state.predictions).length) return;
    if (!confirm('¿Borrar todos tus pronósticos?')) return;
    state.predictions = {};
    removeNotice('mode-switch');
    save();
    renderAll();
  });
  window.addEventListener('hashchange', () => {
    if (applyHash()) {
      applyModeUI();
      renderAll();
    }
  });
}

// ---------- Arranque ----------

async function init() {
  bindEvents();
  try {
    cal = await loadCalendar(CALENDAR_URL);
  } catch (err) {
    const local = location.protocol === 'file:'
      ? ' Abre el sitio con un servidor local (por ejemplo <code>python3 -m http.server</code>), no con doble clic.'
      : '';
    notice(`No se pudo leer el calendario: ${esc(err.message)}.${local}`, { kind: 'error', dismissible: false });
    $('#standings-body').innerHTML = '<tr><td colspan="8" class="loading">Sin datos.</td></tr>';
    return;
  }

  if (cal.warnings.length) {
    notice(`<strong>Avisos al leer el calendario:</strong><ul>${cal.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`, { kind: 'warn', id: 'parser' });
  }

  pendingIds = new Set(cal.games.filter((g) => !g.played).map((g) => g.id));
  realTable = computeStandings(TEAM_NAMES, buildResults(cal.games, {}));
  state.team = realTable.rows[0].team;
  populateTeamSelect();

  if (!applyHash()) {
    const saved = loadSaved();
    if (saved) {
      state.mode = saved.mode === MODES.FULL ? MODES.FULL : MODES.SIMPLE;
      state.predictions = sanitize(saved.predictions);
    }
  }
  state.predictions = sanitize(state.predictions);

  applyModeUI();
  renderAll();
}

init();
