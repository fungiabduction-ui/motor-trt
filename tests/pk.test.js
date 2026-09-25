import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineParams, freeNmol, simulateNonlinear, nonlinearNgdl, concLinear, kaFromHalfLife } from '../js/engine/pk.js';

const MP = { scaleNL: 1, kaE_halfLife: 4.5, kaC_halfLife: 8, shbg: 26 };

test('engineParams convierte vidas medias en ka y calcula kFree', () => {
  const ep = engineParams(MP);
  assert.equal(ep.kaE, Math.log(2) / 4.5);
  assert.equal(ep.kaC, Math.log(2) / 8);
  assert.equal(ep.kFree, 1.386 * (24 + 26));
});
test('freeNmol: ~2-3% libre a concentración fisiológica, 0 en 0', () => {
  const f = freeNmol(20, 26) / 20;
  assert.ok(f > 0.01 && f < 0.04, `fracción libre ${f}`);
  assert.equal(freeNmol(0, 26), 0);
});
test('sin dosis el nivel es 0', () => {
  const r = simulateNonlinear([], 10, 0.02, [5], engineParams(MP));
  assert.equal(r.total[0], 0);
});
test('atribución por éster exacta: poolE + poolC = total', () => {
  const doses = [{ day: 0, mg: 50, ester: 'enantato' }, { day: 3, mg: 48, ester: 'cipionato' }];
  const ts = [1, 4, 10, 20];
  const r = simulateNonlinear(doses, 20, 0.02, ts, engineParams(MP));
  ts.forEach((_, i) => assert.ok(Math.abs(r.poolE[i] + r.poolC[i] - r.total[i]) < 1e-9));
  assert.ok(r.poolC[0] === 0 && r.poolE[0] > 0, 'antes del día 3 no hay cipionato');
  assert.ok(r.poolC[2] > 0);
});
test('nonlinearNgdl convierte nmol/L a ng/dl', () => {
  const doses = [{ day: 0, mg: 50, ester: 'enantato' }];
  const ep = engineParams(MP);
  const nm = simulateNonlinear(doses, 5, 0.02, [3], ep).total[0];
  assert.equal(nonlinearNgdl(doses, 5, 0.02, [3], ep)[0], nm / 0.03467);
});
test('modelo lineal: 0 antes de la dosis, positivo después', () => {
  const ep = engineParams(MP);
  const doses = [{ day: 2, mg: 50, ester: 'enantato' }];
  assert.equal(concLinear(1, doses, ep), 0);
  assert.ok(concLinear(4, doses, ep) > 0);
  assert.equal(kaFromHalfLife(8), Math.log(2) / 8);
});
