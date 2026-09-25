import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { serialize, validateLog, ValidationError, b64encode, b64decode } from '../js/store/serialize.js';

const doc = { schema: 1, rev: 3, entries: [
  { id: 'DOS-0002', tipo: 'dosis_t', at: '2026-09-28T01:30:00-03:00', mg: 16, ml: 0.08, nota: 'pierna — ñ ✓', estado: 'confirmada' },
  { id: 'FAR-0001', tipo: 'farmaco', modo: 'continuo', farmaco: 'rosuvastatina', mg: 20, desde: '2026-09-18T00:00:00-03:00', hasta: null },
  { id: 'DOS-0001', tipo: 'dosis_t', at: '2026-09-25T01:30:00-03:00', mg: 16, ml: 0.08, valores: { b: 1, a: [1, 2] }, estado: 'confirmada' },
] };

test('serialize: mismo texto que serve.py (claves ordenadas, entradas por fecha, UTF-8 sin escapar)', (t) => {
  let py;
  try {
    py = execFileSync('python', ['-c', 'import sys,json; sys.path.insert(0,"."); import serve; sys.stdout.buffer.write(serve.serialize(json.loads(sys.stdin.buffer.read().decode("utf-8"))).encode("utf-8"))'],
      { input: JSON.stringify(doc), encoding: 'utf8' });
  } catch { t.skip('python no disponible'); return; }
  assert.equal(serialize(doc), py);
});

test('serialize: determinística e independiente del orden de entrada', () => {
  assert.equal(serialize(doc), serialize({ ...doc, entries: [...doc.entries].reverse() }));
  assert.ok(serialize(doc).indexOf('FAR-0001') < serialize(doc).indexOf('DOS-0001'), 'desde 18/09 antes que at 25/09');
});

test('validateLog: mismas reglas que serve.py', () => {
  validateLog(doc);
  const bad = [
    { schema: 2, rev: 1, entries: [] }, { schema: 1, rev: '1', entries: [] }, [],
    { schema: 1, rev: 1, entries: [{ id: 'DOS-1', tipo: 'dosis_t' }] },
    { schema: 1, rev: 1, entries: [{ id: 'DOS-0001', tipo: 'lab' }] },
    { schema: 1, rev: 1, entries: [{ id: 'DOS-0001', tipo: 'dosis_t' }, { id: 'DOS-0001', tipo: 'dosis_t' }] },
  ];
  for (const b of bad) assert.throws(() => validateLog(b), ValidationError);
});

test('base64 UTF-8 ida y vuelta con acentos y emojis', () => {
  const s = 'Ñandú — 1/4 comprimido ✓ 🫀';
  assert.equal(b64decode(b64encode(s)), s);
  assert.equal(b64decode(Buffer.from(s, 'utf8').toString('base64')), s);
});
