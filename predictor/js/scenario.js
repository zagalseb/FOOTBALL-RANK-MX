// Codificación del escenario (modo + pronósticos) para el hash de la URL.
// Formato: #m=s&p=<id>:L,<id>:V,<id>:21-14
//   L / V = gana local / visita (solo ganador); "21-14" = marcador local-visita.

export const MODES = { SIMPLE: 'simple', FULL: 'completo' };

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function encodeScenario({ mode, predictions }) {
  const parts = [];
  for (const [id, p] of Object.entries(predictions ?? {})) {
    if (Number.isInteger(p.h) && Number.isInteger(p.a) && p.h !== p.a) parts.push(`${id}:${p.h}-${p.a}`);
    else if (p.w === 'L' || p.w === 'V') parts.push(`${id}:${p.w}`);
  }
  return `m=${mode === MODES.FULL ? 'c' : 's'}&p=${parts.join(',')}`;
}

/**
 * @param {string} hash  con o sin "#"
 * @param {Set<string>} pendingIds  ids de juegos pendientes válidos
 * @returns {{ mode, predictions, ignored: number } | null}
 */
export function decodeScenario(hash, pendingIds) {
  const raw = String(hash ?? '').replace(/^#/, '');
  if (!raw) return null;
  const params = new Map(
    raw.split('&').map((kv) => {
      const i = kv.indexOf('=');
      return i < 0 ? [kv, ''] : [kv.slice(0, i), safeDecode(kv.slice(i + 1))];
    }),
  );
  if (!params.has('m') && !params.has('p')) return null;

  const mode = params.get('m') === 'c' ? MODES.FULL : MODES.SIMPLE;
  const predictions = {};
  let ignored = 0;
  for (const item of (params.get('p') ?? '').split(',').filter(Boolean)) {
    const [id, val = ''] = item.split(':');
    if (!pendingIds.has(id)) { ignored++; continue; }
    const score = val.match(/^(\d{1,3})-(\d{1,3})$/);
    if (score) {
      const h = Number(score[1]);
      const a = Number(score[2]);
      if (h === a) { ignored++; continue; }
      predictions[id] = { w: h > a ? 'L' : 'V', h, a };
    } else if (val === 'L' || val === 'V') {
      predictions[id] = { w: val };
    } else {
      ignored++;
    }
  }
  return { mode, predictions, ignored };
}
