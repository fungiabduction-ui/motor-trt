import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lipidBaseline, statinPeriods, predictLipidsAt, projectLipids, ROSUVA_20 } from '../js/engine/lipids.js';
import { dayFromIso } from '../js/engine/time.js';

const entries = [
  { id: 'LAB-0004', tipo: 'lab', at: '2026-08-16T08:30:00-03:00', valores: { ldl: 137, hdl: 40, apob: 109, tg: 66, no_hdl: 150 } },
  { id: 'LAB-0005', tipo: 'lab', at: '2026-09-17T09:00:00-03:00', valores: { ldl: 127, hdl: 39, tg: 91, no_hdl: 145, col_total: 184 } },
  { id: 'FAR-0003', tipo: 'farmaco', modo: 'continuo', farmaco: 'rosuvastatina', mg: 20, desde: '2026-09-18T00:00:00-03:00', hasta: null },
];
const D = s => dayFromIso(s);

test('baseline: último valor de cada lípido ANTES de la estatina (ApoB viene del 16/08)', () => {
  const b = lipidBaseline(entries, D('2026-09-18T00:00:00-03:00'));
  assert.equal(b.ldl.value, 127);
  assert.equal(b.ldl.labId, 'LAB-0005');
  assert.equal(b.apob.value, 109);
  assert.equal(b.apob.labId, 'LAB-0004');
});

test('statinPeriods: detecta rosuvastatina continua con su dosis', () => {
  const p = statinPeriods(entries);
  assert.equal(p.length, 1);
  assert.equal(p[0].mg, 20);
  assert.equal(p[0].start, D('2026-09-18T00:00:00-03:00'));
});

test('a las 6 semanas, LDL 127 → ~64 (−50%, STELLAR 20 mg) y HDL sube ~8%', () => {
  const v = predictLipidsAt(entries, D('2026-09-18T00:00:00-03:00') + 42);
  assert.ok(Math.abs(v.ldl - 127 * (1 + ROSUVA_20.ldl * (1 - Math.exp(-6)))) < 1e-9);
  assert.ok(Math.abs(v.ldl - 63.7) < 1, `LDL ${v.ldl}`);
  assert.ok(v.hdl > 41.5 && v.hdl < 42.5, `HDL ${v.hdl}`);
  assert.ok(Math.abs(v.apob - 109 * 0.6) < 1.5, `ApoB ${v.apob}`);
});

test('sin estatina en el log no hay cambio', () => {
  const v = predictLipidsAt(entries.slice(0, 2), D('2026-11-01T00:00:00-03:00'));
  assert.equal(v.ldl, 127);
});

test('projectLipids: serie diaria desde la estatina hasta el horizonte', () => {
  const p = projectLipids(entries, D('2026-09-18T00:00:00-03:00'), D('2026-12-18T00:00:00-03:00'));
  assert.ok(p.series.ldl.length > 80);
  assert.equal(p.series.ldl[0].y, 127);
  assert.ok(p.series.ldl.at(-1).y < 64);
});

test('la predicción congelada de un lab nuevo incluye los lípidos proyectados', async () => {
  const { freezePrediction } = await import('../js/engine/calibration.js');
  const model = { vigente: 'v1', versiones: [{ id: 'v1', params: { scaleNL: 6.9, kaE_halfLife: 4.5, kaC_halfLife: 8, shbg: 26, kArom: 0.0716,
    anastrozol: { emax: 0.85, ed50: 0.35, halfLife: 2 } } }] };
  const p = freezePrediction(entries, model, '2026-10-30T09:00:00-03:00', 'x');
  assert.ok(p.lipidos.ldl > 60 && p.lipidos.ldl < 66, `LDL ${p.lipidos.ldl}`);
});
