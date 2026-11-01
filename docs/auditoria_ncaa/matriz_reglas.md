# Matriz de reglas NCAA 2011 vs. código — ONEFA stats

Auditoría **solo lectura**. Fuente: *2011 Football Statisticians' Manual* (18 págs.). Código revisado: `shared/stats-lib.js`, `live-stats/capture/engine.js`, `live-stats/capture/wizard.js`, `live-stats/viewer/viewer.html`, `live-stats/viewer/leaders.html`.
Las filas con un caso `TC-xx` se verificaron **ejecutando** el código contra [casos_de_prueba.json](casos_de_prueba.json) (de 41 casos, sólo TC-39 pasa hoy). Las filas sin caso (o con "—") se evaluaron **por lectura de código**; es el caso de B9/B10 (la lógica de drives vive en viewer.html y no es importable), S10-5 y S14-7, entre otras.

Estados: **CUMPLE** · **NO CUMPLE** · **PARCIAL** · **NO APLICA** (no se captura) · **VERIFICAR VIGENCIA**.
Grupo: **a** = corregible con lo que ya se captura · **b** = requiere captura nueva (segunda pasada con video).

---

## 1. Inventario: qué calcula hoy el código y dónde

### 1.1 Cómo se captura (engine.js / wizard.js)

| Pieza | Dónde | Detalle relevante para las reglas |
|---|---|---|
| Árboles de captura | `engine.js` `RESULT_BRANCHES`, `PASS_RESULT_BRANCHES`, `FUMBLE_RESULT_BRANCHES`, `FUMBLE_2_RESULT_BRANCHES`, `KICKOFF_/PUNT_/FG_/PAT_*_BRANCHES`, `SNAP_FUMBLE_*`, `*_BAD_SNAP_*`, `PUNT_MUFF_RESULT_BRANCHES` | Fumbles hasta nivel 2 (`fumble_*`, `fumble_2_*`). Jugadas con un solo `rush_by`/`pass_by`/`received_by`: **no hay laterales, pitcheos, kneel, spike**. `sack_by` es `multiple:false`. |
| `net_yards` | `wizard.js:1692-1698` (`_renderSubmit`) | **Sólo se calcula si existe `at`** (`calcNetYards(field_pos, at)`). Las ramas de fumble y de safety **no tienen `at`** (usan `fumble_at`, `fumble_recovered_at`, `fumble_at_result`, `safety_time`) → `net_yards = null`. |
| Flags de penalidad | `wizard.js:1757-1880` | Flag aceptado con `down_result` ∈ {repeat_down, loss_of_down, first_down} y `timing ≠ 'dead'` ⇒ `net_yards=0`, `touchdown=false`, `stats_count=false` (jugada anulada). `timing` sólo ofrece `live`/`dead`. No se captura el **spot de aplicación** ni quién presionó en un IG. |
| Estado del juego | `stats-lib.js` `advanceGameState`, `_advanceFumble`, `_applyFlag`, `_advanceDownDistance`, `_addPoints` | Puntos, down/distancia, posesión y `field_pos` del siguiente snap. |
| Persistencia | `engine.js` `_buildPlayRow` | `net_yards`, `result` en columnas; todo lo demás en `play_data`. |

### 1.2 Qué estadísticas se calculan

| Función (stats-lib.js) | Estadísticas | Notas |
|---|---|---|
| `computePlayerStats` (l.92) | Rush/pass/rec/def de UN jugador (Reports) | Duplica reglas de `buildOffenseMaps`/`computeDefenseStats`. |
| `buildOffenseMaps` (l.2486) | Passers (att/comp/yds/td/long/sacked), rushers (att/yds/gained/td/long), receivers | Sack y scramble → rush del QB. Filtra `stats_count===false`. |
| `computeQBProgression` (l.2410) | Att/comp/yds/td/int por QB | |
| `computeComparisonStats` (l.321) | Yardas de equipo, jugadas, 3ª/4ª down, primeros downs, red zone, fumbles, turnovers, sacks, TFL | Mezcla: unos contadores ignoran `stats_count`, otros no. |
| `_isFirstDownPlay` (l.291) | Primeros downs | Booleano (máx. 1 por jugada). |
| `_effectiveNetYards` (l.300) | Yardas de equipo/drive "efectivas" | **Suma yardas de penalidad** si el flag es aceptado y `dead`. |
| `computeDefenseStats` (l.2013) | Solo, ast, sacks, sackYds, TFL, FF, INT, QBH, PBU | `defTeam` = quien NO tiene posesión. Arrays de tackle: `tackle_by`, `fumble_tackle_by`, `punt_block_ret_tackle_by`, `return_tackle_by`. |
| `computeSpecialTeamsStats` (l.2075) | Punts (no/yds/long/in20/tb), kickoffs, FG (lista), kick/punt returns | No lee `stats_count`. |
| `computeFumbleStats` (l.2207) | Fumbles y perdidos por jugador | Sólo nivel 1; equipo = `p.possession`. |
| `computeTurnoverReturnYards*`, `computeTurnoverStatsByPlayer` (l.2246-2376) | Yardas/TD de INT y de recuperaciones de fumble | `Math.max(…,0)`. |
| `computeAllPurposeMap` (l.2383) | Rush+rec+KR+PR+FR/IR | |
| `computePenalties` (l.433) | Lista y yardas de penalidades | `yardas = |new_los − field_pos|` (o spot terminal del punt). |
| `computeDrives` / `driveEndLabel` (l.235, 273) | Drives, cómo terminan | |
| `computeDriveRows`, `_isScrimmagePlay` | Plays-Yds-TOP por drive | **Dentro de viewer.html** (l.333-384). |
| `_passerRating` (l.2588) | Rating de pasador | Fórmula NFL, no NCAA. |
| `buildLeaders` (l.2991) | Líderes pase/rush/rec | Mínimos 10/5/1.5 por juego **del equipo**. |
| `advanceGameState` (l.1107) | Transición de estado/marcador | Detalle en filas de safety/fumble/posesión. |
| `formatPlay` | Texto de jugada | Sólo presentación (no se auditó línea por línea). |

**No existen**: net punting, tiempo de posesión por equipo en juegos play-by-play (viewer lo descartó explícitamente, l.936-940), stats de PAT por pateador, puntos por jugador, bloqueos por jugador, fumbles recuperados (FR) como columna, TFL con yardas individuales.

---

## 2. Matriz de reglas

Leyenda de columnas: **Regla** (sección/artículo/A.R. del manual) · **Estadística** · **Esperado** · **Estado** · **Código / evidencia** · **Caso**.

### 2.1 Basic Interpretations (B.I.)

| ID | Regla | Estadística | Resultado esperado | Estado | Código / evidencia | Caso |
|---|---|---|---|---|---|---|
| B2 | B.I.2 / A.R.1-2 — Ubicación del balón: sobre la yarda → esa yarda; regla "siempre ≥1 yarda para primero" (2a, 2b); yardas distintas por equipo (2c); error del oficial no cambia spot (2d) | Yardas de jugada | Operador marca AT correcto | NO APLICA | El operador teclea `AT`; el código no valida ninguna de estas reglas de spot | — |
| B3 | B.I.3 — Yardas sólo goal-to-goal; FG suma 10 | Yardas | 0–100 por campo | CUMPLE | `absYard/calcNetYards` (posiciones 0–100). FG: ver S10-1 | — |
| B4 | B.I.4 — Yardas de penalidad = distancia real perdida, no la asignada (mitad de la distancia, etc.) | Penalty yds | Distancia real desde el spot de aplicación | PARCIAL | Usa `new_los` capturado (bien: refleja media distancia), pero mide desde `field_pos` (snap), no desde el spot de aplicación; ver S14 | TC-28/29/30/31 |
| B5 | B.I.5 — Fumble return sólo si hay yardas de retorno; INT de fumble = fumble return | Fumble returns | No listar los "cae sobre el balón" | NO CUMPLE | Lista toda recuperación defensiva aun con 0 yds (`credit(...)` con `yds=0`) | TC-10 |
| B6 | B.I.6 — Postemporada suma a temporada | Agregación | Incluir playoffs/bowls | CUMPLE | `selectLeaderGames` sólo excluye `semana==='TEST'` | — |
| B7 | B.I.7 — Juego jugado = ≥1 jugada en lineup; para ranking ≥75 % de juegos | GP, ranking | GP por participación; filtro 75 % | PARCIAL | GP = juegos con actividad en la categoría; no hay regla del 75 % | TC-37 (conexo) |
| B8a | B.I.8 — 3ª down: éxito = 1D o TD en jugada rush/pass | 3rd down eff. | Contar | CUMPLE | `computeComparisonStats` l.369 | — |
| B8b | B.I.8 — FG en 3ª down no cuenta; 1D por penalidad no cuenta; falta ofensiva aceptada con mismo down no cuenta (A.R.2) | 3rd down att | No contar | CUMPLE | Jugada anulada → `stats_count=false` → `continue` antes de contar (l.363). KICK no entra | — |
| B8c | B.I.8 A.R.1 — 3ª y gol TD cuenta intento y conversión | 3rd down | att+conv | CUMPLE | `_isFirstDownPlay` por `touchdown===true` | — |
| B8d | B.I.8 A.R.4 — 1D por yardas + falta posterior: conversión + 2 primeros downs | 3rd/1D | Conv 1; 1D=2 | PARCIAL | Conversión sí (timing `dead`); sólo 1 primer down | TC-28 |
| B8e | B.I.8 A.R.3 — rodillazo/caída en 3ª down cuenta intento | 3rd down | att 1 | NO APLICA | No hay marca de kneel/spike (el rush se carga al QB, sí cuenta intento) | TC-35 |
| B8f | B.I.8 A.R.5 — IG en 3ª y 15 cuenta intento de 3ª | 3rd down | att 1, conv 0 | NO CUMPLE | La jugada se anula (loss_of_down live) y se excluye | TC-06 |
| B9 | B.I.9 — Tiempo de posesión: desde 1ª jugada de scrimmage hasta pérdida de posesión; receptor desde el kickoff; 60:00 suma; sólo reglamentario; redondeo de décimas | TOP por equipo | 60:00 entre ambos | NO CUMPLE | No existe cálculo por equipo en juegos PBP (sólo manual). TOP por drive = `reloj(primera) − reloj(última)`: omite la duración de la última jugada, devuelve `null` si el drive cruza cuarto, y arranca en el kickoff | — (ver H-17) |
| B10a | B.I.10 — Yardas de scoring drive: LOS inicial → goal line (TD) o → última LOS (FG), sin contar la patada | Drive yards | Net desde LOS inicial | CUMPLE | `computeDriveRows` suma `_effectiveNetYards` de jugadas de scrimmage (excluye KICK no-FG, PUNT, PAT) | — |
| B10b | B.I.10 — # de jugadas: no contar penalidades que repiten down; sí las que cambian down y avanzan; FG = jugada | Plays del drive | Excluir penalty plays sin cambio de down | NO CUMPLE | `realPlays = scrimmagePlays.length` cuenta toda jugada `PENALTY` y las anuladas | — (viewer.html:368) |
| B10c | B.I.10 — Tiempo del scoring drive empieza en la 1ª jugada de scrimmage | Drive time | Sin el kickoff | NO CUMPLE | `first = d.plays[0]` puede ser el KICK fusionado en el drive | — (viewer.html:369) |
| B11 | B.I.11 — OT: stats se suman a las reglamentarias; sin periodo aparte; posesión desde la 25 | Todas | Sin separar | PARCIAL | Se suman (CUMPLE); el modelo de OT desde la 25 no existe (operador usa `start_drive`) → NO APLICA | — |
| B12 | B.I.12 — Rodillazo = rush de equipo; pase al suelo para parar reloj = intento de equipo; ninguno al individuo | Rush/pass | Team | NO APLICA | No hay marca; se carga al QB | TC-35 |
| B13 | B.I.13 — Red Zone: basta *alcanzar* la 20 en la posesión; sigue en OT | RZ trips | Contar toda posesión que toque la 20 | PARCIAL | Usa `yardline_100 ≤ 20` **al snap**; no cuenta TD/jugada que cruza desde fuera de la 20 ni drive que termina en la jugada que entra | TC-36 |
| B14a | B.I.14 — Punt "inside 20" donde termina el retorno; la 20 exacta no cuenta; touchback no | Punt in20 | Por spot final | NO CUMPLE | Usa `punt_kicked_to`; usa `≤ 20` | TC-19 |
| B14b | B.I.14 — Punt downed/oob/fair catch dentro de la 20 | Punt in20 | Contar | NO CUMPLE (downed) | `downed` no tiene `landPos`: nunca cuenta (el caso más común) | TC-18 |
| B15a | B.I.15 — Tackle solo: máx. 1 por jugada; sack/TFL implican solo | Solo | 1 por jugada | NO CUMPLE | Sack suma `solo` aparte de `tackle_by` → 2 solos si el operador captura ambos | TC-03 |
| B15b | B.I.15 — 2 asistidos o 1 solo; si hay 3+ asistidos, "rarísimo" | Ast | 2 ast | CUMPLE | `isSolo = arr.length===1`, resto ast (sin tope) | TC-38 |
| B15c | B.I.15 — TFL solo: solo+TFL con todas las yardas; asistido: mitad c/u | TFL, TFL yds | Yardas por jugador | PARCIAL | TFL se cuenta; **no hay yardas de TFL individuales**; el sacker no recibe TFL | TC-02, TC-38 |
| B15d | B.I.15 — Tackles en cobertura de patadas y por ofensivos tras turnover cuentan | Tackles | Acreditar al equipo del tackleador | NO CUMPLE | Se omiten `kick_return_tackle_by`, `punt_return_tackle_by`, `fg_ret_tackle_by`, `punt_muff_tackle_by`, `snap/*_bad_snap_tackle_by`, `fumble_2_tackle_by`; `return_tackle_by`/`fumble_tackle_by` se acreditan al equipo equivocado | TC-23, TC-24 |
| B15e | B.I.15 — Sack: solo ⇒ sack+solo+TFL(yardas); asistido ⇒ ast sack+ast+ast TFL, yardas partidas | Sacks | | NO CUMPLE / b | Solo: falta TFL (TC-02). Asistido: `sack_by` es un solo jugador (b) | TC-02, TC-04 |
| B15f | B.I.15 — Fumble antes de contacto o snap malo sin continuar jugada: no hay sack | Sacks | 0 | CUMPLE | Depende de que el operador no marque `sack`; no hay lógica propia pero tampoco crédito automático | — |
| B15g | B.I.15 — Pasador fuera de la LOS corriendo = rush (no sack); sacado detrás de la LOS = sack; scramble tacleado detrás de la LOS = sack | Sack vs rush | | PARCIAL | Lo decide el operador con `sack`/`scramble`; el código no re-clasifica por `net_yards` (un `scramble` con `net<0` queda como rush con TFL vía `tackle_by`, sin sack) | — |
| B15h | B.I.15 — Pasador presionado → IG: sack solo al presionador; pasador cargado con rush negativo; no intento de pase; penalidad de 0 yardas | Sack, rush, pass att, penalty | Ver A.R. §3 Art.10 | NO CUMPLE | Jugada anulada: sin rush, sin sack, penalidad = 8 en vez de 0. No hay campo del presionador (b) | TC-05 |
| B15i | B.I.15 — Strip-sack antes de que el brazo avance: FF + sack + solo + TFL; rush al QB hasta la recuperación; fumble no perdido/perdido | FF, sacks, rush | Ver A.R. §16 Art.4 | NO CUMPLE | `net_yards=null` ⇒ rush 0, TFL 0, sackYds 0 | TC-07 |
| B15j | B.I.15 — Strip tras el brazo adelante: pase incompleto + PBU, sin sack/fumble | PBU | | CUMPLE | Se captura como `incomplete`/`broken_up` + `broken_up_by` (depende del operador) | TC-39 |
| B15k | B.I.15 — PBU: contacto con el balón o tackleo simultáneo; INT no recibe PBU; PBU+INT de otro | PBU, INT | | CUMPLE | `broken_up_by` y `intercepted_by` son campos distintos; no hay juicio automático | TC-39 |
| B15l | B.I.15 — PBU compartido (2 defensores, "rarísimo") | PBU | | NO APLICA | `broken_up_by` es un solo jugador | — |
| B15m | B.I.15 — Forced fumble: un solo jugador; además recibe solo tackle; TFL sólo si recuperación detrás de la LOS | FF, solo, TFL | | PARCIAL | Un solo jugador ✔ (campo único). **No se le suma el solo**. FF se acredita al equipo no-poseedor aunque el forzador sea del otro lado (retornos) | TC-40, TC-12 |
| B15n | B.I.15 NOTE — Política 2004: stats defensivas oficiales sólo del press box en vivo | Política | | VERIFICAR VIGENCIA | La captura "con video / segunda pasada" que se contempla choca con esta política para stats *oficiales NCAA*; revisar política actual y si ONEFA la adopta | — |
| B16a | B.I.16 — Pass efficiency = (8.4×Yds + 100×Comp + 330×TD − 200×INT)/Att | Rating | Muestra del manual = 161.71 | NO CUMPLE | `_passerRating` usa la fórmula clásica NFL (clamps 0–2.375, escala 0–158.3). Mismo input → 105.17. Etiqueta de leaders.html "NCAA/NFL" es engañosa | TC-01 |
| B16b | B.I.16 NOTE — Mínimo 15 intentos por juego jugado | Ranking de pase | 15/juego jugado | NO CUMPLE | `LEADER_MIN_PER_TEAM_GAME.pass = 10` por juego del equipo | TC-37 |
| B16c | B.I.16 — Net punting = (yds − retornos − 20×TB)/punts | Net punting | | NO CUMPLE (no existe) | Sin función ni columna "Net" | TC-21 |

### 2.2 Sec. 1 — Primeros downs

| ID | Regla | Estadística | Esperado | Estado | Evidencia | Caso |
|---|---|---|---|---|---|---|
| S1-1 | Art.1 — 1D al mover cadenas o TD de scrimmage en serie iniciada a ≥10 yds de la goal | 1D | TD en 1ª y gol (<10) no es 1D | PARCIAL | `touchdown===true` siempre cuenta | TC-32 |
| S1-1b | Art.1 A.R.1 — 1D al terminar mitad/juego en jugada en curso | 1D | Contar | CUMPLE | Sin filtro de reloj | — |
| S1-1c | Art.1 A.R.2 — 1D por penalidad aunque las cadenas retrocedan | 1D | Contar | CUMPLE | `flag_x_down_result==='first_down'` | TC-31 |
| S1-2 | Art.2 + A.R.1-2 — Dos 1D (yardas + penalidad) si la penalidad da otro; si no basta, sólo el de yardas | 1D | 2 / 1 | NO CUMPLE | `_isFirstDownPlay` devuelve booleano | TC-28, TC-31 |
| S1-3 | Art.3 — Sin 1D en retornos (kickoff, punt, INT) | 1D | 0 | CUMPLE | KICK/PUNT sin `net_yards`; INT sin `at` | — |
| S1-4 | Art.4 — Sin 1D si se pierde posesión en la jugada | 1D | 0 | PARCIAL | Hoy "cumple por accidente" porque `net_yards=null` en fumbles. **Al corregir H-01 hay que excluir fumble perdido, o se introduce una regresión** | TC-09 |
| S1-5 | Art.5 — Fumble recuperado por A que da 1D: se acredita a la categoría de origen | 1D, rush | 1D rush | NO CUMPLE | `net_yards=null` | TC-09 |
| S1-6 | Art.6 — Falta de bola muerta que da 1D | 1D | Contar | CUMPLE | `first_down` en flag/penalty | — |
| S1-7 | Art.7 — Última jugada del 2º/4º cuarto: 1D si lo logró aunque no lo señalen | 1D | Contar | NO APLICA | Criterio del estadístico | — |

### 2.3 Sec. 2 — Rushing

| ID | Regla | Estadística | Esperado | Estado | Evidencia | Caso |
|---|---|---|---|---|---|---|
| S2-2 | Art.2 — Yardas desde la LOS hasta donde muere o la recupera el rival | Rush yds | Incluye fumble | NO CUMPLE | Fumbles: `net_yards=null` | TC-08 |
| S2-3 | Art.3 — Total es neto; registrar todas las pérdidas | Rush net | | CUMPLE | `yds += net_yards` con negativos | — |
| S2-4 | Art.4 — Pérdida al portador sea cual sea la causa; excepciones: pitcheo errático, pérdida al intentar pasar, rodillazo, wild snap | Rush | | PARCIAL | Sack/scramble → QB ✔. Kneel/pitch (b); wild snap cargado al QB ✘ | TC-34, TC-35 |
| S2-5/6/7/8/9 | Run-option, laterales, pitcheos errráticos (A.R. varios) | Rush att/yds | Atribuir al receptor del pitch/lateral sin intento | NO APLICA | Una sola persona por jugada de rush; sin campos de lateral/pitch | (b) |

### 2.4 Sec. 3 — Pases

| ID | Regla | Estadística | Esperado | Estado | Evidencia | Caso |
|---|---|---|---|---|---|---|
| S3-1 | Art.1 — Yardas LOS→muerte, incluye YAC; mismas yardas a pasador y receptor | Pass/rec yds | | CUMPLE | `net_yards` a ambos | TC-31 (allenYds) |
| S3-2 | Art.2 — Lateral del receptor: yardas al lateral sin recepción | Rec | | NO APLICA | Sin captura | (b) |
| S3-3 | Art.3 — Completo detrás de la LOS = yardas negativas de pase | Pass yds | | CUMPLE | `net_yards` negativo | — |
| S3-4 | Art.4 — Pérdida del que intenta pasar = rushing | Rush | | PARCIAL | Sack/scramble ✔; IG ✘ (TC-05) | TC-05 |
| S3-5 | Art.5 + A.R. — Pase desviado atrapado por el pasador | Pass | | NO APLICA | Sin captura | (b) |
| S3-6 | Art.6 + A.R.1-4 — Retorno de INT desde el punto de INT; puede ser negativo | INT yds | −10 | NO CUMPLE | `Math.max(…,0)` en l.2264, 2304, 2356 | TC-33 |
| S3-7 | Art.7 — No hay pase completo por penalidad; PI: sin intento ni yardas | Pass | | CUMPLE | Jugada anulada | — |
| S3-8 | Art.8 + A.R.1-6 — Reglas de spot de PI defensiva | Penalty yds | | VERIFICAR VIGENCIA | El operador teclea `new_los`; el código no calcula el spot. Verificar la regla actual (15 yds/spot) | — |
| S3-9 | Art.9 — PI declinada: jugada normal | Pass | | CUMPLE | `declined` no anula | — |
| S3-10a | Art.10 — IG: sin intento de pase; rush negativo al spot de la falta | Pass/Rush | att 0; rush 1 (−8) | NO CUMPLE | La jugada se anula completa | TC-05 |
| S3-10b | Art.10 A.R.1-3 — IG: sack+solo+TFL al presionador; penalidad "de 0 yardas" | Sack/Penalty | | NO CUMPLE (a+b) | Yardas de penalidad = 8; presionador no se captura (b) | TC-05 |
| S3-10c | Art.10 A.R.3 — IG en end zone ⇒ safety + free kick | Score/estado | +2 rival | PARCIAL | Se captura como PASS con flag; el safety depende de que el operador lo marque (no hay `result` en la rama `incomplete`) | — |
| S3-10d | Art.10 A.R.5-7 — Strip antes/después del brazo | FF/sack/PBU | | PARCIAL | Antes ⇒ `sack`+`fumble` (TC-07 ✘); después ⇒ `broken_up` ✔ | TC-07, TC-39 |
| S3-10e | Art.10 A.R.8 — Spike: intento de equipo | Pass att | | NO APLICA | | TC-35 |
| S3-11 | Art.11 — Elegible no declarado: sin intento | Pass | | CUMPLE | | — |
| S3-12/13 | Art.12-13 — Pase ilegal más allá de la LOS: aceptada ⇒ rush al spot, sin intento; declinada ⇒ normal | Rush/Pass | | PARCIAL | Declinada ✔; aceptada: se anula y **no** se acredita el rush | — |
| S3-14 | Art.14 — Segundo pase adelantado | Pass | | NO APLICA | | (b) |
| S3-15 | Art.15 — PI ofensiva: sin intento; 15 yds desde el spot previo | Pass | | CUMPLE | | — |
| S3-16 | Art.16 — Pasador golpeado: completo ⇒ falta desde el final de la jugada; incompleto ⇒ sin intento | Pass, penalty | | PARCIAL | Incompleto ✔. Completo: yardas de penalidad y de equipo infladas | TC-31 |
| S3-17..19 | Art.17-19 — Overthrown (falta personal), receptor fuera de límites | Pass | sin intento | CUMPLE | Jugada anulada | — |
| S3-20 | Art.20 — Pase adelantado tras pasar la LOS: falta, sin rush/pase | Pass/Rush | | CUMPLE | | — |
| S3-21 | Art.21 — Fake FG/punt con pase adelantado = jugada de pase | Pass | | CUMPLE | `fake_punt` retargetea a PASS; fake FG: el operador registra PASS directo | — |
| S3-22 | Art.22 — Rush abortado seguido de pase = pase | Pass | | NO APLICA | Criterio del operador | — |

### 2.5 Sec. 4 — Laterales / Sec. 5 — Total offense / all-purpose

| ID | Regla | Estadística | Esperado | Estado | Evidencia | Caso |
|---|---|---|---|---|---|---|
| S4-1..6 | Laterales: yardas sin intento/recepción/retorno; kickoff multi-jugador; INT de lateral = fumble lost | Rush/rec/returns | | NO APLICA | Una sola persona por jugada o retorno | (b) |
| S5-1/2 | Total offense = net rush + net pass (sin penalidades, sin retornos) | Total yds | | NO CUMPLE | `_effectiveNetYards` suma yardas de penalidad `dead` a rushYds/passYds; fumbles sin yardas | TC-28, TC-31, TC-08 |
| S5-3 | All-purpose = rush+rec+INT+punt+kickoff+FG runbacks (sin pase) | All-purpose | | PARCIAL | Falta runback de FG; INT/FR con clamp a 0 | TC-33 |

### 2.6 Sec. 6-9 — Patadas y retornos

| ID | Regla | Estadística | Esperado | Estado | Evidencia | Caso |
|---|---|---|---|---|---|---|
| S6-1 | Punt medido hasta donde el receptor gana/pierde posesión o hasta donde muere | Punt yds | | PARCIAL | `returned`/`fair_catch`/`oob`/`touchback` ✔. `downed`, `muffed`, `blocked`, `bad_snap`: 0 yds pero suman al conteo → promedio y largo mal | TC-18, TC-22 |
| S6-1b | Art.1 A.R.1-2 — Retorno negativo / positivo | Punt ret | | CUMPLE | `dist(defTeam, punt_kicked_to, punt_return_at)` | — |
| S6-2/3 | Touchback: medido hasta la goal line (con o sin penalidad) | Punt yds | | CUMPLE | `landPos = goal line` | — |
| S6-4 | Interferencia del pateador en vuelo: medir al punto de infracción | Punt yds | | NO APLICA | | — |
| S6-5 | Falta personal contra el pateador en vuelo aceptada: no se acredita punt | Punt | 0 | NO CUMPLE | `computeSpecialTeamsStats` no revisa `stats_count` | TC-41 |
| S6-6/8 | Balón suelto antes de la LOS / fumble de snap correcto | Punt/Rush | | NO APLICA | | (b) |
| S6-7 | Snap malo en punt: entrada "Team" | Punt | No al punter | NO CUMPLE | `bad_snap` cuenta `no++` al pateador con 0 yds | TC-20, TC-34 |
| S6-x | Punt que termina en safety (A.R.3, A.R.4-6) | Score/estado | +2 | PARCIAL | Puntos ✔; transición de estado ✘ | TC-16 |
| S7-1 | Punt bloqueado = "Team", un punt de 0 yds en el total; bloqueador recibe punt return por lo avanzado | Punt, PR | | NO CUMPLE | Se carga al pateador; no hay PR al bloqueador; `fg/punt blocked_by` no se usa | TC-20 |
| S7-2..5 | Bloqueo detrás de la LOS, recuperado por el pateador, "materialmente afectado" | Punt | | NO APLICA | Juicio / sin captura | — |
| S8-1 | Sólo kickoffs/punts que se intentan regresar cuentan como retorno | KR/PR | | CUMPLE | Sólo `*_result==='returned'` | — |
| S8-2 | Retorno medido desde donde primero gana posesión; kicks a end zone desde la goal | KR/PR yds | | CUMPLE | `kicked_to`→`*_return_at` | — |
| S8-3/7/8 | Muff/toque del receptor: retorno desde el punto de toque (puede ser negativo), fumble al receptor, punt medido al toque | PR, fumbles, punt yds | | NO CUMPLE | Muff: punt 0 yds, sin retorno, sin fumble (a/equipo); falta *quién* hizo el muff (b/jugador) | TC-22 |
| S8-4/5/6/8/9 | Retornos con laterales/handoffs; toque a no-jugador | KR/PR | | NO APLICA | | (b) |
| S8-10 | Kickoff tocado/muff que entra a end zone: opción de touchback o retorno | KR | | PARCIAL | | — |
| S8-12 | Kickoff muerto en end zone = touchback; punto de touchback | Estado | 20 (2011) | VERIFICAR VIGENCIA | Código usa 25 (regla vigente desde 2011-12); el manual dice 20 | — |
| S8-x | Fair catch de kickoff | Estado | Spot de la atrapada | VERIFICAR VIGENCIA | El código fija 25 (`fair_catch_at` se captura pero no se usa); consistente sólo con la regla actual de 25 | — |
| S9 | Free kicks (incl. tras safety) se registran como kickoffs | KO | | CUMPLE | Se reutiliza `kick_type='kickoff'` | — |

### 2.7 Sec. 10-12 — FG, PAT, safeties

| ID | Regla | Estadística | Esperado | Estado | Evidencia | Caso |
|---|---|---|---|---|---|---|
| S10-1 | FG medido desde el spot de la patada al poste (goal + 10) | FG dist | | PARCIAL | `kick_distance` se teclea a mano; no hay validación/derivación | — |
| S10-3/4 | Sin patada (snap malo/hold) ⇒ intento al "Team"; bloqueado ⇒ al pateador (excepto snap/hold) | FG att | | PARCIAL | `bad_snap` queda fuera de `fgs` ✔; no hay stats FG por pateador; excepción por juicio | — |
| S10-5 | Bloqueo de FG ⇒ crédito al que lo toca | Blocks | | NO CUMPLE | `fg_blocked_by` se captura y no se usa | (a) |
| S10-6 | Snap malo de FG: pérdida = rush de equipo + fumble | Team rush/fumble | | NO CUMPLE | Igual que wild snap | TC-34 |
| S10-7 | Retorno de FG bloqueado no es punt return | PR/net punting | | CUMPLE | No entra a `puntReturns` | — |
| S11-O | Sec.11 Art.1-3 — PAT por patada: intento al pateador o al Team | PAT att/made | | NO CUMPLE (no existe) | Sin estadística PAT por pateador | TC-27 |
| S11-4 | Art.4 — PAT = tiempo fuera; no es rush/pase/INT/patada de scrimmage; sin yardas ni intento de rush/pase | Rush/pass/def/1D/fumbles | No contar | NO CUMPLE | `computeDefenseStats` acredita INT/tackles/PBU; `computeComparisonStats` cuenta fumble y primer down de PAT | TC-26 |
| S11-D | Defensive extra points (INT/fumble/bloqueo regresado a TD) | 2 pts def | | PARCIAL | Marcador ✔ (+2 al defensor); contadores "defensive PAT att/made" no existen; PAT pass con fumble regresado no puntúa | — |
| S11-P | A.R.3-5 — Penalidades en PAT | Penalties | | CUMPLE | Flags en PAT_TRY entran a `computePenalties` | — |
| S12 | Safety: puntos al equipo beneficiado, sin crédito individual; portador con rush y pérdida hasta la goal; defensor puede recibir sack/TFL | Score, rush, sack | | NO CUMPLE | Rush: `net_yards=null` ⇒ 0 yds. Sack/scramble con safety: **0 puntos**. Estado siguiente: down avanza, posesión/spot no pasan al free kick | TC-14, TC-15, TC-16 |

### 2.8 Sec. 13 — Fumbles

| ID | Regla | Estadística | Esperado | Estado | Evidencia | Caso |
|---|---|---|---|---|---|---|
| S13-1 | Art.1 — Fumble = pérdida de control; excepciones (bobble momentáneo, **PAT**); yardas hasta la recuperación al que fumbleó | Fumbles, yds | | NO CUMPLE | Yardas ✘; PAT run con fumble sí cuenta como fumble | TC-08, TC-26 |
| S13-2 | Art.2 + A.R.1-4 — Fumble ofensivo avanzado por compañero más allá de la LOS: rush original; yardas al que recupera sin rush; TD al recuperador | Rush, TD, score | Allen TD, +6 | NO CUMPLE | Recuperación propia en end zone ⇒ **no suma 6 pts** (`_advanceFumble` sólo puntúa si cambió la posesión) | TC-13 |
| S13-3 | Art.3 a-c — Recuperado en/detrás de la LOS por compañero (+ yardas adicionales) | Rush | | NO CUMPLE | Sin yardas ni atribución al recuperador | TC-08 (conexo) |
| S13-4 | Art.4 — Fumble defensivo regresado: listar sólo con yardas | FR | | PARCIAL | Se lista siempre | TC-10 |
| S13-5/6 | Fumble hacia la banda / dos jugadores | Fumble | | CUMPLE | Criterio del operador | — |
| S13-7 | Art.7 — INT de fumble o pase atrás = fumble lost + fumble return | Fumbles | | CUMPLE | `fumble_recovery_team ≠ possession` | — |
| S13-8 | Art.8 — Fumble en 4ª down recuperado por rival = lost | Fumbles lost | | CUMPLE | | — |
| S13-L2 | Fumble de nivel 2 y recuperaciones avanzadas | Fumbles, lost, turnovers | Cada pérdida de control es fumble | NO CUMPLE | `p.result==='fumble'` sólo mira nivel 1; `fumblesLost` ignora `fumble_2_recovery_team`; sin fumble individual del 2º portador | TC-11 |
| S13-ST | Fumbles en retornos (KR, PR, INT, FG block) | Fumbles, lost | Al equipo del que regresa | NO CUMPLE | Se cargan a `p.possession` (el pateador/pasador) con `lost` invertido; el comparativo ni los cuenta | TC-12 |
| S13-9 | Art.9 — Pateo/golpe involuntario del defensor | Rush | | NO APLICA | | — |

### 2.9 Sec. 14 — Penalidades

| ID | Regla | Estadística | Esperado | Estado | Evidencia | Caso |
|---|---|---|---|---|---|---|
| S14-1 | Art.1 + A.R.1-3 — Falta de A más allá de la LOS: se aplica desde el fin de la corrida o el spot de la falta; la corrida cuenta neta | Rush, penalty | rush 17 / pen 15 | NO CUMPLE (b) | Anulada; penalty = 2 (desplazamiento). Falta capturar el spot de la falta | TC-30 |
| S14-2 | Art.2 + A.R.1-3 — Falta de B con corrida más allá de la LOS: corrida cuenta; penalidad desde el fin de la corrida | Rush, penalty | rush 5 / pen 10 | NO CUMPLE (a) | Flag `live` aceptado siempre anula; penalty = 15 | TC-29 |
| S14-3 | Art.3 — Falta de B con corrida en/detrás de la LOS: jugada nula | Rush | | CUMPLE | Anulada | — |
| S14-4 | Art.4 — RP en pase completo: 15 desde el fin de la corrida; 1D pase + 1D penalidad | Pass yds, 1D, penalty | pass 15 / 2 1D / pen 15 | NO CUMPLE | passYds 30, penalty 30, 1D 1 | TC-31 |
| S14-5 | Art.5 — Falta de A detrás de la LOS: previo spot, jugada nula (si B declina, cuenta) | Todas | | CUMPLE | | — |
| S14-6 | Art.6 — Offside/delay/etc.: jugada nula; si B declina se registra sin yardas | Todas | | CUMPLE | | — |
| S14-7 | Art.7 — Kickoff OOB y repatear: 5 yds al pateador | Penalty | | PARCIAL | Se captura el OOB y la elección de spot, no el "penalty de 5" como penalidad | — |
| S14-8/9 | Extensión de periodo; falta de contacto tras el cruce del pase | — | | NO APLICA | | — |
| S14-10 | Art.10 — Sobre/sub-penalización: registrar la distancia real | Penalty yds | | CUMPLE | Usa `new_los` real | — |
| S14-IG | IG (penalidad de 0 yardas) | Penalty yds | 0 | NO CUMPLE | | TC-05 |

### 2.10 Sec. 15-16

| ID | Regla | Estadística | Esperado | Estado | Evidencia | Caso |
|---|---|---|---|---|---|---|
| S15 | Wild pass from center: pérdida a "Center Pass"/Team (rush de equipo + fumble); ganancia normal | Rush, fumble, turnover | | NO CUMPLE | SNAP_FUMBLE recuperado por B: 0 fumbles, 0 lost, 0 turnovers, sin yardas de equipo. Snap propio recuperado: rush y pérdida al QB, sin fumble | TC-34 |
| S16-1..3 | Solo/ast/TFL (ver B15) | | | PARCIAL | Ver B15a-c | TC-03, TC-38 |
| S16-4 | Sacks (ver B15e-i) y A.R.1-10 | | | NO CUMPLE | Ver B15 | TC-02..07 |
| S16-5 | PBU (ver B15j-l) | | | CUMPLE | | TC-39 |
| S16-6 | Forced fumble + solo + TFL condicionado | | | PARCIAL | | TC-40 |
| S16-x | Anulación: jugada nula ⇒ ninguna stat (también defensiva) | Todas | | NO CUMPLE | `computeDefenseStats`, `computeSpecialTeamsStats`, `computeFumbleStats`, `computeTurnover*` no leen `stats_count`; `computeComparisonStats` cuenta fumbles/INT/sacks/TFL antes del `continue` | TC-25, TC-41 |

### 2.11 Reglas sin aplicación directa o ajenas al cálculo

| ID | Regla | Estado |
|---|---|---|
| B1 | A.R. como interpretación | NO APLICA |
| B6 (otros) | Estadísticas de temporada/ranking nacional | NO APLICA |
| — | Posesión inicial/Overtime 25 yd, 2-pt desde la 3, one-point safety defensivo | VERIFICAR VIGENCIA (reglas de OT y one-point safety cambiaron después de 2011) |
| — | Kickoff desde la 30 (A.R. §11) vs. 35 que usa el código al pasar de PAT a kickoff | VERIFICAR VIGENCIA |
| — | QB Hurry (`qb_hurried_by`) | NO APLICA: no es una estadística del manual; mantenerla fuera de totales "NCAA" |

---

## 3. Resumen por estado

| Estado | Filas |
|---|---|
| NO CUMPLE | 43 |
| CUMPLE | 39 |
| PARCIAL | 27 |
| NO APLICA (no se captura) | 21 |
| VERIFICAR VIGENCIA | 6 |
| **Total de filas** | **136** |

(Conteo automático del primer estado de cada fila de las tablas 2.1–2.11. Una fila agrupa a veces varios A.R. del mismo artículo; no son 136 A.R. distintos. Una fila con dos estados, p. ej. "NO CUMPLE / b", cuenta una vez bajo el primero.)

## 4. Límites de esta auditoría

- `formatPlay` (texto de jugada) y los componentes visuales no se auditaron línea por línea; sólo se usaron para confirmar nombres de campos.
- Las reglas de spot (B.I.2), criterio de estadístico (bloqueo "materialmente afectado", quién provocó una fumble, sack vs rush) dependen del operador y se marcan NO APLICA o CUMPLE-por-captura.
- Las reglas de 2011 posteriormente modificadas se marcaron VERIFICAR VIGENCIA, no como error.
- No se revisó la Edge Function ni los esquemas SQL (fuera del alcance indicado).
