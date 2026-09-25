// Estado de la app: log + modelo.
// - Modo GitHub: se trabaja sobre la copia del navegador; cada cambio es instantáneo y local. "💾 Guardar backup"
//   sube un archivo nuevo e inmutable al repo privado y baja la misma copia al disco (patrón CFG de biolab).
// - Modo local (serve.py): cada cambio se guarda en data/ del servidor, como siempre.
import * as api from './store/api.js';
import * as wc from './store/workcopy.js';
import { addEntry, updateEntry, removeEntry, nowIso } from './store/entries.js';
import { backupText, backupStamp, backupPath, byteSize, parseBackup, fingerprint, stampKey, stampLabel } from './store/backup.js';
import { freezePrediction } from './engine/calibration.js';

export const state = { log: null, model: null, errores: [], base: null };
const listeners = new Set();
const statusListeners = new Set();
export function subscribe(fn) { listeners.add(fn); }
export function onStatus(fn) { statusListeners.add(fn); }
function emit() { listeners.forEach(fn => fn(state)); }
function setStatus(kind, text) { statusListeners.forEach(fn => fn(kind, text)); }
export { setStatus };
const hhmm = () => new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
const kb = n => `${(n / 1024).toFixed(1)} KB`;

export const isGithub = () => api.backendKind === 'github';
export function hasUnsaved() { return isGithub() && (!state.base || fingerprint(state) !== state.base.fp); }
function saveWork() {
  if (!wc.write({ log: state.log, model: state.model, errores: wc.read()?.errores || state.errores, base: state.base })) {
    setStatus('error', '✕ No se pudo guardar la copia local del navegador (¿almacenamiento lleno?)');
  }
}
export function refreshStatus() {
  if (!isGithub()) return;
  const ult = state.base ? `${state.base.source === 'save' ? 'último backup' : 'cargado'} ${stampLabel(state.base.name).slice(0, 16)}` : 'sin backups';
  if (hasUnsaved()) setStatus('dirty', `● Cambios sin guardar · ${ult}`);
  else setStatus('saved', `✓ Todo guardado · ${ult}`);
}

export async function load() {
  if (!isGithub()) {
    const [log, model] = await Promise.all([api.getLog(), api.getModel()]);
    Object.assign(state, { log, model });
    emit();
    return;
  }
  const w = wc.read();
  if (w?.log && w?.model) {
    Object.assign(state, { log: w.log, model: w.model, errores: w.errores || [], base: w.base || null });
  } else if (!(await loadLatestBackup())) {
    // Todavía sin backups: se parte del formato anterior (log.json/model.json en la raíz del repo privado).
    const legacy = await api.gh.loadLegacy();
    if (!legacy) { const err = new Error('El repo de datos no tiene backups ni datos'); err.data = { error: 'log_missing', backups: [] }; throw err; }
    Object.assign(state, { log: legacy.log, model: legacy.model, errores: [], base: null });
    saveWork();
  }
  emit();
  refreshStatus();
}

async function persist(doc) {
  if (isGithub()) {
    state.log = doc;
    saveWork();
    emit();
    refreshStatus();
    return;
  }
  setStatus('saving', '⏳ Guardando…');
  try {
    const r = await api.putLog(doc);
    state.log = { ...doc, rev: r.rev };
    setStatus('saved', `✓ Guardado ${hhmm()}`);
    emit();
  } catch (e) {
    if (e.status === 409) { setStatus('conflict', '⚠ Otra pestaña guardó antes — se recargó el log, repetí el cambio'); await load(); }
    else { setStatus('error', '✕ NO se guardó — ' + e.message); api.reportError({ modulo: 'state', accion: 'persist', mensaje: e.message, status: e.status }); }
    throw e;
  }
}

// Un lab nuevo congela la predicción de la versión vigente del modelo ANTES de cualquier recalibración.
export async function create(data) {
  const d = data.tipo === 'lab' ? { ...data, prediccion: freezePrediction(state.log.entries, state.model, data.at, nowIso()) } : data;
  const { doc, entry } = addEntry(state.log, d);
  await persist(doc);
  return entry;
}
export async function update(id, patch) { await persist(updateEntry(state.log, id, patch)); }
export async function remove(id) { await persist(removeEntry(state.log, id)); }
export async function reloadAll() { await load(); }

// ── Backups (modo GitHub) ──
export async function saveBackup() {
  const errores = wc.read()?.errores || [];
  const text = backupText({ log: state.log, model: state.model, errores });
  const stamp = backupStamp(), path = backupPath(stamp);
  setStatus('saving', '⏳ Guardando backup…');
  try {
    const r = await api.gh.saveBackup(path, text);
    wc.downloadText(path.split('/').pop(), text); // segunda copia al disco, en el mismo momento (como CFG)
    state.base = { fp: fingerprint(state), name: path, at: nowIso(), size: r.size ?? byteSize(text), source: 'save' };
    saveWork();
    setStatus('saved', `✓ Backup guardado ${hhmm()} · ${kb(state.base.size)}`);
    emit();
    return { path, size: state.base.size };
  } catch (e) {
    setStatus('error', '✕ NO se guardó el backup — ' + e.message);
    throw e;
  }
}
export async function loadBackup(path) {
  const text = await api.gh.getBackupText(path);
  const b = parseBackup(text);
  Object.assign(state, { log: b.log, model: b.model, base: { fp: fingerprint(b), name: path, at: nowIso(), size: byteSize(text), source: 'load' } });
  wc.write({ log: b.log, model: b.model, errores: b.errores, base: state.base });
  emit();
  refreshStatus();
}
export async function listBackups() {
  const list = await api.gh.listBackups();
  return list.sort((a, b) => stampKey(b.name).localeCompare(stampKey(a.name)));
}
export async function loadLatestBackup() {
  const list = await listBackups();
  if (!list.length) return false;
  await loadBackup(list[0].path);
  return true;
}
