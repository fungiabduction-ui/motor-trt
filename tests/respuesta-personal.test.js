import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anastrozolResponse, statinResponse } from '../js/engine/respuesta.js';
import { predictLipidsAt } from '../js/engine/lipids.js';
import { suppressionFromDoses } from '../js/engine/estradiol.js';
import { dayFromIso } from '../js/engine/time.js';

const A = { emax: 0.85, ed50: 0.35, halfLife: 2 };
const mp = { kArom: 0.0716, anastrozol: A };
const toma = (id, at) => ({ id, tipo: 'farmaco', modo: 'toma', farmaco: 'anastrozol', mg: 0.25, at, estado: 'confirmada' });

test('anastrozol: con un E2 medido más bajo que lo esperado, propone un ED50 menor (sos más sensible)', () => {
  const entries = [toma('FAR-0001', '2026-10-01T01:30:00-03:00'), toma('FAR-0002', '2026-10-05T01:30:00-03:00'),
    { id: 'LAB-0010', tipo: 'lab', at: '2026-10-06T09:00:00-03:00', valores: { t_total: 700, e2: 25 } }];
  const r = anastrozolResponse(entries, mp);
  assert.equal(r.labs.length, 1);
  const lab = r.labs[0];
  assert.ok(Math.abs(lab.supresionObservada - (1 - 25 / (0.0716 * 700))) < 1e-9);
  assert.ok(r.ed50Propuesto < A.ed50, `ED50 ${r.ed50Propuesto}`);
  // con el ED50 propuesto, el modelo reproduce la supresión observada en ese lab
  const day = dayFromIso('2026-10-06T09:00:00-03:00');
  const doses = entries.filter(e => e.tipo === 'farmaco').map(e => ({ day: dayFromIso(e.at), mg: e.mg }));
  assert.ok(Math.abs(suppressionFromDoses(doses, day, { ...A, ed50: r.ed50Propuesto }) - lab.supresionObservada) < 0.005);
});

test('anastrozol: labs sin anastrozol activo no cuentan; sin datos → null', () => {
  const entries = [{ id: 'LAB-0005', tipo: 'lab', at: '2026-09-17T09:00:00-03:00', valores: { t_total: 1095, e2: 74.6 } }];
  assert.equal(anastrozolResponse(entries, mp), null);
});

const lipEntries = [
  { id: 'LAB-0005', tipo: 'lab', at: '2026-09-17T09:00:00-03:00', valores: { ldl: 127, apob: 100 } },
  { id: 'FAR-0003', tipo: 'farmaco', modo: 'continuo', farmaco: 'rosuvastatina', mg: 20, desde: '2026-09-18T00:00:00-03:00', hasta: null },
];

test('estatina: LDL real 80 a las 6 semanas (esperado ~64) → hipo-respondedor, factor < 1', () => {
  const entries = [...lipEntries, { id: 'LAB-0011', tipo: 'lab', at: '2026-10-30T09:00:00-03:00', valores: { ldl: 80 } }];
  const r = statinResponse(entries);
  assert.equal(r.labs[0].id, 'LAB-0011');
  assert.ok(Math.abs(r.labs[0].bajaObservadaPct - 100 * (1 - 80 / 127)) < 1e-9);
  assert.ok(r.factor > 0.7 && r.factor < 0.8, `factor ${r.factor}`);
  // con el factor personal, la proyección reproduce el lab
  const v = predictLipidsAt(entries, dayFromIso('2026-10-30T09:00:00-03:00'), r.factor);
  assert.ok(Math.abs(v.ldl - 80) < 0.5, `LDL ${v.ldl}`);
});

test('estatina: 40 mg da un poco más que 20 mg (STELLAR −55% vs −52%), no el doble', () => {
  const d = dayFromIso('2026-11-15T00:00:00-03:00');
  const v20 = predictLipidsAt(lipEntries, d).ldl;
  const v40 = predictLipidsAt([lipEntries[0], { ...lipEntries[1], mg: 40 }], d).ldl;
  assert.ok(v40 < v20 && v20 - v40 < 5, `20mg ${v20} vs 40mg ${v40}`);
  assert.equal(statinResponse(lipEntries), null);
});
