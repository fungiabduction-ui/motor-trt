// Motor PK no lineal — portado SIN cambios matemáticos de calculadora-trt.html (sesiones 20-24/09/2026).
// Un compartimento: depósito del éster → pool central; la eliminación actúa solo sobre la T libre, que
// satura con la SHBG (ecuación de Vermeulen et al. 1999). Ver CLAUDE.md del HTML viejo, secciones 2-5.
export const NGDL_TO_NMOL = 0.03467;
export const KA_SHBG = 1.0;   // L/nmol — afinidad SHBG-testosterona (Vermeulen 1999)
export const ALB_ALPHA = 24;  // 1 + Ka_albúmina·[albúmina] poblacional (tu albúmina nunca se midió)
export const KE_POP = 1.386;  // eliminación poblacional (t½ aparente 12h)
export const ESTER_CONC = { enantato: 250, cipionato: 200 };

export function kaFromHalfLife(halfLifeDays) {
  return Math.log(2) / halfLifeDays;
}

// Parámetros del motor a partir de los `params` de una versión de data/model.json.
export function engineParams(mp) {
  return {
    scaleNL: mp.scaleNL,
    kaE: kaFromHalfLife(mp.kaE_halfLife),
    kaC: kaFromHalfLife(mp.kaC_halfLife),
    shbg: mp.shbg,
    kFree: KE_POP * (ALB_ALPHA + KA_SHBG * mp.shbg), // iguala ke poblacional a concentraciones bajas
  };
}

export function freeNmol(totalNmol, shbg) {
  if (totalNmol <= 0) return 0;
  const A = ALB_ALPHA * KA_SHBG, B = ALB_ALPHA + KA_SHBG * (shbg - totalNmol), C = -totalNmol;
  return (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
}

// doses: [{day, mg, ester: 'enantato'|'cipionato'}]. Devuelve {total, poolE, poolC} (nmol/L) en cada sampleTime.
// Atribución por prorrateo: la eliminación se reparte en cada paso proporcional al aporte de cada éster al
// pool — exacto por construcción (poolE + poolC = total).
export function simulateNonlinear(doses, tEnd, dt, sampleTimes, ep) {
  const sorted = [...doses].sort((a, b) => a.day - b.day);
  let di = 0, depotE = 0, depotC = 0, total = 0, poolE = 0, poolC = 0, si = 0;
  const outTotal = new Array(sampleTimes.length).fill(0);
  const outE = new Array(sampleTimes.length).fill(0);
  const outC = new Array(sampleTimes.length).fill(0);
  for (let t = 0; t <= tEnd + dt; t += dt) {
    while (di < sorted.length && sorted[di].day < t + dt / 2) {
      const d = sorted[di];
      if (d.ester === 'enantato') depotE += d.mg * ep.scaleNL; else depotC += d.mg * ep.scaleNL;
      di++;
    }
    while (si < sampleTimes.length && sampleTimes[si] <= t) {
      outTotal[si] = total; outE[si] = poolE; outC[si] = poolC; si++;
    }
    const relE = ep.kaE * depotE, relC = ep.kaC * depotC;
    const elim = ep.kFree * freeNmol(total, ep.shbg);
    const elimE = total > 0 ? elim * (poolE / total) : 0;
    const elimC = total > 0 ? elim * (poolC / total) : 0;
    depotE = Math.max(0, depotE - relE * dt);
    depotC = Math.max(0, depotC - relC * dt);
    poolE = Math.max(0, poolE + (relE - elimE) * dt);
    poolC = Math.max(0, poolC + (relC - elimC) * dt);
    total = poolE + poolC;
  }
  while (si < sampleTimes.length) { outTotal[si] = total; outE[si] = poolE; outC[si] = poolC; si++; }
  return { total: outTotal, poolE: outE, poolC: outC };
}

export function nonlinearNgdl(doses, tEnd, dt, sampleTimes, ep) {
  return simulateNonlinear(doses, tEnd, dt, sampleTimes, ep).total.map(v => v / NGDL_TO_NMOL);
}

// Modelo lineal de referencia (Bateman, ke fijo, sin SHBG) — solo para comparación.
export function concOne(dt, ka) {
  if (dt < 0) return 0;
  return (ka / (KE_POP - ka)) * (Math.exp(-ka * dt) - Math.exp(-KE_POP * dt));
}
export function concLinear(t, doses, ep) {
  let c = 0;
  for (const d of doses) if (t >= d.day) c += d.mg * concOne(t - d.day, d.ester === 'enantato' ? ep.kaE : ep.kaC);
  return c;
}
