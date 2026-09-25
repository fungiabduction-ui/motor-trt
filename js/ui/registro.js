// Pestaña Registro: próxima dosis (confirmar / saltear), vencidas, altas rápidas y tabla del log.
import { buildTimeline } from '../engine/projection.js';
import { nowDay, isoFromDay, dayFromIso } from '../engine/time.js';
import { nowIso } from '../store/entries.js';
import { ESTER_CONC } from '../engine/pk.js';
import { h, esc, fmt, fmtDay, fmtIso, label, WEEKDAYS } from './common.js';
import { openEntryForm } from './forms.js';
import * as st from '../state.js';

const TIPO_TXT = { dosis_t: 'Dosis T', farmaco: 'Fármaco', esquema: 'Esquema', sintoma: 'Síntoma', lab: 'Lab' };
const r3 = x => Math.round(x * 1000) / 1000;

export function describeEntry(e) {
  switch (e.tipo) {
    case 'dosis_t':
      return `${label(e.ester)} ${fmt(e.mg, 1)} mg (${e.ml ?? r3(e.mg / ESTER_CONC[e.ester])} ml)` +
        (e.sitio ? ` · ${label(e.sitio)}` : '') + (e.profundidad ? ` · ${label(e.profundidad)}` : '');
    case 'farmaco':
      return e.modo === 'continuo'
        ? `${e.farmaco} ${fmt(e.mg, 2)} mg/día · desde ${fmtIso(e.desde).slice(0, 5)}${e.hasta ? ' hasta ' + fmtIso(e.hasta).slice(0, 5) : ''}`
        : `${e.farmaco} ${fmt(e.mg, 2)} mg`;
    case 'esquema': {
      const cuando = e.dias ? e.dias.map(d => WEEKDAYS[d]).join('-') + (e.hora ? ` ${e.hora}` : '')
        : e.intervaloDias && e.generaPendientes ? `cada ${fmt(e.intervaloDias)} días desde ${fmtIso(e.desde)}`
        : e.intervaloDias ? `cada ${fmt(e.intervaloDias, 2)} días` : 'única';
      const ai = (e.acompanantes || []).map(a => ` + ${a.farmaco} ${a.mg}mg (${a.cadaN ? `1 de cada ${a.cadaN} aplicaciones` : (a.dias || []).map(d => WEEKDAYS[d]).join('-')})`).join('');
      return `${label(e.ester)} ${fmt(e.mg, 1)} mg · ${cuando}${ai}${e.generaPendientes ? ' · <b>genera pendientes</b>' : ''}`;
    }
    case 'sintoma':
      return esc(e.texto) + (e.intensidad ? ` (intensidad ${e.intensidad}/5)` : '');
    case 'lab': {
      const v = e.valores || {};
      const parts = [['T', v.t_total, 'ng/dl'], ['SHBG', v.shbg, ''], ['T libre', v.t_libre_directa, 'pg/ml'], ['E2', v.e2, 'pg/ml'],
        ['LH', v.lh, ''], ['FSH', v.fsh, ''], ['PRL', v.prolactina, ''], ['Hto', v.hematocrito, '%'], ['LDL', v.ldl, ''], ['HDL', v.hdl, ''],
        ['TG', v.tg, ''], ['ApoB', v.apob, ''], ['Lp(a)', v.lpa, '']].filter(p => typeof p[1] === 'number').map(p => `${p[0]} ${fmt(p[1], 1)} ${p[2]}`);
      const pred = e.prediccion ? ` · predicho ${e.prediccion.modelVersion}: T ${fmt(e.prediccion.t_total)}` : '';
      return parts.join(' · ') + pred;
    }
  }
  return '';
}
export const entryWhen = e => e.at || e.desde;

export function initRegistro(root) {
  const filters = { tipo: '', q: '' };
  root.innerHTML = '';
  const top = h('<div></div>');
  const quick = h(`<div>
    <h2>Registrar</h2>
    <div class="btn-row">
      <button class="btn" data-new="dosis_t">+ Dosis T (fuera de esquema)</button>
      <button class="btn" data-new="farmaco">+ Fármaco</button>
      <button class="btn" data-new="sintoma">+ Síntoma / nota</button>
      <button class="btn" data-new="esquema">+ Cambio de esquema</button>
      <button class="btn" data-new="lab">+ Lab</button>
    </div></div>`);
  quick.addEventListener('click', ev => { const b = ev.target.closest('[data-new]'); if (b) openEntryForm(b.dataset.new); });
  const logBox = h(`<div>
    <h2>Log completo</h2>
    <div class="field-row">
      <div class="field"><label>Tipo</label><select data-f="tipo"><option value="">todos</option>
        ${Object.entries(TIPO_TXT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field" style="flex:1"><label>Buscar</label><input data-f="q" placeholder="texto, id, fecha (dd/mm)…"></div>
    </div>
    <div class="scroll-table"><table><thead><tr><th>Fecha</th><th>ID</th><th>Tipo</th><th>Detalle</th><th>Estado</th><th></th></tr></thead><tbody></tbody></table></div>
  </div>`);
  logBox.addEventListener('input', ev => { const f = ev.target.dataset.f; if (f) { filters[f] = ev.target.value; renderTable(); } });
  logBox.addEventListener('click', ev => {
    const b = ev.target.closest('[data-edit]');
    if (b) { const e = st.state.log.entries.find(x => x.id === b.dataset.edit); if (e) openEntryForm(e.tipo, e); }
  });
  root.append(top, quick, logBox);

  function renderTable() {
    const q = filters.q.trim().toLowerCase();
    const rows = st.state.log.entries
      .filter(e => !filters.tipo || e.tipo === filters.tipo)
      .map(e => ({ e, when: entryWhen(e), txt: describeEntry(e) }))
      .filter(r => !q || `${r.e.id} ${r.txt} ${fmtIso(r.when)} ${r.e.nota || ''} ${r.e.motivo || ''}`.toLowerCase().includes(q))
      .sort((a, b) => dayFromIso(b.when) - dayFromIso(a.when) || b.e.id.localeCompare(a.e.id));
    logBox.querySelector('tbody').innerHTML = rows.map(({ e, when, txt }) => {
      const estado = e.estado ? `<span class="tag ${e.estado}">${e.estado}</span>` : '';
      const extra = e.nota || e.motivo ? `<div class="muted small">${esc(e.nota || e.motivo)}</div>` : '';
      return `<tr><td style="white-space:nowrap">${fmtIso(when)}${e.tipo === 'farmaco' && e.modo === 'continuo' ? '' : ` <span class="muted small">${WEEKDAYS[((Math.floor(dayFromIso(when)) + 2) % 7 + 7) % 7]}</span>`}</td>
        <td><code>${e.id}</code></td><td>${TIPO_TXT[e.tipo]}</td><td>${txt}${extra}</td><td>${estado}</td>
        <td><button class="btn small" data-edit="${e.id}">Editar</button></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="muted">Sin entradas con ese filtro.</td></tr>';
  }

  function slotActions(s, when) {
    if (s.kind === 'dosis_t') {
      const iso = isoFromDay(s.day);
      return {
        text: `${label(s.ester)} <b>${fmt(s.mg, 1)} mg</b> = <b>${r3(s.mg / ESTER_CONC[s.ester])} ml</b>` +
          (s.profundidad ? ` · ${label(s.profundidad)}` : '') + (s.sitio ? ` · ${label(s.sitio)}` : ''),
        confirm: () => openEntryForm('dosis_t', { at: when === 'vencida' ? iso : nowIso(), ester: s.ester, mg: s.mg,
          ml: r3(s.mg / ESTER_CONC[s.ester]), sitio: s.sitio, profundidad: s.profundidad, estado: 'confirmada', slot: iso,
          esquemaId: s.esquemaId }, 'confirmar aplicación'),
        skip: () => st.create({ tipo: 'dosis_t', at: iso, slot: iso, ester: s.ester, mg: s.mg, ml: r3(s.mg / ESTER_CONC[s.ester]),
          concMgMl: ESTER_CONC[s.ester], sitio: null, profundidad: null, estado: 'salteada', esquemaId: s.esquemaId, nota: '' }),
      };
    }
    const iso = isoFromDay(s.day);
    return {
      text: `${s.farmaco} <b>${fmt(s.mg, 3)} mg</b>` + (s.farmaco === 'anastrozol' ? ` = <b>${{ 0.25: '1/4', 0.5: '1/2', 0.75: '3/4', 1: '1' }[s.mg] || fmt(s.mg, 2)} comprimido</b> de 1 mg` : ''),
      confirm: () => openEntryForm('farmaco', { farmaco: s.farmaco, mg: s.mg, modo: 'toma', at: when === 'vencida' ? iso : nowIso(),
        estado: 'confirmada', slot: iso }, 'confirmar toma'),
      skip: () => st.create({ tipo: 'farmaco', farmaco: s.farmaco, mg: s.mg, modo: 'toma', at: iso, slot: iso, estado: 'salteada', nota: '' }),
    };
  }

  function slotRow(s, when, conBotones = true) {
    const a = slotActions(s, when);
    const row = h(`<div class="slot-row"><div>${when === 'vencida' ? `<span class="tag vencida">vencida</span> <b>${fmtDay(s.day)}</b> ${WEEKDAYS[((Math.floor(s.day) + 2) % 7 + 7) % 7]} · ` : ''}${a.text}</div>
      ${conBotones ? `<div class="btn-row"><button class="btn primary small" data-a="ok">✓ ${s.kind === 'dosis_t' ? 'Confirmar aplicación' : 'Confirmar toma'}</button>
      <button class="btn skip small" data-a="skip">⤼ Salteada</button></div>` : ''}</div>`);
    if (!conBotones) return row;
    row.querySelector('[data-a=ok]').addEventListener('click', a.confirm);
    row.querySelector('[data-a=skip]').addEventListener('click', async () => {
      if (!confirm('¿Marcar como salteada? El motor la va a tratar como NO aplicada.')) return;
      try { await a.skip(); } catch { /* el indicador de guardado ya muestra el error */ }
    });
    return row;
  }

  function renderTop() {
    const now = nowDay();
    const tl = buildTimeline(st.state.log.entries, now, now + 21);
    top.innerHTML = '';
    if (tl.vencidas.length) {
      const box = h(`<div class="warn-box"><b>⚠ ${tl.vencidas.length} pendiente(s) vencida(s) sin confirmar.</b> El motor las toma como NO aplicadas hasta que digas qué pasó.</div>`);
      tl.vencidas.forEach(s => box.appendChild(slotRow(s, 'vencida')));
      top.appendChild(box);
    }
    const next = tl.pendientes[0];
    top.appendChild(h('<h2>Próxima dosis</h2>'));
    if (!next) {
      top.appendChild(h('<div class="info-box">No hay un esquema vigente que genere dosis pendientes. Creá uno con "+ Cambio de esquema".</div>'));
    } else {
      const group = tl.pendientes.filter(s => Math.abs(s.day - next.day) < 1e-6);
      const hrs = (next.day - now) * 24;
      const falta = hrs < 1 ? `en ${fmt(hrs * 60)} min` : hrs < 48 ? `en ${fmt(hrs, 1)} hs` : `en ${fmt(hrs / 24, 1)} días`;
      // Verde solo el día calendario (hora local) en que toca la aplicación; el resto de los días, rojo con letras amarillas.
      const hoy = isoFromDay(next.day).slice(0, 10) === isoFromDay(now).slice(0, 10);
      const card = h(`<div class="card next-dose dose-card ${hoy ? 'hoy' : 'no-hoy'}">
        <div class="dose-flag">${hoy ? '✅ HOY TOCA APLICACIÓN' : '⛔ HOY NO TOCA APLICACIÓN'}</div>
        <div class="when">${hoy ? '' : 'Próxima: '}${WEEKDAYS[((Math.floor(next.day) + 2) % 7 + 7) % 7]} ${fmtDay(next.day)} <span class="small">(${falta})</span></div>
        <div class="small" style="opacity:.8">Esquema ${next.esquemaId}</div></div>`);
      group.forEach(s => card.appendChild(slotRow(s, 'pendiente', hoy))); // botones solo el día que toca
      top.appendChild(card);
      const later = tl.pendientes.filter(s => s.kind === 'dosis_t' && s.day > next.day + 1e-6).slice(0, 5);
      if (later.length) top.appendChild(h(`<div class="legend-note">Después: ${later.map(s => `${WEEKDAYS[((Math.floor(s.day) + 2) % 7 + 7) % 7]} ${fmtDay(s.day)} (${fmt(s.mg, 1)} mg)`).join(' · ')}</div>`));
    }
  }

  function render() { renderTop(); renderTable(); }
  st.subscribe(render);
  setInterval(() => { if (st.state.log) renderTop(); }, 60000); // las pendientes pasan a vencidas solas
  if (st.state.log) render();
}
