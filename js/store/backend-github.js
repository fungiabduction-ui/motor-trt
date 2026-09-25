// Backend GitHub (patrón CFG de biolab-app): los datos viven en un repo PRIVADO (log.json, model.json, errors.json)
// y se leen/escriben con la API de contenidos. Cada guardado = un commit → el historial de commits ES el respaldo.
// El token queda solo en este navegador (localStorage, ofuscado en base64 — no es cifrado) y nunca se exporta.
// Sin proxies de terceros: solo api.github.com, con reintento ante fallos de RED (no ante respuestas HTTP).
import { serialize, validateLog, ValidationError, b64encode, b64decode } from './serialize.js';

const CFG_KEY = 'motor-trt.gh';
const API = 'https://api.github.com';
export const DEFAULT_REPO = 'fungiabduction-ui/MOTOR-TRT-DATA';

export function loadConfig(storage = globalThis.localStorage) {
  try {
    const c = JSON.parse(storage?.getItem(CFG_KEY) || 'null');
    return c && c.token ? { repo: c.repo || DEFAULT_REPO, branch: c.branch || 'main', token: atob(c.token) } : null;
  } catch { return null; }
}
export function saveConfig({ token, repo, branch }, storage = globalThis.localStorage) {
  storage.setItem(CFG_KEY, JSON.stringify({ token: btoa(token.trim()), repo: repo.trim(), branch: (branch || 'main').trim() }));
}
export function clearConfig(storage = globalThis.localStorage) { storage.removeItem(CFG_KEY); }

// Cliente sobre una config concreta (inyectable para tests: fetchImpl).
export function createGithubBackend(cfg, fetchImpl = (...a) => globalThis.fetch(...a)) {
  let logSha = null, logCanon = null, logRev = 0;

  async function gh(method, path, body) {
    let r, last;
    for (let i = 0; i < 3; i++) {
      try {
        r = await fetchImpl(`${API}/repos/${cfg.repo}${path}`, {
          method, cache: 'no-store',
          headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
            ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
        break;
      } catch (e) { last = e; await new Promise(res => setTimeout(res, 700 * (i + 1))); }
    }
    if (!r) { const err = new Error('Sin conexión con GitHub — NO se guardó (' + (last?.message || 'red') + ')'); err.status = 0; throw err; }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(r.status === 401 ? 'Token inválido o vencido (⚙️ Config)' : r.status === 404 ? 'No encontrado en el repo de datos' : (data.message || `GitHub HTTP ${r.status}`));
      err.status = r.status; err.data = data; throw err;
    }
    return data;
  }

  async function getFile(name, ref) {
    const f = await gh('GET', `/contents/${name}?ref=${encodeURIComponent(ref || cfg.branch)}`);
    let b64 = f.content;
    if (!b64 && f.sha) b64 = (await gh('GET', `/git/blobs/${f.sha}`)).content; // > 1 MB: la API no manda el contenido inline
    return { text: b64decode(b64 || ''), sha: f.sha };
  }
  const putFile = (name, text, sha, message) =>
    gh('PUT', `/contents/${name}`, { message, content: b64encode(text), sha: sha || undefined, branch: cfg.branch });

  return {
    kind: 'github', repo: cfg.repo,
    async getLog() {
      let f;
      try { f = await getFile('log.json'); } catch (e) {
        if (e.status === 404) { const err = new Error('log.json no existe en el repo de datos'); err.status = 404; err.data = { error: 'log_missing', backups: [] }; throw err; }
        throw e;
      }
      const doc = JSON.parse(f.text);
      logSha = f.sha; logCanon = serialize(doc); logRev = doc.rev;
      return doc;
    },
    async putLog(doc, message = 'Actualizar log') {
      try { validateLog(doc); } catch (e) { if (e instanceof ValidationError) { const err = new Error(e.message); err.status = 400; throw err; } throw e; }
      if (doc.rev !== logRev) { const err = new Error('conflict'); err.status = 409; err.data = { rev: logRev }; throw err; }
      if (serialize({ ...doc, rev: logRev }) === logCanon) return { rev: logRev, unchanged: true, backup: null };
      const next = { ...doc, rev: logRev + 1 }, text = serialize(next);
      let r;
      try { r = await putFile('log.json', text, logSha, `${message} (rev ${next.rev})`); } catch (e) {
        if (e.status === 409 || e.status === 422) { const err = new Error('conflict'); err.status = 409; err.data = { rev: logRev }; throw err; }
        throw e;
      }
      logSha = r.content.sha; logCanon = text; logRev = next.rev;
      return { rev: next.rev, unchanged: false, backup: r.commit.sha };
    },
    async getModel() {
      try { return JSON.parse((await getFile('model.json')).text); } catch (e) {
        if (e.status === 404) { e.data = { error: 'model_missing' }; } throw e;
      }
    },
    // Respaldos = commits que tocaron log.json (el más nuevo primero).
    async listBackups() {
      const commits = await gh('GET', `/commits?path=log.json&sha=${encodeURIComponent(cfg.branch)}&per_page=50`);
      return commits.map(c => ({ name: c.sha, label: c.commit.message, date: c.commit.author?.date }));
    },
    async getBackup(sha) { return JSON.parse((await getFile('log.json', sha)).text); },
    async restoreBackup(sha) {
      const old = JSON.parse((await getFile('log.json', sha)).text);
      await this.getLog(); // sha y rev actuales
      const next = { ...old, rev: logRev + 1 }, text = serialize(next);
      const r = await putFile('log.json', text, logSha, `Restaurar log a ${sha.slice(0, 7)} (rev ${next.rev})`);
      logSha = r.content.sha; logCanon = text; logRev = next.rev;
      return { rev: next.rev, backup: r.commit.sha, restored: sha };
    },
    async reportError(info) {
      try {
        let errors = [], sha;
        try { const f = await getFile('errors.json'); errors = JSON.parse(f.text); sha = f.sha; } catch { /* no existe todavía */ }
        errors.push({ ...info, ts: new Date().toISOString() });
        await putFile('errors.json', JSON.stringify(errors.slice(-200), null, 2) + '\n', sha, `Error: ${String(info.mensaje || '').slice(0, 60)}`);
      } catch (e) { console.error('No se pudo registrar el error en GitHub', info, e); }
    },
    async test() { const repo = await gh('GET', ''); return { privado: repo.private, nombre: repo.full_name }; },
    // Diagnóstico cuando el repo no aparece: de qué cuenta es el token y qué repos puede ver.
    async diagnose() {
      const call = async path => {
        const r = await fetchImpl(`${API}${path}`, { cache: 'no-store', headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
        return { status: r.status, data: await r.json().catch(() => ({})) };
      };
      const user = await call('/user');
      if (user.status === 401) return { valido: false };
      const repos = await call('/user/repos?per_page=100');
      return { valido: true, cuenta: user.data.login, repos: Array.isArray(repos.data) ? repos.data.map(r => r.full_name) : [] };
    },
  };
}
