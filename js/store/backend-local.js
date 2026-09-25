// Cliente de la API de serve.py. Cualquier fallo de red se reporta como "NO se guardó" — nunca en silencio.
async function req(method, path, body) {
  let r;
  try {
    r = await fetch(path, {
      method, cache: 'no-store',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    const err = new Error('Sin conexión con el servidor — ¿está abierta la ventana de start.bat?');
    err.status = 0;
    throw err;
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.detail || data.error || `HTTP ${r.status}`);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const getLog = () => req('GET', '/api/log');
export const putLog = doc => req('PUT', '/api/log', doc);
export const getModel = () => req('GET', '/api/model');
export const listBackups = () => req('GET', '/api/backups');
export const getBackup = name => req('GET', '/api/backups/' + encodeURIComponent(name));
export const restoreBackup = name => req('POST', '/api/restore/' + encodeURIComponent(name));

// Nunca tira: si el servidor está caído, al menos queda en la consola.
export async function reportError(info) {
  try { await req('POST', '/api/errors', info); } catch (e) { console.error('No se pudo registrar el error', info, e); }
}
