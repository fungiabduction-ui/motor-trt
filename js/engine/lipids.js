// Lípidos bajo estatina (spec 2026-09-24-historia-optimizador-lipidos-design.md, Parte 3).
// Base: último valor de cada lípido ANTES de arrancar la estatina. Efecto poblacional de rosuvastatina 20 mg
// (STELLAR, Jones et al., Am J Cardiol 2003: LDL −52% a 20 mg; se usa −50%, algo conservador), con llegada
// gradual al efecto pleno (τ = 7 días → ~95% a las 3 semanas). Cuando haya un lab con estatina, la pestaña
// Modelo compara esto contra tu respuesta real.
import { dayFromIso } from './time.js';

export const ROSUVA_20 = { ldl: -0.50, apob: -0.40, no_hdl: -0.42, col_total: -0.33, tg: -0.15, hdl: 0.08 };
const LDL_BY_DOSE = { 5: 0.42, 10: 0.46, 20: 0.52, 40: 0.55 }; // STELLAR (rosuvastatina) — para escalar otras dosis
const TAU_DAYS = 7;
export const LIPID_KEYS = ['ldl', 'apob', 'no_hdl', 'hdl', 'tg', 'col_total'];

export function statinPeriods(entries) {
  return entries
    .filter(e => e.tipo === 'farmaco' && e.modo === 'continuo' && /rosuvastatina/i.test(e.farmaco))
    .map(e => ({ id: e.id, mg: e.mg, start: dayFromIso(e.desde), end: e.hasta ? dayFromIso(e.hasta) : Infinity }))
    .sort((a, b) => a.start - b.start);
}

export function lipidBaseline(entries, beforeDay) {
  const labs = entries.filter(e => e.tipo === 'lab' && e.valores && dayFromIso(e.at) < beforeDay).sort((a, b) => a.at.localeCompare(b.at));
  const out = {};
  for (const k of LIPID_KEYS) {
    const lab = [...labs].reverse().find(e => typeof e.valores[k] === 'number');
    if (lab) out[k] = { value: lab.valores[k], labId: lab.id, day: dayFromIso(lab.at) };
  }
  return out;
}

// Fracción del efecto pleno de la estatina en `day` (sube con τ al empezar; baja con τ si se suspende).
function effectFraction(p, day) {
  if (day < p.start) return 0;
  const on = 1 - Math.exp(-(Math.min(day, p.end) - p.start) / TAU_DAYS);
  return day <= p.end ? on : on * Math.exp(-(day - p.end) / TAU_DAYS);
}
const doseScale = mg => (LDL_BY_DOSE[mg] ?? LDL_BY_DOSE[20]) / LDL_BY_DOSE[20];

// Estatina vigente en `day` y cuánto de su efecto pleno ya actúa (dosis y tiempo).
export function statinEffectAt(entries, day) {
  const p = statinPeriods(entries).filter(x => x.start <= day).at(-1) || null;
  return p ? { period: p, fraction: effectFraction(p, day), doseScale: doseScale(p.mg) } : null;
}

// factor = respuesta personal a la estatina (1 = promedio poblacional; se calibra en sesión con statinResponse).
export function predictLipidsAt(entries, day, factor = 1) {
  const eff = statinEffectAt(entries, day);
  const base = lipidBaseline(entries, eff ? eff.period.start : day + 1e-9);
  const out = {};
  for (const [k, b] of Object.entries(base)) {
    out[k] = eff ? b.value * (1 + ROSUVA_20[k] * factor * eff.doseScale * eff.fraction) : b.value;
  }
  return out;
}

export function projectLipids(entries, fromDay, toDay, step = 1, factor = 1) {
  const periods = statinPeriods(entries);
  const series = Object.fromEntries(LIPID_KEYS.map(k => [k, []]));
  for (let d = fromDay; d <= toDay + 1e-9; d += step) {
    const v = predictLipidsAt(entries, d, factor);
    for (const k of LIPID_KEYS) if (typeof v[k] === 'number') series[k].push({ x: d, y: v[k] });
  }
  return { series, periods, baseline: periods.length ? lipidBaseline(entries, periods.at(-1).start) : lipidBaseline(entries, toDay) };
}
