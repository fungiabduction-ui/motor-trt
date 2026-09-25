// Backend GitHub (patrón CFG de biolab-app): el repo PRIVADO guarda BACKUPS INMUTABLES en backups/ — uno nuevo por
// cada "💾 Guardar backup" manual; nunca se pisa ni se sube nada solo. La app trabaja sobre la copia del navegador.
// Token solo en este navegador (localStorage, ofuscado en base64 — no es cifrado); solo api.github.com, sin proxies;
// reintento solo ante fallos de RED (nunca ante una respuesta HTTP real).
import { b64encode, b64decode } from './serialize.js';

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

export function createGithubBackend(cfg, fetchImpl = (...a) => globalThis.fetch(...a)) {
  async function raw(url, method = 'GET', body) {
    let r, last;
    for (let i = 0; i < 3; i++) {
      try {
        r = await fetchImpl(url, {
          method, cache: 'no-store',
          headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
            ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
        break;
      } catch (e) { last = e; await new Promise(res => setTimeout(res, 700 * (i + 1))); }
    }
    if (!r) { const err = new Error('Sin conexión con GitHub (' + (last?.message || 'red') + ')'); err.status = 0; throw err; }
    return { status: r.status, ok: r.ok, data: await r.json().catch(() => ({})) };
  }
  async function gh(method, path, body) {
    const r = await raw(`${API}/repos/${cfg.repo}${path}`, method, body);
    if (!r.ok) {
      const err = new Error(r.status === 401 ? 'Token inválido o vencido (⚙️ Config)' : r.status === 404 ? 'No encontrado en el repo de datos' : (r.data.message || `GitHub HTTP ${r.status}`));
      err.status = r.status; err.data = r.data; throw err;
    }
    return r.data;
  }
  async function getText(path) {
    const f = await gh('GET', `/contents/${path}?ref=${encodeURIComponent(cfg.branch)}`);
    let b64 = f.content;
    if (!b64 && f.sha) b64 = (await gh('GET', `/git/blobs/${f.sha}`)).content; // > 1 MB: la API no manda el contenido inline
    return b64decode(b64 || '');
  }

  return {
    kind: 'github', repo: cfg.repo,
    // Lista de backups (más nuevo primero lo ordena la UI): nombre, path, tamaño y sha vienen en el listado.
    async listBackups() {
      try {
        const files = await gh('GET', `/contents/backups?ref=${encodeURIComponent(cfg.branch)}`);
        return files.filter(f => f.type === 'file' && f.name.endsWith('.json')).map(f => ({ name: f.name, path: f.path, size: f.size, sha: f.sha }));
      } catch (e) { if (e.status === 404) return []; throw e; }
    },
    getBackupText: path => getText(path),
    // Backup nuevo e inmutable: sin sha → si ya existiera un archivo con ese nombre, GitHub lo rechaza (nunca pisa).
    async saveBackup(path, text) {
      const r = await gh('PUT', `/contents/${path}`, { message: `Motor TRT backup · ${path.split('/').pop()}`, content: b64encode(text), branch: cfg.branch });
      return { path, sha: r.content.sha, size: r.content.size };
    },
    // Formato anterior (log.json / model.json sueltos en la raíz): solo para migrar si todavía no hay backups.
    async loadLegacy() {
      try { return { log: JSON.parse(await getText('log.json')), model: JSON.parse(await getText('model.json')) }; }
      catch (e) { if (e.status === 404) return null; throw e; }
    },
    async test() { const repo = await gh('GET', ''); return { privado: repo.private, nombre: repo.full_name }; },
    // Diagnóstico cuando el repo no aparece: de qué cuenta es el token y qué repos puede ver.
    async diagnose() {
      const user = await raw(`${API}/user`);
      if (user.status === 401) return { valido: false };
      const repos = await raw(`${API}/user/repos?per_page=100`);
      return { valido: true, cuenta: user.data.login, repos: Array.isArray(repos.data) ? repos.data.map(r => r.full_name) : [] };
    },
  };
}
