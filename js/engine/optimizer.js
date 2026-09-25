// Optimizador de testosterona + anastrozol — el botón "✨ Calcular dosis óptima" de la Calculadora.
// Parte del modelo vivo (T y E2 de hoy, reconstruidos del log) y prueba todas las opciones prácticas:
//   1. T: frecuencia × ml en rayitas de la jeringa × saltear 0-2 aplicaciones. Se descartan las que pasan el techo.
//   2. Anastrozol en CUARTOS de comprimido: 0.25 o 0.5 mg por toma, 1 toma cada N aplicaciones (hasta ~cada 14 días).
//   3. Robustez: las combinaciones se re-evalúan con el modelo equivocándose (7 escenarios) y gana la más segura.
import { engineParams, nonlinearNgdl, ESTER_CONC } from './pk.js';
import { mondayOf } from './time.js';
import { suppressionFromDoses, e2FromT } from './estradiol.js';

export const INJ_HOUR = 1.5 / 24;
export const T_PATTERNS = [
  { id: 'diario', label: 'Diario', interval: 1, perWeek: 7 },
  { id: '48h', label: 'Día por medio (cada 48 hs)', interval: 2, perWeek: 3.5 },
  { id: '2x', label: '2x/semana (lun-jue)', weekdays: [0, 3], perWeek: 2 },
  { id: '3x', label: '3x/semana (lun-mié-vie)', weekdays: [0, 2, 4], perWeek: 3 },
];
export const AI_MG_TOMA = [0.25, 0.5]; // 1/4 y 1/2 comprimido de 1 mg
const AI_MAX_DAYS = 14;               // la toma más espaciada que se considera: ~1 cada 2 semanas
const SCENARIOS = [
  { id: 'base' }, { id: 'escala×0.8', scale: 0.8 }, { id: 'escala×1.2', scale: 1.2 },
  { id: 'E2/T −8%', kArom: 0.92 }, { id: 'E2/T +8%', kArom: 1.08 }, { id: 'anastrozol ×2 potente', ed50: 0.5 }, { id: 'anastrozol ×0.5 potente', ed50: 2 },
];

// Aplicaciones nuevas desde `now` (a la 1:30am), salteando las primeras `skip`.
export function scheduleDoses(p, now, spanDays, mg, ester, skip = 0) {
  const out = [], end = now + spanDays;
  if (p.interval) {
    let d = Math.floor(now) + INJ_HOUR;
    if (d <= now) d += 1;
    for (; d < end; d += p.interval) out.push({ day: d, mg, ester });
  } else {
    for (let mon = mondayOf(now); mon < end; mon += 7) {
      for (const wd of p.weekdays) { const d = mon + wd + INJ_HOUR; if (d > now && d < end) out.push({ day: d, mg, ester }); }
    }
    out.sort((a, b) => a.day - b.day);
  }
  return out.slice(skip);
}

// pasoMl = graduación de la jeringa que se usa de verdad (0.02 = tuberculina actual; 0.01 / 0.005 = insulina).
function tCandidates(ester, pasoMl) {
  const step = ESTER_CONC[ester] * pasoMl;
  const out = [];
  for (const p of T_PATTERNS) {
    const lo = Math.ceil(20 / p.perWeek / step) * step, hi = Math.floor(100 / p.perWeek / step) * step;
    for (let mg = lo; mg <= hi + 1e-9; mg += step) for (const skip of [0, 1, 2]) out.push({ p, mg: Math.round(mg * 100) / 100, skip });
  }
  return out;
}

// Métricas + costo. soft=true (escenarios de robustez): pasar el techo penaliza en vez de descartar.
function evaluate(tData, e2Data, firstIdx, steadyIdx, ctx, aiMgSemana, perWeek, soft) {
  const { obj, estatinaActiva } = ctx, w = obj.pesos;
  const [tLo, tHi] = obj.t.objetivo, [eLo, eHi] = obj.e2.objetivo;
  let tMax = -Infinity, e2Min = Infinity, e2Max = -Infinity, tOut = 0, tLow = 0, eOut = 0, eLow = 0, eHigh = 0;
  let tPeak = -Infinity, tTrough = Infinity, tSum = 0, ePeak = -Infinity, eTrough = Infinity, eSum = 0, ns = 0;
  const n = tData.length;
  for (let i = 0; i < n; i++) {
    const t = tData[i], e = e2Data[i];
    if (t < tLo || t > tHi) tOut++;
    if (t < obj.t.pisoDuro) tLow++;
    if (e < eLo || e > eHi) eOut++;
    if (e < obj.e2.pisoDuro) eLow++;
    if (e > obj.e2.tolerableMax) eHigh++;
    if (i >= firstIdx) { tMax = Math.max(tMax, t); e2Min = Math.min(e2Min, e); e2Max = Math.max(e2Max, e); }
    if (i >= steadyIdx) { tPeak = Math.max(tPeak, t); tTrough = Math.min(tTrough, t); tSum += t; ePeak = Math.max(ePeak, e); eTrough = Math.min(eTrough, e); eSum += e; ns++; }
  }
  const base = { tMax, e2Min, e2Max, tPeak, tTrough, tAvg: tSum / ns, ratio: tPeak / tTrough, e2Peak: ePeak, e2Trough: eTrough,
    e2Avg: eSum / ns, pctTObj: 100 * (1 - tOut / n), pctE2Obj: 100 * (1 - eOut / n) };
  const costo = {
    t: w.tFuera * tOut / n + w.tBajo * tLow / n + w.oscilacion * (base.ratio - 1),
    e2: w.e2Fuera * eOut / n + w.e2Bajo * eLow / n + w.e2Alto * eHigh / n,
    anastrozol: aiMgSemana * (estatinaActiva ? w.anastrozolConEstatina : w.anastrozolMgSem),
    practic: w.aplicacion * perWeek,
  };
  costo.techo = tMax > obj.t.techo ? (soft ? 5 * (tMax - obj.t.techo) / obj.t.techo : Infinity) : 0;
  costo.total = costo.t + costo.e2 + costo.anastrozol + costo.practic + costo.techo;
  return { base, costo };
}

// ctx: {mp, history, aiHistory, now, obj, ester, estatinaActiva, weeks?, maxTCandidates?, pasoMl?}
export function optimize(ctx) {
  const weeks = ctx.weeks || 8, span = weeks * 7, step = 0.25, now = ctx.now, ester = ctx.ester || 'cipionato';
  const rel = []; for (let t = 0; t <= span + 1e-9; t += step) rel.push(t);
  const abs = rel.map(t => now + t);
  const steadyIdx = rel.findIndex(t => t >= span - 14);
  const history = ctx.history.filter(d => d.day <= now);
  const aiHist = ctx.aiHistory.filter(d => d.day <= now);
  const idxOf = day => { const i = rel.findIndex(t => now + t >= day); return i < 0 ? rel.length : i; };
  const simT = (doses, mp) => nonlinearNgdl(history.concat(doses), now + span, 0.02, abs, engineParams(mp));
  const e2Of = (tData, aiDoses, mp) => tData.map((t, i) => e2FromT(t, mp.kArom, suppressionFromDoses(aiDoses, abs[i], mp.anastrozol)));

  // Punto de partida: el modelo vivo hoy (historia real de T + supresión que queda de tomas reales de anastrozol).
  const tHoy = simT([], ctx.mp)[0];
  const hoy = { t: tHoy, e2: e2FromT(tHoy, ctx.mp.kArom, suppressionFromDoses(aiHist, now, ctx.mp.anastrozol)) };

  // Etapa 1: testosterona.
  const stage1 = [];
  for (const c of tCandidates(ester, ctx.pasoMl || 0.02)) {
    const doses = scheduleDoses(c.p, now, span, c.mg, ester, c.skip);
    if (!doses.length) continue;
    const tData = simT(doses, ctx.mp);
    const firstIdx = idxOf(doses[0].day);
    const ev = evaluate(tData, tData.map(t => e2FromT(t, ctx.mp.kArom, 0)), firstIdx, steadyIdx, ctx, 0, c.p.perWeek, false);
    if (!Number.isFinite(ev.costo.total)) continue;
    stage1.push({ ...c, doses, tData, firstIdx, tCost: ev.costo.t + ev.costo.practic });
  }
  const maxT = ctx.maxTCandidates || 12, perPattern = Math.max(1, Math.ceil(maxT / T_PATTERNS.length));
  const kept = T_PATTERNS.flatMap(p => stage1.filter(c => c.p.id === p.id).sort((a, b) => a.tCost - b.tCost).slice(0, perPattern))
    .sort((a, b) => a.tCost - b.tCost).slice(0, maxT);

  // Etapa 2: anastrozol en cuartos, 1 toma cada N aplicaciones.
  const aiDosesFor = (c, every, mg) => aiHist.concat(every ? c.doses.filter((_, i) => i % every === 0).map(d => ({ day: d.day, mg })) : []);
  const todas = [];
  for (const c of kept) {
    const maxEvery = Math.max(1, Math.floor(AI_MAX_DAYS * c.p.perWeek / 7));
    const options = [[0, 0]];
    for (let every = 1; every <= maxEvery; every++) for (const mg of AI_MG_TOMA) options.push([every, mg]);
    for (const [every, mg] of options) {
      const e2Data = e2Of(c.tData, aiDosesFor(c, every, mg), ctx.mp);
      const mgSemana = every ? mg * c.p.perWeek / every : 0;
      const ev = evaluate(c.tData, e2Data, c.firstIdx, steadyIdx, ctx, mgSemana, c.p.perWeek, false);
      todas.push({ key: `${c.p.id}|${c.mg}|${c.skip}|${every}|${mg}`, c, every, mg, mgSemana, e2Data, ...ev });
    }
  }
  todas.sort((a, b) => a.costo.total - b.costo.total);

  // Etapa 3: robustez frente al error del modelo, sobre TODAS las combinaciones (si solo se miran las de mejor
  // costo base, las opciones prudentes nunca compiten).
  const tCache = new Map();
  const robust = todas.map(o => {
    let sum = 0, worstT = -Infinity, worstE = Infinity, worstEHigh = -Infinity;
    for (const s of SCENARIOS) {
      const mp = { ...ctx.mp, scaleNL: ctx.mp.scaleNL * (s.scale || 1), kArom: ctx.mp.kArom * (s.kArom || 1),
        anastrozol: { ...ctx.mp.anastrozol, ed50: ctx.mp.anastrozol.ed50 * (s.ed50 || 1) } };
      const k = `${o.c.p.id}|${o.c.mg}|${o.c.skip}|${s.scale || 1}`;
      if (!tCache.has(k)) tCache.set(k, s.scale ? simT(o.c.doses, mp) : o.c.tData);
      const tData = tCache.get(k);
      const ev = evaluate(tData, e2Of(tData, aiDosesFor(o.c, o.every, o.mg), mp), o.c.firstIdx, steadyIdx, ctx, o.mgSemana, o.c.p.perWeek, true);
      sum += ev.costo.total;
      worstT = Math.max(worstT, ev.base.tMax); worstE = Math.min(worstE, ev.base.e2Min); worstEHigh = Math.max(worstEHigh, ev.base.e2Max);
    }
    const { obj } = ctx;
    // Quedar debajo del piso duro de E2 en el peor caso pesa fuerte (acordado: quedar bajo es peor que pasarse).
    const final = sum / SCENARIOS.length + 5 * Math.max(0, worstT - obj.t.techo) / obj.t.techo
      + 8 * Math.max(0, obj.e2.pisoDuro - worstE) / obj.e2.pisoDuro;
    return { o, final, peorCaso: { tMax: worstT, e2Min: worstE, e2Max: worstEHigh } };
  }).sort((a, b) => a.final - b.final);

  // Recomendación + la mejor opción de CADA OTRA frecuencia de T (alternativas reales, no la misma T con otro
  // anastrozol) + la mejor sin anastrozol, como referencia de qué aporta el anastrozol.
  const opciones = [];
  for (const r of robust) {
    if (r.o.every === 0 || opciones.some(x => x.t.pattern.id === r.o.c.p.id)) continue;
    opciones.push(toOption(r, abs, ester));
  }
  const sinAI = robust.find(x => x.o.every === 0);
  if (sinAI) opciones.push(toOption(sinAI, abs, ester));
  if (sinAI && sinAI.final < opciones[0].final) opciones.unshift(opciones.pop()); // si sin anastrozol gana, va primero
  return { hoy, opciones, todas, escenarios: SCENARIOS.map(s => s.id), evaluadas: stage1.length, conAnastrozol: todas.length };
}

function toOption(r, abs, ester) {
  const { o, final, peorCaso } = r, p = o.c.p;
  return {
    key: o.key, final, peorCaso, base: o.base, costo: o.costo,
    t: { pattern: p, mg: o.c.mg, ml: Math.round(o.c.mg / ESTER_CONC[ester] * 1000) / 1000, skip: o.c.skip, firstDay: o.c.doses[0].day,
      perWeek: p.perWeek, mgSemana: o.c.mg * p.perWeek },
    ai: { every: o.every, mgToma: o.mg, mgSemana: o.mgSemana, tomasSemana: o.every ? p.perWeek / o.every : 0,
      cadaDias: o.every ? o.every * 7 / p.perWeek : null },
    series: { days: abs, t: o.c.tData, e2: o.e2Data },
  };
}
