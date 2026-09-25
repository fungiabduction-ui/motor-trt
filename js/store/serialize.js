// Serialización y validación del log en el navegador — el mismo contrato que serve.py (validate_log/serialize),
// para que un guardado desde GitHub y uno desde el servidor local produzcan el mismo archivo.
export const SCHEMA = 1;
const TIPO_PREFIX = { dosis_t: 'DOS', farmaco: 'FAR', esquema: 'ESQ', sintoma: 'SIN', lab: 'LAB' };
const ID_RE = /^(DOS|FAR|ESQ|SIN|LAB)-\d{4}$/;

export class ValidationError extends Error {}

export function validateLog(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new ValidationError('el log debe ser un objeto JSON');
  if (doc.schema !== SCHEMA) throw new ValidationError(`schema debe ser ${SCHEMA}`);
  if (!Number.isInteger(doc.rev)) throw new ValidationError('rev debe ser un entero');
  if (!Array.isArray(doc.entries)) throw new ValidationError('entries debe ser una lista');
  const seen = new Set();
  doc.entries.forEach((e, i) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new ValidationError(`entrada ${i}: no es un objeto`);
    if (typeof e.id !== 'string' || !ID_RE.test(e.id)) throw new ValidationError(`entrada ${i}: id inválido ${JSON.stringify(e.id)}`);
    if (!(e.tipo in TIPO_PREFIX)) throw new ValidationError(`${e.id}: tipo desconocido ${JSON.stringify(e.tipo)}`);
    if (!e.id.startsWith(TIPO_PREFIX[e.tipo] + '-')) throw new ValidationError(`${e.id}: el prefijo no corresponde al tipo ${e.tipo}`);
    if (seen.has(e.id)) throw new ValidationError(`${e.id}: id duplicado`);
    seen.add(e.id);
  });
}

const canon = v => Array.isArray(v) ? v.map(canon)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const sortKey = e => [e.at || e.desde || '', e.id];

// Determinística: claves ordenadas, entradas por fecha e id, indentación 2, salto de línea final (= serve.py).
export function serialize(doc) {
  const entries = [...doc.entries].sort((a, b) => {
    const [ka, ia] = sortKey(a), [kb, ib] = sortKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : ia < ib ? -1 : ia > ib ? 1 : 0;
  });
  return JSON.stringify(canon({ ...doc, entries }), null, 2) + '\n';
}

// base64 ↔ texto UTF-8 (la API de GitHub usa base64; btoa/atob solos rompen acentos y emojis).
export function b64encode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
