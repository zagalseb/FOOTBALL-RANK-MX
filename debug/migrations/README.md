# Migraciones pendientes y aplicadas

## 2026-10-05_players_temporada.sql (PENDIENTE de OK)

Agrega temporada a players, normaliza nombre/apellido y permite números repetidos
dentro de un equipo (identidad por temporada, número, nombre y apellido).

- **Antes de aplicar**: confirmar OK explícito. Después, poner `PLAYERS_HAS_TEMPORADA = true`
  en `shared/stats-lib.js` (commit aparte).
- **Riesgo de rollback**: con números repetidos ya no se puede recrear `UNIQUE (team_id, number)`.
- **Transición**: `players.temporada` tiene `DEFAULT '2026'` solo de forma transitoria.
  **Quitar el DEFAULT antes de 2027** (`alter table covercero.players alter column temporada drop default;`).
- **Partido de prueba**: el Final (MTY vs AT) tiene kickoff 2025 y se asigna a temporada
  2026 porque no hay roster 2025 cargado. Reasignar a 2025 cuando se cargue ese roster.
- **Índice**: la unicidad usa `lower(trim(...))` en SQL; la app compara con `normName`
  (además sin acentos). Un nombre que solo difiere en acentos puede pasar la base de datos
  pero lo bloquea la app.
