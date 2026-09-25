// Estado de la app: log + modelo cargados del servidor. Toda escritura pasa por persist() → PUT /api/log.
import * as api from './store/api.js';
import { addEntry, updateEntry, removeEntry, nowIso } from './store/entries.js';
import { freezePrediction } from './engine/calibration.js';

export const state = { log: null, model: null };
const listeners = new Set();
const statusListeners = new Set();

export function subscribe(fn) { listeners.add(fn); }
export function onStatus(fn) { statusListeners.add(fn); }
function emit() { listeners.forEach(fn => fn(state)); }
function setStatus(kind, text) { statusListeners.forEach(fn => fn(kind, text)); }

export async function load() {
  const [log, model] = await Promise.all([api.getLog(), api.getModel()]);
  state.log = log;
  state.model = model;
  emit();
}

async function persist(doc, message) {
  setStatus('saving', '⏳ Guardando…');
  try {
    const r = await api.putLog(doc, message);
    state.log = { ...doc, rev: r.rev };
    const hhmm = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
    setStatus('saved', `✓ Guardado ${hhmm}`);
    emit();
  } catch (e) {
    if (e.status === 409) {
      setStatus('conflict', '⚠ Otra pestaña guardó antes — se recargó el log, repetí el cambio');
      await load();
    } else {
      setStatus('error', '✕ NO se guardó — ' + e.message);
      api.reportError({ modulo: 'state', accion: 'persist', mensaje: e.message, status: e.status });
    }
    throw e;
  }
}

// Un lab nuevo congela la predicción de la versión vigente del modelo ANTES de cualquier recalibración.
export async function create(data) {
  const d = data.tipo === 'lab'
    ? { ...data, prediccion: freezePrediction(state.log.entries, state.model, data.at, nowIso()) }
    : data;
  const { doc, entry } = addEntry(state.log, d);
  await persist(doc, `+ ${entry.id} ${entry.tipo}${entry.estado ? ' ' + entry.estado : ''}`);
  return entry;
}
export async function update(id, patch) { await persist(updateEntry(state.log, id, patch), `~ ${id}`); }
export async function remove(id) { await persist(removeEntry(state.log, id), `- ${id}`); }
export async function reloadAll() { await load(); }
export { setStatus };
