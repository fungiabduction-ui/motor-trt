import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGithubBackend, loadConfig, saveConfig } from '../js/store/backend-github.js';

// API de GitHub simulada: archivos por path; un PUT sin sha sobre un archivo existente se rechaza (inmutable).
function fakeGithub() {
  const files = new Map();
  let n = 0;
  const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetchImpl = async (url, opts) => {
    const u = new URL(url), path = u.pathname.replace('/repos/u/DATA', '');
    if (path === '') return res(200, { private: true, full_name: 'u/DATA' });
    if (path === '/contents/backups' && opts.method === 'GET') {
      const list = [...files].filter(([p]) => p.startsWith('backups/')).map(([p, f]) => ({ type: 'file', name: p.split('/').pop(), path: p, size: f.text.length, sha: f.sha }));
      return list.length ? res(200, list) : res(404, { message: 'Not Found' });
    }
    const m = path.match(/^\/contents\/(.+)$/);
    if (m && opts.method === 'GET') {
      const f = files.get(m[1]);
      return f ? res(200, { content: Buffer.from(f.text, 'utf8').toString('base64'), sha: f.sha }) : res(404, { message: 'Not Found' });
    }
    if (m && opts.method === 'PUT') {
      const body = JSON.parse(opts.body);
      if (files.has(m[1]) && !body.sha) return res(422, { message: 'sha wasn\'t supplied' });
      const text = Buffer.from(body.content, 'base64').toString('utf8'), sha = `s${++n}`;
      files.set(m[1], { text, sha, message: body.message });
      return res(201, { content: { sha, size: Buffer.byteLength(text) }, commit: { sha: `c${n}` } });
    }
    return res(404, {});
  };
  return { files, fetchImpl };
}
const cfg = { repo: 'u/DATA', branch: 'main', token: 't' };

test('guardar backup crea un archivo nuevo; nunca pisa uno existente', async () => {
  const g = fakeGithub(), be = createGithubBackend(cfg, g.fetchImpl);
  const r = await be.saveBackup('backups/motor-backup-FECHA_25-09-2026_HORA_01-30-00.json', '{"a":"ñ"}\n');
  assert.equal(r.size, Buffer.byteLength('{"a":"ñ"}\n'));
  assert.match(g.files.get(r.path).message, /Motor TRT backup/);
  await assert.rejects(be.saveBackup(r.path, '{}'), e => e.status === 422);
  assert.equal(g.files.get(r.path).text, '{"a":"ñ"}\n');
});

test('listar backups (vacío si no hay carpeta) y leer uno', async () => {
  const g = fakeGithub(), be = createGithubBackend(cfg, g.fetchImpl);
  assert.deepEqual(await be.listBackups(), []);
  await be.saveBackup('backups/motor-backup-FECHA_25-09-2026_HORA_01-30-00.json', 'hola ✓');
  const list = await be.listBackups();
  assert.equal(list.length, 1);
  assert.equal(await be.getBackupText(list[0].path), 'hola ✓');
});

test('formato anterior (log.json/model.json en la raíz) se puede leer para migrar', async () => {
  const g = fakeGithub(), be = createGithubBackend(cfg, g.fetchImpl);
  assert.equal(await be.loadLegacy(), null);
  g.files.set('log.json', { text: '{"schema":1,"rev":10,"entries":[]}', sha: 'a' });
  g.files.set('model.json', { text: '{"vigente":"v1"}', sha: 'b' });
  assert.equal((await be.loadLegacy()).log.rev, 10);
});

test('config: el token queda ofuscado en el almacenamiento y se lee de vuelta', () => {
  const store = new Map(), storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  saveConfig({ token: ' ghp_abc ', repo: 'u/DATA', branch: '' }, storage);
  assert.ok(!store.get('motor-trt.gh').includes('ghp_abc'));
  assert.deepEqual(loadConfig(storage), { repo: 'u/DATA', branch: 'main', token: 'ghp_abc' });
});
