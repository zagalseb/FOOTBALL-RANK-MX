// Equipos de la Liga Mayor ONEFA 2026 (una sola tabla, sin conferencias).
// `name` es el nombre exacto que usa el Excel en las filas de juegos.

export const LOGOS_BASE = 'Logos/';

export const TEAMS = [
  { name: 'Borregos CCM', short: 'CCM', logo: 'Borregos CCM.png' },
  { name: 'Borregos MTY', short: 'MTY', logo: 'Borregos MTY.png' },
  { name: 'Borregos GDL', short: 'GDL', logo: 'Borregos GDL.png' },
  { name: 'Borregos PUE', short: 'PUE', logo: 'Borregos Puebla.png' },
  { name: 'Borregos CEM', short: 'CEM', logo: 'Borregos CEM.png' },
  { name: 'Leones Anáhuac MX', short: 'LAM', logo: 'Leones Anahuac.png' },
  { name: 'Leones Anáhuac Cancún', short: 'LAC', logo: 'anahuac_cun.png' },
  { name: 'Pumas CU', short: 'PCU', logo: 'Pumas CU.png' },
  { name: 'Zorros CETYS', short: 'CETYS', logo: 'Zorros CETYS.png' },
  { name: 'Aztecas UDLAP', short: 'UDLAP', logo: 'Aztecas UDLAP.png' },
  { name: 'Auténticos Tigres UANL', short: 'UANL', logo: 'Autenticos Tigres.png' },
  { name: 'Águilas Blancas IPN', short: 'ÁB', logo: 'Aguilas Blancas.png' },
  { name: 'Burros Blancos IPN', short: 'BB', logo: 'Burros Blancos.png' },
  { name: 'Linces UVM', short: 'UVM', logo: 'Linces Mexico.png' },
];

export const TEAM_NAMES = TEAMS.map((t) => t.name);

// Variantes que aparecen en el Excel (sobre todo en las filas "Bye").
// Las llaves se comparan ya normalizadas (minúsculas, sin acentos).
const ALIASES = {
  'autenticos uanl': 'Auténticos Tigres UANL',
  'tigres uanl': 'Auténticos Tigres UANL',
  'autenticos tigres': 'Auténticos Tigres UANL',
  'uanl': 'Auténticos Tigres UANL',
  'borregos puebla': 'Borregos PUE',
  'borregos monterrey': 'Borregos MTY',
  'borregos guadalajara': 'Borregos GDL',
  'leones anahuac': 'Leones Anáhuac MX',
  'leones anahuac mexico': 'Leones Anáhuac MX',
  'anahuac cancun': 'Leones Anáhuac Cancún',
  'leones cancun': 'Leones Anáhuac Cancún',
  'aguilas blancas': 'Águilas Blancas IPN',
  'burros blancos': 'Burros Blancos IPN',
  'linces': 'Linces UVM',
  'pumas': 'Pumas CU',
  'zorros': 'Zorros CETYS',
  'aztecas': 'Aztecas UDLAP',
};

export function normalizeKey(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const LOOKUP = new Map([
  ...TEAMS.map((t) => [normalizeKey(t.name), t.name]),
  ...Object.entries(ALIASES),
]);

/** Devuelve el nombre canónico del equipo, o null si no se reconoce. */
export function resolveTeam(raw) {
  if (raw == null) return null;
  return LOOKUP.get(normalizeKey(raw)) ?? null;
}

export function teamInfo(name) {
  return TEAMS.find((t) => t.name === name) ?? null;
}

export function initials(name) {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-ZÁÉÍÓÚÑ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('');
}
