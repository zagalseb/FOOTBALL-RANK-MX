# Casos NCAA (auditoría `docs/auditoria_ncaa/`)
Correr desde la raíz del repo: `node debug/ncaa_cases/run.mjs` (opcional: `node debug/ncaa_cases/run.mjs salida.json` guarda el detalle).
Imprime los casos en verde y los que difieren de `resultado_actual_codigo` (resultado de la auditoría original).
Cada caso de `casos_de_prueba.json` tiene `salida_esperada`; los numéricos admiten `tolerancia` (p. ej. TC-01: 0.01).
Solo lectura: importa `shared/stats-lib.js` y simula el submit de `wizard.js`; no escribe en Supabase.
