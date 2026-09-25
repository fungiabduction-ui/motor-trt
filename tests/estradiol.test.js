import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suppressionFor, anastrozolNeededFor, suppressionFromDoses, e2FromT } from '../js/engine/estradiol.js';

const A = { emax: 0.85, ed50: 0.35, halfLife: 2 };
const close = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('Emax: 0.25mg → ~35.4%, 0.75mg → ~58%, 0 → 0', () => {
  close(suppressionFor(0.25, A), 0.354, 0.001);
  close(suppressionFor(0.75, A), 0.58, 0.005);
  assert.equal(suppressionFor(0, A), 0);
});
test('anastrozol necesario para bajar un pico de 57.8 a 40 ≈ 0.20 mg/sem (número del Módulo 4)', () => {
  close(anastrozolNeededFor(40, 57.8, A), 0.20, 0.005);
  assert.equal(anastrozolNeededFor(40, 35, A), 0);
});
test('una dosis decae con vida media de 2 días', () => {
  const doses = [{ day: 10, mg: 0.25 }];
  assert.equal(suppressionFromDoses(doses, 9, A), 0);
  close(suppressionFromDoses(doses, 10, A), 0.354, 0.001);
  close(suppressionFromDoses(doses, 12, A), 0.177, 0.001);
});
test('dosis superpuestas se combinan multiplicativamente (nunca > 100%)', () => {
  const doses = [{ day: 0, mg: 0.25 }, { day: 1, mg: 0.25 }];
  const s1 = suppressionFor(0.25, A) * Math.pow(0.5, 0.5);
  const s2 = suppressionFor(0.25, A);
  close(suppressionFromDoses(doses, 1, A), 1 - (1 - s1) * (1 - s2), 1e-12);
});
test('e2FromT aplica la proporción personal y la supresión', () => {
  close(e2FromT(1000, 0.0716, 0), 71.6, 1e-9);
  close(e2FromT(1000, 0.0716, 0.5), 35.8, 1e-9);
});
