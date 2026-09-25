import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schemeSlots, buildTimeline, appliedTDoses, appliedAIDoses } from '../js/engine/projection.js';
import { dayFromIso, isoFromDay, weekdayOfDay } from '../js/engine/time.js';

const D = s => dayFromIso(s);
const ESQ = {
  id: 'ESQ-0001', tipo: 'esquema', desde: '2026-09-21T01:30:00-03:00', ester: 'cipionato', mg: 16, concMgMl: 200,
  dias: [0, 2, 4], hora: '01:30', sitio: null, profundidad: 'subq_superficial',
  acompanantes: [{ farmaco: 'anastrozol', mg: 0.25, dias: [4] }], generaPendientes: true,
};
const skipped = iso => ({ id: 'DOS-09' + iso.slice(8, 10), tipo: 'dosis_t', at: iso, slot: iso, ester: 'cipionato', mg: 16, estado: 'salteada' });

test('esquema lun-mié-vie genera lunes/miércoles/viernes (regresión del bug MAINT_START)', () => {
  const slots = schemeSlots([ESQ], D('2026-10-03T00:00:00-03:00')).filter(s => s.kind === 'dosis_t');
  assert.deepEqual(slots.map(s => isoFromDay(s.day)), [
    '2026-09-21T01:30:00-03:00', '2026-09-23T01:30:00-03:00', '2026-09-25T01:30:00-03:00',
    '2026-09-28T01:30:00-03:00', '2026-09-30T01:30:00-03:00', '2026-10-02T01:30:00-03:00',
  ]);
  slots.forEach(s => assert.ok([0, 2, 4].includes(weekdayOfDay(s.day))));
});

test('acompañante anastrozol solo los viernes', () => {
  const ai = schemeSlots([ESQ], D('2026-10-03T00:00:00-03:00')).filter(s => s.kind === 'farmaco');
  assert.deepEqual(ai.map(s => isoFromDay(s.day)), ['2026-09-25T01:30:00-03:00', '2026-10-02T01:30:00-03:00']);
  assert.equal(ai[0].farmaco, 'anastrozol');
});

test('un esquema nuevo corta los slots del anterior', () => {
  const esq2 = { ...ESQ, id: 'ESQ-0002', desde: '2026-09-28T00:00:00-03:00', dias: [0], acompanantes: [] };
  const t = schemeSlots([ESQ, esq2], D('2026-10-06T00:00:00-03:00')).filter(s => s.kind === 'dosis_t');
  assert.deepEqual(t.map(s => [isoFromDay(s.day), s.esquemaId]), [
    ['2026-09-21T01:30:00-03:00', 'ESQ-0001'], ['2026-09-23T01:30:00-03:00', 'ESQ-0001'],
    ['2026-09-25T01:30:00-03:00', 'ESQ-0001'], ['2026-09-28T01:30:00-03:00', 'ESQ-0002'],
    ['2026-10-05T01:30:00-03:00', 'ESQ-0002'],
  ]);
});

test('esquemas históricos (generaPendientes false) no generan slots', () => {
  assert.equal(schemeSlots([{ ...ESQ, generaPendientes: false }], D('2026-10-03T00:00:00-03:00')).length, 0);
});

test('salteadas resuelven su slot y no entran al motor; la próxima pendiente es el viernes', () => {
  const entries = [ESQ, skipped('2026-09-21T01:30:00-03:00'), skipped('2026-09-23T01:30:00-03:00')];
  const now = D('2026-09-24T12:00:00-03:00');
  const tl = buildTimeline(entries, now, now + 14);
  assert.equal(tl.tDoses.length, 0);
  assert.equal(tl.vencidas.length, 0);
  assert.equal(isoFromDay(tl.pendientes[0].day), '2026-09-25T01:30:00-03:00');
  assert.ok(tl.allT.every(d => d.projected));
});

test('slot pasado sin resolver = vencida, fuera del motor', () => {
  const entries = [ESQ, skipped('2026-09-21T01:30:00-03:00'), skipped('2026-09-23T01:30:00-03:00')];
  const now = D('2026-09-26T12:00:00-03:00');
  const tl = buildTimeline(entries, now, now + 14);
  const vT = tl.vencidas.filter(s => s.kind === 'dosis_t');
  assert.deepEqual(vT.map(s => isoFromDay(s.day)), ['2026-09-25T01:30:00-03:00']);
  assert.ok(!tl.allT.some(d => Math.abs(d.day - D('2026-09-25T01:30:00-03:00')) < 1e-6));
});

test('confirmada con hora real distinta del slot: resuelve el slot y usa la hora real', () => {
  const conf = { id: 'DOS-0100', tipo: 'dosis_t', at: '2026-09-25T02:10:00-03:00', slot: '2026-09-25T01:30:00-03:00',
    ester: 'cipionato', mg: 16, estado: 'confirmada' };
  const entries = [ESQ, skipped('2026-09-21T01:30:00-03:00'), skipped('2026-09-23T01:30:00-03:00'), conf];
  const now = D('2026-09-26T12:00:00-03:00');
  const tl = buildTimeline(entries, now, now + 14);
  assert.equal(tl.vencidas.filter(s => s.kind === 'dosis_t').length, 0);
  assert.deepEqual(appliedTDoses(entries).map(d => d.day), [D('2026-09-25T02:10:00-03:00')]);
});

test('anastrozol: tomas aplicadas + acompañantes futuros', () => {
  const toma = { id: 'FAR-0001', tipo: 'farmaco', modo: 'toma', farmaco: 'anastrozol', mg: 0.25,
    at: '2026-09-21T19:00:00-03:00', estado: 'reconstruida' };
  const cont = { id: 'FAR-0002', tipo: 'farmaco', modo: 'continuo', farmaco: 'tamoxifeno', mg: 20, desde: '2026-09-17T00:00:00-03:00' };
  const entries = [ESQ, toma, cont];
  assert.equal(appliedAIDoses(entries).length, 1);
  const now = D('2026-09-24T12:00:00-03:00');
  const tl = buildTimeline(entries, now, now + 10);
  assert.deepEqual(tl.allAI.map(d => isoFromDay(d.day)), [
    '2026-09-21T19:00:00-03:00', '2026-09-25T01:30:00-03:00', '2026-10-02T01:30:00-03:00',
  ]);
});

test('esquema cada 48 hs genera slots cada 2 días a la hora de "desde"', () => {
  const esq = { ...ESQ, id: 'ESQ-0003', dias: null, intervaloDias: 2, desde: '2026-09-25T01:30:00-03:00', acompanantes: [] };
  const t = schemeSlots([esq], D('2026-10-02T00:00:00-03:00')).map(s => isoFromDay(s.day));
  assert.deepEqual(t, ['2026-09-25T01:30:00-03:00', '2026-09-27T01:30:00-03:00', '2026-09-29T01:30:00-03:00', '2026-10-01T01:30:00-03:00']);
});

test('acompañante cadaN: 1 de cada 2 aplicaciones, contando desde la primera del esquema', () => {
  const esq = { ...ESQ, id: 'ESQ-0004', acompanantes: [{ farmaco: 'anastrozol', mg: 0.1, cadaN: 2 }] };
  const ai = schemeSlots([esq], D('2026-10-03T00:00:00-03:00')).filter(s => s.kind === 'farmaco').map(s => isoFromDay(s.day));
  assert.deepEqual(ai, ['2026-09-21T01:30:00-03:00', '2026-09-25T01:30:00-03:00', '2026-09-30T01:30:00-03:00']);
});

test('primeraAplicacion: el esquema nuevo corta al anterior desde "desde" pero aplica recién desde su 1ra aplicación', () => {
  const nuevo = { ...ESQ, id: 'ESQ-0009', desde: '2026-09-24T18:00:00-03:00', primeraAplicacion: '2026-09-27T01:30:00-03:00',
    dias: null, intervaloDias: 2, hora: null, acompanantes: [] };
  const t = schemeSlots([ESQ, nuevo], D('2026-10-02T00:00:00-03:00')).filter(s => s.kind === 'dosis_t').map(s => [isoFromDay(s.day), s.esquemaId]);
  assert.deepEqual(t, [
    ['2026-09-21T01:30:00-03:00', 'ESQ-0001'], ['2026-09-23T01:30:00-03:00', 'ESQ-0001'],
    ['2026-09-27T01:30:00-03:00', 'ESQ-0009'], ['2026-09-29T01:30:00-03:00', 'ESQ-0009'], ['2026-10-01T01:30:00-03:00', 'ESQ-0009'],
  ]);
});
