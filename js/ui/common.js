// Utilidades de interfaz compartidas: formato, plugins de Chart.js, modal y constructor de formularios.
import { isoFromDay, dayFromIso } from '../engine/time.js';
import { isoFromInput, inputFromIso } from '../store/entries.js';

export const C = {
  enantato: '#3987e5', cipionato: '#d55181', t: '#3987e5', e2: '#d55181', real: '#f2c94c',
  good: '#199e70', warn: '#c98500', bad: '#e5484d', muted: '#8892b0', grid: '#2e3350', text: '#e4e8f7',
};
export const T_REF = { low: 241, high: 827, unit: 'ng/dl' };
export const E2_REF = { high: 40, unit: 'pg/ml' };
export const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export const fmt = (n, d = 0) => (n == null || !Number.isFinite(n)) ? '—'
  : Number(n).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function fmtIso(iso) { return iso ? fmtDay(dayFromIso(iso)) : '—'; }
export function fmtDay(day) { const s = isoFromDay(day); return `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}`; }
export function fmtDate(day) { const s = isoFromDay(day); return `${s.slice(8, 10)}/${s.slice(5, 7)}`; }
export function weekdayName(iso) { const wd = ((Math.floor(dayFromIso(iso)) + 2) % 7 + 7) % 7; return WEEKDAYS[wd]; }
export const label = s => String(s ?? '').replace(/_/g, ' ');

export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
export function kpi(lbl, val, color, sub) {
  return `<div class="card kpi" style="border-top:3px solid ${color}"><div class="lbl">${lbl}</div>` +
    `<div class="val" style="color:${color}">${val}</div>${sub ? `<div class="sub2">${sub}</div>` : ''}</div>`;
}
export function statusOf(val, ref) {
  if (ref.high != null && val > ref.high) return { color: C.bad, text: `+${fmt(100 * (val - ref.high) / ref.high)}% sobre el techo (${ref.high})` };
  if (ref.low != null && val < ref.low) return { color: C.warn, text: `-${fmt(100 * (ref.low - val) / ref.low)}% bajo el piso (${ref.low})` };
  return { color: C.good, text: 'dentro del rango' };
}

// ── Referencias bien visibles (pedido 24/09): banda verde en rango, zona fuera de rango sombreada en rojo,
// líneas sólidas de piso/techo con el valor escrito en los dos extremos. target = banda objetivo personal
// (más marcada, rotulada); extra = líneas adicionales punteadas (piso duro, línea base natural, etc.). ──
export function refPlugin({ low, high, unit, target, extra = [] }) {
  return {
    id: 'refLines',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea: { left, right, top, bottom }, scales: { y } } = chart;
      const clampY = v => Math.min(Math.max(v, top), bottom);
      const yHigh = high != null ? y.getPixelForValue(high) : null;
      const yLow = low != null ? y.getPixelForValue(low) : null;
      ctx.save();
      if (yHigh != null && yHigh > top) { ctx.fillStyle = 'rgba(229,72,77,0.10)'; ctx.fillRect(left, top, right - left, clampY(yHigh) - top); }
      if (yLow != null && yLow < bottom) { ctx.fillStyle = 'rgba(201,133,0,0.08)'; ctx.fillRect(left, clampY(yLow), right - left, bottom - clampY(yLow)); }
      const bTop = yHigh != null ? clampY(yHigh) : top, bBot = yLow != null ? clampY(yLow) : bottom;
      if (bBot > bTop) { ctx.fillStyle = 'rgba(25,158,112,0.06)'; ctx.fillRect(left, bTop, right - left, bBot - bTop); }
      if (target) {
        const tTop = clampY(y.getPixelForValue(target[1])), tBot = clampY(y.getPixelForValue(target[0]));
        ctx.fillStyle = 'rgba(25,158,112,0.22)'; ctx.fillRect(left, tTop, right - left, tBot - tTop);
        ctx.strokeStyle = 'rgba(25,158,112,0.8)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
        for (const yy of [tTop, tBot]) { ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke(); }
        ctx.setLineDash([]);
        ctx.font = 'bold 11px Segoe UI, sans-serif';
        const txt = `objetivo ${target[0]}–${target[1]}`, w = ctx.measureText(txt).width + 10, cx = left + 6;
        ctx.fillStyle = 'rgba(15,17,23,.85)'; ctx.fillRect(cx, (tTop + tBot) / 2 - 8, w, 15);
        ctx.fillStyle = C.good; ctx.fillText(txt, cx + 5, (tTop + tBot) / 2 + 3);
      }
      const line = (yp, color, text, dash) => {
        if (yp < top - 1 || yp > bottom + 1) return;
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dash || []);
        ctx.beginPath(); ctx.moveTo(left, yp); ctx.lineTo(right, yp); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = 'bold 11px Segoe UI, sans-serif';
        const w = ctx.measureText(text).width + 10;
        for (const x of [left + 4, right - w - 4]) {
          ctx.fillStyle = 'rgba(15,17,23,.88)'; ctx.fillRect(x, yp - 17, w, 15);
          ctx.fillStyle = color; ctx.fillText(text, x + 5, yp - 6);
        }
      };
      if (yHigh != null) line(yHigh, C.bad, `techo ${high} ${unit}`);
      if (yLow != null) line(yLow, C.warn, `piso ${low} ${unit}`);
      extra.forEach(l => line(y.getPixelForValue(l.value), l.color, l.label, [6, 4]));
      ctx.restore();
    },
  };
}

// Referencias de T y E2 desde los objetivos de model.json.
export function tRef(obj) { return { low: obj.t.ref[0], high: obj.t.ref[1], unit: 'ng/dl', target: obj.t.objetivo }; }
export function e2Ref(obj) {
  return { high: obj.e2.refMax, unit: 'pg/ml', target: obj.e2.objetivo, extra: [
    { value: obj.e2.pisoDuro, color: C.warn, label: `piso duro ${obj.e2.pisoDuro}` },
    { value: obj.e2.natural, color: '#a0a8c8', label: `tu E2 natural pre-TRT ${obj.e2.natural}` },
  ] };
}

// Línea vertical "hoy".
export function nowLinePlugin(getNow) {
  return {
    id: 'nowLine',
    afterDatasetsDraw(chart) {
      const x = chart.scales.x, now = getNow();
      if (now == null || now < x.min || now > x.max) return;
      const { ctx, chartArea: { top, bottom } } = chart;
      const xp = x.getPixelForValue(now);
      ctx.save();
      ctx.strokeStyle = C.real; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(xp, top); ctx.lineTo(xp, bottom); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C.real; ctx.font = 'bold 11px Segoe UI, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('hoy', xp, top + 11);
      ctx.restore();
    },
  };
}

export const tooltipStyle = {
  backgroundColor: '#22263a', borderColor: '#2e3350', borderWidth: 1, titleColor: C.text, bodyColor: C.text,
};

// Eje X en días del motor, rotulado con fecha.
export function dayAxis(title) {
  return {
    type: 'linear', title: { display: !!title, text: title, color: C.muted },
    ticks: { color: C.muted, maxTicksLimit: 12, callback: v => fmtDate(v) }, grid: { color: C.grid },
  };
}
export function valueAxis(title, suggestedMax) {
  return { title: { display: true, text: title, color: C.muted }, ticks: { color: C.muted }, grid: { color: C.grid },
    beginAtZero: true, suggestedMax };
}

// Botón ampliar/reducir para cualquier .chart-box.
export function expandButton(box, chartGetter) {
  const b = h('<button class="btn small">⤢ Ampliar</button>');
  b.addEventListener('click', () => {
    const on = box.classList.toggle('expanded');
    b.textContent = on ? '⤡ Reducir' : '⤢ Ampliar';
    box.addEventListener('transitionend', () => chartGetter()?.resize(), { once: true });
  });
  return b;
}

// ── Modal ──
export function openModal(title, content) {
  document.getElementById('modalTitle').textContent = title;
  const body = document.getElementById('modalBody');
  body.innerHTML = '';
  body.appendChild(content);
  document.getElementById('modal').hidden = false;
}
export function closeModal() { document.getElementById('modal').hidden = true; }

// ── Formularios declarativos ──
// field: {k, label, type: datetime|number|text|select|textarea|days|time|checkbox, options, step, wide, show(vals)}
export function buildForm(fields, values, onChange) {
  const form = h('<form class="entry-form" novalidate></form>');
  const row = h('<div class="field-row"></div>');
  form.appendChild(row);
  const refs = {};
  for (const f of fields) {
    const wrap = h(`<div class="field${f.wide ? ' wide' : ''}${f.type === 'checkbox' ? ' inline' : ''}"></div>`);
    const id = 'f_' + f.k;
    let input;
    const v = values[f.k];
    if (f.type === 'select') {
      input = h(`<select id="${id}">${f.options.map(o => {
        const [val, txt] = Array.isArray(o) ? o : [o, label(o)];
        return `<option value="${esc(val)}">${esc(txt)}</option>`;
      }).join('')}</select>`);
      input.value = v ?? '';
    } else if (f.type === 'textarea') {
      input = h(`<textarea id="${id}"></textarea>`); input.value = v ?? '';
    } else if (f.type === 'days') {
      input = h(`<div class="pill-group" id="${id}">${WEEKDAYS.map((n, i) => `<span class="pill${(v || []).includes(i) ? ' active' : ''}" data-d="${i}">${n}</span>`).join('')}</div>`);
      input.addEventListener('click', ev => { const p = ev.target.closest('.pill'); if (p) { p.classList.toggle('active'); onChange?.(f.k, read(), set); } });
    } else if (f.type === 'checkbox') {
      input = h(`<input type="checkbox" id="${id}">`); input.checked = !!v;
    } else {
      const type = { datetime: 'datetime-local', number: 'number', time: 'time', text: 'text' }[f.type];
      input = h(`<input type="${type}" id="${id}"${f.step ? ` step="${f.step}"` : ''}>`);
      input.value = f.type === 'datetime' ? (v ? inputFromIso(v) : '') : (v ?? '');
    }
    if (f.type === 'checkbox') { wrap.appendChild(input); wrap.appendChild(h(`<label for="${id}">${esc(f.label)}</label>`)); }
    else { wrap.appendChild(h(`<label for="${id}">${esc(f.label)}</label>`)); wrap.appendChild(input); }
    if (f.type !== 'days') input.addEventListener('input', () => { onChange?.(f.k, read(), set); refreshVisibility(); });
    refs[f.k] = { f, input, wrap };
    row.appendChild(wrap);
  }
  function read() {
    const out = {};
    for (const { f, input } of Object.values(refs)) {
      if (f.type === 'days') out[f.k] = [...input.querySelectorAll('.pill.active')].map(p => +p.dataset.d);
      else if (f.type === 'checkbox') out[f.k] = input.checked;
      else if (f.type === 'number') out[f.k] = input.value === '' ? null : Number(input.value);
      else if (f.type === 'datetime') out[f.k] = input.value ? input.value : null;
      else out[f.k] = input.value === '' ? null : input.value;
    }
    return out;
  }
  function set(k, val) { const r = refs[k]; if (r) r.input.value = val; }
  function refreshVisibility() {
    const vals = read();
    for (const { f, wrap } of Object.values(refs)) wrap.style.display = f.show && !f.show(vals) ? 'none' : '';
  }
  refreshVisibility();
  // Convierte los datetime del formulario a ISO local (tira si hay una fecha mal escrita).
  function readIso() {
    const vals = read();
    for (const { f } of Object.values(refs)) {
      if (f.type === 'datetime' && vals[f.k]) vals[f.k] = isoFromInput(vals[f.k]);
      if (f.show && !f.show(read())) delete vals[f.k];
    }
    return vals;
  }
  return { form, read, readIso, set };
}
