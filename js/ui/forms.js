// Formularios de alta/edición de entradas del log (en modal). Validan con validateEntry antes de guardar.
import { buildForm, openModal, closeModal, h, esc, label } from './common.js';
import { validateEntry, ESTERES, ESTADOS, SITIOS, PROFUNDIDADES, nowIso } from '../store/entries.js';
import { ESTER_CONC } from '../engine/pk.js';
import * as st from '../state.js';

const opt = (list, empty) => (empty ? [['', empty]] : []).concat(list.map(x => [x, label(x)]));
const FARMACOS = ['anastrozol', 'tamoxifeno', 'cabergolina', 'rosuvastatina', 'clomifeno', 'hcg', 'otro'];
const r3 = x => Math.round(x * 1000) / 1000;
const TITLES = { dosis_t: 'Dosis de testosterona', farmaco: 'Fármaco', esquema: 'Cambio de esquema', sintoma: 'Síntoma / nota', lab: 'Laboratorio' };

const FIELDS = {
  dosis_t: [
    { k: 'at', label: 'Fecha y hora real de aplicación', type: 'datetime' },
    { k: 'ester', label: 'Éster', type: 'select', options: opt(ESTERES) },
    { k: 'mg', label: 'mg', type: 'number', step: 0.5 },
    { k: 'ml', label: 'ml', type: 'number', step: 0.005 },
    { k: 'sitio', label: 'Sitio', type: 'select', options: opt(SITIOS, 'sin especificar') },
    { k: 'profundidad', label: 'Profundidad', type: 'select', options: opt(PROFUNDIDADES, 'sin especificar') },
    { k: 'estado', label: 'Estado', type: 'select', options: opt(ESTADOS) },
    { k: 'nota', label: 'Nota', type: 'textarea', wide: true },
  ],
  farmaco: [
    { k: 'farmaco', label: 'Fármaco', type: 'select', options: opt(FARMACOS) },
    { k: 'farmacoOtro', label: 'Nombre', type: 'text', show: v => v.farmaco === 'otro' },
    { k: 'mg', label: 'mg por toma / por día', type: 'number', step: 0.05 },
    { k: 'modo', label: 'Modo', type: 'select', options: [['toma', 'toma puntual'], ['continuo', 'tratamiento diario continuo']] },
    { k: 'at', label: 'Fecha y hora de la toma', type: 'datetime', show: v => v.modo === 'toma' },
    { k: 'estado', label: 'Estado', type: 'select', options: opt(ESTADOS), show: v => v.modo === 'toma' },
    { k: 'desde', label: 'Desde', type: 'datetime', show: v => v.modo === 'continuo' },
    { k: 'hasta', label: 'Hasta (vacío = sigue)', type: 'datetime', show: v => v.modo === 'continuo' },
    { k: 'nota', label: 'Nota', type: 'textarea', wide: true },
  ],
  esquema: [
    { k: 'desde', label: 'Rige desde (corta al esquema anterior)', type: 'datetime' },
    { k: 'primeraAplicacion', label: '1ra aplicación (vacío = desde que rige)', type: 'datetime' },
    { k: 'ester', label: 'Éster', type: 'select', options: opt(ESTERES) },
    { k: 'mg', label: 'mg por aplicación', type: 'number', step: 0.5 },
    { k: 'intervaloDias', label: 'Cada N días (vacío = días de la semana)', type: 'number', step: 1 },
    { k: 'hora', label: 'Hora habitual', type: 'time', show: v => !(v.intervaloDias > 0) },
    { k: 'dias', label: 'Días de aplicación', type: 'days', wide: true, show: v => !(v.intervaloDias > 0) },
    { k: 'sitio', label: 'Sitio', type: 'select', options: opt(SITIOS, 'sin especificar') },
    { k: 'profundidad', label: 'Profundidad', type: 'select', options: opt(PROFUNDIDADES, 'sin especificar') },
    { k: 'aiMg', label: 'Anastrozol acompañante (mg, vacío = no)', type: 'number', step: 0.05 },
    { k: 'aiCadaN', label: 'Anastrozol: 1 de cada N aplicaciones (vacío = por días)', type: 'number', step: 1, show: v => v.aiMg > 0 },
    { k: 'aiDias', label: 'Días del anastrozol', type: 'days', wide: true, show: v => v.aiMg > 0 && !(v.aiCadaN > 0) },
    { k: 'generaPendientes', label: 'Genera dosis pendientes (esquema vigente)', type: 'checkbox' },
    { k: 'motivo', label: 'Motivo del cambio', type: 'textarea', wide: true },
  ],
  sintoma: [
    { k: 'at', label: 'Fecha y hora', type: 'datetime' },
    { k: 'intensidad', label: 'Intensidad', type: 'select', options: [['', '—'], ['1', '1 leve'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5 fuerte']] },
    { k: 'texto', label: 'Qué notaste', type: 'textarea', wide: true },
  ],
  lab: [
    { k: 'at', label: 'Fecha y hora de extracción', type: 'datetime' },
    { k: 't_total', label: 'T total (ng/dl)', type: 'number', step: 1 },
    { k: 'shbg', label: 'SHBG (nmol/l)', type: 'number', step: 0.1 },
    { k: 't_libre_directa', label: 'T libre directa (pg/ml)', type: 'number', step: 0.1 },
    { k: 'e2', label: 'Estradiol (pg/ml)', type: 'number', step: 0.1 },
    { k: 't_biodisponible', label: 'T biodisponible (ng/dl)', type: 'number', step: 0.1 },
    { k: 'lh', label: 'LH (mUI/ml)', type: 'number', step: 0.01 },
    { k: 'fsh', label: 'FSH (mUI/ml)', type: 'number', step: 0.01 },
    { k: 'prolactina', label: 'Prolactina (ng/ml)', type: 'number', step: 0.1 },
    { k: 'hematocrito', label: 'Hematocrito (%)', type: 'number', step: 0.1 },
    { k: 'dhea_s', label: 'DHEA-S (µg/dl)', type: 'number', step: 0.1 },
    { k: 'ldl', label: 'LDL (mg/dl)', type: 'number', step: 1 },
    { k: 'hdl', label: 'HDL (mg/dl)', type: 'number', step: 1 },
    { k: 'tg', label: 'Triglicéridos (mg/dl)', type: 'number', step: 1 },
    { k: 'apob', label: 'ApoB (mg/dl)', type: 'number', step: 1 },
    { k: 'lpa', label: 'Lp(a) (mg/dl)', type: 'number', step: 0.1 },
    { k: 'got', label: 'GOT (U/l)', type: 'number', step: 1 },
    { k: 'gpt', label: 'GPT (U/l)', type: 'number', step: 1 },
    { k: 'ggt', label: 'GGT (U/l)', type: 'number', step: 1 },
    { k: 'cpk_mb', label: 'CPK-MB (U/l)', type: 'number', step: 0.1 },
    { k: 'hemoglobina', label: 'Hemoglobina (g/dl)', type: 'number', step: 0.1 },
    { k: 'psa', label: 'PSA total (ng/ml)', type: 'number', step: 0.01 },
    { k: 'glucemia', label: 'Glucemia (mg/dl)', type: 'number', step: 1 },
    { k: 'insulina', label: 'Insulina (µU/ml)', type: 'number', step: 0.01 },
    { k: 'hba1c', label: 'HbA1c (%)', type: 'number', step: 0.01 },
    { k: 'pcr', label: 'PCR (mg/l)', type: 'number', step: 0.01 },
    { k: 'homocisteina', label: 'Homocisteína (µmol/l)', type: 'number', step: 0.1 },
    { k: 'tsh', label: 'TSH (µUI/ml)', type: 'number', step: 0.01 },
    { k: 'vitamina_d', label: 'Vitamina D (ng/ml)', type: 'number', step: 0.1 },
    { k: 'col_total', label: 'Colesterol total (mg/dl)', type: 'number', step: 1 },
    { k: 'no_hdl', label: 'Colesterol no-HDL (mg/dl)', type: 'number', step: 1 },
    { k: 'fuente', label: 'Fuente (PDF)', type: 'text', wide: true },
    { k: 'nota', label: 'Nota (ej. horas post-dosis)', type: 'textarea', wide: true },
  ],
};
const FORM_LAB_KEYS = FIELDS.lab.map(f => f.k).filter(k => !['at', 'fuente', 'nota'].includes(k));

// Entrada → valores del formulario
function toValues(tipo, e) {
  if (tipo === 'farmaco') return { ...e, farmaco: FARMACOS.includes(e.farmaco) ? e.farmaco : 'otro', farmacoOtro: FARMACOS.includes(e.farmaco) ? '' : e.farmaco };
  if (tipo === 'esquema') { const ai = (e.acompanantes || []).find(a => a.farmaco === 'anastrozol'); return { ...e, aiMg: ai?.mg ?? null, aiDias: ai?.dias ?? [], aiCadaN: ai?.cadaN ?? null }; }
  if (tipo === 'lab') return { ...e, ...(e.valores || {}) };
  if (tipo === 'sintoma') return { ...e, intensidad: e.intensidad == null ? '' : String(e.intensidad) };
  return e;
}

// Valores del formulario → datos de la entrada
function toData(tipo, v, orig) {
  const n = x => (x === '' || x == null ? null : x);
  switch (tipo) {
    case 'dosis_t':
      return { at: v.at, ester: v.ester, mg: v.mg, ml: v.ml, concMgMl: ESTER_CONC[v.ester], sitio: n(v.sitio),
        profundidad: n(v.profundidad), estado: v.estado, nota: v.nota || '', slot: orig.slot ?? null, esquemaId: orig.esquemaId ?? null };
    case 'farmaco': {
      const base = { farmaco: v.farmaco === 'otro' ? (v.farmacoOtro || '').trim() : v.farmaco, mg: v.mg, modo: v.modo, nota: v.nota || '' };
      return v.modo === 'toma'
        ? { ...base, at: v.at, estado: v.estado, slot: orig.slot ?? null }
        : { ...base, desde: v.desde, hasta: v.hasta ?? null };
    }
    case 'esquema':
      return { desde: v.desde, primeraAplicacion: v.primeraAplicacion || null, ester: v.ester, mg: v.mg, concMgMl: ESTER_CONC[v.ester],
        dias: v.intervaloDias > 0 ? null : v.dias, hora: v.intervaloDias > 0 ? null : v.hora, intervaloDias: v.intervaloDias > 0 ? v.intervaloDias : null,
        sitio: n(v.sitio), profundidad: n(v.profundidad), generaPendientes: !!v.generaPendientes,
        acompanantes: v.aiMg > 0 ? [v.aiCadaN > 0 ? { farmaco: 'anastrozol', mg: v.aiMg, cadaN: v.aiCadaN } : { farmaco: 'anastrozol', mg: v.aiMg, dias: v.aiDias || [] }] : [],
        motivo: v.motivo || '' };
    case 'sintoma':
      return { at: v.at, texto: v.texto || '', intensidad: v.intensidad ? Number(v.intensidad) : null };
    case 'lab': {
      // Parte de los valores existentes: los que no tienen campo en el formulario (ej. macroprolactina) se conservan.
      const valores = { ...(orig.valores || {}) };
      for (const k of FORM_LAB_KEYS) { if (typeof v[k] === 'number') valores[k] = v[k]; else delete valores[k]; }
      return { at: v.at, valores, fuente: v.fuente || '', nota: v.nota || '', prediccion: orig.prediccion ?? null };
    }
  }
}

// original: entrada existente (edición) o valores iniciales (alta). title opcional.
export function openEntryForm(tipo, original = {}, title) {
  const editing = !!original.id;
  const values = toValues(tipo, { ...defaults(tipo), ...original });
  const link = (k, vals, set) => {
    if (tipo !== 'dosis_t') return;
    const conc = ESTER_CONC[vals.ester];
    if ((k === 'mg' || k === 'ester') && vals.mg != null) set('ml', r3(vals.mg / conc));
    if (k === 'ml' && vals.ml != null) set('mg', Math.round(vals.ml * conc * 100) / 100);
  };
  const { form, readIso } = buildForm(FIELDS[tipo], values, link);
  const errs = h('<div class="form-errors"></div>');
  const btns = h(`<div class="btn-row"><button type="submit" class="btn primary">${editing ? 'Guardar cambios' : 'Guardar'}</button>
    <button type="button" class="btn skip" data-cancel>Cancelar</button>
    ${editing ? '<button type="button" class="btn danger" data-del style="margin-left:auto">Eliminar</button>' : ''}</div>`);
  if (editing && tipo === 'lab' && original.prediccion) {
    const p = original.prediccion;
    form.appendChild(h(`<div class="info-box small">Predicción congelada al cargar este lab (modelo ${esc(p.modelVersion)}): T ${p.t_total} ng/dl, E2 ${p.e2} pg/ml. No se modifica al editar.</div>`));
  }
  form.appendChild(errs);
  form.appendChild(btns);
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    let data;
    try { data = toData(tipo, readIso(), original); } catch (e) { errs.textContent = e.message; return; }
    const problems = validateEntry({ tipo, ...data });
    if (problems.length) { errs.innerHTML = problems.map(esc).join('<br>'); return; }
    const hrsAhead = data.at && data.estado === 'confirmada' ? (Date.parse(data.at) - Date.now()) / 3600000 : 0;
    if (hrsAhead > 1 && !confirm(`La hora de la aplicación es ${Math.round(hrsAhead)} hs en el futuro. ¿Registrarla igual como confirmada?`)) return;
    try {
      if (editing) await st.update(original.id, data); else await st.create({ tipo, ...data });
      closeModal();
    } catch (e) { errs.textContent = 'No se guardó: ' + e.message; }
  });
  btns.querySelector('[data-cancel]').addEventListener('click', closeModal);
  btns.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!confirm(`¿Eliminar ${original.id}? Queda en el backup automático, pero sale del log.`)) return;
    try { await st.remove(original.id); closeModal(); } catch (e) { errs.textContent = 'No se eliminó: ' + e.message; }
  });
  openModal((editing ? `Editar ${original.id} — ` : 'Nuevo: ') + (title || TITLES[tipo]), form);
}

function defaults(tipo) {
  const now = nowIso();
  switch (tipo) {
    case 'dosis_t': return { at: now, ester: 'cipionato', mg: 16, ml: 0.08, estado: 'confirmada', profundidad: 'subq_superficial' };
    case 'farmaco': return { farmaco: 'anastrozol', mg: 0.25, modo: 'toma', at: now, estado: 'confirmada', desde: now };
    case 'esquema': return { desde: now, ester: 'cipionato', mg: 16, hora: '01:30', dias: [0, 2, 4], generaPendientes: true,
      profundidad: 'subq_superficial', aiDias: [4] };
    case 'sintoma': return { at: now };
    case 'lab': return { at: now };
    default: return {};
  }
}
