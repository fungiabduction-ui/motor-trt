// Pestaña Modelo: versiones de model.json, historial de predicciones vs labs reales, propuesta de recalibración.
// La app NUNCA escribe model.json: aplicar una propuesta es trabajo de una sesión con Claude Code.
import { labRefs, freezePrediction, calibrationProposal, activeVersion } from '../engine/calibration.js';
import { anastrozolResponse, statinResponse } from '../engine/respuesta.js';
import { perfilOf } from '../engine/objetivos.js';
import { h, esc, fmt, fmtIso, C } from './common.js';
import * as st from '../state.js';

const pct = (pred, real) => 100 * (pred - real) / real;
const errCell = (pred, real) => {
  const e = pct(pred, real), col = Math.abs(e) <= 15 ? C.good : Math.abs(e) <= 33 ? C.warn : C.bad;
  return `${fmt(pred)} <span style="color:${col};font-weight:700">(${e > 0 ? '+' : ''}${fmt(e, 1)}%)</span>`;
};

export function initModelo(root) {
  root.innerHTML = '';
  const ui = h('<div><div data-rule></div><h2>Tu respuesta personal</h2><div data-resp></div><h2>Predicción vs real</h2><div data-pred></div><h2>Propuesta de recalibración</h2><div data-prop></div><h2>Versiones del modelo</h2><div data-vers></div></div>');
  root.appendChild(ui);

  function render() {
    const { log, model } = st.state;
    ui.querySelector('[data-rule]').innerHTML = `<div class="info-box" style="margin-top:14px"><b>Regla fija:</b> la app calcula y propone; <code>data/model.json</code> solo cambia en una sesión con Claude Code (script → tests → versión nueva con motivo). Cada lab que cargás congela la predicción de la versión vigente <i>antes</i> de recalibrar: esa es la validación fuera de muestra real.</div>`;

    renderRespuesta(log, model);
    const labs = labRefs(log.entries);
    const trt = labs.filter(l => l.day >= 0), pre = labs.filter(l => l.day < 0);
    const vig = model.versiones.find(v => v.id === model.vigente);
    const rows = trt.map(l => {
      const cur = freezePrediction(log.entries, model, l.at, null);
      const frozen = l.prediccion ? `${errCell(l.prediccion.t_total, l.t_total)}<br><span class="muted small">${esc(l.prediccion.modelVersion)} · ${fmtIso(l.prediccion.calculadoEn)}</span>` : '<span class="muted small">— (lab migrado, sin predicción previa)</span>';
      const anchor = (vig.labsUsados || []).includes(l.id) ? ' <span class="tag">ancla</span>' : '';
      const e2 = typeof l.e2 === 'number' ? `${fmt(l.e2, 1)} / ${errCell(cur.e2, l.e2)}` : '—';
      return `<tr><td>${fmtIso(l.at)}</td><td><code>${l.id}</code></td><td class="num"><b>${fmt(l.t_total)}</b></td>
        <td class="num">${frozen}</td><td class="num">${errCell(cur.t_total, l.t_total)}${anchor}</td><td class="num">${e2}</td></tr>`;
    });
    ui.querySelector('[data-pred]').innerHTML = `<div class="scroll-table" style="max-height:none"><table>
      <thead><tr><th>Extracción</th><th>Lab</th><th class="num">T real</th><th class="num">Predicción congelada (fuera de muestra)</th><th class="num">Modelo vigente ${esc(vig.id)} (retro)</th><th class="num">E2 real / modelo</th></tr></thead>
      <tbody>${rows.join('') || '<tr><td colspan="6" class="muted">Sin labs durante el TRT.</td></tr>'}</tbody></table></div>
      <div class="legend-note">Verde ≤15% · amarillo ≤33% (margen actual del modelo) · rojo >33%. "Retro" = lo que el modelo vigente da hoy para ese momento: en el lab ancla es exacto por construcción, no valida nada. La columna que mide de verdad es la congelada.
      ${pre.length ? `<br>Labs pre-TRT (no se modelan): ${pre.map(l => `${fmtIso(l.at).slice(0, 5)}/${l.at.slice(2, 4)} T ${fmt(l.t_total)}`).join(' · ')}.` : ''}</div>`;

    // Lípidos: solo labs cargados con la app (tienen la predicción congelada con estatina).
    const lipLabs = log.entries.filter(e => e.tipo === 'lab' && e.prediccion?.lipidos).sort((x, y) => x.at.localeCompare(y.at));
    const lipRows = lipLabs.flatMap(e => ['ldl', 'apob', 'no_hdl', 'hdl', 'tg'].filter(k => typeof e.valores[k] === 'number' && typeof e.prediccion.lipidos[k] === 'number')
      .map(k => `<tr><td>${fmtIso(e.at)}</td><td><code>${e.id}</code></td><td>${k.toUpperCase().replace('_', '-')}</td><td class="num"><b>${fmt(e.valores[k])}</b></td><td class="num">${errCell(e.prediccion.lipidos[k], e.valores[k])}</td></tr>`));
    ui.querySelector('[data-pred]').insertAdjacentHTML('beforeend', `<h3>Lípidos — respuesta real a la estatina vs poblacional</h3>${lipRows.length
      ? `<div class="scroll-table" style="max-height:none"><table><thead><tr><th>Extracción</th><th>Lab</th><th>Lípido</th><th class="num">Real</th><th class="num">Predicción congelada</th></tr></thead><tbody>${lipRows.join('')}</tbody></table></div><div class="legend-note">Si tu LDL real baja menos que lo predicho, sos "hipo-respondedor" a la estatina: es un dato concreto para ${perfilOf(model).cardiologo} (dosis o ezetimibe).</div>`
      : '<div class="muted small">Todavía no hay labs de lípidos cargados desde la app (el primero con estatina va a medir tu respuesta real).</div>'}`);

    const p = calibrationProposal(log.entries, model);
    const box = ui.querySelector('[data-prop]');
    if (!p) box.innerHTML = '<div class="info-box">No hay labs durante el TRT para calibrar.</div>';
    else if (Math.abs(p.cambioPct) < 0.5) box.innerHTML = `<div class="good-box">La versión vigente ya está calibrada contra el lab más reciente (<code>${p.anchorId}</code>). No hay propuesta pendiente.</div>`;
    else {
      box.innerHTML = `<div class="warn-box"><b>Propuesta pendiente de sesión con Claude Code</b> — recalibrar contra <code>${p.anchorId}</code>: factor de escala ${fmt(p.scaleActual, 3)} → <b>${fmt(p.scalePropuesta, 3)}</b> (${p.cambioPct > 0 ? '+' : ''}${fmt(p.cambioPct, 1)}%). La app no la aplica.</div>
        <div class="scroll-table" style="max-height:none"><table><thead><tr><th>Lab</th><th class="num">Real</th><th class="num">Vigente</th><th class="num">Propuesta</th></tr></thead><tbody>
        ${p.vigente.map((r, i) => `<tr><td><code>${r.id}</code></td><td class="num">${fmt(r.real)}</td><td class="num">${errCell(r.pred, r.real)}</td><td class="num">${errCell(p.propuesta[i].pred, r.real)}</td></tr>`).join('')}
        </tbody></table></div><div class="legend-note">Recalibrar solo la escala con un lab nuevo lo vuelve exacto en ese lab; la pregunta real es si mejora los demás. Revisar en sesión también la hipótesis de ka personal (CLAUDE.md viejo, §6.1).</div>`;
    }

    ui.querySelector('[data-vers]').innerHTML = model.versiones.slice().reverse().map(v => {
      const pm = v.params;
      return `<div class="card" style="margin-bottom:10px;${v.id === model.vigente ? 'border-color:var(--good)' : ''}">
        <b>${esc(v.id)}</b> ${v.id === model.vigente ? '<span class="tag confirmada">vigente</span>' : ''} <span class="muted small">${esc(v.fecha)} · sesión ${esc(v.sesion || '—')}</span>
        <div class="small" style="margin-top:6px">${esc(v.motivo)}</div>
        <div class="muted small" style="margin-top:6px">scaleNL ${fmt(pm.scaleNL, 4)} · t½ enantato ${pm.kaE_halfLife} d · t½ cipionato ${pm.kaC_halfLife} d · SHBG ${pm.shbg} nmol/l · E2/T ${pm.kArom} ·
        anastrozol Emax ${pm.anastrozol.emax} / ED50 ${pm.anastrozol.ed50} mg/sem / t½ ${pm.anastrozol.halfLife} d · labs usados: ${(v.labsUsados || []).join(', ') || '—'}</div></div>`;
    }).join('');
  }
  // Anastrozol y estatina: la respuesta REAL de tu cuerpo, calculada con labs; hasta tener datos, se usa el promedio
  // poblacional y se muestra el plan para medirla.
  function renderRespuesta(log, model) {
    const mp = activeVersion(model).params, ai = anastrozolResponse(log.entries, mp), sr = statinResponse(log.entries);
    const aiHtml = ai
      ? `<div class="warn-box"><b>Propuesta pendiente de sesión:</b> ED50 ${fmt(mp.anastrozol.ed50, 3)} → <b>${fmt(ai.ed50Propuesto, 3)}</b> mg/sem — sos <b>${ai.potenciaRelativa >= 1 ? fmt(ai.potenciaRelativa, 1) + '× más sensible' : fmt(1 / ai.potenciaRelativa, 1) + '× menos sensible'}</b> al anastrozol que el promedio.</div>
         <table><thead><tr><th>Lab</th><th class="num">T / E2 reales</th><th class="num">Supresión esperada</th><th class="num">Supresión observada</th></tr></thead><tbody>${ai.labs.map(l =>
          `<tr><td><code>${l.id}</code> ${fmtIso(l.at)}</td><td class="num">${fmt(l.t)} / ${fmt(l.e2, 1)}</td><td class="num">${fmt(100 * l.supresionModelo)}%</td><td class="num"><b>${fmt(100 * l.supresionObservada)}%</b></td></tr>`).join('')}</tbody></table>
         <div class="legend-note">La proporción E2/T tiene ±8% propio: con 1 solo lab la estimación hereda ese margen; con 2-3 labs se afirma.</div>`
      : `<div class="info-box">Todavía se usa el <b>promedio poblacional</b> (no hay ningún E2 medido con anastrozol activo). <b>Plan:</b> 1/4 comprimido 2 veces por semana (ej. lunes y jueves), y E2 + T total ~2 semanas después de arrancar, a mitad de camino entre dos tomas. Con ese lab el sistema calcula tu sensibilidad real y la Calculadora puede apuntar a 22-30 con seguridad.</div>`;
    const srHtml = sr
      ? `<div class="warn-box"><b>Propuesta pendiente de sesión:</b> respuesta a la estatina ×${fmt(mp.estatinaFactor ?? 1, 2)} → <b>×${fmt(sr.factor, 2)}</b> ${sr.factor < 0.85 ? '— <b>hipo-respondedor</b>: dato concreto para ${perfilOf(model).cardiologo} (más dosis o ezetimibe)' : sr.factor > 1.15 ? '— respondés más que el promedio' : '— dentro de lo esperado'}.</div>
         <table><thead><tr><th>Lab</th><th class="num">LDL base → real</th><th class="num">Baja esperada</th><th class="num">Baja real</th></tr></thead><tbody>${sr.labs.map(l =>
          `<tr><td><code>${l.id}</code> ${fmtIso(l.at)}</td><td class="num">${fmt(l.base)} → ${fmt(l.ldl)}</td><td class="num">${fmt(l.bajaEsperadaPct)}%</td><td class="num"><b>${fmt(l.bajaObservadaPct)}%</b></td></tr>`).join('')}</tbody></table>`
      : `<div class="info-box">Todavía se usa el <b>promedio poblacional</b> de rosuvastatina (STELLAR). El primer LDL con la estatina (idealmente ≥ 3-4 semanas de tratamiento, es decir desde mediados de octubre) calcula tu respuesta real: si bajás menos de lo esperado sos hipo-respondedor y eso cambia la estrategia.</div>`;
    ui.querySelector('[data-resp]').innerHTML = `<div class="grid2"><div><h3>Anastrozol</h3>${aiHtml}</div><div><h3>Rosuvastatina</h3>${srHtml}</div></div>`;
  }

  st.subscribe(() => { if (!root.hidden) render(); else root.dataset.stale = '1'; });
  root.addEventListener('tab:show', () => { delete root.dataset.stale; render(); });
}
