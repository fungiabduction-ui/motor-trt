// Pestaña Curva real: T y E2 reconstruidos desde el log + proyección, con cada evento marcado en el gráfico.
import { buildCurves } from '../engine/curves.js';
import { nowDay, dayFromIso } from '../engine/time.js';
import { objetivosOf } from '../engine/objetivos.js';
import { h, esc, fmt, fmtDay, fmtIso, kpi, statusOf, refPlugin, nowLinePlugin, tooltipStyle, dayAxis, valueAxis,
  expandButton, C, T_REF, E2_REF, label, tRef, e2Ref } from './common.js';
import { describeEntry } from './registro.js';
import { mountLipidChart } from './lipidchart.js';
import * as st from '../state.js';

function valueAt(days, arr, d) {
  if (d <= days[0]) return arr[0];
  const step = days[1] - days[0], i = Math.min(Math.floor((d - days[0]) / step), days.length - 2);
  const f = (d - days[i]) / step;
  return arr[i] * (1 - f) + arr[i + 1] * f;
}
const xy = (days, arr, pred) => days.map((d, i) => pred(d) ? { x: d, y: arr[i] } : null).filter(Boolean);
const line = (lbl, data, color, extra = {}) => ({ type: 'line', label: lbl, data, borderColor: color, backgroundColor: color,
  borderWidth: 2, pointRadius: 0, tension: 0.15, ...extra });
const marks = (lbl, points, style, color, extra = {}) => ({ type: 'scatter', label: lbl, data: points, pointStyle: style,
  pointRadius: 6, pointHoverRadius: 9, borderColor: color, backgroundColor: color, ...extra });

function tooltipLabel(ctx) {
  if (ctx.raw && ctx.raw.info) return ctx.raw.info;
  return `${ctx.dataset.label}: ${fmt(ctx.parsed.y, ctx.parsed.y < 100 ? 1 : 0)}`;
}

export function initCurva(root) {
  root.innerHTML = '';
  const ui = h(`<div>
    <div class="field-row" style="margin-top:14px">
      <div class="field"><label>Ventana</label><select data-range>
        <option value="all">Todo (desde 17/06)</option><option value="60">Últimos 60 días + proyección</option>
        <option value="30" selected>Últimos 30 días + proyección</option><option value="14">Últimos 14 días + proyección</option></select></div>
      <div class="field inline"><input type="checkbox" id="cvEster"><label for="cvEster">Mostrar aporte por éster</label></div>
    </div>
    <div class="callouts" data-kpis></div>
    <div class="chart-head"><h2>Testosterona total</h2><span data-exp-t></span></div>
    <div class="chart-box" data-box-t><canvas></canvas></div>
    <div class="legend-note">Línea sólida = reconstruida desde el log · punteada = proyección con las dosis pendientes del esquema vigente ·
      ▲ confirmada · △ tenue reconstruida · ○ pendiente · ✕ salteada/vencida · ■ síntoma · ★ lab real (tooltip: predicho vs real).</div>
    <div class="chart-head"><h2>Estradiol</h2><span data-exp-e></span></div>
    <div class="chart-box small" data-box-e><canvas></canvas></div>
    <div class="legend-note">E2 = tu proporción personal × T (±8%). El efecto del anastrozol es extrapolación poblacional (sin datos propios todavía). Banda verde fuerte = tu objetivo 22-30 · naranja = piso duro 20 · gris = tu E2 natural pre-TRT (2025).</div>
    <div class="chart-head"><h2>Lípidos — efecto de la rosuvastatina</h2></div>
    <div class="muted small" data-cvnote>El riesgo cardiovascular se sigue acá junto a las hormonas.</div>
    <div data-lipids></div>
    <div data-cont></div>
    <div class="info-box small" data-model></div>
  </div>`);
  root.appendChild(ui);
  let chartT = null, chartE = null, curves = null;
  const lip = mountLipidChart(ui.querySelector('[data-lipids]'), 'c');
  ui.querySelector('[data-exp-t]').appendChild(expandButton(ui.querySelector('[data-box-t]'), () => chartT));
  ui.querySelector('[data-exp-e]').appendChild(expandButton(ui.querySelector('[data-box-e]'), () => chartE));
  ui.querySelector('[data-range]').addEventListener('change', applyRange);
  ui.querySelector('#cvEster').addEventListener('change', render);

  function xMin() {
    const r = ui.querySelector('[data-range]').value;
    return r === 'all' ? 0 : Math.max(0, curves.now - Number(r));
  }
  function applyRange() {
    for (const ch of [chartT, chartE]) if (ch) { ch.options.scales.x.min = xMin(); ch.update('none'); }
  }

  function render() {
    const { log, model } = st.state;
    const now = nowDay();
    curves = buildCurves(log.entries, model, now);
    const { days, t, tE, tC, e2, e2Base, timeline: tl } = curves;
    const past = d => d <= now, fut = d => d >= now;
    const T = d => valueAt(days, t, d), E = d => valueAt(days, e2, d);
    const entries = log.entries;

    // Marcadores de T
    const dosePts = estado => entries.filter(e => e.tipo === 'dosis_t' && e.estado === estado).map(e => {
      const d = dayFromIso(e.at);
      return { x: d, y: T(d), info: [`${e.id} · ${fmtIso(e.at)} · ${estado}`, describeEntry(e).replace(/<[^>]+>/g, '')] };
    });
    const pend = tl.pendientes.filter(s => s.kind === 'dosis_t').map(s => ({ x: s.day, y: T(s.day),
      info: [`Pendiente ${fmtDay(s.day)}`, `${label(s.ester)} ${fmt(s.mg, 1)} mg (esquema ${s.esquemaId})`] }));
    const venc = tl.vencidas.filter(s => s.kind === 'dosis_t').map(s => ({ x: s.day, y: T(s.day),
      info: [`VENCIDA sin confirmar ${fmtDay(s.day)}`, 'El motor la toma como NO aplicada'] }));
    const sint = entries.filter(e => e.tipo === 'sintoma').map(e => { const d = dayFromIso(e.at);
      return { x: d, y: T(d), info: [`${e.id} · síntoma · ${fmtIso(e.at)}`, e.texto] }; });
    const labsT = entries.filter(e => e.tipo === 'lab' && typeof e.valores?.t_total === 'number' && dayFromIso(e.at) >= 0).map(e => {
      const d = dayFromIso(e.at), real = e.valores.t_total, mod = T(d);
      const info = [`${e.id} · Lab real ${fmtIso(e.at)}: ${fmt(real)} ng/dl`,
        `Modelo vigente (${curves.version}) acá: ${fmt(mod)} (${fmt(100 * (mod - real) / real, 1)}%)`];
      if (e.prediccion) info.push(`Predicción congelada (${e.prediccion.modelVersion}): ${fmt(e.prediccion.t_total)} (${fmt(100 * (e.prediccion.t_total - real) / real, 1)}%)`);
      return { x: d, y: real, info };
    });
    const showEster = ui.querySelector('#cvEster').checked;
    const dsT = [
      line('T reconstruida', xy(days, t, past), C.t),
      line('T proyectada', xy(days, t, fut), C.t, { borderDash: [6, 4], borderWidth: 1.8 }),
      line('Aporte enantato', xy(days, tE, () => true), C.enantato, { borderWidth: 1, borderDash: [2, 3], hidden: !showEster }),
      line('Aporte cipionato', xy(days, tC, () => true), C.cipionato, { borderWidth: 1, borderDash: [2, 3], hidden: !showEster }),
      marks('Dosis confirmada', dosePts('confirmada'), 'triangle', C.good),
      marks('Dosis reconstruida', dosePts('reconstruida'), 'triangle', 'rgba(57,135,229,.45)', { pointRadius: 4 }),
      marks('Dosis pendiente', pend, 'circle', 'transparent', { borderColor: C.good, borderWidth: 2 }),
      marks('Salteada', dosePts('salteada').map(p => ({ ...p, y: T(p.x) })), 'crossRot', C.muted, { borderWidth: 2 }),
      marks('Vencida', venc, 'crossRot', C.warn, { borderWidth: 3, pointRadius: 8 }),
      marks('Síntoma', sint, 'rectRounded', '#d95926', { pointRadius: 7 }),
      marks('Lab real', labsT, 'star', C.real, { pointRadius: 11, borderWidth: 2 }),
    ];

    // Estradiol
    const aiPts = entries.filter(e => e.tipo === 'farmaco' && e.farmaco === 'anastrozol' && e.modo === 'toma' && e.estado !== 'salteada')
      .map(e => { const d = dayFromIso(e.at); return { x: d, y: E(d), info: [`${e.id} · anastrozol ${e.mg} mg · ${fmtIso(e.at)}`, e.nota || ''] }; });
    const aiPend = tl.pendientes.filter(s => s.kind === 'farmaco').map(s => ({ x: s.day, y: E(s.day),
      info: [`Pendiente: ${s.farmaco} ${s.mg} mg · ${fmtDay(s.day)}`] }));
    const labsE = entries.filter(e => e.tipo === 'lab' && typeof e.valores?.e2 === 'number' && dayFromIso(e.at) >= 0).map(e => {
      const d = dayFromIso(e.at);
      return { x: d, y: e.valores.e2, info: [`${e.id} · E2 real ${fmtIso(e.at)}: ${fmt(e.valores.e2, 1)} pg/ml`, `Modelo: ${fmt(E(d), 1)}`] };
    });
    const dsE = [
      line('E2 estimado', xy(days, e2, past), C.e2),
      line('E2 proyectado', xy(days, e2, fut), C.e2, { borderDash: [6, 4], borderWidth: 1.8 }),
      line('E2 sin anastrozol (referencia)', xy(days, e2Base, () => true), C.muted, { borderWidth: 1.2, borderDash: [3, 3] }),
      marks('Anastrozol tomado', aiPts, 'rectRot', C.good, { pointRadius: 7 }),
      marks('Anastrozol pendiente', aiPend, 'rectRot', 'transparent', { borderColor: C.real, borderWidth: 2, pointRadius: 7 }),
      marks('E2 lab real', labsE, 'star', C.real, { pointRadius: 11, borderWidth: 2 }),
    ];

    const obj = objetivosOf(model);
    const maxT = Math.max(T_REF.high * 1.1, ...labsT.map(p => p.y * 1.05));
    chartT = draw(chartT, ui.querySelector('[data-box-t] canvas'), dsT, 'ng/dl', maxT, refPlugin(tRef(obj)));
    chartE = draw(chartE, ui.querySelector('[data-box-e] canvas'), dsE, 'pg/ml', E2_REF.high * 1.6, refPlugin(e2Ref(obj)));

    const riesgo = model.perfil?.riesgoCV; // dato personal: vive en data/model.json → perfil (privado)
    if (riesgo) ui.querySelector('[data-cvnote]').textContent = `El riesgo cardiovascular (${riesgo}) se sigue acá junto a las hormonas.`;
    renderKpis(now);
    lip.render(st.state, now, { from: dayFromIso('2026-06-01T00:00:00-03:00'), to: now + 90 });
    renderContinuos(entries, now);
    const mv = model.versiones.find(v => v.id === model.vigente);
    ui.querySelector('[data-model]').innerHTML = `Modelo vigente <b>${esc(mv.id)}</b> (${esc(mv.fecha)}): ${esc(mv.motivo)} Margen real ±33% — sirve para decisiones de rango, no para un número exacto.`;
  }

  function draw(chart, canvas, datasets, unit, suggestedMax, ref) {
    const end = curves.days[curves.days.length - 1];
    if (chart) {
      chart.data.datasets = datasets;
      chart.options.scales.y.suggestedMax = suggestedMax;
      chart.options.scales.x.max = end;
      chart.options.scales.x.min = xMin();
      chart.update('none');
      return chart;
    }
    return new Chart(canvas.getContext('2d'), {
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, parsing: true,
        interaction: { mode: 'nearest', intersect: false },
        scales: { x: { ...dayAxis(), min: xMin(), max: end }, y: valueAxis(unit, suggestedMax) },
        plugins: {
          legend: { position: 'bottom', labels: { color: C.muted, boxWidth: 10, font: { size: 10.5 }, usePointStyle: true } },
          tooltip: { ...tooltipStyle, callbacks: { title: items => items.length ? fmtDay(items[0].parsed.x) : '', label: tooltipLabel } },
        },
      },
      plugins: [ref, nowLinePlugin(() => curves.now)],
    });
  }

  function renderKpis(now) {
    const { days, t } = curves;
    let pk = -Infinity, pkDay = now;
    days.forEach((d, i) => { if (d > now && d <= now + 7 && t[i] > pk) { pk = t[i]; pkDay = d; } });
    const obj = objetivosOf(st.state.model);
    const tgtT = { low: obj.t.objetivo[0], high: obj.t.objetivo[1] }, tgtE = { low: obj.e2.objetivo[0], high: obj.e2.objetivo[1] };
    const inT = v => v > obj.t.techo ? statusOf(v, T_REF) : statusOf(v, tgtT);
    const sT = inT(curves.nowT), sE = statusOf(curves.nowE2, tgtE), sP = inT(pk);
    const tl = curves.timeline;
    ui.querySelector('[data-kpis]').innerHTML =
      kpi(`T estimada hoy (${fmtDay(now)})`, `${fmt(curves.nowT)} ng/dl`, sT.color, sT.text) +
      kpi('Pico T próximos 7 días', pk > -Infinity ? `${fmt(pk)} ng/dl` : '—', sP.color, pk > -Infinity ? `${fmtDay(pkDay)} · ${sP.text}` : 'sin dosis pendientes') +
      kpi('E2 estimado hoy', `${fmt(curves.nowE2, 1)} pg/ml`, sE.color, `supresión anastrozol ${fmt(curves.nowSupp * 100)}% (extrapolación)`) +
      kpi('Vencidas sin confirmar', String(tl.vencidas.length), tl.vencidas.length ? C.warn : C.good,
        tl.vencidas.length ? 'resolvelas en Registro' : 'todo al día');
  }

  function renderContinuos(entries, now) {
    const act = entries.filter(e => e.tipo === 'farmaco' && e.modo === 'continuo' && dayFromIso(e.desde) <= now && (!e.hasta || dayFromIso(e.hasta) >= now));
    ui.querySelector('[data-cont]').innerHTML = act.length
      ? `<h3>Tratamientos continuos activos (no entran al modelo de T/E2)</h3><div class="muted small">${act.map(e => `${esc(e.farmaco)} ${fmt(e.mg, 2)} mg/día desde ${fmtIso(e.desde).slice(0, 5)}`).join(' · ')}</div>` : '';
  }

  st.subscribe(() => { if (!root.hidden) render(); else root.dataset.stale = '1'; });
  root.addEventListener('tab:show', () => { if (!chartT || root.dataset.stale) { delete root.dataset.stale; render(); } else { chartT.resize(); chartE.resize(); } });
}
