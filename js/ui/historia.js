// Pestaña Historia: todos los labs desde 2018 (antes, durante y después de los ciclos de AAS y del TRT),
// un parámetro a la vez con su rango de referencia, más la tabla completa.
import { dayFromIso } from '../engine/time.js';
import { objetivosOf } from '../engine/objetivos.js';
import { h, esc, fmt, fmtIso, refPlugin, tooltipStyle, valueAxis, expandButton, C } from './common.js';
import { nowDay } from '../engine/time.js';
import { mountLipidChart } from './lipidchart.js';
import * as st from '../state.js';

// ref: [piso, techo] del laboratorio (null = sin límite de ese lado). Rangos DIM salvo aclaración.
// ref: [piso, techo] del laboratorio (null = sin límite). g = grupo del selector.
export const PARAMS = {
  t_total: { g: 'Hormonas', label: 'Testosterona total', unit: 'ng/dl', ref: [241, 827], obj: o => o.t.objetivo },
  e2: { g: 'Hormonas', label: 'Estradiol', unit: 'pg/ml', ref: [null, 40], obj: o => o.e2.objetivo },
  t_libre_directa: { g: 'Hormonas', label: 'T libre directa', unit: 'pg/ml', ref: [50, 220] },
  t_biodisponible: { g: 'Hormonas', label: 'T biodisponible', unit: 'ng/dl', ref: [120, 480] },
  shbg: { g: 'Hormonas', label: 'SHBG', unit: 'nmol/l', ref: [18.3, 54.1] },
  lh: { g: 'Hormonas', label: 'LH', unit: 'mUI/ml', ref: [1.7, 8.6] },
  fsh: { g: 'Hormonas', label: 'FSH', unit: 'mUI/ml', ref: [1.5, 12.4] },
  prolactina: { g: 'Hormonas', label: 'Prolactina', unit: 'ng/ml', ref: [4.04, 15.2] },
  dhea_s: { g: 'Hormonas', label: 'DHEA-S', unit: 'µg/dl', ref: [null, null] },
  cortisol: { g: 'Hormonas', label: 'Cortisol matinal', unit: 'µg/dl', ref: [4.82, 19.5] },
  tsh: { g: 'Hormonas', label: 'TSH', unit: 'µUI/ml', ref: [0.27, 4.2] },
  t4_libre: { g: 'Hormonas', label: 'T4 libre', unit: 'ng/dl', ref: [0.93, 1.7] },
  ldl: { g: 'Cardiovascular', label: 'LDL', unit: 'mg/dl', ref: [null, 116] },
  apob: { g: 'Cardiovascular', label: 'ApoB', unit: 'mg/dl', ref: [null, 100] },
  lpa: { g: 'Cardiovascular', label: 'Lipoproteína(a)', unit: 'mg/dl', ref: [null, 30] },
  no_hdl: { g: 'Cardiovascular', label: 'Colesterol no-HDL', unit: 'mg/dl', ref: [null, 130] },
  hdl: { g: 'Cardiovascular', label: 'HDL', unit: 'mg/dl', ref: [40, null] },
  tg: { g: 'Cardiovascular', label: 'Triglicéridos', unit: 'mg/dl', ref: [null, 150] },
  col_total: { g: 'Cardiovascular', label: 'Colesterol total', unit: 'mg/dl', ref: [null, 200] },
  homocisteina: { g: 'Cardiovascular', label: 'Homocisteína', unit: 'µmol/l', ref: [null, 15] },
  pcr: { g: 'Cardiovascular', label: 'PCR', unit: 'mg/l', ref: [null, 5] },
  fibrinogeno: { g: 'Cardiovascular', label: 'Fibrinógeno', unit: 'mg/dl', ref: [200, 400] },
  hematocrito: { g: 'Seguridad TRT / estatina', label: 'Hematocrito', unit: '%', ref: [40, 54] },
  hemoglobina: { g: 'Seguridad TRT / estatina', label: 'Hemoglobina', unit: 'g/dl', ref: [13.5, 18] },
  got: { g: 'Seguridad TRT / estatina', label: 'GOT (AST)', unit: 'U/l', ref: [null, 50] },
  gpt: { g: 'Seguridad TRT / estatina', label: 'GPT (ALT)', unit: 'U/l', ref: [null, 50] },
  ggt: { g: 'Seguridad TRT / estatina', label: 'GGT', unit: 'U/l', ref: [null, 60] },
  cpk_mb: { g: 'Seguridad TRT / estatina', label: 'CPK-MB', unit: 'U/l', ref: [null, 25] },
  creatinina: { g: 'Seguridad TRT / estatina', label: 'Creatinina', unit: 'mg/dl', ref: [0.7, 1.2] },
  psa: { g: 'Seguridad TRT / estatina', label: 'PSA total', unit: 'ng/ml', ref: [null, 4] },
  glucemia: { g: 'Metabólico', label: 'Glucemia', unit: 'mg/dl', ref: [70, 100] },
  insulina: { g: 'Metabólico', label: 'Insulina', unit: 'µU/ml', ref: [2.6, 24.9] },
  homa: { g: 'Metabólico', label: 'HOMA-IR', unit: '', ref: [null, 2.5] },
  hba1c: { g: 'Metabólico', label: 'HbA1c', unit: '%', ref: [4.5, 5.7] },
  vitamina_d: { g: 'Metabólico', label: 'Vitamina D', unit: 'ng/ml', ref: [30, 100] },
};
const TABLE_COLS = ['t_total', 'e2', 'shbg', 'lh', 'prolactina', 'hematocrito', 'ldl', 'hdl', 'apob', 'lpa', 'got', 'gpt', 'glucemia'];

const yearTick = d => { const dt = new Date(Date.parse('2026-06-17T00:00:00-03:00') + d * 86400000); return `${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${String(dt.getUTCFullYear()).slice(2)}`; };

export function initHistoria(root) {
  root.innerHTML = '';
  const ui = h(`<div>
    <div class="field-row" style="margin-top:14px">
      <div class="field"><label for="hParam">Parámetro</label><select id="hParam">${[...new Set(Object.values(PARAMS).map(p => p.g))].map(g => `<optgroup label="${g}">${Object.entries(PARAMS).filter(([, p]) => p.g === g).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}</optgroup>`).join('')}</select></div>
    </div>
    <div class="chart-head"><h2 data-title></h2><span data-exp></span></div>
    <div class="chart-box" data-box><canvas></canvas></div>
    <div class="legend-note">Eje de tiempo real. Líneas verticales: eventos del log (inicio TRT, cambios de éster, fármacos continuos). 2018-2024: ciclos de AAS ~1 por año (fechas exactas no registradas) — explican el HDL en 23-25 y la T suprimida de 2019.</div>
    <h2>Lípidos y estatina</h2>
    <div data-lipids></div>
    <h2>Todos los laboratorios</h2>
    <div class="scroll-table"><table data-table></table></div>
  </div>`);
  root.appendChild(ui);
  let chart = null;
  ui.querySelector('[data-exp]').appendChild(expandButton(ui.querySelector('[data-box]'), () => chart));
  ui.querySelector('#hParam').addEventListener('change', render);
  const lip = mountLipidChart(ui.querySelector('[data-lipids]'), 'h');
  const renderLipids = () => lip.render(st.state, nowDay(), { from: dayFromIso('2025-01-01T00:00:00-03:00'), to: nowDay() + 90 });

  function events(entries) {
    const ev = [{ day: 0, label: 'Inicio TRT', color: C.good }];
    entries.filter(e => e.tipo === 'esquema' && e.ester === 'cipionato').slice(0, 1)
      .forEach(e => ev.push({ day: dayFromIso(e.desde), label: 'Cipionato', color: C.cipionato }));
    entries.filter(e => e.tipo === 'farmaco' && e.modo === 'continuo')
      .forEach(e => ev.push({ day: dayFromIso(e.desde), label: e.farmaco, color: C.muted }));
    return ev;
  }
  const eventsPlugin = evs => ({
    id: 'events',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
      ctx.save();
      evs.forEach((e, i) => {
        if (e.day < x.min || e.day > x.max) return;
        const xp = x.getPixelForValue(e.day);
        ctx.strokeStyle = e.color; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(xp, top); ctx.lineTo(xp, bottom); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = e.color; ctx.font = '10.5px Segoe UI, sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(e.label, xp - 3, top + 12 + (i % 3) * 12);
      });
      ctx.restore();
    },
  });

  function render() {
    const { log, model } = st.state;
    const obj = objetivosOf(model);
    const key = ui.querySelector('#hParam').value, p = PARAMS[key];
    const labs = log.entries.filter(e => e.tipo === 'lab').sort((a, b) => a.at.localeCompare(b.at));
    const pts = labs.filter(e => typeof e.valores?.[key] === 'number')
      .map(e => ({ x: dayFromIso(e.at), y: e.valores[key], info: [`${e.id} · ${fmtIso(e.at)}/${e.at.slice(2, 4)}`, `${p.label}: ${fmt(e.valores[key], 1)} ${p.unit}`, e.nota || ''] }));
    ui.querySelector('[data-title]').textContent = `${p.label} (${p.unit}) — ${pts.length} mediciones`;
    // Cortar la línea si pasan más de ~6 meses entre mediciones: unirlas sugiere datos que no existen.
    const series = pts.flatMap((q, i) => (i && q.x - pts[i - 1].x > 180 ? [{ x: (q.x + pts[i - 1].x) / 2, y: null }, q] : [q]));
    const ref = refPlugin({ low: p.ref[0], high: p.ref[1], unit: p.unit, target: p.obj ? p.obj(obj) : null,
      extra: key === 'e2' ? [{ value: obj.e2.pisoDuro, color: C.warn, label: `piso duro ${obj.e2.pisoDuro}` }] : [] });
    const maxY = Math.max(...pts.map(q => q.y), p.ref[1] || 0) * 1.12;
    const minX = pts.length ? Math.min(...pts.map(q => q.x)) - 60 : -3000;
    if (chart) chart.destroy();
    chart = new Chart(ui.querySelector('[data-box] canvas').getContext('2d'), {
      data: { datasets: [{ type: 'line', label: p.label, data: series, spanGaps: false, borderColor: C.t, backgroundColor: C.real, borderWidth: 1.5,
        pointStyle: 'star', pointRadius: 9, pointHoverRadius: 12, pointBorderColor: C.real, pointBorderWidth: 2, tension: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'nearest', intersect: false },
        scales: { x: { type: 'linear', min: minX, max: Math.max(dayFromIso(new Date().toISOString()), ...pts.map(q => q.x)) + 30,
          ticks: { color: C.muted, maxTicksLimit: 14, callback: yearTick }, grid: { color: C.grid } }, y: valueAxis(p.unit, maxY) },
        plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { title: () => '', label: c => c.raw?.info || '' } } },
      },
      plugins: [ref, eventsPlugin(events(log.entries))],
    });
    renderTable(labs);
    renderLipids();
  }

  function renderTable(labs) {
    const cell = (e, k) => {
      const v = e.valores?.[k];
      if (typeof v !== 'number') return '<td class="num muted">—</td>';
      const [lo, hi] = PARAMS[k].ref;
      const out = (hi != null && v > hi) || (lo != null && v < lo);
      return `<td class="num" style="${out ? 'color:var(--bad);font-weight:700' : ''}">${fmt(v, v < 10 ? 2 : v < 100 ? 1 : 0)}</td>`;
    };
    ui.querySelector('[data-table]').innerHTML = `<thead><tr><th>Fecha</th><th>Lab</th>${TABLE_COLS.map(k => `<th class="num">${PARAMS[k].label}</th>`).join('')}</tr></thead><tbody>` +
      labs.slice().reverse().map(e => `<tr><td style="white-space:nowrap">${fmtIso(e.at).slice(0, 5)}/${e.at.slice(0, 4)}</td><td><code>${e.id}</code></td>${TABLE_COLS.map(k => cell(e, k)).join('')}</tr>`).join('') + '</tbody>';
  }

  st.subscribe(() => { if (!root.hidden) render(); else root.dataset.stale = '1'; });
  root.addEventListener('tab:show', () => { delete root.dataset.stale; render(); });
}
