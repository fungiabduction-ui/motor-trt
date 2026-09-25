// Backups (dentro de ⚙️ Config, como en biolab): guardar backup manual (archivo nuevo e inmutable + copia al disco),
// aviso de cambios sin guardar, cargar el último, y lista con tamaño coloreado contra el anterior, ¿qué cambió?,
// descargar y restaurar. En modo local (serve.py) muestra los backups automáticos de data/backups-local.
import * as api from '../store/api.js';
import * as wc from '../store/workcopy.js';
import { diffLogs } from '../store/diff.js';
import { parseBackup, sizeColors, stampLabel, backupText } from '../store/backup.js';
import { h, esc } from './common.js';
import { describeEntry } from './registro.js';
import * as st from '../state.js';

const kb = n => (n == null ? '—' : `${(n / 1024).toFixed(1)} KB`);
const val = v => v == null ? '<i>vacío</i>' : esc(typeof v === 'object' ? JSON.stringify(v) : v);

export function renderDiff(d, modeloCambio) {
  const strip = s => s.replace(/<[^>]+>/g, '');
  if (!d.added.length && !d.removed.length && !d.modified.length && !modeloCambio) return '<div class="good-box small">Sin diferencias.</div>';
  return `<div class="card small">
    ${modeloCambio ? '<div class="diff-mod"><b>~ cambió el modelo (model.json)</b></div>' : ''}
    ${d.added.length ? `<div class="diff-add"><b>+ ${d.added.length} agregada(s)</b></div><ul class="diff-list">${d.added.map(e => `<li><code>${e.id}</code> ${esc(strip(describeEntry(e)))}</li>`).join('')}</ul>` : ''}
    ${d.removed.length ? `<div class="diff-del"><b>− ${d.removed.length} eliminada(s)</b></div><ul class="diff-list">${d.removed.map(e => `<li><code>${e.id}</code> ${esc(strip(describeEntry(e)))}</li>`).join('')}</ul>` : ''}
    ${d.modified.length ? `<div class="diff-mod"><b>~ ${d.modified.length} modificada(s)</b></div><ul class="diff-list">${d.modified.map(m => `<li><code>${m.id}</code>: ${m.fields.map(f => `${esc(f.name)} ${val(f.before)} → ${val(f.after)}`).join(' · ')}</li>`).join('')}</ul>` : ''}
  </div>`;
}

export function mountBackups(root) {
  if (st.isGithub()) mountGithub(root); else mountLocal(root);
}

function mountGithub(root) {
  const ui = h(`<div>
    <div data-state></div>
    <div class="btn-row" style="margin:10px 0">
      <button class="btn" data-bk-save>💾 Guardar backup ahora</button>
      <button class="btn" data-latest>⬇ Cargar último backup</button>
      <button class="btn" data-dl-now>⬇ Descargar copia actual</button>
      <button class="btn small" data-refresh>↻ Actualizar lista</button>
    </div>
    <div data-msg></div>
    <div data-list></div>
    <div class="muted small" style="margin-top:6px">Cada backup es un archivo nuevo en <code>backups/</code> del repo privado — nunca se pisa. Tamaño: <span style="color:var(--good)">verde</span> creció, <span style="color:var(--real)">amarillo</span> igual, <span style="color:var(--bad)">rojo</span> bajó respecto del anterior (revisá qué cambió antes de confiar en uno más chico).</div>
  </div>`);
  root.appendChild(ui);
  const $ = s => ui.querySelector(s);
  let files = [];

  function renderState() {
    const b = st.state.base, dirty = st.hasUnsaved();
    $('[data-state]').innerHTML = `<div class="${dirty ? 'warn-box' : 'good-box'}">${dirty
      ? '<b>● Hay cambios sin guardar en GitHub.</b> Están solo en este navegador: guardá un backup para no perderlos y para verlos en el otro dispositivo.'
      : '<b>✓ Todo guardado.</b> No hay cambios desde el último backup.'}
      <div class="small muted" style="margin-top:4px">${b ? `${b.source === 'save' ? 'Último backup guardado' : 'Cargado desde'}: <b>${esc(stampLabel(b.name))}</b> · ${kb(b.size)}` : 'Todavía no hay ningún backup.'}</div></div>`;
    const save = $('[data-bk-save]');
    save.className = 'btn ' + (dirty ? 'primary' : '');
    save.disabled = !dirty;
    save.title = dirty ? '' : 'No hay cambios nuevos desde el último backup';
  }

  async function refresh() {
    $('[data-list]').innerHTML = '<div class="muted small">⏳ Cargando backups…</div>';
    try {
      files = await st.listBackups();
      const colors = sizeColors(files);
      const col = { up: 'var(--good)', same: 'var(--real)', down: 'var(--bad)', neutral: 'var(--text)' };
      $('[data-list]').innerHTML = files.length ? `<div class="scroll-table"><table><thead><tr><th>Fecha</th><th class="num">Tamaño</th><th>SHA</th><th></th></tr></thead><tbody>
        ${files.map((f, i) => `<tr><td style="white-space:nowrap">${esc(stampLabel(f.name))}${st.state.base?.name === f.path ? ' <span class="tag confirmada">actual</span>' : ''}</td>
          <td class="num" style="color:${col[colors[i]]};font-weight:600">${kb(f.size)}</td><td><code>${esc(f.sha.slice(0, 7))}</code></td>
          <td><div class="btn-row"><button class="btn small" data-act="diff" data-i="${i}">¿Qué cambió?</button><button class="btn small" data-act="dl" data-i="${i}">⬇ Descargar</button><button class="btn small danger" data-act="load" data-i="${i}">Restaurar</button></div></td></tr>
          <tr data-diff-row="${i}" hidden><td colspan="4"></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="muted">Todavía no hay backups en GitHub. Tocá <b>💾 Guardar backup ahora</b> para crear el primero.</div>';
    } catch (e) { $('[data-list]').innerHTML = `<div class="error-box">✕ ${esc(e.message)}</div>`; }
  }

  const okToReplace = () => !st.hasUnsaved() || confirm('Tenés cambios sin guardar en este navegador: se van a perder. ¿Seguir?');
  ui.addEventListener('click', async ev => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    const msg = $('[data-msg]');
    try {
      if (btn.matches('[data-bk-save]')) {
        const r = await st.saveBackup();
        msg.innerHTML = `<div class="good-box small">✓ Backup guardado en <code>${esc(r.path)}</code> · <b>${kb(r.size)}</b> — y descargado al disco.</div>`;
        await refresh();
      } else if (btn.matches('[data-latest]')) {
        if (!okToReplace()) return;
        if (await st.loadLatestBackup()) msg.innerHTML = '<div class="good-box small">✓ Cargado el último backup.</div>';
        else msg.innerHTML = '<div class="info-box small">No hay backups todavía.</div>';
        await refresh();
      } else if (btn.matches('[data-dl-now]')) {
        wc.downloadText('motor-trt-copia-actual.json', backupText({ log: st.state.log, model: st.state.model, errores: wc.read()?.errores || [] }));
      } else if (btn.matches('[data-refresh]')) {
        await refresh();
      } else if (btn.dataset.act) {
        const i = +btn.dataset.i, f = files[i];
        if (btn.dataset.act === 'dl') {
          wc.downloadText(f.name, await api.gh.getBackupText(f.path));
        } else if (btn.dataset.act === 'load') {
          if (!okToReplace() || !confirm(`¿Restaurar el backup del ${stampLabel(f.name)}? Reemplaza la copia de este navegador (los backups en GitHub no se tocan).`)) return;
          await st.loadBackup(f.path);
          msg.innerHTML = `<div class="good-box small">✓ Restaurado el backup del ${esc(stampLabel(f.name))}. Si querés que quede como el más reciente, guardá un backup.</div>`;
          await refresh();
        } else if (btn.dataset.act === 'diff') {
          const row = ui.querySelector(`[data-diff-row="${i}"]`), cell = row.firstElementChild;
          if (!row.hidden) { row.hidden = true; return; }
          row.hidden = false;
          const prev = files[i + 1];
          if (!prev) { cell.innerHTML = '<span class="muted small">Es el más viejo: no hay uno anterior para comparar.</span>'; return; }
          cell.innerHTML = '<span class="muted small">⏳ Comparando…</span>';
          const [a, b] = await Promise.all([api.gh.getBackupText(prev.path), api.gh.getBackupText(f.path)].map(p => p.then(parseBackup)));
          cell.innerHTML = `<div class="small muted">Contra el backup anterior (${esc(stampLabel(prev.name))}):</div>` +
            renderDiff(diffLogs(a.log, b.log), JSON.stringify(a.model) !== JSON.stringify(b.model));
        }
      }
    } catch (e) {
      msg.innerHTML = `<div class="error-box">✕ ${esc(e.message)}</div>`;
      api.reportError({ modulo: 'backups', accion: btn.textContent.trim(), mensaje: e.message });
    }
  });

  st.subscribe(renderState);
  renderState();
  refresh();
}

// Modo local (serve.py): backups automáticos del servidor en data/backups-local.
function mountLocal(root) {
  const ui = h(`<div>
    <div class="info-box">💻 Modo local: el servidor guarda cada cambio y copia la versión anterior en <code>data/backups-local/</code>. Para backups en GitHub (y usar el celular), conectá GitHub arriba.</div>
    <div data-list></div><div data-diff></div></div>`);
  root.appendChild(ui);
  const tsOf = name => { const m = name.match(/^log_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6]}` : name; };
  async function refresh() {
    try {
      const items = await api.listLocalBackups();
      ui.querySelector('[data-list]').innerHTML = items.length ? `<div class="scroll-table"><table><thead><tr><th>Fecha</th><th class="num">rev</th><th class="num">Entradas</th><th class="num">Tamaño</th><th></th></tr></thead><tbody>
        ${items.map(b => `<tr><td>${esc(tsOf(b.name))}</td><td class="num">${b.rev ?? '—'}</td><td class="num">${b.entries ?? '—'}</td><td class="num">${kb(b.size)}</td>
          <td><div class="btn-row"><button class="btn small" data-act="diff" data-name="${esc(b.name)}">¿Qué cambió?</button><button class="btn small danger" data-act="restore" data-name="${esc(b.name)}">Restaurar</button></div></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="muted small">Sin backups locales todavía.</div>';
    } catch (e) { ui.querySelector('[data-list]').innerHTML = `<div class="error-box">${esc(e.message)}</div>`; }
  }
  ui.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const name = b.dataset.name, box = ui.querySelector('[data-diff]');
    try {
      if (b.dataset.act === 'diff') box.innerHTML = renderDiff(diffLogs(await api.getLocalBackup(name), st.state.log));
      else if (confirm(`¿Restaurar ${tsOf(name)}?`)) { await api.restoreLocalBackup(name); await st.reloadAll(); refresh(); }
    } catch (e) { box.innerHTML = `<div class="error-box">${esc(e.message)}</div>`; }
  });
  st.subscribe(() => refresh());
  refresh();
}
