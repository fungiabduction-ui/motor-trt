// Estradiol y anastrozol — portado de calculadora-trt.html (Módulo 4 + sesiones 21-24/09).
// E2 ≈ kArom × T total (proporción personal, ±8%). Anastrozol: Emax calibrado con práctica de TRT a dosis
// bajas; 100% poblacional, sin datos propios todavía. No extrapolar arriba de ~2 mg/semana.
export const E2_CEILING = 40;            // pg/ml, techo de referencia (hombre)
export const E2_OVERSUPP_WARN = 25;      // pg/ml, zona de sobre-supresión posible
export const E2_OVERSUPP_BAD = 20;       // pg/ml, sobre-supresión probable
export const ANASTROZOL_CREDIBLE_MAX_MGWEEK = 2;

// a = params.anastrozol de model.json: {emax, ed50, halfLife}
export function suppressionFor(mgWeek, a) {
  return mgWeek <= 0 ? 0 : a.emax * mgWeek / (a.ed50 + mgWeek);
}

export function anastrozolNeededFor(targetE2, currentE2, a) {
  if (currentE2 <= targetE2) return 0;
  const s = Math.min(1 - targetE2 / currentE2, a.emax * 0.98);
  return a.ed50 * s / (a.emax - s);
}

// Cada toma: pico propio suppressionFor(mg), decae con a.halfLife. Varias tomas activas se combinan sobre
// la fracción de aromatasa remanente: remanente = Π(1 - s_i). Supuesto no validado en este paciente.
export function suppressionFromDoses(doses, day, a) {
  let remaining = 1;
  for (const d of doses) {
    if (day < d.day) continue;
    remaining *= 1 - suppressionFor(d.mg, a) * Math.pow(0.5, (day - d.day) / a.halfLife);
  }
  return 1 - remaining;
}

export function e2FromT(tNgdl, kArom, supp = 0) {
  return kArom * tNgdl * (1 - supp);
}
