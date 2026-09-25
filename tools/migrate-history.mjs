// Migración incremental (24/09/2026): completa el log con TODA la historia de laboratorio de JET/data_raw.json
// (2018 → hoy) y agrega los objetivos acordados a model.json. Idempotente: nunca pisa un valor existente ni
// duplica labs. Hace backup de log.json antes de escribir (mismo formato que serve.py).
// Uso: node tools/migrate-history.mjs [--data <carpeta>] [--raw <data_raw.json>]
import { readFileSync, writeFileSync, mkdirSync, existsSync, openSync, writeSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextId } from '../js/store/entries.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Clave de data_raw.json → clave de `valores` del log. Vermeulen se ignora a propósito (inválido, ver JET/CLAUDE.md).
const MAP = {
  testosterona: 't_total', testosterona_total: 't_total', testosterona_libre: 't_libre_directa',
  testosterona_biodisponible: 't_biodisponible', glae_shbg: 'shbg', shbg: 'shbg', estradiol: 'e2',
  lh: 'lh', fsh: 'fsh', prolactina: 'prolactina', macroprolactina_recuperacion: 'macroprolactina_rec',
  hematocrito: 'hematocrito', dhea_s: 'dhea_s', colesterol_total: 'col_total', colesterol_ldl: 'ldl',
  colesterol_hdl: 'hdl', colesterol_no_hdl: 'no_hdl', trigliceridos: 'tg', apolipoproteina_b: 'apob', lipoproteina_a: 'lpa',
  // Seguridad del TRT/estatina y riesgo CV/metabólico (24/09/2026). El resto de data_raw (hemograma completo,
  // orina, electrolitos) queda en JET/dashboard_jet.html — no es parte de este sistema.
  got_ast: 'got', gpt_alt: 'gpt', ggt: 'ggt', gamma_gt: 'ggt', cpk_mb: 'cpk_mb', creatininemia: 'creatinina', hemoglobina: 'hemoglobina',
  psa_total: 'psa', psa_libre: 'psa_libre', glucemia_basal: 'glucemia', insulina_basal: 'insulina', homa: 'homa', hba1c: 'hba1c',
  homocisteina: 'homocisteina', pcr: 'pcr', fibrinogeno: 'fibrinogeno', tsh: 'tsh', t4_libre: 't4_libre',
  cortisol_matinal: 'cortisol', vitamina_d: 'vitamina_d',
};

export { DEFAULT_OBJETIVOS } from '../js/engine/objetivos.js';
import { DEFAULT_OBJETIVOS } from '../js/engine/objetivos.js';

export function valoresFromRaw(parametros) {
  const valores = {}, notas = [];
  for (const [k, p] of Object.entries(parametros)) {
    const key = MAP[k];
    if (!key || p == null) continue;
    let v = p.valor;
    if (typeof v === 'string' && /^<\s*[\d.]+$/.test(v)) { notas.push(`${key} ${v} (debajo del límite de detección; se guarda el límite)`); v = Number(v.replace('<', '')); }
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (key === 't_total' && String(p.unidad || '').toLowerCase() === 'ng/ml') { notas.push(`T total ${v} ng/ml convertida ×100 a ng/dl`); v = Math.round(v * 100 * 100) / 100; }
    valores[key] = v;
  }
  return { valores, notas };
}

export function mergeHistory(log, informes, ts) {
  const entries = log.entries.map(e => ({ ...e }));
  const added = [], completed = new Set();
  for (const inf of informes) {
    const { valores, notas } = valoresFromRaw(inf.parametros || {});
    if (!Object.keys(valores).length) continue;
    let lab = entries.find(e => e.tipo === 'lab' && e.at.slice(0, 10) === inf.fecha);
    if (!lab) {
      lab = { id: nextId(entries, 'lab'), tipo: 'lab', at: `${inf.fecha}T09:00:00-03:00`, valores: {}, fuente: inf.archivo || 'JET/data_raw.json',
        prediccion: null, nota: 'Hora de extracción no registrada. Migrado de data_raw.json (24/09/2026).', createdAt: ts, updatedAt: ts };
      entries.push(lab);
      added.push(lab.id);
    }
    const nuevos = Object.entries(valores).filter(([k]) => lab.valores[k] === undefined);
    if (!nuevos.length) continue;
    lab.valores = { ...lab.valores, ...Object.fromEntries(nuevos) };
    if (notas.length) lab.nota = [lab.nota, ...notas.filter(n => !String(lab.nota).includes(n))].filter(Boolean).join(' ');
    if (!added.includes(lab.id)) { lab.updatedAt = ts; completed.add(lab.id); }
  }
  return { doc: { ...log, entries }, added, completed: [...completed] };
}

function backup(dataDir) {
  const dir = join(dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const base = `log_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  const data = readFileSync(join(dataDir, 'log.json'));
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${base}.json` : `${base}_${n}.json`;
    try { const fd = openSync(join(dir, name), 'wx'); writeSync(fd, data); closeSync(fd); return name; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), arg = (f, d) => { const i = args.indexOf(f); return i >= 0 ? resolve(args[i + 1]) : d; };
  const dataDir = arg('--data', join(ROOT, 'data'));
  const rawPath = arg('--raw', resolve(ROOT, '..', 'data_raw.json'));
  const logPath = join(dataDir, 'log.json'), modelPath = join(dataDir, 'model.json');
  if (!existsSync(logPath)) { console.error('ERROR: no existe', logPath); process.exit(1); }
  const log = JSON.parse(readFileSync(logPath, 'utf8'));
  const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
  const ts = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 19) + '-03:00';
  const r = mergeHistory(log, raw.informes, ts);
  if (r.added.length || r.completed.length) {
    const b = backup(dataDir);
    writeFileSync(logPath, JSON.stringify({ ...r.doc, rev: log.rev + 1 }, null, 2) + '\n');
    console.log(`Log: +${r.added.length} labs (${r.added.join(', ')}), completados ${r.completed.length} (${r.completed.join(', ')}). Backup: ${b}`);
  } else console.log('Log: nada que agregar (ya estaba completo).');
  const model = JSON.parse(readFileSync(modelPath, 'utf8'));
  if (!model.objetivos) {
    writeFileSync(modelPath, JSON.stringify({ ...model, objetivos: DEFAULT_OBJETIVOS }, null, 2) + '\n');
    console.log('model.json: objetivos agregados.');
  } else console.log('model.json: ya tenía objetivos.');
}
