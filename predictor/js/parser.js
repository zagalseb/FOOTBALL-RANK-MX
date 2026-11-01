// Lectura del calendario (Calendario_2026.xlsx, hoja Sheet1).
// parseRows es pura; loadCalendar hace el fetch y usa SheetJS.
import * as XLSX from '../vendor/xlsx.mjs';
import { resolveTeam, normalizeKey } from './teams.js';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function slug(s) {
  return normalizeKey(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function gameId(week, home, away) {
  return `s${week}-${slug(home)}-vs-${slug(away)}`;
}

/** Número serial de Excel (sistema 1900) → "Vie 23-oct". */
export function excelSerialToText(serial) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}-${MONTHS[d.getUTCMonth()]}`;
}

export function formatDate(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return excelSerialToText(v);
  if (v == null) return '';
  return String(v).trim();
}

/** Fracción de día (0.75) → "18:00". El texto ("POR DEFINIR") se deja tal cual. */
export function formatTime(v) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const mins = Math.round((v - Math.floor(v)) * 1440) % 1440;
    const h = String(Math.floor(mins / 60)).padStart(2, '0');
    const m = String(mins % 60).padStart(2, '0');
    return `${h}:${m}`;
  }
  if (v == null) return '';
  return String(v).trim();
}

const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '');

/** Marcador → número, null (vacío / "-") o undefined (texto no reconocido). */
function parseScore(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (isBlank(v)) return null;
  const s = String(v).trim();
  if (/^[-–—]$/.test(s)) return null;
  if (/^\d+$/.test(s)) return Number(s);
  return undefined;
}

/**
 * Convierte las filas de Sheet1 (arreglo de arreglos) al calendario.
 * Nunca lanza: lo que no entiende lo reporta en `warnings`.
 */
export function parseRows(rows) {
  const weeks = [];
  const games = [];
  const warnings = [];
  const ids = new Set();
  let week = null;

  rows.forEach((row, i) => {
    const r = Array.isArray(row) ? row : [];
    const rowNum = i + 1; // número de fila tal como lo ve Excel
    if (r.every(isBlank)) return;

    const [fecha, hora, lugar, local, ptsL, ptsV, visita] = r;
    const first = isBlank(fecha) ? '' : String(fecha).trim();

    if (/^fecha$/i.test(first)) return; // encabezado

    const semana = first.match(/^semana\s*(\d+)/i);
    if (semana) {
      week = { number: Number(semana[1]), games: [], byes: [] };
      weeks.push(week);
      return;
    }

    const bye = first.match(/^bye\s*:?\s*(.*)$/i);
    if (bye) {
      if (!week) {
        warnings.push(`Fila ${rowNum}: descanso antes de la primera "Semana"; se ignoró.`);
        return;
      }
      for (const rawName of bye[1].split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
        const team = resolveTeam(rawName);
        if (team) week.byes.push(team);
        else warnings.push(`Fila ${rowNum}: no reconozco al equipo "${rawName}" en la fila de descanso.`);
      }
      return;
    }

    if (isBlank(local) && isBlank(visita)) {
      warnings.push(`Fila ${rowNum}: no entiendo el contenido ("${r.filter((v) => !isBlank(v)).join(' | ')}"); se ignoró.`);
      return;
    }
    if (!week) {
      warnings.push(`Fila ${rowNum}: juego antes de la primera "Semana"; se ignoró.`);
      return;
    }

    const home = resolveTeam(local);
    const away = resolveTeam(visita);
    if (!home || !away) {
      const bad = [!home && local, !away && visita].filter(Boolean).map((n) => `"${n}"`).join(' y ');
      warnings.push(`Fila ${rowNum}: no reconozco al equipo ${bad}; se ignoró el juego.`);
      return;
    }
    if (home === away) {
      warnings.push(`Fila ${rowNum}: ${home} aparece como local y visita; se ignoró.`);
      return;
    }

    let hs = parseScore(ptsL);
    let as = parseScore(ptsV);
    if (hs === undefined || as === undefined) {
      warnings.push(`Fila ${rowNum} (${home} vs ${away}): marcador no reconocido ("${ptsL ?? ''}" - "${ptsV ?? ''}"); se trata como pendiente.`);
      hs = as = null;
    } else if ((hs === null) !== (as === null)) {
      warnings.push(`Fila ${rowNum} (${home} vs ${away}): solo hay un marcador; se trata como pendiente.`);
      hs = as = null;
    } else if (hs !== null && hs === as) {
      warnings.push(`Fila ${rowNum} (${home} vs ${away}): marcador empatado ${hs}-${as}; se trata como pendiente.`);
      hs = as = null;
    }

    let id = gameId(week.number, home, away);
    if (ids.has(id)) {
      warnings.push(`Fila ${rowNum}: juego repetido (${home} vs ${away}, semana ${week.number}).`);
      let n = 2;
      while (ids.has(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
    }
    ids.add(id);

    const game = {
      id,
      week: week.number,
      date: formatDate(fecha),
      time: formatTime(hora),
      venue: isBlank(lugar) ? '' : String(lugar).trim(),
      home,
      away,
      hs,
      as,
      played: hs !== null,
    };
    week.games.push(game);
    games.push(game);
  });

  // Validación ligera: cada equipo debería aparecer una sola vez por semana.
  for (const w of weeks) {
    const seen = new Map();
    for (const t of [...w.games.flatMap((g) => [g.home, g.away]), ...w.byes]) {
      seen.set(t, (seen.get(t) ?? 0) + 1);
    }
    for (const [t, n] of seen) {
      if (n > 1) warnings.push(`Semana ${w.number}: ${t} aparece ${n} veces (juegos + descansos).`);
    }
  }

  if (games.length === 0) warnings.push('No se encontró ningún juego en el calendario.');

  return { weeks, games, warnings };
}

/** Lee el contenido binario del .xlsx. */
export function parseWorkbook(data) {
  const wb = XLSX.read(data, { type: data instanceof ArrayBuffer ? 'array' : undefined });
  let name = 'Sheet1';
  const extra = [];
  if (!wb.Sheets[name]) {
    name = wb.SheetNames[0];
    extra.push(`No existe la hoja "Sheet1"; se usó "${name}".`);
  }
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true });
  const result = parseRows(rows);
  result.warnings.unshift(...extra);
  return result;
}

export async function loadCalendar(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`No se pudo descargar ${url} (HTTP ${res.status}).`);
  return parseWorkbook(await res.arrayBuffer());
}
