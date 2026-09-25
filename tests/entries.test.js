import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextId, isoFromInput, inputFromIso, nowIso, addEntry, updateEntry, removeEntry, validateEntry } from '../js/store/entries.js';
import { diffLogs } from '../js/store/diff.js';

const base = { schema: 1, rev: 3, entries: [
  { id: 'DOS-0001', tipo: 'dosis_t', at: '2026-09-25T01:30:00-03:00', ester: 'cipionato', mg: 16, ml: 0.08, estado: 'confirmada',
    createdAt: 'x', updatedAt: 'x' },
  { id: 'DOS-0009', tipo: 'dosis_t', at: '2026-09-28T01:30:00-03:00', ester: 'cipionato', mg: 16, ml: 0.08, estado: 'confirmada',
    createdAt: 'x', updatedAt: 'x' },
] };
const MS = Date.parse('2026-09-25T02:10:00-03:00');

test('nextId toma el máximo del prefijo + 1, con 4 dígitos', () => {
  assert.equal(nextId(base.entries, 'dosis_t'), 'DOS-0010');
  assert.equal(nextId(base.entries, 'lab'), 'LAB-0001');
});

test('fechas de formulario ↔ ISO local', () => {
  assert.equal(isoFromInput('2026-09-25T01:30'), '2026-09-25T01:30:00-03:00');
  assert.equal(inputFromIso('2026-09-25T04:30:00Z'), '2026-09-25T01:30');
  assert.throws(() => isoFromInput('25/09'), /inválida/);
  assert.equal(nowIso(MS), '2026-09-25T02:10:00-03:00');
});

test('addEntry asigna id y timestamps sin mutar el log', () => {
  const { doc, entry } = addEntry(base, { tipo: 'sintoma', at: '2026-09-25T10:00:00-03:00', texto: 'ok' }, MS);
  assert.equal(entry.id, 'SIN-0001');
  assert.equal(entry.createdAt, '2026-09-25T02:10:00-03:00');
  assert.equal(doc.entries.length, 3);
  assert.equal(base.entries.length, 2);
  assert.equal(doc.rev, 3);
});

test('updateEntry conserva id/tipo/createdAt y actualiza updatedAt', () => {
  const doc = updateEntry(base, 'DOS-0001', { ml: 0.1, id: 'DOS-9999', tipo: 'lab' }, MS);
  const e = doc.entries.find(x => x.id === 'DOS-0001');
  assert.equal(e.ml, 0.1);
  assert.equal(e.tipo, 'dosis_t');
  assert.equal(e.createdAt, 'x');
  assert.equal(e.updatedAt, '2026-09-25T02:10:00-03:00');
  assert.throws(() => updateEntry(base, 'DOS-0404', {}, MS), /no existe/);
});

test('removeEntry', () => {
  assert.deepEqual(removeEntry(base, 'DOS-0001').entries.map(e => e.id), ['DOS-0009']);
  assert.throws(() => removeEntry(base, 'DOS-0404'), /no existe/);
});

test('validateEntry detecta campos faltantes o inválidos por tipo', () => {
  assert.deepEqual(validateEntry(base.entries[0]), []);
  assert.ok(validateEntry({ tipo: 'dosis_t', at: 'mal', ester: 'x', mg: 0, estado: 'z' }).length >= 4);
  assert.deepEqual(validateEntry({ tipo: 'farmaco', farmaco: 'anastrozol', mg: 0.25, modo: 'toma',
    at: '2026-09-25T01:30:00-03:00', estado: 'confirmada' }), []);
  assert.ok(validateEntry({ tipo: 'farmaco', farmaco: 'tamoxifeno', mg: 20, modo: 'continuo' }).some(m => /desde/.test(m)));
  assert.ok(validateEntry({ tipo: 'esquema', desde: '2026-09-25T01:30:00-03:00', ester: 'cipionato', mg: 16,
    generaPendientes: true, dias: [], hora: '1:30' }).length >= 2);
  assert.ok(validateEntry({ tipo: 'sintoma', at: '2026-09-25T01:30:00-03:00', texto: '  ' }).length === 1);
  assert.ok(validateEntry({ tipo: 'lab', at: '2026-09-25T01:30:00-03:00', valores: {} }).length === 1);
  assert.deepEqual(validateEntry({ tipo: 'lab', at: '2026-09-25T01:30:00-03:00', valores: { t_total: 700 } }), []);
});

test('diffLogs: el orden de las claves de objetos anidados no cuenta como cambio', () => {
  const a = { entries: [{ id: 'LAB-0001', tipo: 'lab', valores: { t_total: 287, e2: 23.2 }, acomp: [{ mg: 1, dias: [4] }] }] };
  const b = { entries: [{ tipo: 'lab', id: 'LAB-0001', valores: { e2: 23.2, t_total: 287 }, acomp: [{ dias: [4], mg: 1 }] }] };
  assert.deepEqual(diffLogs(a, b).modified, []);
});

test('diffLogs: agregadas, eliminadas y modificadas campo a campo (ignora updatedAt)', () => {
  const nuevo = updateEntry(removeEntry(base, 'DOS-0009'), 'DOS-0001', { ml: 0.1 }, MS);
  const { doc } = addEntry(nuevo, { tipo: 'sintoma', at: '2026-09-25T10:00:00-03:00', texto: 'x' }, MS);
  const d = diffLogs(base, doc);
  assert.deepEqual(d.added.map(e => e.id), ['SIN-0001']);
  assert.deepEqual(d.removed.map(e => e.id), ['DOS-0009']);
  assert.deepEqual(d.modified, [{ id: 'DOS-0001', fields: [{ name: 'ml', before: 0.08, after: 0.1 }] }]);
});

test('validateEntry: esquema que genera pendientes acepta intervaloDias en vez de días', () => {
  assert.deepEqual(validateEntry({ tipo: 'esquema', desde: '2026-09-25T01:30:00-03:00', ester: 'cipionato', mg: 8,
    generaPendientes: true, dias: null, intervaloDias: 2, hora: null }), []);
  assert.ok(validateEntry({ tipo: 'esquema', desde: '2026-09-25T01:30:00-03:00', ester: 'cipionato', mg: 8,
    generaPendientes: true, dias: [], intervaloDias: null, hora: '01:30' }).length);
});
