import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proximaExtraccion, diasSinAplicacion } from '../js/engine/extraccion.js';
import { dayFromIso, isoFromDay } from '../js/engine/time.js';

const D = dayFromIso;
const esq = (desde, dias, extra = {}) => ({ id: 'ESQ-0001', tipo: 'esquema', desde, dias, hora: '01:30', mg: 16, ...extra });
const estatina = { id: 'FAR-0001', tipo: 'farmaco', modo: 'continuo', farmaco: 'rosuvastatina', mg: 20, desde: '2026-09-18T00:00:00-03:00', hasta: null };
const now = D('2026-09-28T02:00:00-03:00');

test('esquema lun-mié-vie + estatina reciente: manda la estatina, cae martes 08:30', () => {
  const r = proximaExtraccion([esq('2026-09-24T23:34:00-03:00', [0, 2, 4]), estatina], now);
  assert.equal(isoFromDay(r.day), '2026-10-20T08:30:00-03:00');
  assert.match(r.motivo, /estatina/);
  assert.deepEqual(r.libres, [1, 3]);
});

test('sin estatina: manda el esquema (+14 d) y saltea viernes (aplicación) y fin de semana', () => {
  const r = proximaExtraccion([esq('2026-09-24T23:34:00-03:00', [0, 2, 4])], now);
  assert.equal(isoFromDay(r.day), '2026-10-13T08:30:00-03:00');
  assert.match(r.motivo, /esquema/);
});

test('días libres según el esquema; diario o cada 48 h → martes/jueves', () => {
  assert.deepEqual(diasSinAplicacion({ dias: [1, 3] }), [0, 2, 4]);
  assert.deepEqual(diasSinAplicacion({ dias: [0, 1, 2, 3, 4, 5, 6] }), [1, 3]);
  assert.deepEqual(diasSinAplicacion({ dias: null, intervaloDias: 2 }), [1, 3]);
  assert.deepEqual(diasSinAplicacion(null), [1, 3]);
});

test('con todo estable manda la preparación (hoy + 7 d)', () => {
  const later = D('2026-12-01T10:00:00-03:00'); // martes
  const r = proximaExtraccion([esq('2026-09-24T23:34:00-03:00', [0, 2, 4]), estatina], later);
  // mar 08/12 08:30 queda antes del límite (10:00) → jueves 10/12
  assert.equal(isoFromDay(r.day), '2026-12-10T08:30:00-03:00');
  assert.match(r.motivo, /prepararte/);
});
