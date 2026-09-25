// Predicción y calibración. La UI solo CALCULA y muestra propuestas: data/model.json cambia únicamente en
// una sesión con Claude Code (spec §5).
import { simulateNonlinear, engineParams, NGDL_TO_NMOL } from './pk.js';
import { dayFromIso } from './time.js';
import { appliedTDoses, appliedAIDoses } from './projection.js';
import { suppressionFromDoses, e2FromT } from './estradiol.js';
import { predictLipidsAt } from './lipids.js';

export function predictT(doses, day, ep) {
  return simulateNonlinear(doses, day, 0.02, [day], ep).total[0] / NGDL_TO_NMOL;
}

// Factor de escala personal que hace que el modelo dé exactamente el valor del lab (búsqueda binaria,
// mismo método que calibrateScaleNL() del HTML viejo). mp = params de model.json sin scaleNL.
export function calibrateScale(doses, lab, mp) {
  let lo = 0.001, hi = 2000;
  for (let i = 0; i < 45; i++) {
    const mid = (lo + hi) / 2;
    const v = predictT(doses, lab.day, engineParams({ ...mp, scaleNL: mid }));
    if (v < lab.t_total) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// labs: [{id, day, t_total}]. Solo labs durante el TRT (day >= 0) con T total.
export function predictionTable(labs, doses, mp) {
  const ep = engineParams(mp);
  return labs
    .filter(l => l.day >= 0 && typeof l.t_total === 'number')
    .map(l => {
      const pred = predictT(doses, l.day, ep);
      return { id: l.id, day: l.day, real: l.t_total, pred, errPct: 100 * (pred - l.t_total) / l.t_total };
    });
}

export function activeVersion(model) {
  const v = model.versiones.find(x => x.id === model.vigente);
  if (!v) throw new Error(`model.json: la versión vigente "${model.vigente}" no existe`);
  return v;
}

// Labs del log con T total, ordenados por fecha: {id, day, at, t_total, e2, prediccion}.
export function labRefs(entries) {
  return entries
    .filter(e => e.tipo === 'lab' && e.valores && typeof e.valores.t_total === 'number')
    .map(e => ({ id: e.id, day: dayFromIso(e.at), at: e.at, t_total: e.valores.t_total, e2: e.valores.e2,
      prediccion: e.prediccion || null }))
    .sort((a, b) => a.day - b.day);
}

// Se llama al CREAR un lab: guarda lo que la versión vigente predecía para ese momento, antes de recalibrar.
export function freezePrediction(entries, model, atIso, calculadoEn) {
  const v = activeVersion(model), mp = v.params;
  const day = dayFromIso(atIso);
  const t = predictT(appliedTDoses(entries), day, engineParams(mp));
  const supp = suppressionFromDoses(appliedAIDoses(entries), day, mp.anastrozol);
  const r1 = x => Math.round(x * 10) / 10;
  const lip = predictLipidsAt(entries, day, mp.estatinaFactor ?? 1);
  const lipidos = Object.keys(lip).length ? Object.fromEntries(Object.entries(lip).map(([k, x]) => [k, r1(x)])) : null;
  return { modelVersion: v.id, t_total: r1(t), e2: r1(e2FromT(t, mp.kArom, supp)), lipidos, calculadoEn };
}

// Propuesta (NO se aplica sola): recalibrar la escala contra el lab más reciente durante el TRT.
export function calibrationProposal(entries, model) {
  const mp = activeVersion(model).params;
  const labs = labRefs(entries).filter(l => l.day >= 0);
  if (!labs.length) return null;
  const anchor = labs[labs.length - 1];
  const doses = appliedTDoses(entries);
  const scalePropuesta = calibrateScale(doses, anchor, mp);
  return {
    anchorId: anchor.id,
    scaleActual: mp.scaleNL,
    scalePropuesta,
    cambioPct: 100 * (scalePropuesta - mp.scaleNL) / mp.scaleNL,
    vigente: predictionTable(labs, doses, mp),
    propuesta: predictionTable(labs, doses, { ...mp, scaleNL: scalePropuesta }),
  };
}
