// Diff entre dos versiones del log (backup vs actual), campo a campo. updatedAt se ignora: cambia en cada edición.
// Comparación independiente del orden de claves: el servidor guarda con claves ordenadas y el navegador no,
// así que JSON.stringify directo marcaba como "modificadas" entradas idénticas.
const canon = v => Array.isArray(v) ? v.map(canon)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

export function diffLogs(oldDoc, newDoc) {
  const om = new Map(oldDoc.entries.map(e => [e.id, e]));
  const nm = new Map(newDoc.entries.map(e => [e.id, e]));
  const byId = (a, b) => a.id.localeCompare(b.id);
  const added = newDoc.entries.filter(e => !om.has(e.id)).sort(byId);
  const removed = oldDoc.entries.filter(e => !nm.has(e.id)).sort(byId);
  const modified = [];
  for (const [id, n] of [...nm].sort((a, b) => a[0].localeCompare(b[0]))) {
    const o = om.get(id);
    if (!o) continue;
    const names = [...new Set([...Object.keys(o), ...Object.keys(n)])].filter(k => k !== 'updatedAt').sort();
    const fields = names.filter(k => !same(o[k], n[k])).map(k => ({ name: k, before: o[k], after: n[k] }));
    if (fields.length) modified.push({ id, fields });
  }
  return { added, removed, modified };
}
