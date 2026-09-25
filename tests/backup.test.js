import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupStamp, backupPath, stampKey, stampLabel, backupText, parseBackup, byteSize, fingerprint, sizeColors } from '../js/store/backup.js';

const log = { schema: 1, rev: 3, entries: [{ id: 'SIN-0001', tipo: 'sintoma', at: '2026-09-20T12:00:00-03:00', texto: 'ñandú ✓' }] };
const model = { vigente: 'v1', versiones: [{ id: 'v1', params: { b: 2, a: 1 } }] };

test('nombre del backup con fecha y hora (formato biolab) y orden por fecha', () => {
  const s = backupStamp(new Date(2026, 8, 25, 1, 30, 5));
  assert.equal(s, 'FECHA_25-09-2026_HORA_01-30-05');
  assert.equal(backupPath(s), 'backups/motor-backup-FECHA_25-09-2026_HORA_01-30-05.json');
  assert.equal(stampKey(backupPath(s)), '20260925013005');
  assert.equal(stampLabel(backupPath(s)), '25/09/2026 01:30:05');
  assert.ok(stampKey('motor-backup-FECHA_01-10-2026_HORA_00-00-00.json') > stampKey('motor-backup-FECHA_30-09-2026_HORA_23-59-59.json'));
});

test('backup = estado completo; ida y vuelta; peso en bytes UTF-8', () => {
  const text = backupText({ log, model, errores: [{ mensaje: 'x' }] });
  const back = parseBackup(text);
  assert.deepEqual(back.log, log);
  assert.deepEqual(back.model, model);
  assert.equal(back.errores.length, 1);
  assert.equal(byteSize(text), Buffer.byteLength(text, 'utf8'));
  assert.throws(() => parseBackup('{"a":1}'), /no es un backup/);
});

test('huella: cambia si cambia log o modelo, no por orden de claves ni por errores', () => {
  const f = fingerprint({ log, model });
  assert.equal(f, fingerprint({ log, model: { versiones: [{ params: { a: 1, b: 2 }, id: 'v1' }], vigente: 'v1' }, errores: [1] }));
  assert.notEqual(f, fingerprint({ log: { ...log, entries: [{ ...log.entries[0], texto: 'otro' }] }, model }));
  assert.notEqual(f, fingerprint({ log, model: { ...model, vigente: 'v2' } }));
});

test('colores de tamaño contra el backup anterior (lista más nuevo primero)', () => {
  assert.deepEqual(sizeColors([{ size: 120 }, { size: 100 }, { size: 100 }, { size: 150 }]), ['up', 'same', 'down', 'neutral']);
});
