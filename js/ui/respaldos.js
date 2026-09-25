// Pestaña Respaldos: backups automáticos (uno antes de cada guardado), diff campo a campo, descargar, restaurar.
import * as api from '../store/api.js';
import { diffLogs } from '../store/diff.js';
import { h, esc } from './common.js';
import { describeEntry } from './registro.js';
import * as st from '../state.js';

const tsOf = name => { const m = name.match(/^log_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6]}` : name; };
const val = v => v == null ? '<i>vacío</i>' : esc(typeof v === 'object' ? JSON.stringify(v) : v);

function download(name, obj) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function renderDiff(d) {
  const strip = s => s.replace(/<[^>]+>/g, '');
  if (!d.added.length && !d.removed.length && !d.modified.length) return '<div class="good-box">Sin diferencias con el log actual.</div>';
  return `<div class="card small">
    ${d.added.length ? `<div class="diff-add"><b>+ ${d.added.length} agregada(s) después de este backup</b></div><ul class="diff-list">${d.added.map(e => `<li><code>${e.id}</code> ${esc(strip(describeEntry(e)))}</li>`).join('')}</ul>` : ''}
    ${d.removed.length ? `<div class="diff-del"><b>− ${d.removed.length} eliminada(s) después de este backup</b></div><ul class="diff-list">${d.removed.map(e => `<li><code>${e.id}</code> ${esc(strip(describeEntry(e)))}</li>`).join('')}</ul>` : ''}
    ${d.modified.length ? `<div class="diff-mod"><b>~ ${d.modified.length} modificada(s)</b></div><ul class="diff-list">${d.modified.map(m => `<li><code>${m.id}</code>: ${m.fields.map(f => `${esc(f.name)} ${val(f.before)} → ${val(f.after)}`).join(' · ')}</li>`).join('')}</ul>` : ''}
  </div>`;
}

export function initRespaldos(root) {
  root.innerHTML = '';
  const ui = h(`<div>
    <div class="info-box" style="margin-top:14px">${api.backendKind === 'github'
      ? 'Cada guardado es un <b>commit</b> en tu repo privado: el historial completo queda en GitHub y nunca se pisa. Restaurar crea un commit nuevo con la versión vieja, así que también se puede deshacer.'
      : 'Antes de cada guardado, el servidor copia la versión anterior del log a <code>data/backups/</code>. Esas copias nunca se pisan. Restaurar primero respalda el estado actual, así que también se puede deshacer.'}</div>
    <div class="btn-row"><button class="btn" data-dl>⬇ Descargar log actual (JSON)</button><button class="btn" data-refresh>↻ Actualizar lista</button></div>
    <h2>Backups</h2><div data-list></div><div data-diff></div>
  </div>`);
  root.appendChild(ui);
  ui.querySelector('[data-dl]').addEventListener('click', () => download(`log_actual_rev${st.state.log.rev}.json`, st.state.log));
  ui.querySelector('[data-refresh]').addEventListener('click', refresh);
  ui.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const name = b.dataset.name, diffBox = ui.querySelector('[data-diff]');
    try {
      if (b.dataset.act === 'diff') {
        const old = await api.getBackup(name);
        diffBox.innerHTML = `<h3>Qué cambió desde ${name.startsWith('log_') ? 'el backup ' + esc(tsOf(name)) : 'el commit ' + esc(name.slice(0, 7))} hasta ahora</h3>` + renderDiff(diffLogs(old, st.state.log));
        diffBox.scrollIntoView({ behavior: 'smooth' });
      } else if (b.dataset.act === 'dl') {
        download(name.startsWith('log_') ? name : `log_${name.slice(0, 7)}.json`, await api.getBackup(name));
      } else if (b.dataset.act === 'restore') {
        if (!confirm(`¿Restaurar ${name.startsWith('log_') ? 'el backup ' + tsOf(name) : 'el commit ' + name.slice(0, 7)}? El estado actual se respalda antes, así que se puede deshacer.`)) return;
        await api.restoreBackup(name);
        await st.reloadAll();
        st.setStatus('saved', `✓ Restaurado ${name.startsWith('log_') ? tsOf(name) : name.slice(0, 7)}`);
        diffBox.innerHTML = '';
        refresh();
      }
    } catch (e) {
      diffBox.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
      api.reportError({ modulo: 'respaldos', accion: b.dataset.act, mensaje: e.message, backup: name });
    }
  });

  async function refresh() {
    const list = ui.querySelector('[data-list]');
    try {
      const items = await api.listBackups();
      list.innerHTML = items.length ? `<div class="scroll-table"><table><thead><tr><th>Fecha del backup</th><th class="num">rev</th><th class="num">Entradas</th><th class="num">Tamaño</th><th></th></tr></thead><tbody>
        ${items.map(b => `<tr><td>${b.date ? `${esc(new Date(b.date).toLocaleString('es-AR', { hour12: false }))}<div class="muted small">${esc(b.label || '')}</div>` : esc(tsOf(b.name))}</td><td class="num">${b.rev ?? '—'}</td><td class="num">${b.entries ?? (b.date ? '—' : '<span style="color:var(--bad)">ilegible</span>')}</td><td class="num">${b.size ? (b.size / 1024).toFixed(1) + ' KB' : '—'}</td>
          <td><div class="btn-row"><button class="btn small" data-act="diff" data-name="${esc(b.name)}">Ver cambios</button><button class="btn small" data-act="dl" data-name="${esc(b.name)}">Descargar</button><button class="btn small danger" data-act="restore" data-name="${esc(b.name)}">Restaurar</button></div></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="muted">Todavía no hay backups (se crea el primero con el próximo guardado).</div>';
    } catch (e) { list.innerHTML = `<div class="error-box">${esc(e.message)}</div>`; }
  }
  st.subscribe(() => { if (!root.hidden) refresh(); });
  root.addEventListener('tab:show', refresh);
}
