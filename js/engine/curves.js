// Curvas de "Curva real": T (total y aporte por éster) y E2 (con y sin anastrozol) reconstruidas desde el log,
// más la proyección de las dosis pendientes del esquema vigente.
import { engineParams, simulateNonlinear, NGDL_TO_NMOL } from './pk.js';
import { buildTimeline } from './projection.js';
import { suppressionFromDoses, e2FromT } from './estradiol.js';
import { predictT, activeVersion } from './calibration.js';

export { activeVersion };

export function buildCurves(entries, model, now, { step = 0.25, horizonDays = 35 } = {}) {
  const v = activeVersion(model), mp = v.params, ep = engineParams(mp);
  const end = Math.max(now, 0) + horizonDays;
  const timeline = buildTimeline(entries, now, end);
  const days = [];
  for (let t = 0; t <= end + 1e-9; t += step) days.push(Number(t.toFixed(4)));
  const sim = simulateNonlinear(timeline.allT, end, 0.02, days, ep);
  const t = sim.total.map(x => x / NGDL_TO_NMOL);
  const tE = sim.poolE.map(x => x / NGDL_TO_NMOL);
  const tC = sim.poolC.map(x => x / NGDL_TO_NMOL);
  const supp = days.map(d => suppressionFromDoses(timeline.allAI, d, mp.anastrozol));
  const e2Base = t.map(x => e2FromT(x, mp.kArom, 0));
  const e2 = t.map((x, i) => e2FromT(x, mp.kArom, supp[i]));
  const nowT = predictT(timeline.allT, now, ep);
  const nowSupp = suppressionFromDoses(timeline.allAI, now, mp.anastrozol);
  return { days, t, tE, tC, e2, e2Base, supp, timeline, now, nowT, nowSupp,
    nowE2: e2FromT(nowT, mp.kArom, nowSupp), version: v.id, params: mp };
}
