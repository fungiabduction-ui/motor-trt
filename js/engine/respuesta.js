// Respuesta PERSONAL al anastrozol y a la estatina, calculada con labs reales. Igual que el factor de escala de la
// testosterona: la app solo PROPONE; aplicarlo a model.json es trabajo de una sesión con Claude Code.
import { dayFromIso } from './time.js';
import { appliedAIDoses } from './projection.js';
import { suppressionFromDoses } from './estradiol.js';
import { statinPeriods, lipidBaseline, statinEffectAt, ROSUVA_20 } from './lipids.js';

// Anastrozol: en cada lab con E2 y T medidos mientras había anastrozol activo (supresión modelada ≥ 5%),
// supresión observada = 1 − E2_real / (kArom × T_real). Se busca el ED50 que hace que el modelo dé exactamente eso
// (ED50 menor = más sensible). kArom tiene ±8% propio: con un solo lab, la propuesta hereda ese margen.
export function anastrozolResponse(entries, mp) {
  const ai = appliedAIDoses(entries);
  const a = mp.anastrozol;
  const labs = entries
    .filter(e => e.tipo === 'lab' && typeof e.valores?.e2 === 'number' && typeof e.valores?.t_total === 'number')
    .map(e => {
      const day = dayFromIso(e.at);
      const supresionModelo = suppressionFromDoses(ai, day, a);
      if (supresionModelo < 0.05) return null;
      const obs = 1 - e.valores.e2 / (mp.kArom * e.valores.t_total);
      const supresionObservada = Math.min(Math.max(obs, 0), a.emax * 0.98);
      let lo = 0.005, hi = 20; // la supresión baja cuando el ED50 sube → búsqueda binaria
      for (let i = 0; i < 50; i++) {
        const mid = Math.sqrt(lo * hi);
        if (suppressionFromDoses(ai, day, { ...a, ed50: mid }) > supresionObservada) lo = mid; else hi = mid;
      }
      return { id: e.id, at: e.at, e2: e.valores.e2, t: e.valores.t_total, supresionModelo, supresionObservada, ed50: Math.sqrt(lo * hi) };
    })
    .filter(Boolean);
  if (!labs.length) return null;
  const ed50Propuesto = Math.exp(labs.reduce((s, l) => s + Math.log(l.ed50), 0) / labs.length);
  return { labs, ed50Actual: a.ed50, ed50Propuesto, potenciaRelativa: a.ed50 / ed50Propuesto };
}

// Estatina: en cada lab con LDL durante la estatina (≥ 7 días de tratamiento), baja observada vs la esperada
// para la dosis y el tiempo transcurrido. factor = observada / esperada (1 = promedio; < 1 hipo-respondedor).
export function statinResponse(entries) {
  const periods = statinPeriods(entries);
  if (!periods.length) return null;
  const labs = entries
    .filter(e => e.tipo === 'lab' && typeof e.valores?.ldl === 'number')
    .map(e => {
      const day = dayFromIso(e.at), eff = statinEffectAt(entries, day);
      if (!eff || day - eff.period.start < 7) return null;
      const base = lipidBaseline(entries, eff.period.start).ldl;
      if (!base) return null;
      const esperada = -ROSUVA_20.ldl * eff.doseScale * eff.fraction;
      const observada = 1 - e.valores.ldl / base.value;
      return { id: e.id, at: e.at, ldl: e.valores.ldl, base: base.value, mg: eff.period.mg,
        bajaEsperadaPct: 100 * esperada, bajaObservadaPct: 100 * observada, factor: observada / esperada };
    })
    .filter(Boolean);
  if (!labs.length) return null;
  return { labs, factor: labs.reduce((s, l) => s + l.factor, 0) / labs.length };
}
