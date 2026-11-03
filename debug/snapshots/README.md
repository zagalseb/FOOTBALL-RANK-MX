# Snapshots de regresión de stats

Guardia de regresión, **no verdad histórica**. Cada JSON es la salida de
`debug/snapshot_stats.mjs` para un partido de referencia.

| Archivo | Partido | Game id |
|---|---|---|
| full-plays.json | MTY vs AT (Final) | c0a826d4-5dfa-4279-942e-b3ecff24361c |
| penalties-fumbles.json | CCM vs CU | 2dd8daf7-5053-4f5c-8c32-acabbbacda83 |
| manual-only.json | AT vs AB (sin jugadas) | f75f4008-75b0-4455-911e-1995d52cf605 |

## Partido de prueba (Final)

MTY vs AT tiene kickoff en 2025 y es un partido de prueba. Desde la migración
`debug/migrations/2026-10-06_mty_at_temporada_2025.sql` está en **temporada 2025**, con los
140 jugadores de MTY y AT también en 2025. Los rosters 2026 de MTY y AT se cargarán después,
así que los partidos 2026 de esos equipos quedarán sin roster hasta entonces (esperado).

## Baselines

- `baseline_legacy/`: los baselines anteriores al cambio de C4 (identidad por número y
  etiqueta; `resolvePlayerKey` sin regla de apellido). Se conservan para comparar.
- Los JSON de este directorio: baseline actual, con identidad canónica y regla de apellido.

## Criterio de salida

Un cambio numérico solo se acepta si es **por contradicción de apellido**, cada
uno está listado y explicado. `debug/numeric_diff.py` compara contra la allowlist
dentro del script. Cualquier otra diferencia numérica en los 3 partidos falla.
Las diferencias de texto (nombres mostrados, `label`, `key`, `receiver`) no cuentan.

### Cambios numéricos aceptados

1. **Final, AT #35 Mandujano, solo 2 → 1.** La jugada de "Lucio Ascolani" (#35) se
   atribuía a Mandujano porque era el único #35 del roster 2026. El apellido
   contradice, así que ahora Ascolani es huérfano. Mandujano conserva su INT.

### Huérfanos nuevos del Final (no resueltos)

Los 140 jugadores de MTY y AT ya están en temporada 2025; estos tres números no están en esos rosters.

| Equipo | # | Referencia | Motivo |
|---|---|---|---|
| AT | 35 | Lucio Ascolani | apellido contradice a Mandujano (2026) |
| AT | 82 | Mauricio Santos | apellido contradice a Marco Vinicio García (2026) |
| AT | 56 | Steven Zambrano | AT no tiene #56 en el roster 2026 |

Observación: la referencia "Steven Zambrano" coincide con un jugador de MTY (#56 en
el roster de MTY). Puede ser una captura en el lado equivocado. No se corrige aquí.

## Reportes de solo lectura (2026-10-05)

`debug/surname_report.mjs`, con el mismo enumerador de referencias que `orphan_report.mjs`:

- **A. Número en el roster, apellido contradictorio (huérfano):** Final 5, CCM vs CU 0.
  Ninguno parece abreviatura, compuesto o typo: son apellidos distintos.
- **B. Mismo apellido, nombre distinto (resuelto):** 0 en ambos partidos.
- **Huérfanos por número ausente del roster:** CCM vs CU 26 (el roster de CCM está vacío;
  el de CU no tiene #23 ni otros números de sus jugadas).

## Temporada de los partidos de referencia

- Final MTY vs AT: `temporada = '2025'` (migración 2026-10-06).
- CCM vs CU y AT vs AB: `temporada = '2026'` (migración 2026-10-05).

## Fixtures congelados (2026-11-02)

Los tres partidos de referencia son filas vivas de Supabase que los operadores siguen editando
(el 2026-11-03 04:01 UTC se añadió la jugada 62 al Final y su `status` pasó de `final` a
`scheduled`). Para que un snapshot cambie **sólo cuando cambia el código**, las respuestas REST
que usa cada partido están congeladas en `debug/fixtures/<game_id>.json`
(`games`, `plays`, `team_game_stats_manual`, `player_game_stats_manual` y el roster).
**Los fixtures no se versionan**: `debug/fixtures/` está en `.gitignore` (datos reales, el repo es
público), así que viven sólo en la máquina de quien los congeló. En un clon nuevo, el script pide
`--freeze` (o `--live`) antes de poder correr.

- `node debug/snapshot_stats.mjs <label>:<game_id>` lee de los fixtures (por defecto).
- `--live` lee de Supabase. `--freeze [--max-seq N]` lee de Supabase y reescribe el fixture.
- El fixture del Final (c0a8) se congeló con `--max-seq 61`: **sin la jugada 62** (captura de
  prueba posterior, `e9e041bc-…`, MTY 2ª y 10, pase de Sarabia a Elizondo de 25 yds), para que
  coincida con la base tomada antes del lote 3. Su `games.status` en el fixture es `scheduled`.
- Los snapshots de este directorio se regeneraron una sola vez desde los fixtures. Contra la base
  anterior al lote 3 sólo cambian: Final, AT `firstDowns` 7 → 6 (c0a8·31, NF tras fair catch); CCM vs CU,
  el pase de 2dd8·18 (PI aceptada capturada con `stats_count` null) deja de contar (−1 intento,
  −1 jugada, −15 yds de pase del QB #3); y `meta.status` del Final.
- `debug/numeric_diff.py` compara contra `baseline_legacy` (era C4) y ya no pasa: los snapshots
  ahora incluyen las correcciones NCAA de los lotes 1 a 3 (H-01 a H-07, H-13, H-15), que esa
  lista de excepciones no contempla.
