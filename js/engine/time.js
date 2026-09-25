// Tiempo del motor: "día" = días (con fracción) desde el 17/06/2026 00:00, hora de Argentina (UTC-3 fijo,
// sin horario de verano). Todas las fechas del log son ISO 8601 con offset -03:00.
export const TZ_OFFSET = '-03:00';
const TZ_OFFSET_MS = -3 * 3600000;
const DAY_MS = 86400000;
export const DAY0_MS = Date.parse('2026-06-17T00:00:00-03:00');

export function dayFromIso(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error('Fecha inválida: ' + iso);
  return (ms - DAY0_MS) / DAY_MS;
}

// Redondea al minuto y expresa en hora local.
export function isoFromDay(day) {
  const ms = DAY0_MS + Math.round(day * 1440) * 60000;
  const wall = new Date(ms + TZ_OFFSET_MS);
  const p = n => String(n).padStart(2, '0');
  return `${wall.getUTCFullYear()}-${p(wall.getUTCMonth() + 1)}-${p(wall.getUTCDate())}` +
    `T${p(wall.getUTCHours())}:${p(wall.getUTCMinutes())}:00${TZ_OFFSET}`;
}

export function nowDay(nowMs = Date.now()) {
  return (nowMs - DAY0_MS) / DAY_MS;
}

// 0=Lun … 6=Dom. El día 0 (17/06/2026) fue miércoles.
export function weekdayOfDay(day) {
  return ((Math.floor(day) + 2) % 7 + 7) % 7;
}

export function mondayOf(day) {
  return Math.floor(day) - weekdayOfDay(day);
}

export function hourToDayFraction(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return (h * 60 + m) / 1440;
}
