// Copia de trabajo en este navegador (modo GitHub): {log, model, errores, base}. `base` = el backup del que se partió
// o el último guardado ({fp, name, at, size, source}) → con la huella se sabe si hay cambios sin guardar.
const KEY = 'motor-trt.estado';

export function read(storage = globalThis.localStorage) {
  try { return JSON.parse(storage?.getItem(KEY) || 'null'); } catch { return null; }
}
export function write(obj, storage = globalThis.localStorage) {
  try { storage.setItem(KEY, JSON.stringify(obj)); return true; } catch (e) { console.error('No se pudo guardar la copia local', e); return false; }
}
export function appendError(info, storage = globalThis.localStorage) {
  const w = read(storage);
  if (!w) return;
  w.errores = [...(w.errores || []), { ...info, ts: new Date().toISOString() }].slice(-200);
  write(w, storage);
}
export function clear(storage = globalThis.localStorage) { try { storage.removeItem(KEY); } catch { /* nada */ } }

export function downloadText(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
