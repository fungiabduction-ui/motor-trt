// Próxima extracción ideal para calibrar el motor: un día hábil SIN aplicación (a mitad del intervalo, donde el
// modelo depende menos de la velocidad de absorción), con el esquema estable (T y anastrozol en régimen) y la
// estatina en efecto pleno. Devuelve la fecha y qué condición la fijó.
import { dayFromIso, weekdayOfDay, hourToDayFraction } from './time.js';
import { statinPeriods } from './lipids.js';

export const EXTRACCION = { hora: '08:30', minDesdeHoy: 7, estableDias: 14, estatinaDias: 28 };

// Días hábiles (0=Lun … 4=Vie) sin aplicación según el esquema; si no hay ninguno (diario, cada 48 h), mar/jue.
export function diasSinAplicacion(esq) {
  const dias = esq && Array.isArray(esq.dias) && !esq.intervaloDias ? esq.dias : null;
  const libres = dias ? [0, 1, 2, 3, 4].filter(w => !dias.includes(w)) : [];
  return libres.length ? libres : [1, 3];
}

export function proximaExtraccion(entries, now, o = EXTRACCION) {
  const esqs = entries.filter(e => e.tipo === 'esquema' && e.desde).sort((a, b) => a.desde.localeCompare(b.desde));
  const esq = esqs.filter(e => dayFromIso(e.desde) <= now).at(-1) || null;
  const conds = [{ day: now + o.minDesdeHoy, motivo: `${o.minDesdeHoy} días para prepararte (biotina, sin entrenamiento pesado)` }];
  if (esqs.length) conds.push({ day: dayFromIso(esqs.at(-1).desde) + o.estableDias, motivo: `${o.estableDias} días con el esquema actual sin cambios` });
  const st = statinPeriods(entries).filter(p => p.start <= now && p.end >= now).at(-1);
  if (st) conds.push({ day: st.start + o.estatinaDias, motivo: `${o.estatinaDias} días de estatina (efecto pleno)` });
  const lim = conds.reduce((a, b) => (b.day > a.day ? b : a));
  const libres = diasSinAplicacion(esq);
  let d = Math.floor(lim.day) + hourToDayFraction(o.hora);
  while (d < lim.day || !libres.includes(weekdayOfDay(d))) d += 1;
  return { day: d, motivo: lim.motivo, libres, condiciones: conds };
}
