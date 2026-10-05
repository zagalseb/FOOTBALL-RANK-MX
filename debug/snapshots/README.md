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
