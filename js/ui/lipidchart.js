// Gráfico de lípidos compartido (Curva real + Historia): valores reales + proyección con la estatina del log +
// metas del laboratorio y ESC riesgo muy alto (a confirmar con el cardiólogo del perfil privado).
import { projectLipids, predictLipidsAt, statinPeriods } from '../engine/lipids.js';
import { objetivosOf, perfilOf } from '../engine/objetivos.js';
import { activeVersion } from '../engine/calibration.js';
import { dayFromIso } from '../engine/time.js';
import { h, fmt, fmtIso, fmtDay, kpi, refPlugin, nowLinePlugin, tooltipStyle, valueAxis, C } from './common.js';

export const LIPIDS = {
  ldl: { label: 'LDL', unit: 'mg/dl', ref: [null, 116] },
  apob: { label: 'ApoB', unit: 'mg/dl', ref: [null, 100] },
  no_hdl: { label: 'Colesterol no-HDL', unit: 'mg/dl', ref: [null, 130] },
  hdl: { label: 'HDL', unit: 'mg/dl', ref: [40, null] },
  tg: { label: 'Triglicéridos', unit: 'mg/dl', ref: [null, 150] },
};
const monthTick = d => { const dt = new Date(Date.parse('2026-06-17T00:00:00-03:00') + d * 86400000); return `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${String(dt.getUTCFullYear()).slice(2)}`; };
const breakGaps = pts => pts.flatMap((q, i) => (i && q.x - pts[i - 1].x > 180 ? [{ x: (q.x + pts[i - 1].x) / 2, y: null }, q] : [q]));

// Monta el bloque (selector + KPIs + gráfico + nota) dentro de `root`. Devuelve render(state, now, {from, to}).
export function mountLipidChart(root, idPrefix) {
  const ui = h(`<div>
    <div class="field-row"><div class="field"><label for="${idPrefix}Lip">Lípido</label><select id="${idPrefix}Lip">
      ${Object.entries(LIPIDS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}</select></div></div>
    <div class="callouts" data-k></div>
    <div class="chart-box small" data-box><canvas></canvas></div>
    <div class="legend-note" data-note></div></div>`);
  root.appendChild(ui);
  let chart = null, lastArgs = null;
  ui.querySelector('select').addEventListener('change', () => lastArgs && render(...lastArgs));

  function render(state, now, win) {
    lastArgs = [state, now, win];
    const { log, model } = state, obj = objetivosOf(model), factor = activeVersion(model).params.estatinaFactor ?? 1;
    const key = ui.querySelector('select').value, p = LIPIDS[key];
    const periods = statinPeriods(log.entries);
    const from = win.from, to = win.to;
    const proj = periods.length ? (projectLipids(log.entries, Math.max(periods.at(-1).start, from), to, 1, factor).series[key] || []) : [];
    const real = log.entries.filter(e => e.tipo === 'lab' && typeof e.valores?.[key] === 'number' && dayFromIso(e.at) >= from - 400)
      .map(e => ({ x: dayFromIso(e.at), y: e.valores[key], info: [`${e.id} · ${fmtIso(e.at)}/${e.at.slice(2, 4)}`, `${p.label}: ${fmt(e.valores[key])} ${p.unit}`] }))
      .sort((a, b) => a.x - b.x);
    const statinMarks = periods.map(s => ({ x: s.start, y: valueAt(proj, s.start) ?? real.at(-1)?.y, info: [`Rosuvastatina ${s.mg} mg desde ${fmtDay(s.start)}`] }));
    const metaLab = obj.lipidos.laboratorio[key], metaEsc = obj.lipidos.escMuyAlto[key];
    const extra = metaEsc ? [{ value: metaEsc, color: '#9b6bd6', label: `meta ESC riesgo muy alto ${metaEsc} (a confirmar con ${perfilOf(model).cardiologo})` }] : [];
    chart?.destroy();
    chart = new Chart(ui.querySelector('canvas').getContext('2d'), {
      data: { datasets: [
        { type: 'line', label: `${p.label} real`, data: breakGaps(real), spanGaps: false, borderColor: C.t, backgroundColor: C.real, pointStyle: 'star',
          pointRadius: 9, pointBorderColor: C.real, pointBorderWidth: 2, borderWidth: 1.2, tension: 0 },
        { type: 'line', label: 'Proyección con estatina (poblacional)', data: proj, borderColor: C.good, borderDash: [6, 4], borderWidth: 2, pointRadius: 0 },
        { type: 'scatter', label: 'Inicio estatina', data: statinMarks, pointStyle: 'rectRot', pointRadius: 8, backgroundColor: C.good, borderColor: C.good },
      ] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'nearest', intersect: false },
        scales: { x: { type: 'linear', min: from, max: to, ticks: { color: C.muted, maxTicksLimit: 12, callback: monthTick }, grid: { color: C.grid } },
          y: valueAxis(p.unit, Math.max(...real.map(q => q.y), metaLab || 0) * 1.15) },
        plugins: { legend: { position: 'bottom', labels: { color: C.muted, boxWidth: 10, font: { size: 10.5 } } },
          tooltip: { ...tooltipStyle, callbacks: { title: it => it.length ? fmtDay(it[0].parsed.x) : '', label: c => c.raw?.info || `${c.dataset.label}: ${fmt(c.parsed.y)}` } } } },
      plugins: [refPlugin({ low: p.ref[0], high: metaLab ?? p.ref[1], unit: p.unit, extra }), nowLinePlugin(() => now)],
    });
    const at = w => predictLipidsAt(log.entries, now + 7 * w, factor)[key];
    const col = v => metaEsc && v <= metaEsc ? C.good : metaLab != null && v <= metaLab ? C.warn : C.bad;
    ui.querySelector('[data-k]').innerHTML = periods.length
      ? [0, 4, 8].map(w => { const v = at(w); return v == null ? '' : kpi(w ? `En ${w} semanas` : 'Estimado hoy', `${fmt(v)} ${p.unit}`,
        key === 'hdl' || key === 'tg' ? C.text : col(v), w ? fmtDay(now + 7 * w) : 'proyección, no medición'); }).join('')
      : kpi('Sin estatina en el log', '—', C.muted, 'cargala como tratamiento continuo');
    ui.querySelector('[data-note]').innerHTML = `Proyección desde tu último valor sin estatina con el efecto poblacional de rosuvastatina ${periods.at(-1)?.mg ?? 20} mg (STELLAR: LDL −52%; se usa −50%, ApoB −40%, HDL +8%), pleno a las ~3 semanas; si la suspendés, el modelo la hace volver. Metas: laboratorio (roja) y ESC 2019 riesgo muy alto por placa en imagen (violeta, <i>a confirmar con ${perfilOf(model).cardiologo}</i>). El primer lab con estatina mide tu respuesta real.`;
  }
  return { render, chart: () => chart };
}

function valueAt(series, x) {
  const p = series.find(q => q.x >= x);
  return p ? p.y : null;
}
