# Hallazgos — cálculo de estadísticas vs. NCAA Football Statisticians' Manual 2011

Auditoría **solo lectura** (no se modificó código). Cada hallazgo se verificó ejecutando `shared/stats-lib.js` contra un caso derivado de un A.R. del manual; el detalle (jugadas de entrada, salida esperada, resultado actual) está en [casos_de_prueba.json](../../debug/ncaa_cases/casos_de_prueba.json). Reglas por A.R.: [matriz_reglas.md](matriz_reglas.md).

**Resultado global:** de 41 casos ejecutados, 40 fallan hoy y 1 pasa (TC-39, PBU). Eso es una muestra dirigida a las áreas prioritarias, no una tasa de error del sistema.

Severidad = impacto sobre las cifras que ve el usuario (box score, líderes, marcador) × frecuencia con la que ocurre en un juego real.

---

## Causa raíz que explica varios hallazgos

1. **`net_yards` sólo se calcula si existe `at`** (`wizard.js:1692`). Las ramas de **fumble** y de **safety** no tienen `at`, así que su `net_yards` es `null` (H-01, H-03).
2. **Un flag aceptado anula la jugada completa** cuando su `down_result` es repeat/loss/first y el timing no es `dead` (`wizard.js:1866`). Es correcto para faltas en/detrás de la LOS, pero el manual exige que la jugada cuente en varios casos (H-06, H-07).
3. **`stats_count` no se respeta de forma uniforme.** `buildOffenseMaps`/`computePlayerStats`/`QBProgression` lo respetan; `computeDefenseStats`, `computeSpecialTeamsStats`, `computeFumbleStats` y `computeTurnover*` no; `computeComparisonStats` lo respeta a medias (H-08).
4. **La defensa se infiere como "el equipo sin posesión"** (`computeDefenseStats` l.2026, `computePlayerStats` l.148). Falla cuando quien actúa pertenece al otro equipo: tackles de ofensivos tras turnover, forzador de fumble en retornos, cobertura de patadas (H-09).

---

## A. Errores de cálculo corregibles con los datos que ya se capturan

### H-01 · Fumbles: la jugada pierde sus yardas — **ALTA**
- **Regla:** §13 Art.1-3; §2 Art.2; §16 Art.4 A.R.7-10; §1 Art.4-5.
- **Dónde:** `live-stats/capture/wizard.js:1692-1698` (`_renderSubmit`, `net_yards` sólo desde `at`); `shared/stats-lib.js` `buildOffenseMaps` (l.2501), `computePlayerStats` (l.111), `computeComparisonStats` (l.374), `_isFirstDownPlay` (l.293).
- **Qué pasa:** en RUSH/PASS/sack con `result:'fumble'` no existe `at`; el portador queda con `att` +1 y **0 yardas**; el equipo pierde esas yardas en rush/pass/total/drive. Strip-sack: QB con 0 en vez de −8, TFL y yardas de sack en 0.
- **Casos:** TC-08 (esperado 6 yds, actual 0), TC-07, TC-09.
- **Corrección posible (no aplicada):** derivar la yarda final de `fumble_recovered_at` (o `fumble_at_result` si la recuperación se avanzó, según §13 Art.2-3) cuando no hay `at`.
- **Cuidado al corregir:** hoy S1-4 ("sin primer down si se pierde la posesión") cumple *por accidente* porque `net_yards` es null. Al arreglar H-01 hay que excluir fumbles perdidos de `_isFirstDownPlay`, o se crea una regresión (ver H-13).

### H-02 · Passer rating usa la fórmula NFL, no la NCAA — **ALTA**
- **Regla:** B.I.16 (fórmula y muestra oficial: 98/166, 1567 yds, 16 TD, 7 INT = **161.71**).
- **Dónde:** `shared/stats-lib.js:2588` `_passerRating`; consumido por `viewer.html` (`_passingRows`, BasicBoxScore) y `buildLeaders` (l.3032) → `leaders.html` ("Rating de pasador").
- **Qué pasa:** con la misma muestra devuelve **105.17**. La fórmula NFL tiene topes por componente; la NCAA no. Todos los ratings publicados están mal, y `leaders.html:326` los etiqueta "fórmula clásica NCAA/NFL, 0–158.3".
- **Caso:** TC-01. Relacionado: mínimo de ranking 10 intentos/juego del equipo vs. 15/juego jugado (TC-37, H-18).
- **Corrección posible:** `(8.4·Yds + 100·Comp + 330·TD − 200·Int) / Att` y quitar la etiqueta 0–158.3.

### H-03 · Safety: no se anota en sack/scramble, no hay yardas, y el estado queda mal — **ALTA**
- **Regla:** §12; §3 Art.10 A.R.3; §6 A.R.3-6.
- **Dónde:** `stats-lib.js` `advanceGameState`: rama `sack`/`scramble` (l.1741-1770) **no consulta `result==='safety'`**; rama final RUSH (l.1846-1854) puntúa pero llama `_advanceDownDistance` antes y no pasa la posesión al free kick; `punt_muff` safety (l.1453) y `SNAP_FUMBLE` safety (l.1594) no fijan spot/down (ejecutado, TC-16); `PASS complete` con safety (l.1815) sigue el mismo patrón por lectura de código.
- **Qué pasa:** (1) sack o scramble en la propia end zone: **0 puntos**; (2) en rush con safety el portador queda con 0 yardas (falta `at`, ver H-01) en vez de −5; (3) tras el safety el estado queda con down avanzado y spot viejo en vez de free kick desde la 20 del que cedió.
- **Casos:** TC-15 (esperado 2/2, actual 0/0), TC-14, TC-16.

### H-04 · Fumble recuperado por el propio equipo en la end zone no anota — **ALTA**
- **Regla:** §13 Art.2 A.R.3-4 (recuperador anota TD por rushing/passing).
- **Dónde:** `stats-lib.js:1943-1949` `_advanceFumble`: `if (possessionChanged) _addPoints(...)`.
- **Qué pasa:** `isTD` es verdadero pero sólo se suman los 6 puntos si cambió la posesión. Marcador −6 y sin TD para el recuperador; `touchdown` no se persiste en esa jugada.
- **Caso:** TC-13 (esperado 6, actual 0).

### H-05 · Pérdida de posesión en 4ª down no cambia la posesión — **ALTA**
- **Regla:** §9 (posesión hasta pérdida de la misma); toda estadística posterior depende de `possession`.
- **Dónde:** `stats-lib.js:1985-1997` `_advanceDownDistance` (4ª down fallida ⇒ `down=1, distance=10`, misma posesión); ramas incompleto (l.1731-1739) y sack.
- **Qué pasa:** después de un 4º down sin convertir el estado propone 1ª y 10 para el mismo equipo. Si el operador no corrige con `set_possession`/`start_drive`, **todas las jugadas siguientes se atribuyen al equipo equivocado** (ofensiva, defensa, drives, red zone).
- **Caso:** TC-17. (Depende del operador; el sistema no lo previene ni lo avisa.)

### H-06 · Penalidades: anulan jugadas válidas, mal yardaje y yardas dentro de las del equipo — **ALTA**
- **Regla:** §14 Art.1-4; B.I.4; §5 Art.1-2.
- **Dónde:** `wizard.js:1866-1880` `_flagVoidsPlay`; `stats-lib.js:433-467` `computePenalties`; `stats-lib.js:300-318` `_effectiveNetYards`; `computeComparisonStats` l.374/388.
- **Qué pasa:**
  1. Falta de **B** en corrida que termina **más allá de la LOS** (el caso más común): el manual manda contar la corrida y cargar la penalidad aparte. El wizard sólo ofrece `live` (anula) o `dead` (suma). Con `live` se pierde la corrida (TC-29: esperado 5 yds, actual 0).
  2. `computePenalties` mide `|new_los − field_pos|` (desplazamiento total desde el snap), no la penalidad: 30 en vez de 10 (TC-28), 30 en vez de 15 (TC-31), 15 en vez de 10 (TC-29).
  3. Con `dead` la corrida/pase cuenta, pero `_effectiveNetYards` **suma la penalidad** a `rushYds`/`passYds` de equipo: 30 en vez de 20 (TC-28), 30 en vez de 15 (TC-31). Rompe "total offense = rush + pass" (§5) y que el equipo coincida con la suma de individuales.
  4. Falta **ofensiva** más allá de la LOS (§14 Art.1): se anula y la penalidad sale 2 en vez de 15 (TC-30). Aquí sí falta un dato: el spot de la falta (ver B-02).
- **Casos:** TC-28, TC-29, TC-30, TC-31.
- **Corrección posible:** para penalidad en jugada que cuenta, `yardas = |new_los − fin_de_corrida (at)|`; en anuladas, `|new_los − field_pos|`; no sumar penalidad a las yardas de equipo.

### H-07 · Intentional grounding — **ALTA**
- **Regla:** §3 Art.10 A.R.1-4; §16 Art.4 A.R.5; B.I.8 A.R.5.
- **Dónde:** `engine.js:596` (IG es sólo un código de penalidad); `wizard.js:_flagVoidsPlay`; `stats-lib.js` `computePenalties`, `computeComparisonStats` (l.363).
- **Qué pasa:** el IG se captura como PASS incompleto + flag `loss_of_down` ⇒ jugada anulada: (a) **sin intento de pase** (correcto); (b) **sin rush negativo** al pasador (esperado 1 att, −8); (c) penalidad cargada con **8** yardas en vez de 0; (d) en 3ª down no cuenta el intento de 3ª (TC-06); (e) sin sack/solo/TFL al presionador.
- **Casos:** TC-05, TC-06.
- **Grupo:** (a) para rush negativo, penalidad 0 y 3ª down (se deduce del `new_los` del flag, que ya es el spot de la falta); (b) para el crédito de sack, porque no se captura quién presionó.

### H-08 · Se acreditan estadísticas en jugadas que deben ignorarse — **ALTA / MEDIA**
- **Regla:** §14 Art.5 (jugada nula no se registra); §6 Art.5 A.R.; §11 Art.4 (PAT no es jugada de scrimmage); §13 Art.1 (PAT sin fumble).
- **Dónde:** `computeDefenseStats` (l.2024-2058), `computePlayerStats` (l.148-171), `computeSpecialTeamsStats` (l.2085-2126), `computeFumbleStats`, `computeTurnover*`; `computeComparisonStats` (l.339-361 antes del `continue` de l.363).
- **Qué pasa:** sack/tackle/INT de jugada anulada siguen contando (TC-25: sack anulado por holding ofensivo sigue en 1 sack, 1 solo y 1 sack de equipo); punt con falta personal en vuelo sigue contando (TC-41); en PAT/2 pts se acreditan INT, tackles, PBU, fumble de equipo y **primer down** (TC-26).
- **Casos:** TC-25, TC-26, TC-41.
- **Corrección posible:** una función común `countsForStats(p)` (`stats_count !== false` y `play_type !== 'PAT_TRY'`) usada por todas.

### H-09 · Tackles/FF acreditados al equipo equivocado o no acreditados — **ALTA**
- **Regla:** B.I.15 y §16 intro ("tackles in kick coverage and tackles made by offensive players after turnovers"); §16 Art.6.
- **Dónde:** `computeDefenseStats` l.2026-2037 y l.2045; `computePlayerStats` l.148-167.
- **Qué pasa:**
  1. **Cobertura de patadas:** `kick_return_tackle_by`, `punt_return_tackle_by`, `fg_ret_tackle_by`, `punt_muff_tackle_by`, `snap_fumble_tackle_by`, `*_bad_snap_tackle_by`, `fumble_2_tackle_by` no están en `tackleArrays` ⇒ ningún tackle de cobertura cuenta (TC-23).
  2. `return_tackle_by` / `fumble_tackle_by` / `punt_block_ret_tackle_by` sí están, pero se acreditan al equipo **sin posesión** aunque los tackleadores sean del otro equipo (el ofensivo que tacklea tras INT): Adams #12 (A) aparece en la plantilla de B (TC-24).
  3. Mismo patrón con `fumble_forced_by`/`fumble_2_forced_by` en retornos (TC-12) y con el campo de fumble de nivel 2.
  4. El forzador de fumble no recibe solo tackle (TC-40).
- **Casos:** TC-23, TC-24, TC-12, TC-40.
- **Corrección posible:** acreditar según el equipo del tackleador (la captura ya usa `teamFrom`/`invertTeamFrom` para pedirlo) en lugar de `defTeam`.

### H-10 · Fumbles de equipo: nivel 2, retornos, muffs y snap malo — **ALTA**
- **Regla:** §13 Art.1,7,8; §8 Art.2,3,7; §15; §6 Art.7; §10 Art.6.
- **Dónde:** `computeComparisonStats` l.343 (`p.result === 'fumble'` únicamente); `computeFumbleStats`/`_fumbleOccurred` (l.2189-2220); `_fumbleCarrier`.
- **Qué pasa:**
  - **Nivel 2:** un 2º fumble no suma fumble ni "perdido" (si A recupera su fumble y lo vuelve a perder, `fumblesLost`=0). TC-11: esperado A 2 fumbles/1 perdido, actual 1/0; Allen sin fumble.
  - **Retornos (KR/PR/INT/FG):** el fumble se carga a `p.possession` (pateador/pasador) en `computeFumbleStats`, con `lost` **invertido**, y el comparativo no los cuenta. TC-12: esperado B 1 perdido, actual 0.
  - **Muff de punt:** sin fumble, sin retorno negativo, punt de 0 yds (TC-22). El branch `punt_muff` no captura quién hizo el muff (el jugador es (b)).
  - **Snap malo / SNAP_FUMBLE:** recuperado por el rival no genera fumble ni turnover ni pérdida de equipo; recuperado por el propio equipo se carga como rush del QB (TC-34).
- **Casos:** TC-11, TC-12, TC-22, TC-34.

### H-11 · Sacks, tackle solo y TFL — **MEDIA**
- **Regla:** §16 Art.1-4, B.I.15.
- **Dónde:** `computeDefenseStats` l.2039-2043; `computePlayerStats` l.160-164; `computeComparisonStats` l.351-359.
- **Qué pasa:** el sack suma `solo` aparte de `tackle_by` ⇒ **2 solos** en una jugada si el operador captura ambos (TC-03, el wizard pide `tackle_by` tras el sack); el sacker **no recibe TFL** (TC-02); no hay yardas de TFL individuales (TC-38); el TFL de equipo (`tflMade`) excluye sacks, mientras que el manual los define como un tipo de TFL; sack asistido no existe (`sack_by` único, (b), TC-04).
- **Casos:** TC-02, TC-03, TC-04, TC-38.

### H-12 · Punting: yardas, "inside 20", bloqueados y net punting — **MEDIA**
- **Regla:** §6 Art.1,5,7; §7 Art.1; §8 Art.7; B.I.14, B.I.16.
- **Dónde:** `computeSpecialTeamsStats` l.2089-2126.
- **Qué pasa:**
  - `downed`, `muffed`, `blocked` y `bad_snap` cuentan el punt (`no++`) con **0 yds** (el spot sí está capturado: `punt_downed_at`, `punt_muff_at`) ⇒ promedio y largo bajan (TC-18, TC-22).
  - **In-20:** se mide en el punto donde cae (no donde termina el retorno), incluye la 20 exacta y omite los `downed` (TC-18, TC-19).
  - **Bloqueado** se carga al pateador; el manual lo manda a "Team" y el bloqueador recibe punt return (TC-20).
  - **No existe net punting** (TC-21).
- **Casos:** TC-18 a TC-22, TC-41.

### H-13 · Primeros downs — **MEDIA**
- **Regla:** §1 Art.1,2,4,5; §11 Art.4.
- **Dónde:** `stats-lib.js:291-298` `_isFirstDownPlay`, uso en `computeComparisonStats` l.361.
- **Qué pasa:** (1) booleano ⇒ nunca hay 2 primeros downs en la misma jugada (TC-28, TC-31); (2) un TD en 1ª y gol cuenta primer down (TC-32); (3) un 2-pt exitoso cuenta primer down (TC-26); (4) fumble recuperado por A que da primer down no se acredita (TC-09) — y al corregir H-01 hay que cuidar Art.4.
- **Casos:** TC-09, TC-26, TC-28, TC-31, TC-32.

### H-14 · Red Zone — **MEDIA**
- **Regla:** B.I.13.
- **Dónde:** `computeComparisonStats` l.394-403 (`yardline_100 ≤ 20` al snap).
- **Qué pasa:** un TD de pase de 35 yds desde fuera de la 20 no es "trip" ni "TD en red zone" (TC-36); tampoco una posesión que cruza la 20 en la última jugada. Sólo se cuentan TD (no FG), lo cual el manual no define.
- **Caso:** TC-36.

### H-15 · Retornos de turnover — **BAJA**
- **Regla:** §3 Art.6 A.R.1; B.I.5.
- **Dónde:** `Math.max(…,0)` en `stats-lib.js:2264, 2304, 2356`.
- **Qué pasa:** INT con retorno negativo (−10) se registra en 0; recuperaciones sin retorno se listan como "fumble return" (TC-10); el all-purpose no incluye runbacks de FG.
- **Casos:** TC-33, TC-10.

### H-16 · PAT y 2 puntos — **BAJA**
- **Regla:** §11.
- **Qué pasa:** no hay intentos/convertidos de PAT por pateador ni "Team" (TC-27), ni puntos por jugador, ni contadores de "defensive extra point"; el marcador sí es correcto (+1, +2 ofensivo, +2 defensivo, con una salvedad hallada por lectura de código, sin caso ejecutado: un PAT de pase completo que termina en fumble regresado a TD por la defensa no puntúa, porque `advanceGameState` sólo contempla `complete`+`touchdown` e `intercepted` para `pat_type:'pass'`).
- **Dónde:** `computeSpecialTeamsStats` (no maneja `PAT_TRY`); `advanceGameState` l.1706-1723.
- **Caso:** TC-27.

### H-17 · Tiempo de posesión y scoring drives — **MEDIA**
- **Regla:** B.I.9, B.I.10.
- **Dónde:** `viewer.html:333-384` (`_isScrimmagePlay`, `computeDriveRows`); TOP de equipo no existe en juegos PBP (`viewer.html:936-940` lo descartó).
- **Qué pasa:** no hay TOP por equipo; el TOP por drive resta el reloj del primer y último snap (omite la duración de la última jugada), da `null` si el drive cruza cuarto y empieza en el kickoff (válido para TOP, incorrecto para tiempo de scoring drive); el conteo de jugadas incluye penalidades que repiten down y jugadas anuladas.
- **Sin caso ejecutable** (la lógica vive en viewer.html, no importable); evidencia por lectura de código.
- **Grupo:** (a) para el conteo de jugadas y el inicio del tiempo; (b) para un TOP exacto, porque no se guarda el reloj al final de cada jugada.

### H-18 · Líderes y mínimos — **BAJA**
- **Regla:** B.I.16 NOTE (15 intentos por juego jugado), B.I.7 (75 % de juegos).
- **Dónde:** `stats-lib.js:2945` `LEADER_MIN_PER_TEAM_GAME = { pass: 10, rush: 5, rec: 1.5 }` (por juego del equipo, no del jugador); `buildLeaders` no aplica el 75 %.
- **Caso:** TC-37. Rush 10/juego es el umbral NCAA nacional pero no está en el manual provisto: **verificar vigencia/fuente**.

### H-19 · Penalidad aceptada antes de un cambio de posesión: la posesión no se devuelve — **MEDIA**
- **Regla:** §1 Art.4, §14; reglamento: una falta de B aceptada que ocurrió antes del cambio de posesión devuelve el balón a A.
- **Dónde:** `stats-lib.js` `applyFlags`/`_applyFlag` (sólo mueve `field_pos` y el down; la posesión queda como la dejó `advanceGameState`); `_penaltyFirstDown`.
- **Qué pasa:** en una jugada con **fumble perdido** o **intercepción** y una falta de B aceptada, el estado siguiente sigue dando el balón a B. El fumble/INT se cuenta como perdido y no se acredita el primer down por penalidad. Mientras no se corrija la posesión, `_penaltyFirstDown` devuelve 0 a propósito: contar ese primer down se lo daría a un equipo que, según el estado, no tiene el balón.
- **Caso:** TC-44 (**limitación conocida**, no regla correcta: hoy espera 0 primeros downs).

### H-20 · `applyFlags` deja `distance` = 47 en el estado del kickoff tras una falta en el PAT — **BAJA**
- **Dónde:** `stats-lib.js` `_applyFlag`, rama `repeat_down`: `distance = play.distance − net`, con `play.distance = 0` en un PAT_TRY y `net` negativo (BBB3 → AAA50 = −47).
- **Qué pasa:** el spot, la posesión, el down y el marcador quedan bien; sólo `distance` queda en 47 en vez de 0. En un kickoff no se usa, pero se ve en el estado.
- **Caso:** TC-48 (verifica spot/posesión/down, no `distance`).

### H-21 · Modo edición: "Presionado por" usa la posesión del estado actual del juego — **BAJA**
- **Dónde:** `live-stats/capture/wizard.js` `renderByMenu` (`team: 'opponent'` se resuelve con `gameState.possession`), usado por el paso `flag_N_pressured_by` y por los demás pasos "del rival" (tackle, sack, etc.).
- **Qué pasa:** al editar una jugada anterior, la lista de jugadores del presionador sale del equipo opuesto a la posesión **actual** del juego, no a la de la jugada editada. Si la posesión cambió desde entonces, se ofrece el roster equivocado.
- **Alcance:** limitación previa de todos los pasos "del rival" en edición; `pressured_by` sólo la hereda.

---

## B. Reglas que requieren capturar datos nuevos (candidatas a segunda pasada con video)

| ID | Qué falta capturar | Regla | Impacto | Alternativa de bajo costo |
|---|---|---|---|---|
| B-01 | **Marca kneel / spike / pase al suelo** (jugada de equipo) | §12; §3 Art.10 A.R.8; B.I.8 A.R.3 | Intentos/rush del QB inflados con −1/−2; mala eficiencia de 3ª down | Un solo campo `team_play: 'kneel'|'spike'` en el wizard |
| B-02 | **Spot de la falta / de aplicación** de cada flag | §14 Art.1 A.R.3, Art.4; B.I.4 | Yardas de penalidad ofensiva más allá de la LOS; rush neto (TC-30) | Campo `flag_N_enforced_from` con `AT` |
| B-03 | **Presionador en IG** y **segundo sacker** (`sack_by` único) | §3 Art.10, §16 Art.4 A.R.2 | Sack al jugador correcto; sacks asistidos (TC-04) | `sack_by` multiple + `pressured_by` |
| B-04 | **Laterales, pitcheos, run-option, errant pitch, lateral del receptor** | §2 Art.5-9; §3 Art.2; §4 | Atribución rush/rec al jugador correcto | Dos campos `lateral_by` / `lateral_at` |
| B-05 | **Retornos con varios jugadores** y toque a no-jugador | §8 Art.4-6, 8, 9 | Retornos y yardas por jugador | Campo `returner_chain` |
| B-06 | **Quién hizo el muff** y quién tocó el balón | §8 Art.3, 7 | Retorno negativo y fumble al jugador (el equipo ya es corregible, H-10) | `punt_muff_by` |
| B-07 | **Hora de fin de jugada** (reloj al terminar) | B.I.9 | TOP exacto por equipo y por scoring drive | Capturar reloj final sólo en la última jugada de cada posesión |
| B-08 | Pase batido recogido por el pasador, segundo pase ilegal, pase atrás interceptado | §3 Art.5,14; §4 Art.4 | Casos raros | Juicio del operador con nota libre |
| B-09 | Bloqueo "materialmente afectó" (punt/FG) | §7 Art.5 | Juicio | Pregunta Sí/No |
| B-10 | Condición de PBU (contacto/tackle simultáneo) y PBU compartido | §16 Art.5 | Calidad del dato | Ayuda en pantalla |

---

## C. Riesgos de regresión al corregir (para planear el orden)

1. Corregir **H-01** vuelve a contar el primer down en fumbles perdidos si no se actualiza `_isFirstDownPlay` (**H-13**).
2. Corregir **H-06** cambia `_effectiveNetYards`, que consumen `computeComparisonStats`, `computeExplosivePlays` y las yardas por drive de viewer.html; los totales de drive y de equipo cambiarán.
3. Unificar `stats_count` (**H-08**) modifica totales históricos de defensa y de equipos ya publicados.
4. `debug/snapshot_stats.mjs` y sus snapshots existen: conviene regenerar la línea base antes de corregir y dejar los cambios esperados documentados.

## D. Reglas marcadas "verificar vigencia" (no son errores)

- Punto de touchback en kickoff (manual: 20; código: 25) y spot tras fair catch de kickoff (código fija 25 y no usa `fair_catch_at`).
- Kickoff desde la 30 (A.R. §11) vs. la 35 que usa el código.
- Overtime desde la 25, 2 pts obligatorios en OT largos, one-point safety defensivo en PAT.
- Regla de spot de pass interference defensiva (§3 Art.8).
- Política 2004 de estadísticas defensivas "sólo del press box" frente a una segunda pasada con video.
- Mínimo de rush 10/juego (no está en este manual).

## E. Qué sí cumple (para no tocarlo)

- Solo/asistido y asignación de TFL básicos (TC-38, salvo yardas), PBU sin INT (TC-39).
- Sack y scramble como rush del QB y no como intento de pase; "sacked" en la línea del pasador sin doble conteo en totales.
- Pase completo detrás de la LOS (yardas negativas), PI/ineligible/IG/fuera de límites **sin intento de pase** (por la anulación).
- 3ª down: FG excluido, primer down por penalidad excluido, conversión con falta posterior (dead).
- Punts a touchback medidos hasta la goal line; retorno de punt/kickoff medido desde el punto de recepción (puede ser negativo); retorno de FG bloqueado no entra a punt returns.
- Marcador de TD, FG, PAT 1 y 2 pts, 2 pts defensivos; PAT penalizado.
