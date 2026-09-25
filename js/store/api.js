// Elige dónde viven los datos: si este navegador tiene configurado el repo privado de GitHub (⚙️ Config) → GitHub
// (así funciona desde el celular vía GitHub Pages); si no → servidor local serve.py (start.bat, sin internet).
import * as local from './backend-local.js';
import { loadConfig, createGithubBackend } from './backend-github.js';

const cfg = loadConfig();
const be = cfg ? createGithubBackend(cfg) : { kind: 'local', ...local };

export const backendKind = be.kind;
export const backendRepo = be.repo || null;
export const getLog = () => be.getLog();
export const putLog = (doc, message) => be.putLog(doc, message);
export const getModel = () => be.getModel();
export const listBackups = () => be.listBackups();
export const getBackup = name => be.getBackup(name);
export const restoreBackup = name => be.restoreBackup(name);
export const reportError = info => be.reportError(info);
