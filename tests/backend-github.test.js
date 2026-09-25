import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGithubBackend, loadConfig, saveConfig } from '../js/store/backend-github.js';
import { serialize } from '../js/store/serialize.js';

// API de GitHub simulada en memoria: archivos con sha, commits, conflicto si el sha no coincide.
function fakeGithub() {
  const files = new Map(), commits = [];
  let n = 0;
  const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const put = (name, text, message) => {
    const sha = `sha${++n}`;
    files.set(name, { text, sha });
    commits.unshift({ sha: `c${n}`, name, text, commit: { message, author: { date: '2026-09-25T00:00:00Z' } } });
    return sha;
  };
  const fetchImpl = async (url, opts) => {
    const u = new URL(url), path = u.pathname.replace('/repos/u/DATA', '');
    const m = path.match(/^\/contents\/(.+)$/);
    if (opts.method === 'GET' && path === '') return res(200, { private: true, full_name: 'u/DATA' });
    if (opts.method === 'GET' && m) {
      const ref = u.searchParams.get('ref');
      const f = ref.startsWith('c') ? { text: commits.find(c => c.sha === ref).text, sha: 'old' } : files.get(m[1]);
      return f ? res(200, { content: Buffer.from(f.text, 'utf8').toString('base64'), sha: f.sha }) : res(404, { message: 'Not Found' });
    }
    if (opts.method === 'PUT' && m) {
      const body = JSON.parse(opts.body), cur = files.get(m[1]);
      if ((cur?.sha || undefined) !== body.sha) return res(409, { message: 'sha does not match' });
      const sha = put(m[1], Buffer.from(body.content, 'base64').toString('utf8'), body.message);
      return res(200, { content: { sha }, commit: { sha: `c${n}` } });
    }
    if (opts.method === 'GET' && path === '/commits') return res(200, commits.filter(c => c.name === 'log.json'));
    return res(404, {});
  };
  return { files, commits, put, fetchImpl };
}
const cfg = { repo: 'u/DATA', branch: 'main', token: 't' };
const entry = (id, ml) => ({ id, tipo: 'dosis_t', at: '2026-09-25T01:30:00-03:00', ester: 'cipionato', mg: 16, ml, estado: 'confirmada' });

test('lee, guarda como commit con rev+1 y no escribe si no cambió nada', async () => {
  const g = fakeGithub();
  g.put('log.json', serialize({ schema: 1, rev: 0, entries: [entry('DOS-0001', 0.08)] }), 'init');
  const be = createGithubBackend(cfg, g.fetchImpl);
  const doc = await be.getLog();
  assert.equal(doc.rev, 0);
  const same = await be.putLog(doc);
  assert.equal(same.unchanged, true);
  const r = await be.putLog({ ...doc, entries: [entry('DOS-0001', 0.1)] }, '~ DOS-0001');
  assert.equal(r.rev, 1);
  assert.match(g.commits[0].commit.message, /~ DOS-0001 \(rev 1\)/);
  assert.equal(JSON.parse(g.files.get('log.json').text).entries[0].ml, 0.1);
});

test('si otro dispositivo guardó antes → 409 (conflicto), sin pisar', async () => {
  const g = fakeGithub();
  g.put('log.json', serialize({ schema: 1, rev: 0, entries: [entry('DOS-0001', 0.08)] }), 'init');
  const a = createGithubBackend(cfg, g.fetchImpl), b = createGithubBackend(cfg, g.fetchImpl);
  const da = await a.getLog(), db = await b.getLog();
  await a.putLog({ ...da, entries: [entry('DOS-0001', 0.1)] });
  await assert.rejects(b.putLog({ ...db, entries: [entry('DOS-0001', 0.5)] }), e => e.status === 409);
  assert.equal(JSON.parse(g.files.get('log.json').text).entries[0].ml, 0.1);
});

test('inválido → 400 sin tocar el repo; log inexistente → log_missing', async () => {
  const g = fakeGithub();
  const be = createGithubBackend(cfg, g.fetchImpl);
  await assert.rejects(be.getLog(), e => e.data?.error === 'log_missing');
  g.put('log.json', serialize({ schema: 1, rev: 0, entries: [] }), 'init');
  const doc = await be.getLog();
  await assert.rejects(be.putLog({ ...doc, entries: [{ id: 'X', tipo: 'dosis_t' }] }), e => e.status === 400);
  assert.equal(g.commits.length, 1);
});

test('respaldos = commits de log.json; restaurar crea un commit nuevo con la versión vieja', async () => {
  const g = fakeGithub();
  g.put('log.json', serialize({ schema: 1, rev: 0, entries: [entry('DOS-0001', 0.08)] }), 'init');
  const be = createGithubBackend(cfg, g.fetchImpl);
  const doc = await be.getLog();
  await be.putLog({ ...doc, entries: [entry('DOS-0001', 0.1)] });
  const list = await be.listBackups();
  assert.equal(list.length, 2);
  const r = await be.restoreBackup(list[1].name);
  assert.equal(r.rev, 2);
  assert.equal(JSON.parse(g.files.get('log.json').text).entries[0].ml, 0.08);
  assert.equal((await be.getBackup(list[1].name)).entries[0].ml, 0.08);
});

test('config: el token queda ofuscado en el almacenamiento y se lee de vuelta', () => {
  const store = new Map(), storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  saveConfig({ token: ' ghp_abc ', repo: 'u/DATA', branch: '' }, storage);
  assert.ok(!store.get('motor-trt.gh').includes('ghp_abc'));
  assert.deepEqual(loadConfig(storage), { repo: 'u/DATA', branch: 'main', token: 'ghp_abc' });
});
