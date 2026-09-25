import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayFromIso, isoFromDay, nowDay, weekdayOfDay, mondayOf, hourToDayFraction } from '../js/engine/time.js';

test('día 0 = 17/06/2026 00:00 hora local', () => {
  assert.equal(dayFromIso('2026-06-17T00:00:00-03:00'), 0);
});
test('17/06/2026 fue miércoles (0=Lun)', () => {
  assert.equal(weekdayOfDay(0), 2);
});
test('21/09/2026 es el día 96 y es lunes', () => {
  assert.equal(dayFromIso('2026-09-21T00:00:00-03:00'), 96);
  assert.equal(weekdayOfDay(96), 0);
});
test('ida y vuelta ISO ↔ día conserva la hora local', () => {
  const iso = '2026-09-25T01:30:00-03:00';
  assert.equal(isoFromDay(dayFromIso(iso)), iso);
});
test('una hora UTC se expresa en hora local', () => {
  assert.equal(isoFromDay(dayFromIso('2026-09-25T04:30:00Z')), '2026-09-25T01:30:00-03:00');
});
test('nowDay usa hora local, no UTC (bug de 3hs del HTML viejo)', () => {
  const ms = Date.parse('2026-09-24T15:00:00-03:00');
  assert.equal(nowDay(ms), dayFromIso('2026-09-24T00:00:00-03:00') + 15 / 24);
});
test('mondayOf devuelve el lunes de esa semana', () => {
  assert.equal(mondayOf(dayFromIso('2026-09-25T01:30:00-03:00')), 96);
  assert.equal(mondayOf(96), 96);
});
test('hourToDayFraction', () => {
  assert.equal(hourToDayFraction('01:30'), 1.5 / 24);
});
test('fecha inválida tira error', () => {
  assert.throws(() => dayFromIso('ayer'), /Fecha inválida/);
});
