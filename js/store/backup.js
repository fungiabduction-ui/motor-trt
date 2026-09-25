// Backups al estilo CFG de biolab-app: un archivo NUEVO e inmutable por cada "Guardar backup" (nunca automático),
// nombre con fecha y hora, huella para detectar cambios sin guardar, y tamaño coloreado contra el backup anterior.
import { serialize } from './serialize.js';

const p2 = n => String(n).padStart(2, '0');
const canon = v => Array.isArray(v) ? v.map(canon)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;

// FECHA_24-09-2026_HORA_01-30-05 (mismo formato que biolab).
export function backupStamp(d = new Date()) {
  return `FECHA_${p2(d.getDate())}-${p2(d.getMonth() + 1)}-${d.getFullYear()}_HORA_${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`;
}
export const backupPath = stamp => `backups/motor-backup-${stamp}.json`;

// Clave ordenable AAAAMMDDHHMMSS a partir del nombre (para ordenar más nuevo primero).
export function stampKey(name) {
  const m = String(name).match(/FECHA_(\d{2})-(\d{2})-(\d{4})_HORA_(\d{2})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}${m[2]}${m[1]}${m[4]}${m[5]}${m[6]}` : '';
}
export function stampLabel(name) {
  const m = String(name).match(/FECHA_(\d{2})-(\d{2})-(\d{4})_HORA_(\d{2})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}:${m[6]}` : String(name);
}

// Contenido del backup: el estado completo {log, model, errores}, determinístico.
export function backupText(state) {
  return JSON.stringify({ tipo: 'motor-trt-backup', version: 1, log: JSON.parse(serialize(state.log)),
    model: canon(state.model), errores: state.errores || [] }, null, 2) + '\n';
}
export function parseBackup(text) {
  const b = JSON.parse(text);
  if (b.tipo !== 'motor-trt-backup' || !b.log || !b.model) throw new Error('El archivo no es un backup del Motor TRT');
  return { log: b.log, model: b.model, errores: b.errores || [] };
}
export const byteSize = text => new TextEncoder().encode(text).length;

// Huella de log + modelo (sin errores): igual huella = nada nuevo para guardar.
export function fingerprint(state) {
  const s = serialize(state.log) + JSON.stringify(canon(state.model));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${h.toString(16)}-${s.length}`;
}

// Color del tamaño de cada backup contra el guardado justo antes (lista más nuevo primero), como kbColor de CFG:
// creció = bien (verde), igual = amarillo, bajó = rojo (posible pérdida de datos).
export function sizeColors(files) {
  return files.map((f, i) => {
    const prev = files[i + 1];
    if (!prev || f.size == null || prev.size == null) return 'neutral';
    return f.size > prev.size ? 'up' : f.size === prev.size ? 'same' : 'down';
  });
}
