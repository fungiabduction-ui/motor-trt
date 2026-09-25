// Pestaña Calculadora: jeringa, curva de una inyección, esquema (desde hoy o desde cero) con protección de techo,
// estradiol con anastrozol en cuartos de comprimido, comparador de frecuencias, y el botón "✨ Calcular dosis
// óptima", que parte del modelo vivo (T y E2 de hoy) y completa todos los campos con la mejor combinación.
import { engineParams, nonlinearNgdl, ESTER_CONC } from '../engine/pk.js';
import { activeVersion } from '../engine/calibration.js';
import { appliedTDoses, appliedAIDoses } from '../engine/projection.js';
import { nowDay, isoFromDay, dayFromIso } from '../engine/time.js';
import { simulateScheme, schemeMetrics, ceilingAdvice, schemeAnastrozol, schemeWeeks, T_CEILING } from '../engine/scheme.js';
import { e2FromT, anastrozolNeededFor, E2_CEILING, ANASTROZOL_CREDIBLE_MAX_MGWEEK } from '../engine/estradiol.js';
import { objetivosOf } from '../engine/objetivos.js';
import { optimize } from '../engine/optimizer.js';
import { h, fmt, fmtDay, kpi, statusOf, refPlugin, nowLinePlugin, tooltipStyle, dayAxis, valueAxis, C, T_REF, E2_REF,
  WEEKDAYS, label, tRef, e2Ref } from './common.js';
import { openEntryForm } from './forms.js';
import { openModal, closeModal } from './common.js';
import { nowIso } from '../store/entries.js';
import * as st from '../state.js';

// Frecuencias: días de la semana o "cada N días".
const FREQS = {
  '7': { label: 'Diario', interval: 1 },
  '48h': { label: 'Día por medio (cada 48 hs)', interval: 2 },
  '3': { label: '3x/semana (lun-mié-vie)', weekdays: [0, 2, 4] },
  '2': { label: '2x/semana (lun-jue)', weekdays: [0, 3] },
  '1': { label: '1x/semana (lun)', weekdays: [0] },
};
const OPT_TO_FREQ = { diario: '7', '48h': '48h', '2x': '2', '3x': '3' };
const FREQ_COLOR = { '7': C.good, '48h': '#9b6bd6', '3': C.e2, '2': C.t, '1': C.muted };
const r3 = x => Math.round(x * 1000) / 1000;
const E2_WARN = () => objetivosOf(st.state.model).e2.objetivo[0];
const E2_BAD = () => objetivosOf(st.state.model).e2.pisoDuro;
const perWeekOf = o => (o.interval ? 7 / o.interval : o.weekdays.length);

export function initCalculadora(root) {
  root.innerHTML = '';
  const ui = h(`<div>
    <div class="card next-dose" style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div><b style="font-size:16px">✨ Calcular dosis óptima</b><div class="muted small">Desde tu T y E2 de hoy (modelo vivo), calcula la mejor dosis y la carga en los campos de abajo.</div></div>
        <div class="btn-row"><select id="optPaso" title="Graduación de la jeringa"><option value="0.02">Jeringa 0.02 ml</option><option value="0.01">Jeringa 0.01 ml</option><option value="0.005">Jeringa 0.005 ml</option></select>
        <button class="btn primary" data-magic>✨ Calcular</button></div>
      </div>
      <div data-magic-out></div>
    </div>

    <h2>1 · Esquema de testosterona</h2>
    <div class="field-row">
      <div class="field"><label for="sEster">Éster</label><select id="sEster" data-s="ester"><option value="cipionato">Cipionato — t½ 8 d</option><option value="enantato">Enantato — t½ 4.5 d</option></select></div>
      <div class="field"><label for="sFreq">Frecuencia</label><select id="sFreq" data-s="freq">
        ${Object.entries(FREQS).map(([k, f]) => `<option value="${k}"${k === '3' ? ' selected' : ''}>${f.label}</option>`).join('')}
        <option value="custom">Personalizado (días)</option></select></div>
      <div class="field"><label for="sMg">mg por aplicación</label><input id="sMg" type="number" step="0.5" value="16" data-s="mg"></div>
      <div class="field"><label for="sSkip">Saltear las primeras</label><input id="sSkip" type="number" step="1" min="0" value="0" data-s="skip"></div>
      <div class="field inline"><input type="checkbox" id="sToday" checked><label for="sToday">Partir de mi nivel actual (hoy)</label></div>
    </div>
    <div class="pill-group" data-s-days style="display:none;margin-bottom:12px">${WEEKDAYS.map((n, i) => `<span class="pill${[0, 2, 4].includes(i) ? ' active' : ''}" data-d="${i}">${n}</span>`).join('')}</div>
    <div class="card" data-s-total></div>
    <div data-s-warn></div>
    <div class="chart-box"><canvas data-s-chart></canvas></div>
    <div class="callouts" data-s-kpis></div>

    <h2>2 · Estradiol y anastrozol (en cuartos de comprimido)</h2>
    <div class="field-row">
      <div class="field"><label for="eMg">Anastrozol por toma</label><select id="eMg" data-e="mg">
        <option value="0">Sin anastrozol</option><option value="0.25" selected>1/4 comprimido (0.25 mg)</option><option value="0.5">1/2 comprimido (0.5 mg)</option></select></div>
      <div class="field"><label for="eEvery">1 toma cada … aplicaciones</label><input id="eEvery" type="number" min="1" step="1" value="3" data-e="every"></div>
    </div>
    <div class="card small" data-e-total></div>
    <div data-e-warn></div>
    <div class="chart-box small"><canvas data-e-chart></canvas></div>
    <div class="callouts" data-e-kpis></div>
    <div class="legend-note">Extrapolación poblacional — cero datos propios de anastrozol (no hay un E2 medido con anastrozol activo). Si te excedés, cortá ante dolor/rigidez articular, baja de libido o erección, ánimo plano, piel u ojos secos.</div>

    <div class="btn-row" style="margin-top:14px"><button class="btn primary" data-adopt>➜ Adoptar esta configuración como esquema</button>
      <span class="muted small">Rige desde ahora (corta el esquema actual); la 1ra aplicación respeta "saltear".</span></div>

    <h2>3 · Comparador de frecuencias (mismo total semanal)</h2>
    <div class="card small" data-k-total></div>
    <div class="chart-box"><canvas data-k-chart></canvas></div>
    <div class="scroll-table" style="max-height:none;margin-top:12px"><table data-k-table></table></div>
    <div class="legend-note">Pico máx. = el más alto desde la 1ra aplicación (rojo si pasa ${T_CEILING}). Valle–pico/ratio = última semana. E2 valle amarillo/rojo = debajo de tu objetivo / del piso duro.</div>

    <h2>4 · Jeringa</h2>
    <div class="field-row">
      <div class="field"><label for="jEster">Éster</label><select id="jEster" data-j="ester"><option value="cipionato">Cipionato 200 mg/ml</option><option value="enantato">Enantato 250 mg/ml</option></select></div>
      <div class="field"><label for="jMg">mg</label><input id="jMg" type="number" step="0.5" value="16" data-j="mg"></div>
      <div class="field"><label for="jMl">ml</label><input id="jMl" type="number" step="0.005" value="0.08" data-j="ml"></div>
    </div>
    <div class="card" data-j-out></div>

    <h2>5 · Curva de una inyección (desde cero)</h2>
    <div class="field-row">
      <div class="field"><label for="cEster">Éster</label><select id="cEster" data-c="ester"><option value="cipionato">Cipionato — t½ 8 d</option><option value="enantato">Enantato — t½ 4.5 d</option></select></div>
      <div class="field"><label for="cMg">mg</label><input id="cMg" type="number" step="1" value="16" data-c="mg"></div>
      <div class="field inline"><input type="checkbox" id="cCmp" checked><label for="cCmp">Comparar con el otro éster</label></div>
    </div>
    <div class="chart-box small"><canvas data-c-chart></canvas></div>
    <div class="callouts" data-c-kpis></div>
  </div>`);
  root.appendChild(ui);
  const $ = s => ui.querySelector(s);
  const charts = {};
  let lastOpt = null;

  // ── contexto real (modelo vivo) ──
  function ctx() {
    const { log, model } = st.state;
    const v = activeVersion(model);
    return { ep: engineParams(v.params), mp: v.params, v, history: appliedTDoses(log.entries), aiHistory: appliedAIDoses(log.entries), now: nowDay() };
  }
  const obj = () => objetivosOf(st.state.model);

  // ── Esquema ──
  function readScheme() {
    const freq = $('[data-s=freq]').value, f = FREQS[freq];
    const weekdays = freq === 'custom' ? [...ui.querySelectorAll('[data-s-days] .pill.active')].map(p => +p.dataset.d) : f.weekdays;
    const ester = $('[data-s=ester]').value, fromToday = $('#sToday').checked;
    return { freq, ester, interval: f?.interval || null, weekdays: f?.interval ? null : weekdays, mg: Number($('[data-s=mg]').value) || 0,
      skip: Math.max(0, parseInt($('[data-s=skip]').value, 10) || 0), fromToday, weeks: schemeWeeks(ester, fromToday) };
  }
  const xOf = (sim, t) => sim.origin + t;
  const schemeAxis = o => o.fromToday ? dayAxis()
    : { type: 'linear', title: { display: true, text: 'Día (desde cero, día 0 = lunes)', color: C.muted }, ticks: { color: C.muted }, grid: { color: C.grid } };
  const when = (sim, t) => sim.origin > 0 ? fmtDay(sim.origin + t) : `día ${fmt(t, 1)}`;
  const freqText = o => o.interval ? (o.interval === 1 ? 'diario' : `cada ${o.interval} días`) : o.weekdays.map(d => WEEKDAYS[d]).join('-');

  function esquema() {
    const o = readScheme(), c = ctx();
    $('[data-s-days]').style.display = o.freq === 'custom' ? 'flex' : 'none';
    if (!o.interval && !o.weekdays.length) { $('[data-s-warn]').innerHTML = '<div class="warn-box">Elegí al menos un día.</div>'; return null; }
    const perWeek = perWeekOf(o), total = o.mg * perWeek, ml = r3(o.mg / ESTER_CONC[o.ester]);
    $('[data-s-total]').innerHTML = `<b>${fmt(o.mg, 1)} mg = ${ml} ml</b> (${fmt(ml / 0.02, 1)} rayitas de 0.02) ${freqText(o)} → <b>${fmt(total, 1)} mg/semana</b> · ~${fmt(total * 4.33)} mg/mes`;
    const sim = simulateScheme(o, c), m = schemeMetrics(sim);
    charts.s = draw(charts.s, $('[data-s-chart]'), [{ type: 'line', label: `${label(o.ester)} ${o.mg} mg ${freqText(o)}`,
      data: sim.labels.map((t, i) => ({ x: xOf(sim, t), y: sim.data[i] })), borderColor: C[o.ester], backgroundColor: C[o.ester], borderWidth: 2, pointRadius: 0 }],
    { x: schemeAxis(o), y: valueAxis('ng/dl', T_REF.high * 1.1) }, [refPlugin(tRef(obj())), nowLinePlugin(() => o.fromToday ? c.now : null)], sim);
    const sOf = v => statusOf(v, T_REF), stable = m.stableDay <= 0 ? 'ya estable' : `≈${Math.ceil(m.stableDay)} días`;
    $('[data-s-kpis]').innerHTML =
      (o.fromToday ? kpi('Hoy — modelo vivo', `${fmt(m.startVal)} ng/dl`, sOf(m.startVal).color, fmtDay(c.now)) +
        kpi('Pico máx. desde la 1ra aplicación', `${fmt(m.maxPeak)} ng/dl`, sOf(m.maxPeak).color, `${when(sim, m.maxPeakDay)} · ${sOf(m.maxPeak).text}`) : '') +
      kpi('Valle–pico estable', `${fmt(m.trough)}–${fmt(m.peak)}`, sOf(m.peak).color, `promedio ${fmt(m.avg)} · pico:valle ${m.ratio.toFixed(2)}`) +
      kpi('Hasta estabilizarse', stable, C.text, sim.applied.length ? `1ra aplicación ${when(sim, sim.applied[0].day)}` : 'sin aplicaciones');
    let warn = '';
    if (o.fromToday && m.maxPeak > T_CEILING && o.weekdays) {
      const adv = ceilingAdvice(o, c), conc = ESTER_CONC[o.ester];
      warn = `<div class="error-box"><b>⚠ Este esquema pasa el techo (${T_CEILING}):</b> pico ${fmt(m.maxPeak)} el ${when(sim, m.maxPeakDay)}. ` +
        (m.peak > T_CEILING ? 'El pico estable ya supera el techo: hay que bajar la dosis.' : adv.skip !== null ? `Salteá las primeras <b>${adv.skip}</b> (1ra el ${fmtDay(adv.firstDay)}).` : '') +
        (adv.maxMg > 0.05 ? ` O usá hasta <b>${fmt(adv.maxMg, 1)} mg</b> (${fmt(adv.maxMg / conc, 3)} ml).` : '') + '</div>';
    } else if (o.fromToday && m.maxPeak > T_CEILING) {
      warn = `<div class="error-box"><b>⚠ Este esquema pasa el techo (${T_CEILING}):</b> pico ${fmt(m.maxPeak)} el ${when(sim, m.maxPeakDay)}. Bajá los mg o salteá aplicaciones (o probá ✨ Calcular).</div>`;
    }
    $('[data-s-warn]').innerHTML = warn;
    return { o, sim, c };
  }

  // ── Estradiol ──
  const readE2 = () => ({ mg: Number($('[data-e=mg]').value) || 0, every: Math.max(1, parseInt($('[data-e=every]').value, 10) || 1) });
  function e2Series(sim, c, e) {
    const every = e.mg > 0 ? e.every : 0;
    const r = schemeAnastrozol(sim, every, e.mg, c.aiHistory, c.mp.anastrozol);
    const withAI = sim.data.map((t, i) => e2FromT(t, c.mp.kArom, r.supp[i]));
    const noAI = sim.data.map(t => e2FromT(t, c.mp.kArom, 0));
    const last = sim.labels[sim.labels.length - 1], first = sim.applied.length ? sim.applied[0].day : 0;
    let pk = -Infinity, pkNo = -Infinity, tr = Infinity, sum = 0, n = 0, min = Infinity, minT = 0;
    sim.labels.forEach((t, i) => {
      if (t >= last - 7) { pk = Math.max(pk, withAI[i]); pkNo = Math.max(pkNo, noAI[i]); tr = Math.min(tr, withAI[i]); sum += withAI[i]; n++; }
      if (t >= first && withAI[i] < min) { min = withAI[i]; minT = t; }
    });
    return { ...r, withAI, noAI, pk, pkNo, tr, avg: sum / n, min, minT };
  }
  function estradiol(res) {
    const { sim, c } = res, e = readE2(), r = e2Series(sim, c, e);
    $('[data-e=every]').closest('.field').style.display = e.mg > 0 ? '' : 'none';
    $('[data-e-total]').innerHTML = e.mg > 0
      ? `<b>${e.mg === 0.25 ? '1/4' : '1/2'} comprimido (${e.mg} mg)</b> cada ${e.every} ${e.every > 1 ? 'aplicaciones' : 'aplicación'} = cada ~${fmt(r.cadaDias, 1)} días → <b>${fmt(r.mgSemana, 2)} mg/semana</b>`
      : 'Sin anastrozol nuevo' + (sim.origin > 0 && r.supp[0] > 0 ? ` (queda ${fmt(r.supp[0] * 100)}% de supresión de tomas ya hechas)` : '');
    charts.e = draw(charts.e, $('[data-e-chart]'), [
      { type: 'line', label: 'E2 sin anastrozol', data: sim.labels.map((t, i) => ({ x: xOf(sim, t), y: r.noAI[i] })), borderColor: C.muted, borderDash: [3, 3], borderWidth: 1.4, pointRadius: 0 },
      { type: 'line', label: 'E2 con anastrozol', data: sim.labels.map((t, i) => ({ x: xOf(sim, t), y: r.withAI[i] })), borderColor: C.e2, backgroundColor: C.e2, borderWidth: 2.2, pointRadius: 0 },
    ], { x: schemeAxis(res.o), y: valueAxis('pg/ml', E2_REF.high * 1.5) }, [refPlugin(e2Ref(obj())), nowLinePlugin(() => res.o.fromToday ? c.now : null)], sim);
    const need = anastrozolNeededFor(E2_CEILING, r.pkNo, c.mp.anastrozol);
    const tgtE = { low: obj().e2.objetivo[0], high: obj().e2.objetivo[1] };
    $('[data-e-kpis]').innerHTML =
      (res.o.fromToday ? kpi('E2 hoy — modelo vivo', `${fmt(r.withAI[0], 1)} pg/ml`, statusOf(r.withAI[0], tgtE).color, fmtDay(c.now)) : '') +
      kpi('E2 estable con anastrozol', `${fmt(r.tr, 1)}–${fmt(r.pk, 1)}`, r.tr < E2_WARN() ? C.bad : statusOf(r.pk, tgtE).color, `promedio ${fmt(r.avg, 1)} · objetivo ${obj().e2.objetivo.join('-')}`) +
      kpi('E2 estable sin anastrozol', `pico ${fmt(r.pkNo, 1)}`, C.muted, 'referencia') +
      kpi('Para no pasar 40 (pico)', need > 0 ? `${fmt(need, 2)} mg/sem` : 'no hace falta', C.good,
        need > ANASTROZOL_CREDIBLE_MAX_MGWEEK ? '⚠ fuera de rango creíble: bajá la T' : 'modelo Emax, conservador');
    $('[data-e-warn]').innerHTML = e.mg > 0 && r.min < E2_WARN()
      ? `<div class="error-box"><b>${r.min < E2_BAD() ? '🔴' : '⚠'} Riesgo de sobre-supresión:</b> el E2 baja a <b>${fmt(r.min, 1)} pg/ml</b> (${when(sim, r.minT)}), debajo de tu objetivo (${E2_WARN()}). Espaciá las tomas (más aplicaciones entre cada cuarto).</div>` : '';
  }

  // ── Comparador ──
  function comparador(res) {
    const base = res.o, c = res.c, total = base.mg * perWeekOf(base), e = readE2(), conc = ESTER_CONC[base.ester];
    $('[data-k-total]').innerHTML = `Total fijo: <b>${fmt(total, 1)} mg/semana</b> de ${label(base.ester)} — ${base.fromToday ? `partiendo de hoy (${fmtDay(c.now)})` : 'desde cero'} · anastrozol ${e.mg > 0 ? `${e.mg} mg cada ${e.every} aplicaciones` : 'no'}`;
    const rows = Object.entries(FREQS).map(([k, f]) => {
      const o = { ...base, freq: k, interval: f.interval || null, weekdays: f.weekdays || null, mg: total / (f.interval ? 7 / f.interval : f.weekdays.length) };
      const sim = simulateScheme(o, c);
      return { k, f, o, sim, m: schemeMetrics(sim), e2: e2Series(sim, c, e) };
    });
    charts.k = draw(charts.k, $('[data-k-chart]'), rows.map(r => ({ type: 'line', label: `${r.f.label} — ${fmt(r.o.mg, 1)} mg`,
      data: r.sim.labels.map((t, i) => ({ x: xOf(r.sim, t), y: r.sim.data[i] })), borderColor: FREQ_COLOR[r.k], backgroundColor: FREQ_COLOR[r.k],
      borderWidth: r.k === base.freq ? 2.6 : 1.3, pointRadius: 0 })),
    { x: schemeAxis(base), y: valueAxis('ng/dl', T_REF.high * 1.15) }, [refPlugin(tRef(obj())), nowLinePlugin(() => base.fromToday ? c.now : null)], rows[0].sim);
    const bad = 'color:var(--bad);font-weight:700', warn = 'color:var(--warn);font-weight:700';
    $('[data-k-table]').innerHTML = `<thead><tr><th>Esquema</th><th class="num">mg (ml) por aplic.</th><th class="num">Pico máx.</th><th class="num">Valle–pico estable</th><th class="num">Pico:valle</th><th class="num">Anastrozol</th><th class="num">E2 valle–pico</th></tr></thead><tbody>` +
      rows.map(r => `<tr${r.k === base.freq ? ' style="background:rgba(242,201,76,.08)"' : ''}><td><span style="color:${FREQ_COLOR[r.k]}">●</span> ${r.f.label}${r.k === base.freq ? ' <b>· actual</b>' : ''}</td>
        <td class="num">${fmt(r.o.mg, 1)} (${fmt(r.o.mg / conc, 3)})</td>
        <td class="num" style="${r.m.maxPeak > T_CEILING ? bad : ''}">${fmt(r.m.maxPeak)}</td>
        <td class="num">${fmt(r.m.trough)}–<span style="${r.m.peak > T_CEILING ? bad : ''}">${fmt(r.m.peak)}</span></td><td class="num">${r.m.ratio.toFixed(2)}</td>
        <td class="num">${r.e2.mgSemana ? `${fmt(r.e2.mgSemana, 2)} mg/sem` : '—'}</td>
        <td class="num"><span style="${r.e2.tr < E2_BAD() ? bad : r.e2.tr < E2_WARN() ? warn : ''}">${fmt(r.e2.tr, 1)}</span>–${fmt(r.e2.pk, 1)}</td></tr>`).join('') + '</tbody>';
  }

  // ── ✨ Calcular dosis óptima ──
  function magic() {
    const out = $('[data-magic-out]');
    out.innerHTML = '<div class="muted small" style="margin-top:8px">⏳ Calculando desde tu nivel de hoy…</div>';
    setTimeout(() => {
      const c = ctx(), { log } = st.state, ester = $('[data-s=ester]').value;
      const statin = log.entries.some(e => e.tipo === 'farmaco' && e.modo === 'continuo' && /rosuvastatina|estatina/i.test(e.farmaco)
        && dayFromIso(e.desde) <= c.now && (!e.hasta || dayFromIso(e.hasta) >= c.now));
      lastOpt = optimize({ mp: c.mp, history: c.history, aiHistory: c.aiHistory, now: c.now, obj: obj(), ester, estatinaActiva: statin, pasoMl: Number($('#optPaso').value) });
      selIdx = 0;
      applyOption(lastOpt.opciones[0]);
      renderMagic();
    }, 30);
  }
  function describeOpt(o) {
    const ai = o.ai.every ? `${o.ai.mgToma === 0.25 ? '1/4' : '1/2'} comprimido de anastrozol cada ${o.ai.every} ${o.ai.every > 1 ? 'aplicaciones' : 'aplicación'} (cada ~${fmt(o.ai.cadaDias, 1)} días)` : 'sin anastrozol';
    return `<b>${fmt(o.t.ml, 3)} ml</b> (${fmt(o.t.mg, 1)} mg) ${o.t.pattern.label.toLowerCase()}${o.t.skip ? `, salteando ${o.t.skip === 1 ? 'la próxima' : `las próximas ${o.t.skip}`}` : ''} · ${ai}`;
  }
  // Resultado del ✨ en la pantalla: SOLO una línea + 3 números + 2 botones. La comparación (gráficos, alternativas,
  // explicación) vive en una ventana aparte que se abre a pedido, para no mezclarse con la calculadora.
  const OPT_COLOR = { diario: C.good, '48h': '#9b6bd6', '2x': C.t, '3x': C.e2 };
  let selIdx = 0;
  const tituloDe = (x, i) => i === 0 ? '⭐ Recomendada' : x.ai.every === 0 ? 'Sin anastrozol' : 'Alternativa';
  function renderMagic() {
    const o = lastOpt.opciones[selIdx], ob = obj();
    const bad = o.peorCaso.tMax > ob.t.techo || o.peorCaso.e2Min < ob.e2.pisoDuro;
    $('[data-magic-out]').innerHTML = `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
      <div style="font-size:15px">👉 ${selIdx ? '<span class="tag">alternativa elegida</span> ' : ''}${describeOpt(o)} <span class="muted small">· 1ra aplicación ${fmtDay(o.t.firstDay)}</span></div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:6px">
        <div class="small">T <b>${fmt(o.base.tTrough)}–${fmt(o.base.tPeak)}</b> · E2 <b>${fmt(o.base.e2Trough, 1)}–${fmt(o.base.e2Peak, 1)}</b> · peor caso <span style="color:${bad ? 'var(--bad)' : 'inherit'}">T ${fmt(o.peorCaso.tMax)} / E2 ${fmt(o.peorCaso.e2Min, 1)}</span> <span class="muted">(desde hoy: T ${fmt(lastOpt.hoy.t)}, E2 ${fmt(lastOpt.hoy.e2, 1)})</span></div>
        <div class="btn-row"><button class="btn small" data-compare>Comparar opciones</button><button class="btn primary small" data-adopt-magic>Adoptar</button></div>
      </div></div>`;
  }

  // Ventana de comparación: gráficos T/E2 de la opción que estás mirando vs la recomendada, y la lista de opciones.
  let viewIdx = 0, mCharts = {};
  function openCompare() {
    viewIdx = selIdx;
    const ob = obj();
    const box = h(`<div>
      <div class="small muted">Desde tu nivel de hoy según el modelo vivo: T ${fmt(lastOpt.hoy.t)} ng/dl · E2 ${fmt(lastOpt.hoy.e2, 1)} pg/ml. Una opción por frecuencia; tocá "Ver" para ver su curva (en color) contra la recomendada (gris).</div>
      <div data-cmp-head style="margin:10px 0 4px"></div>
      <div class="small muted">Testosterona</div><div class="chart-box small" style="height:200px"><canvas data-cmp-t></canvas></div>
      <div class="small muted" style="margin-top:6px">Estradiol</div><div class="chart-box small" style="height:200px"><canvas data-cmp-e></canvas></div>
      <div data-cmp-list style="margin-top:10px"></div>
      <div class="small muted" style="margin-top:8px">El E2 de la recomendada queda algo arriba de ${ob.e2.objetivo.join('-')} a propósito: sin un E2 medido con anastrozol, más dosis podría hundirte debajo de ${ob.e2.pisoDuro} si respondés el doble que el promedio. Medí E2 ~2 semanas después de arrancar y se afina.</div>
    </div>`);
    openModal('Comparar opciones', box);
    const paint = () => {
      const o = lastOpt.opciones[viewIdx], rec = lastOpt.opciones[0];
      const badO = o.peorCaso.tMax > ob.t.techo || o.peorCaso.e2Min < ob.e2.pisoDuro;
      box.querySelector('[data-cmp-head]').innerHTML = `<b>${tituloDe(o, viewIdx)}:</b> ${describeOpt(o)}<div class="small">T ${fmt(o.base.tTrough)}–${fmt(o.base.tPeak)} · E2 ${fmt(o.base.e2Trough, 1)}–${fmt(o.base.e2Peak, 1)} · peor caso <span style="color:${badO ? 'var(--bad)' : 'inherit'}">T ${fmt(o.peorCaso.tMax)} / E2 ${fmt(o.peorCaso.e2Min, 1)}</span></div>`;
      const ds = (key, x, i, ref) => ({ type: 'line', label: tituloDe(x, i), data: x.series.days.map((d, k) => ({ x: d, y: x.series[key][k] })),
        borderColor: ref ? C.muted : (x.ai.every === 0 ? C.muted : OPT_COLOR[x.t.pattern.id]), borderDash: ref ? [4, 4] : [], borderWidth: ref ? 1.3 : 2.4, pointRadius: 0 });
      const sets = key => viewIdx ? [ds(key, o, viewIdx, false), ds(key, rec, 0, true)] : [ds(key, o, 0, false)];
      const xs = { ...dayAxis(), min: o.series.days[0], max: o.series.days.at(-1) };
      mCharts.t = draw(mCharts.t, box.querySelector('[data-cmp-t]'), sets('t'), { x: xs, y: valueAxis('ng/dl', ob.t.techo * 1.12) }, [refPlugin(tRef(ob))], { origin: 1 });
      mCharts.e = draw(mCharts.e, box.querySelector('[data-cmp-e]'), sets('e2'), { x: xs, y: valueAxis('pg/ml', 60) }, [refPlugin(e2Ref(ob))], { origin: 1 });
      box.querySelector('[data-cmp-list]').innerHTML = lastOpt.opciones.map((a, i) => `<div class="slot-row" style="${i === viewIdx ? 'background:rgba(242,201,76,.08);border-radius:8px;padding-left:8px' : ''}">
        <div class="small"><b>${tituloDe(a, i)}</b> — ${describeOpt(a)}<br><span class="muted">T ${fmt(a.base.tTrough)}–${fmt(a.base.tPeak)} · E2 ${fmt(a.base.e2Trough, 1)}–${fmt(a.base.e2Peak, 1)} · peor caso E2 ${fmt(a.peorCaso.e2Min, 1)}</span></div>
        <div class="btn-row">${i === viewIdx ? '' : `<button class="btn small" data-view="${i}">Ver</button>`}<button class="btn small ${i === viewIdx ? 'primary' : ''}" data-use="${i}">Usar esta</button></div></div>`).join('');
    };
    box.addEventListener('click', ev => {
      const v = ev.target.closest('[data-view]'), u = ev.target.closest('[data-use]');
      if (v) { viewIdx = +v.dataset.view; paint(); }
      if (u) { selIdx = +u.dataset.use; applyOption(lastOpt.opciones[selIdx]); renderMagic(); closeModal(); }
    });
    paint();
  }
  function applyOption(o) {
    $('[data-s=freq]').value = OPT_TO_FREQ[o.t.pattern.id];
    $('[data-s=mg]').value = o.t.mg;
    $('[data-s=skip]').value = o.t.skip;
    $('#sToday').checked = true;
    $('[data-e=mg]').value = String(o.ai.every ? o.ai.mgToma : 0);
    if (o.ai.every) $('[data-e=every]').value = o.ai.every;
    all();
  }
  $('[data-magic]').addEventListener('click', magic);
  $('[data-magic-out]').addEventListener('click', ev => {
    if (ev.target.closest('[data-compare]')) openCompare();
    if (ev.target.closest('[data-adopt-magic]')) $('[data-adopt]').click();
  });

  // ── Adoptar ──
  $('[data-adopt]').addEventListener('click', () => {
    const o = readScheme(), e = readE2(), c = ctx();
    const sim = simulateScheme({ ...o, fromToday: true, weeks: 2 }, c);
    const first = sim.applied.length ? sim.origin + sim.applied[0].day : c.now;
    openEntryForm('esquema', {
      desde: nowIso(), primeraAplicacion: isoFromDay(first), ester: o.ester, mg: o.mg, concMgMl: ESTER_CONC[o.ester],
      dias: o.weekdays, intervaloDias: o.interval, hora: o.weekdays ? '01:30' : null, generaPendientes: true, profundidad: 'subq_superficial',
      acompanantes: e.mg > 0 ? [{ farmaco: 'anastrozol', mg: e.mg, cadaN: e.every }] : [],
      motivo: `Calculadora (modelo ${c.v.id}, ${fmtDay(c.now)}): ${fmt(o.mg, 1)} mg ${freqText(o)}${e.mg > 0 ? ` + anastrozol ${e.mg} mg cada ${e.every} aplicaciones` : ''}.`,
    }, 'esquema desde la calculadora (revisá y guardá)');
  });

  // ── Jeringa ──
  function jeringa(src) {
    const conc = ESTER_CONC[$('[data-j=ester]').value];
    if (src === 'ml') $('[data-j=mg]').value = Math.round(Number($('[data-j=ml]').value) * conc * 100) / 100;
    else $('[data-j=ml]').value = r3(Number($('[data-j=mg]').value) / conc);
    const ml = Number($('[data-j=ml]').value), lines = ml / 0.02;
    $('[data-j-out]').innerHTML = `<b style="font-size:20px">${fmt(ml, 3)} ml</b> = <b>${fmt(Number($('[data-j=mg]').value), 1)} mg</b> · ${Number.isInteger(Math.round(lines * 1000) / 1000) ? `<b>${fmt(lines)}</b> rayitas` : `<b>${fmt(lines, 1)}</b> rayitas (no cae justo en una línea)`} de una jeringa graduada cada 0.02 ml`;
  }
  $('[data-j=ester]').addEventListener('change', () => jeringa('mg'));
  $('[data-j=mg]').addEventListener('input', () => jeringa('mg'));
  $('[data-j=ml]').addEventListener('input', () => jeringa('ml'));

  // ── Una inyección ──
  function curvaUna() {
    const c = ctx(), mg = Number($('[data-c=mg]').value) || 0, ester = $('[data-c=ester]').value;
    const esters = $('#cCmp').checked ? [ester, ester === 'cipionato' ? 'enantato' : 'cipionato'] : [ester];
    const ts = []; for (let t = 0; t <= 45; t += 0.1) ts.push(Number(t.toFixed(2)));
    const series = esters.map(e => ({ e, data: nonlinearNgdl([{ day: 0, mg, ester: e }], 45, 0.02, ts, c.ep) }));
    charts.c = draw(charts.c, $('[data-c-chart]'), series.map((s, i) => ({ type: 'line', label: `${label(s.e)} ${mg} mg`,
      data: ts.map((t, k) => ({ x: t, y: s.data[k] })), borderColor: C[s.e], borderWidth: i ? 1.5 : 2.2, borderDash: i ? [5, 4] : [], pointRadius: 0 })),
    { x: { type: 'linear', title: { display: true, text: 'Días desde la aplicación', color: C.muted }, ticks: { color: C.muted }, grid: { color: C.grid } }, y: valueAxis('ng/dl') },
    [refPlugin(tRef(obj()))], null);
    $('[data-c-kpis]').innerHTML = series.map(s => {
      let pk = 0, pkT = 0; s.data.forEach((v, i) => { if (v > pk) { pk = v; pkT = ts[i]; } });
      return kpi(`${label(s.e)} — pico`, `${fmt(pk)} ng/dl`, C[s.e], `a los ${fmt(pkT, 1)} días · una sola aplicación`);
    }).join('');
  }
  ['[data-c=ester]', '[data-c=mg]', '#cCmp'].forEach(s => $(s).addEventListener('input', curvaUna));

  // Los plugins inline no se pueden cambiar en un chart vivo: se recrea en cada cálculo.
  function draw(chart, canvas, datasets, scales, plugins, sim) {
    const titleFn = items => items.length ? (sim && sim.origin > 0 ? fmtDay(items[0].parsed.x) : `día ${fmt(items[0].parsed.x, 1)}`) : '';
    chart?.destroy();
    return new Chart(canvas.getContext('2d'), {
      data: { datasets },
      options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false }, scales,
        plugins: { legend: { position: 'bottom', labels: { color: C.muted, boxWidth: 10, font: { size: 10.5 } } },
          tooltip: { ...tooltipStyle, callbacks: { title: titleFn, label: c => `${c.dataset.label}: ${fmt(c.parsed.y, c.parsed.y < 100 ? 1 : 0)}` } } } },
      plugins,
    });
  }

  function all() {
    if (!st.state.log) return;
    const res = esquema();
    if (!res) return;
    estradiol(res);
    comparador(res);
  }
  $('[data-s-days]').addEventListener('click', ev => { const p = ev.target.closest('.pill'); if (p) { p.classList.toggle('active'); all(); } });
  ['[data-s=ester]', '[data-s=freq]', '[data-s=mg]', '[data-s=skip]', '#sToday', '[data-e=mg]', '[data-e=every]'].forEach(s => $(s).addEventListener('input', all));

  function render() { jeringa('mg'); curvaUna(); all(); }
  st.subscribe(() => { if (!root.hidden) render(); else root.dataset.stale = '1'; });
  root.addEventListener('tab:show', () => { if (!charts.s || root.dataset.stale) { delete root.dataset.stale; render(); } else Object.values(charts).forEach(ch => ch.resize()); });
}
