# Motor TRT — documentación técnica

App para registrar dosis de testosterona, fármacos, esquemas, síntomas y laboratorios, y reconstruir desde ese
registro la curva de testosterona, estradiol y lípidos, con calculadora/optimizador y calibración personal versionada.

**Este repo es PÚBLICO y contiene solo código.** Los datos y todo lo personal (historial, nombres, documentos
clínicos, fixtures y tests con datos reales) viven en el repo **privado** `MOTOR-TRT-DATA`, clonado en `data/`
(ignorado por este repo). Documentación clínica y bitácora completa: `data/docs/CLAUDE-motor-completo.md` (privado).

## Dónde se guardan los datos (patrón CFG de biolab-app)
- **GitHub (principal):** la app lee/escribe `log.json`, `model.json`, `errors.json` en el repo privado con la API de
  contenidos (`js/store/backend-github.js`). Cada guardado = 1 commit (mensaje `+ ID`, `~ ID`, `- ID`): el historial
  de commits es el respaldo (pestaña Respaldos). Token fine-grained (solo Contents R/W de ese repo), guardado en el
  navegador de cada dispositivo (pestaña ⚙️ Config). Solo `api.github.com`, sin proxies; reintento solo ante fallos de red.
- **Servidor local (sin internet):** `start.bat` → `serve.py` en `127.0.0.1:8735`, escribe en `data/` con backup +
  escritura atómica. Se usa si el navegador NO tiene token configurado. Lo guardado así hay que commitear/pushear
  a mano en `data/` para que lo vean los otros dispositivos.
- Concurrencia: `rev` (local) / `sha` (GitHub) → 409 si otro dispositivo guardó antes; la UI recarga sin pisar.
- `js/store/serialize.js` produce **el mismo texto** que `serve.py` (test de paridad): claves ordenadas, entradas por fecha.

## Reglas fijas
1. `log.json` es la única fuente de verdad de eventos. Ningún dato personal en el código.
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
- `js/store/` — `api` (elige backend), `backend-github`, `backend-local`, `serialize`, `entries`, `diff`.
- `js/ui/` — una pestaña por archivo + `common` (formato, referencias piso/techo, modal, formularios), `lipidchart`.
- `serve.py` + `start.bat` — servidor local. `tools/migrate-history.mjs` — importa labs de un `data_raw.json`.

## Gotchas
- Chart.js no permite cambiar plugins inline de un chart vivo: la calculadora recrea sus charts en cada cálculo.
- Comparar entradas siempre con `diff.js` (canónico), nunca `JSON.stringify` directo: el orden de claves difiere.
- En Windows, `http.server` puede servir `.js` como `text/plain`: `serve.py` fuerza `text/javascript`.
