// Operaciones puras sobre el log (sin red ni DOM): IDs, fechas de formulario, alta/edición/baja, validación.
import { isoFromDay, nowDay, dayFromIso } from '../engine/time.js';

export const PREFIX = { dosis_t: 'DOS', farmaco: 'FAR', esquema: 'ESQ', sintoma: 'SIN', lab: 'LAB' };
export const ESTERES = ['cipionato', 'enantato'];
export const ESTADOS = ['confirmada', 'salteada', 'reconstruida'];
export const SITIOS = ['abdomen', 'pierna_derecha', 'pierna_izquierda', 'gluteo', 'deltoides', 'otro'];
export const PROFUNDIDADES = ['subq_superficial', 'subq_profundo', 'im'];

export function nextId(entries, tipo) {
  const p = PREFIX[tipo];
  const nums = entries.filter(e => e.id.startsWith(p + '-')).map(e => parseInt(e.id.slice(4), 10));
  return `${p}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, '0')}`;
}

export function nowIso(ms = Date.now()) {
  return isoFromDay(nowDay(ms));
}

// <input type="datetime-local"> ↔ ISO con offset -03:00
export function isoFromInput(v) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v || '')) throw new Error('Fecha/hora inválida: ' + v);
  return v + ':00-03:00';
}
export function inputFromIso(iso) {
  return isoFromDay(dayFromIso(iso)).slice(0, 16);
}

export function addEntry(log, data, ms = Date.now()) {
  const ts = nowIso(ms);
  const entry = { ...data, id: nextId(log.entries, data.tipo), createdAt: ts, updatedAt: ts };
  return { doc: { ...log, entries: [...log.entries, entry] }, entry };
}

export function updateEntry(log, id, patch, ms = Date.now()) {
  const i = log.entries.findIndex(e => e.id === id);
  if (i < 0) throw new Error(`La entrada ${id} no existe`);
  const old = log.entries[i];
  const upd = { ...old, ...patch, id: old.id, tipo: old.tipo, createdAt: old.createdAt, updatedAt: nowIso(ms) };
  const entries = log.entries.slice();
  entries[i] = upd;
  return { ...log, entries };
}

export function removeEntry(log, id) {
  if (!log.entries.some(e => e.id === id)) throw new Error(`La entrada ${id} no existe`);
  return { ...log, entries: log.entries.filter(e => e.id !== id) };
}

const isIso = s => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const isPos = n => typeof n === 'number' && Number.isFinite(n) && n > 0;

// Devuelve la lista de problemas (vacía = válida). Se usa antes de guardar desde los formularios.
export function validateEntry(e) {
  const err = [];
  switch (e.tipo) {
    case 'dosis_t':
      if (!isIso(e.at)) err.push('Fecha y hora inválida');
      if (!ESTERES.includes(e.ester)) err.push('Éster inválido');
      if (!isPos(e.mg)) err.push('Los mg tienen que ser mayores a 0');
      if (!ESTADOS.includes(e.estado)) err.push('Estado inválido');
      break;
    case 'farmaco':
      if (!e.farmaco || !String(e.farmaco).trim()) err.push('Falta el nombre del fármaco');
      if (!(typeof e.mg === 'number' && e.mg >= 0)) err.push('Dosis (mg) inválida');
      if (e.modo === 'toma') {
        if (!isIso(e.at)) err.push('Fecha y hora de la toma inválida');
        if (!ESTADOS.includes(e.estado)) err.push('Estado inválido');
      } else if (e.modo === 'continuo') {
        if (!isIso(e.desde)) err.push('Falta la fecha "desde" del tratamiento continuo');
        if (e.hasta && !isIso(e.hasta)) err.push('Fecha "hasta" inválida');
      } else err.push('Modo inválido (toma o continuo)');
      break;
    case 'esquema':
      if (!isIso(e.desde)) err.push('Fecha "desde" inválida');
      if (!ESTERES.includes(e.ester)) err.push('Éster inválido');
      if (!isPos(e.mg)) err.push('Los mg tienen que ser mayores a 0');
      if (e.generaPendientes && !(e.intervaloDias > 0)) {
        if (!Array.isArray(e.dias) || !e.dias.length) err.push('Elegí al menos un día de aplicación (o "cada N días")');
        if (!/^\d{2}:\d{2}$/.test(e.hora || '')) err.push('Hora inválida (HH:MM)');
      }
      break;
    case 'sintoma':
      if (!isIso(e.at)) err.push('Fecha y hora inválida');
      if (!e.texto || !e.texto.trim()) err.push('Falta la descripción');
      break;
    case 'lab':
      if (!isIso(e.at)) err.push('Fecha y hora de extracción inválida');
      if (!e.valores || !Object.values(e.valores).some(v => typeof v === 'number' && Number.isFinite(v))) {
        err.push('Cargá al menos un valor');
      }
      break;
    default:
      err.push('Tipo de entrada desconocido');
  }
  return err;
}
