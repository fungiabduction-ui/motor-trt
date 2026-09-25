// Pestaña ⚙️ Config: conectar este navegador (PC o celular) al repo PRIVADO de datos en GitHub.
import { loadConfig, saveConfig, clearConfig, createGithubBackend, DEFAULT_REPO } from '../store/backend-github.js';
import { backendKind, backendRepo } from '../store/api.js';
import { h, esc } from './common.js';

export function initConfig(root) {
  const cfg = loadConfig();
  root.innerHTML = '';
  const ui = h(`<div>
    <h2>Dónde se guardan tus datos</h2>
    <div class="${backendKind === 'github' ? 'good-box' : 'info-box'}">${backendKind === 'github'
      ? `☁️ <b>GitHub</b> — repo privado <code>${esc(backendRepo)}</code>. Cada guardado es un commit (historial = respaldo). Funciona desde cualquier dispositivo con este token.`
      : '💻 <b>Servidor local</b> (start.bat en la PC). Para usarlo desde el celular, conectá el repo privado de GitHub abajo.'}</div>

    <h2>Conectar GitHub</h2>
    <div class="field-row">
      <div class="field wide"><label for="cfgRepo">Repo de datos (privado)</label><input id="cfgRepo" value="${esc(cfg?.repo || DEFAULT_REPO)}"></div>
      <div class="field"><label for="cfgBranch">Rama</label><input id="cfgBranch" value="${esc(cfg?.branch || 'main')}"></div>
      <div class="field wide"><label for="cfgToken">Token (fine-grained)</label><input id="cfgToken" type="password" placeholder="${cfg ? '•••••• (ya configurado — dejá vacío para mantenerlo)' : 'github_pat_…'}" autocomplete="off"></div>
    </div>
    <div class="btn-row"><button class="btn" data-test>Probar conexión</button><button class="btn primary" data-save>Guardar y usar GitHub</button>
      ${cfg ? '<button class="btn danger" data-clear>Desconectar este dispositivo</button>' : ''}</div>
    <div data-out></div>

    <h2>Cómo crear el token (una vez por dispositivo, o reusar el mismo)</h2>
    <ol class="small" style="line-height:1.8">
      <li>En GitHub: <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token</b>.</li>
      <li><b>Repository access:</b> "Only select repositories" → solo <code>${esc(DEFAULT_REPO.split('/')[1])}</code>.</li>
      <li><b>Permissions → Repository → Contents: Read and write</b> (nada más; Metadata queda en solo lectura automáticamente).</li>
      <li>Vencimiento: el que prefieras (cuando venza, la app avisa "Token inválido o vencido" y se genera otro).</li>
      <li>Copiá el token, pegalo arriba, <b>Probar conexión</b> → <b>Guardar</b>.</li>
    </ol>
    <div class="muted small">El token queda solo en este navegador (ofuscado, no cifrado) y nunca sale de acá salvo hacia api.github.com. Con acceso solo a ese repo y solo a su contenido, aunque alguien lo viera no puede tocar nada más de tu cuenta.</div>
  </div>`);
  root.appendChild(ui);
  const out = ui.querySelector('[data-out]');
  const read = () => ({ repo: ui.querySelector('#cfgRepo').value.trim(), branch: ui.querySelector('#cfgBranch').value.trim() || 'main',
    token: ui.querySelector('#cfgToken').value.trim() || cfg?.token || '' });

  async function probar() {
    const c = read();
    if (!c.token) { out.innerHTML = '<div class="error-box">Pegá el token.</div>'; return false; }
    out.innerHTML = '<div class="muted small">⏳ Probando…</div>';
    try {
      const be = createGithubBackend(c);
      const info = await be.test();
      if (!info.privado) { out.innerHTML = `<div class="error-box">⚠ El repo <code>${esc(info.nombre)}</code> es <b>público</b>. Los datos tienen que ir en un repo privado.</div>`; return false; }
      const log = await be.getLog();
      out.innerHTML = `<div class="good-box">✓ Conectado a <code>${esc(info.nombre)}</code> (privado) · log rev ${log.rev}, ${log.entries.length} entradas.</div>`;
      return true;
    } catch (e) { out.innerHTML = `<div class="error-box">✕ ${esc(e.message)}</div>`; return false; }
  }
  ui.querySelector('[data-test]').addEventListener('click', probar);
  ui.querySelector('[data-save]').addEventListener('click', async () => { if (await probar()) { saveConfig(read()); location.reload(); } });
  ui.querySelector('[data-clear]')?.addEventListener('click', () => {
    if (confirm('¿Desconectar este dispositivo de GitHub? El token se borra de este navegador (los datos en GitHub no se tocan).')) { clearConfig(); location.reload(); }
  });
}
