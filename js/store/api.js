// Modo de datos: si este navegador tiene el repo privado de GitHub configurado (⚙️ Config) → modo GitHub (copia de
// trabajo en el navegador + backups manuales inmutables, como CFG de biolab); si no → servidor local serve.py (start.bat).
import * as local from './backend-local.js';
import { loadConfig, createGithubBackend } from './backend-github.js';
import * as wc from './workcopy.js';

const cfg = loadConfig();
export const backendKind = cfg ? 'github' : 'local';
export const backendRepo = cfg ? cfg.repo : null;
export const gh = cfg ? createGithubBackend(cfg) : null;

// Solo modo local (serve.py):
export const getLog = () => local.getLog();
export const putLog = doc => local.putLog(doc);
export const getModel = () => local.getModel();
export const listLocalBackups = () => local.listBackups();
export const getLocalBackup = name => local.getBackup(name);
export const restoreLocalBackup = name => local.restoreBackup(name);

// Errores: en modo GitHub quedan en la copia local y viajan con el próximo backup (nunca un commit automático).
export const reportError = info => (cfg ? wc.appendError(info) : local.reportError(info));
