// Calculadora de esquemas — portado de calculadora-trt.html (sesión 24/09/2026, módulos 3-5).
// fromToday: simula con el mismo motor la historia real (ctx.history, dosis aplicadas hasta ctx.now) + el
// esquema nuevo desde la próxima aplicación. Equivale exactamente a partir del estado del motor de hoy.
import { nonlinearNgdl } from './pk.js';
import { mondayOf, weekdayOfDay } from './time.js';
import { suppressionFromDoses } from './estradiol.js';

export const T_CEILING = 827;
export const T_FLOOR = 241;
export const INJ_HOUR = 1.5 / 24; // 1:30am, horario habitual
const HALF_LIFE = { enantato: 4.5, cipionato: 8 };

export function schemeWeeks(ester, fromToday) {
  const h = HALF_LIFE[ester];
  return fromToday ? Math.max(8, Math.ceil(5 * h / 7) + 2) : Math.max(4, Math.ceil(Math.ceil(5 * h) / 7) + 1);
}

// o: {weekdays (0=Lun), mg, ester, fromToday, weeks, skip?, step?}; ctx: {ep, history?, now?}
export function simulateScheme(o, ctx) {
  const step = o.step || 0.1, span = o.weeks * 7;
  const origin = o.fromToday ? ctx.now : 0;
  const scheme = [];
  if (o.interval) {
    // "Cada N días" (ej. día por medio): desde hoy, a partir de la próxima 1:30; desde cero, días 0, N, 2N…
    let d = o.fromToday ? Math.floor(origin) + INJ_HOUR : 0;
    if (o.fromToday && d <= origin) d += 1;
    for (; d < origin + span - 1e-9; d += o.interval) scheme.push({ day: d, mg: o.mg, ester: o.ester });
  } else if (o.fromToday) {
    for (let mon = mondayOf(origin); mon < origin + span; mon += 7) {
      for (const wd of o.weekdays) {
        const d = mon + wd + INJ_HOUR;
        if (d > origin && d < origin + span) scheme.push({ day: d, mg: o.mg, ester: o.ester });
      }
    }
    scheme.sort((a, b) => a.day - b.day);
  } else {
    for (let w = 0; w < o.weeks; w++) for (const d of o.weekdays) scheme.push({ day: 7 * w + d, mg: o.mg, ester: o.ester });
  }
  const applied = scheme.slice(o.skip || 0);
  const history = o.fromToday ? ctx.history.filter(d => d.day <= origin) : [];
  const labels = [];
  for (let t = 0; t <= span + 1e-9; t += step) labels.push(Number(t.toFixed(2)));
  const data = nonlinearNgdl(history.concat(applied), origin + span, 0.02, labels.map(t => origin + t), ctx.ep);
  return {
    labels, data, origin, perWeek: o.interval ? 7 / o.interval : o.weekdays.length,
    applied: applied.map(d => ({ day: d.day - origin, mg: d.mg,
      weekday: o.fromToday ? weekdayOfDay(d.day) : ((d.day % 7) + 7) % 7 })),
  };
}

// Pico máximo desde la 1ra aplicación (lo anterior es el nivel de hoy bajando), pico/valle/promedio de la
// última semana, y días hasta estabilizarse (promedio móvil de 7 días dentro de ±5% del final).
export function schemeMetrics(sim) {
  const { labels, data } = sim, step = labels[1] - labels[0], last = labels[labels.length - 1];
  const firstDose = sim.applied.length ? sim.applied[0].day : Infinity;
  let maxPeak = -Infinity, maxPeakDay = 0, peak = -Infinity, trough = Infinity, sum = 0, n = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] >= firstDose && data[i] > maxPeak) { maxPeak = data[i]; maxPeakDay = labels[i]; }
    if (labels[i] >= last - 7) { peak = Math.max(peak, data[i]); trough = Math.min(trough, data[i]); sum += data[i]; n++; }
  }
  const avg = sum / n, win = Math.round(7 / step);
  let run = 0;
  for (let i = 0; i < win && i < data.length; i++) run += data[i];
  let stableDay = 0;
  for (let i = win; i < data.length; i++) {
    run += data[i] - data[i - win];
    if (Math.abs(run / win - avg) / avg > 0.05) stableDay = labels[i];
  }
  return { maxPeak, maxPeakDay, peak, trough, avg, ratio: peak / trough, stableDay, startVal: data[0] };
}

// Si el esquema pasa el techo: (a) cuántas aplicaciones saltear al principio, (b) dosis máxima por aplicación
// arrancando ya. Protección contra el error del 19/09 (carga encima de enantato circulando).
export function ceilingAdvice(o, ctx) {
  let skip = null;
  for (let k = 1; k <= o.weekdays.length * 3; k++) {
    if (schemeMetrics(simulateScheme({ ...o, skip: k }, ctx)).maxPeak <= T_CEILING) { skip = k; break; }
  }
  let lo = 0, hi = o.mg;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (schemeMetrics(simulateScheme({ ...o, mg: mid }, ctx)).maxPeak <= T_CEILING) lo = mid; else hi = mid;
  }
  let firstDay = null;
  if (skip !== null) {
    const s = simulateScheme({ ...o, skip }, ctx);
    firstDay = s.applied.length ? s.origin + s.applied[0].day : null;
  }
  return { skip, firstDay, maxMg: lo };
}

// Anastrozol en cuartos de comprimido: 1 toma de `mgPer` (0.25 / 0.5 mg) cada `every` aplicaciones del esquema
// (every = 0 → sin anastrozol). Desde hoy suma las tomas reales ya hechas (aiHistory). a = params.anastrozol.
// 100% extrapolación poblacional.
export function schemeAnastrozol(sim, every, mgPer, aiHistory, a) {
  const hist = sim.origin > 0
    ? aiHistory.filter(d => d.day <= sim.origin).map(d => ({ day: d.day - sim.origin, mg: d.mg }))
    : [];
  const planned = every > 0 ? sim.applied.filter((_, i) => i % every === 0) : [];
  const doses = hist.concat(planned.map(d => ({ day: d.day, mg: mgPer })));
  const tomasSemana = every > 0 ? sim.perWeek / every : 0;
  return {
    doses, tomasSemana, mgSemana: mgPer * tomasSemana, cadaDias: every > 0 ? every * 7 / sim.perWeek : null,
    supp: sim.labels.map(t => suppressionFromDoses(doses, t, a)),
  };
}
