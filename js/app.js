// Arranque: carga log + modelo, monta las 5 pestañas, indicador de guardado y captura de errores.
import * as st from './state.js';
import * as api from './store/api.js';
import { closeModal, esc } from './ui/common.js';
import { initRegistro } from './ui/registro.js';
import { initCurva } from './ui/curva.js';
import { initCalculadora } from './ui/calculadora.js';
import { initHistoria } from './ui/historia.js';
import { initModelo } from './ui/modelo.js';
import { initRespaldos } from './ui/respaldos.js';
import { initConfig } from './ui/config.js';

// Cualquier error de la UI queda en data/errors.json para revisarlo en sesión.
window.addEventListener('error', e => api.reportError({ modulo: 'ui', accion: 'error', mensaje: e.message, stack: e.error?.stack, archivo: `${e.filename}:${e.lineno}` }));
window.addEventListener('unhandledrejection', e => api.reportError({ modulo: 'ui', accion: 'promesa', mensaje: String(e.reason?.message || e.reason), stack: e.reason?.stack }));

const statusEl = document.getElementById('saveStatus');
st.onStatus((kind, text) => { statusEl.dataset.kind = kind; statusEl.textContent = text; });

document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modal').addEventListener('click', ev => { if (ev.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeModal(); });

function showTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => { p.hidden = p.id !== 'tab-' + name; });
  document.getElementById('tab-' + name).dispatchEvent(new Event('tab:show'));
  try { localStorage.setItem('motor-trt.tab', name); } catch { /* sin almacenamiento: no pasa nada */ }
}
document.getElementById('tabs').addEventListener('click', ev => { const b = ev.target.closest('.tab-btn'); if (b) showTab(b.dataset.tab); });

async function boot() {
  const fatal = document.getElementById('fatal');
  document.getElementById('backendTag').textContent = api.backendKind === 'github' ? '☁️ GitHub' : '💻 Local';
  initConfig(document.getElementById('tab-config'));
  try {
    // En GitHub Pages no hay servidor local: sin token configurado, ir directo a ⚙️ Config (sin pedir /api/*).
    if (api.backendKind === 'local' && location.hostname.endsWith('github.io')) throw new Error('sin-config');
    await st.load();
  } catch (e) {
    fatal.style.display = '';
    if (e.data?.error === 'log_missing') {
      const b = e.data.backups || [];
      fatal.innerHTML = `<b>No existe data/log.json.</b> ${b.length
        ? `Hay ${b.length} backup(s). Restaurar el más reciente (<code>${esc(b[0])}</code>): <button class="btn small" id="restoreLatest">Restaurar</button>`
        : 'Si es la primera vez, corré <code>node tools/migrate.mjs</code> en la carpeta motor-trt y recargá.'}`;
      document.getElementById('restoreLatest')?.addEventListener('click', async () => { await api.restoreBackup(b[0]); location.reload(); });
    } else if (api.backendKind === 'local') {
      fatal.innerHTML = `<b>No hay servidor local.</b> Si estás en el celular o en GitHub Pages, conectá tu repo privado en <b>⚙️ Config</b>. En la PC también podés abrir <code>start.bat</code>.`;
      showTab('config');
    } else {
      fatal.innerHTML = `<b>No se pudo cargar desde GitHub:</b> ${esc(e.message)}`;
      showTab('config');
    }
    st.setStatus('error', '✕ Sin datos');
    return;
  }
  const nombre = st.state.model?.perfil?.nombre;
  if (nombre) document.getElementById('subtitle').textContent = `Registro de dosis, curva real y calibración — ${nombre}`;
  st.setStatus('saved', `✓ Cargado (rev ${st.state.log.rev})`);
  initRegistro(document.getElementById('tab-registro'));
  initCurva(document.getElementById('tab-curva'));
  initHistoria(document.getElementById('tab-historia'));
  initCalculadora(document.getElementById('tab-calculadora'));
  initModelo(document.getElementById('tab-modelo'));
  initRespaldos(document.getElementById('tab-respaldos'));
  let tab = 'registro';
  try { tab = localStorage.getItem('motor-trt.tab') || 'registro'; } catch { /* ignorar */ }
  showTab(document.getElementById('tab-' + tab) ? tab : 'registro');
}
boot();
