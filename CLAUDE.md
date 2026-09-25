# Motor TRT — documentación técnica

App para registrar dosis de testosterona, fármacos, esquemas, síntomas y laboratorios, y reconstruir desde ese
registro la curva de testosterona, estradiol y lípidos, con calculadora/optimizador y calibración personal versionada.

**Este repo es PÚBLICO y contiene solo código.** Los datos y todo lo personal (historial, nombres, documentos
clínicos, fixtures y tests con datos reales) viven en el repo **privado** `MOTOR-TRT-DATA`, clonado en `data/`
(ignorado por este repo). Documentación clínica y bitácora completa: `data/docs/CLAUDE-motor-completo.md` (privado).

## Dónde se guardan los datos (patrón CFG de biolab-app)
- **Modo GitHub (principal, PC y celular vía Pages):** la app trabaja sobre una **copia en el navegador**
  (`js/store/workcopy.js`, localStorage `motor-trt.estado`); registrar es instantáneo y NO sube nada.
  **"💾 Guardar backup ahora"** (⚙️ Config → Respaldos) sube un archivo NUEVO e inmutable
  `backups/motor-backup-FECHA_DD-MM-AAAA_HORA_HH-MM-SS.json` = `{tipo, version, log, model, errores}` al repo privado
  y en el mismo momento descarga esa copia al disco. Nunca automático. Aviso de cambios sin guardar por huella
  (`js/store/backup.js → fingerprint`, contra `base` de la copia). Lista: tamaño coloreado vs el anterior
  (verde creció / amarillo igual / rojo bajó), SHA, ¿Qué cambió?, Descargar, Restaurar, Cargar último.
  Errores de la UI quedan en la copia local y viajan con el próximo backup (sin commits automáticos).
- **Modo local (sin internet):** sin token configurado → `start.bat`/`serve.py` escribe `data/log.json` en cada cambio
  con backup en `data/backups-local/` (gitignoreado; `log.json`/`model.json`/`errors.json` de la raíz de `data/`
  también: son solo de este modo).
- **Fuente de verdad para Claude Code:** el backup MÁS RECIENTE de `data/backups/` (tras `git -C data pull`).
  Si en sesión se cambia algo (ej. recalibrar el modelo): escribir un backup nuevo con `backupText()` en
  `data/backups/` (nombre con fecha/hora actual) + commit + push; en los dispositivos, "⬇ Cargar último backup".

## Reglas fijas
1. El log (dentro del backup más reciente) es la única fuente de verdad de eventos. Ningún dato personal en el código.
2. `model.json` cambia SOLO en una sesión con Claude Code (script → tests → versión nueva con motivo). La app propone
   (escala de T, ED50 del anastrozol, respuesta a la estatina), nunca escribe el modelo.
3. Cada lab nuevo congela la predicción de la versión vigente (`prediccion`) antes de recalibrar.
4. Fechas ISO con `-03:00`; el motor trabaja en "días desde 17/06/2026 00:00 hora local" (`js/engine/time.js`).
5. Datos personales que la UI muestra (nombres, contexto clínico) viven en `data/model.json → perfil`; el código los lee de ahí.

## En una sesión de Claude Code
- Antes de leer datos: `git -C data pull`. Después de editar `data/` (ej. recalibrar `model.json`): commit + push en `data/`.
- Tests: `npm test` (en esta PC también corre `data/tests/`, que usan la historia real) y
  `python -m unittest discover -s tests -p "test_*.py"`. Siempre en verde antes y después de tocar el motor.
- Probar escrituras SIEMPRE contra una copia (`serve.make_server('<copia>', 8799)`) o con la API de GitHub simulada
  (`tests/backend-github.test.js`), nunca contra los datos reales.

## Estructura
- `js/engine/` — motor puro, sin DOM: `time`, `pk` (no lineal SHBG/Vermeulen), `estradiol`, `projection`
  (log → dosis/slots/pendientes/vencidas), `scheme` (calculadora), `optimizer` (✨ dosis óptima), `calibration`,
  `respuesta` (ED50 / estatina personal), `lipids`, `curves`, `objetivos`.
- `js/store/` — `api` (modo), `backend-github` (backups en el repo privado), `backend-local`, `workcopy`, `backup`, `serialize`, `entries`, `diff`.
- `js/ui/` — una pestaña por archivo + `common`, `lipidchart`; `respaldos.js` se monta dentro de ⚙️ Config (no es pestaña).
- `serve.py` + `start.bat` — servidor local. `tools/migrate-history.mjs` — importa labs de un `data_raw.json`.

## Gotchas
- Chart.js no permite cambiar plugins inline de un chart vivo: la calculadora recrea sus charts en cada cálculo.
- Comparar entradas siempre con `diff.js` (canónico), nunca `JSON.stringify` directo: el orden de claves difiere.
- En Windows, `http.server` puede servir `.js` como `text/plain`: `serve.py` fuerza `text/javascript`.
