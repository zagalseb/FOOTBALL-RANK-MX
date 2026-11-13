# Notas pendientes (rama feature/individual-tab)

Notas de trabajo. No describen código terminado: registran problemas conocidos
que todavía no se arreglan y cómo separar los cambios sin commit.

## 1. `debug/wizard_flags.test.mjs` no corre en Node (conocido, sin arreglar)

**No arranca.** Truena al importar `live-stats/capture/engine.js`:

```
shared/supabase/supabase_config.js:8
  if (location.pathname.includes('/staging/')) return 'staging'
ReferenceError: location is not defined
```

- **Origen:** commit `d150cad` ("STAGING"). `supabase_config.js` detecta el entorno con
  `location`, que solo existe en el navegador.
- **Efecto:** el arnés de teclas no llega a cargar el wizard ni `stats-lib.js`.

**Tiene además un fallo que ya existía.** Si se simula `location` solo en memoria, la prueba
corre y da 20 de 21:

```
node --import 'data:text/javascript,globalThis.location={pathname:"/",hostname:"localhost",search:"",href:"http://localhost/"}' debug/wizard_flags.test.mjs
✖ pase completo + RP de B: sin preselección, Enter no avanza
```

El resultado es el mismo con `stats-lib.js` antes y después de aplicar la corrección de
tackles (2026-11-13), así que el fallo no viene de esa corrección.

Ninguno de los dos problemas está arreglado.

## 2. `shared/stats-lib.js`: qué bloque es de cada cambio (sin commit)

El working tree mezcla dos cambios sobre HEAD (`e4e0cd5`):

- **Tackles:** la corrección aplicada con `git apply` desde `proposal/defensa-tackles`
  (`341ca47..aeb4187`).
- **Hurries:** el cambio local de `qb_hurried_by` (H-22).

Con el contexto por defecto de `git diff`, cada bloque pertenece a **un solo** cambio, así que
`git add -p shared/stats-lib.js` los separa sin necesidad de dividir ni editar bloques.

Los números de línea corresponden al working tree del 2026-11-13.

| # | Bloque de `git diff` | Función | Cambio | Qué hace |
|---|---|---|---|---|
| 1 | `@@ -287,6 +287,69 @@` | nuevo, después de `_isSamePlayer` | **Tackles** | `_TACKLE_FIELDS`, `_tacklerIsTeam`, `_tackleCredits` |
| 2 | `@@ -357,24 +420,24 @@` | `computePlayerStats` | **Tackles** | usa `_tackleCredits`; el sack cuenta como sack + solo + TFL |
| 3 | `@@ -624,15 +687,25 @@` | `computeComparisonStats` | **Tackles** | fila TFL de Team Stats = TFL por jugador (sacks y scrambles con pérdida) |
| 4 | `@@ -1015,15 +1088,16 @@` | `_formatPlayCore` (PASS sack) | **Hurries** | `(hurried by …)` en el texto |
| 5 | `@@ -1034,8 +1108,9 @@` | `_formatPlayCore` (PASS) | **Hurries** | ídem |
| 6 | `@@ -1043,6 +1118,7 @@` | `_formatPlayCore` (PASS) | **Hurries** | ídem |
| 7 | `@@ -1050,26 +1126,27 @@` | `_formatPlayCore` (INT / scramble) | **Hurries** | ídem |
| 8 | `@@ -1282,7 +1359,7 @@` | `_formatPlayCore` (PAT pase interceptado) | **Hurries** | ídem |
| 9 | `@@ -2384,10 +2461,11 @@` | comentario antes de `computeDefenseStats` | **Tackles** | equipo del tackleador |
| 10 | `@@ -2405,19 +2483,20 @@` | `computeDefenseStats` | **Tackles** | usa `_tackleCredits`; el sack ya no da un segundo solo |
| 11 | `@@ -2429,11 +2508,22 @@` | `computeDefenseStats` (bloque `qb_hurried_by`) | **Hurries** | no acredita hurry en jugada anulada ni a quien ya tiene el sack o la INT |

En resumen:

- **Tackles:** bloques 1, 2, 3, 9 y 10. Con ellos van `debug/snapshots/README.md`,
  `full-plays.json` y `penalties-fumbles.json`.
- **Hurries:** bloques 4 a 8 y 11.

Los snapshots salen iguales con o sin el cambio de hurries, porque no lo reflejan. Por eso
pueden ir en el commit de tackles.

**Cómo comprobar la separación.** Después de hacer `git add -p` solo con los bloques de
tackles, `git diff --cached shared/stats-lib.js` debe coincidir con
`git diff 341ca47 aeb4187 -- shared/stats-lib.js`. Las únicas diferencias deben ser los
números de línea.

## 3. Verificación: #2 M. Martínez (c0a826d4, MTY)

Después de la corrección, Martínez tiene 7 solos, 4 asistencias, 1 sack (7 yds) y 2 TFL.

| Estadística | Seq |
|---|---|
| Solos (7) | 15, 16, 17, 19, 57, 58 (`fumble_tackle_by`), 59 (sack) |
| Asistencias (4) | 12, 18, 37, 40 |
| Sack (1) | 59: `sack_by` y también en `tackle_by`, −7 |
| TFL (2) | 19: corrida de Resendiz, −1 · 59: el sack |

Antes de la corrección tenía 8 solos, porque la seq 59 sumaba +2 solos: uno por `sack_by` y
otro por `tackle_by`. El TFL ya era 2 antes; el sack nunca contó dos veces como TFL.

**Observación, sin cambio:** en la seq 58, Martínez taclea a Resendiz después de que este
recupera su propio fumble. La jugada va de AT 42 a AT 40 y no se acredita como TFL.

## 4. Gol de campo: limitaciones que no se tocaron (2026-11-13)

El arreglo en `advanceGameState` (`shared/stats-lib.js`, rama `field_goal`) cubre tres casos:
el kickoff después de un FG bueno sale de la 35 propia; el FG fallado con snap dentro de la
20 del rival le da el balón en su 20; el FG anulado por bandera no anota. Las pruebas están en
`debug/verify_individual/fg_spot.mjs`. Quedan estas limitaciones:

- **FG bloqueado recuperado por el equipo que patea.** La rama `blocked` siempre le da el
  balón al rival e ignora `fg_recovery_team`. En 4to down el resultado es el mismo (el rival
  toma el balón). En 1ro a 3er down, el equipo que patea debería conservarlo.
- **FG "short" que sigue vivo.** `missed` solo pregunta el tipo de fallo
  (`fg_miss_type`), sin regreso ni recuperación. Un balón corto que el rival regresa no se
  puede capturar como fallado. Hoy hay que capturarlo como bloqueado o corregir el spot con
  Spot Ball.
- **Apertura del 2º tiempo después de una anotación al final del 2º cuarto.** Después de
  un FG o de un PAT, el estado queda con el kickoff en la 35 del equipo que anotó. Si el 2º
  tiempo lo abre el otro equipo, "Set Possession" solo cambia la posesión, no el spot. Hay
  que usar Spot Ball (o Start Drive). Pasaba igual antes del arreglo, después de un PAT.
- **Datos guardados.** `field_pos` se guarda en cada jugada al capturarla. El arreglo no
  cambia las jugadas ya capturadas. c0a826d4 seq 48 (kickoff tras el FG del seq 47) tiene
  MTY 12 y debe tener AT 35 (`yardline_100` 65). Con eso, las yardas de kickoff de
  #42 R. Blanco pasan de 131 a 184. Se corrige desde la edición de la captura.

## 5. Sacks compartidos (TC-04, 2026-11-13)

Un sack es compartido cuando hay otros defensores en `tackle_by`, además de quien está en
`sack_by` (§16 Art.4 A.R.2). Cada participante recibe un sack asistido (`asstSacks`), un
tackle asistido y un TFL, y las yardas del sack se reparten en partes iguales. Al equipo le
cuenta un solo sack. "Capturas" (Individual) y la tabla SACKS (Comparación) muestran
sacks + ½ por cada asistido, p. ej. 0.5 o 1.5. Pruebas: `debug/ncaa_cases` TC-04 a TC-04e y
`debug/verify_individual/sacks_compartidos.mjs`.

- **Pregunta abierta: ¿el TFL asistido cuenta 1 o ½?** El manual no lo dice. Hoy cuenta 1
  para cada participante, igual que el TFL asistido en una corrida (TC-38).
- **Strip-sack compartido no se puede capturar.** Si el sack termina en fumble, el wizard
  no pide `tackle_by` (la rama del fumble pide forzador, recuperación y `fumble_tackle_by`).
  El cálculo ya lo maneja (TC-04d), pero hoy no entra ese dato.
- **Yardas con decimales.** Entre tres, 8 yardas dan 2.67 por jugador; la tabla SACKS
  muestra un decimal (2.7).

## 6. H-19: faltas y cambio de posesión (2026-11-13)

`advanceGameState` ya respeta estas faltas (`_flagKeepsBall`, `_returnFoulTeam` en
`shared/stats-lib.js`). Casos en la suite: TC-44a a TC-44e. Quedan pendientes:

- **Pendiente de captura: `flag_N_before_change` (sí/no).** El wizard lo preguntaría solo
  si se cumplen tres cosas: la falta es del equipo que ganó el balón, hubo INT o fumble
  perdido, y se eligió "Spot de la falta". Sin ese campo, una falta de B cometida *antes*
  del cambio de posesión y cobrada en el spot de la falta (p. ej. una PI cobrada en el
  spot antes de la INT) se lee como falta durante el regreso, y la INT se mantiene. Ese
  caso es **TC-44e**: está marcado `sin_resolver` en la suite y sigue en rojo. No se tocó
  `wizard.js` ni `engine.js`.
- **Pick-six con falta de B en el regreso (TC-44c): resuelto con H-22 (ver §8).** Si la
  falta es del equipo que regresa y se cobra en el spot de la falta, el regreso de INT o de
  fumble se mide hasta ese spot, y sin TD (§14 Art.1 A.R.3, por analogía, más B.I.14). Si la
  falta quedó por delante del corredor, vale el fin de la carrera. Esto aplica a Individual,
  Comparación, Game Stats, all-purpose y al fin del drive ("INT" y no "INTERCEPTION").
  Pruebas: TC-44a-ind, TC-44b-ind, TC-44c-ind y TC-44f. Queda pendiente algo solo visual:
  `_driveEndPos` (viewer.html) sigue marcando el fin del drive en `return_at`.
- **"Repetir down" después de un cambio de posesión.** `_applyFlag` toma el down de la
  jugada, que es el de A. Si el operador elige `repeat_down` en una falta de B durante su
  regreso, el estado queda con el down de A en vez de 1ro y 10 para B.

## 7. Despejes (2026-11-13)

`computeSpecialTeamsStats` es ahora la única fuente de despejes para Game Stats,
Comparación e Individual. Excluye los anulados y los fake punts o snaps malos. Mide el
downed y el muffed hasta su spot. El bloqueado va a la fila "Equipo" (§7 Art.1, 3). "Dentro
de 20" se cuenta donde el balón queda muerto, sin incluir la 20.

- **Solo se anula un punt o kickoff con `flag_N_enforced === 'previous'` explícito.** Las
  banderas viejas sin `flag_N_enforced` ya no anulan un punt ni un kickoff
  (`flagEnforcement`). Por eso c0a826d4 seq 31 (Olvera) vuelve a contar como despeje y ya no
  muestra "NO PLAY". **Los FG no cambian:** con bandera vieja siguen la regla de
  compatibilidad, porque la rama del FG anulado depende de ella. Pruebas: TC-41, TC-41b,
  TC-49a a TC-49c y `debug/flag_outcome.test.mjs`.
- **Regreso del punt bloqueado (§7 Art.1 A.R.1-4).** El bloqueador recibe un regreso desde
  la línea de golpeo hasta donde se recogió el balón, aunque recupere el equipo que patea.
  Si él mismo recogió y corrió, el regreso llega hasta el final de su carrera. Si recogió y
  corrió otro jugador, ese jugador recibe el resto de las yardas sin contar un regreso, y el
  TD es suyo. Pruebas: TC-20 a TC-20d. 2dd8daf7 seq 5: #41 bloqueó, recogió y corrió, así
  que recibe 1 regreso de 29 yardas con TD. Ojo: en esa jugada los tres campos solo tienen
  el número (#41, sin nombre), así que "mismo jugador" se decide por número.
- **Dato por revisar en la captura: staging c9192eef seq 19 (Velazquez).**
  `punt_kicked_to` es CU 17, pero `punt_fair_catch_at` es CU 27. "Dentro de 20" se mide en
  el fair catch (CU 27), así que ese punt ya no cuenta como dentro de 20. Las yardas
  siguen midiéndose hasta `punt_kicked_to`. No se corrigió.

## 8. H-22: jugadas anuladas no cuentan para la defensa (2026-11-13)

Una jugada anulada por una falta aceptada (`stats_count === false` después de
`resolvePlay`) no se registra (§14 Art.3, 5 y 6: "The play is nullified and is not
recorded"). Eso incluye la defensa. Hoy:

- No cuentan tackles, sacks, TFL, FF, INT, PBU ni hurries (`computeDefenseStats`,
  `computePlayerStats`).
- Tampoco cuentan en las filas Sacks y TFL de Comparación (`computeComparisonStats`).
- No cuentan regresos de INT ni de fumble (las tres funciones de regresos).
- Tampoco cuentan kickoffs anulados con `previous` explícito, ni sus regresos o TD de
  regreso en Individual.

Una falta cobrada al final de la jugada o una falta declinada no anulan nada. Pruebas: TC-25
y TC-25b a TC-25g. Además, "mismo jugador" en el regreso del bloqueador exige el mismo
equipo (TC-20e).

Efecto en los juegos de prueba:
- **2dd8daf7 seq 16:** #0 C. Velez (CCM) pasa de 2 a 1 tackle solo. Se actualizaron las 2
  líneas de `penalties-fumbles.json`.
- **Staging c9192eef seq 21:** desaparece la fila de #6 A. Salmones (MTY), que solo tenía ese
  tackle.

Pendiente, sin casos reales:

- **Un FG anulado sigue contando como intento**, en `st.fgs` (`computeSpecialTeamsStats`) y
  en Individual > Equipos Especiales (`viewer.html`, `_buildIndSpecialTeams`, intentos de FG).
  Tiene la misma causa que H-22. No hay ningún FG anulado en los juegos capturados.

## 9. Fumbles, 4to down, try y grounding (2026-11-13)

Se aplicaron TC-40, TC-17, TC-12, TC-11, TC-34 (parte de código), TC-26 y TC-05, todos en
`shared/stats-lib.js`. Pruebas: TC-40 a TC-40e, TC-17 a TC-17f, TC-12, TC-12b, TC-11, TC-34,
TC-26 y TC-05 a TC-05c. Efecto en los juegos de prueba:

- **2dd8daf7 seq 19 (TC-40):** #99 M. Gama (CCM) pasa de 0 a 1 tackle solo y de 0 a 1 TFL. El
  TFL de equipo de CCM pasa de 0-0 a 1-2.
- **13098f4c seq 1 (TC-40):** #12 A. Buendia (ABS) pasa de 0 a 1 tackle solo, sin TFL, porque
  CEM recuperó detrás de la línea pero avanzó hasta ganar 5 yardas (§13 Art.3(a)). En esa
  jugada hay además un tackle solo de #3 al que recuperó. Pregunta abierta: dos solos en una
  jugada (§16 Art.1) frente al solo del que fuerza (Art.6).
- **c0a826d4 seq 61 (TC-34):** el snap malo de MTY cuenta como fumble de equipo no perdido. En
  Team Stats, Fumbles-Lost de MTY pasa de 0-0 a 1-0.

Pendientes:

- **TC-34b, sin resolver (requiere captura).** Hay un snap malo y el mismo equipo recupera y
  sigue la jugada con pérdida. A quién va la corrida y la pérdida depende de qué fue:
  - si fue wild pass del centro, se cargan a "Center Pass" (§15);
  - si el QB soltó un buen snap, se cargan al QB (§6 A.R.6).
  La captura no distingue los dos casos. Hoy la corrida queda del jugador que la captura dice.
- **Snap malo que recupera el rival y luego vuelve a soltar** (`snap_fumble_result: 'fumble'`).
  Ese segundo fumble, el del rival, no se cuenta. No hay casos reales.
- **TC-22 (muff de despeje) sin cambios.** El muff no se cuenta como fumble del equipo que
  recibe. Sigue en rojo en la suite.
- **TC-17 cambia lo que ve el operador en captura.** Después de un 4to down fallido, la
  siguiente jugada ya sale con el balón del rival, en 1ro y 10 en el spot. Antes había que
  usar "Set Possession"; si se usa igual no pasa nada, porque fija un equipo, no alterna. No
  hay ningún 4to down fallido en los datos, así que **conviene revisarlo en el primer juego
  real**, junto con la línea de situación del viewer en vivo.

## 10. Tiempos fuera: pendiente de captura (2026-11-13)

El marcador del viewer ya no muestra tiempos fuera. Antes enseñaba 3 puntos fijos por
equipo que no reflejaban nada real, porque el dato no está en la base.

- **Qué captura hoy el operador:** el evento `timeout` (Game Control, tecla T) guarda el
  equipo y el reloj, pero solo en el `localStorage` del operador (`gameEvents` en
  `live-stats/capture/engine.js`). No llega a Supabase: no hay tabla de eventos y `plays` no
  recibe filas `GAME_CTRL`.
- **Pendiente (captura, toca `engine.js`/`wizard.js`):** guardar los eventos de tiempo fuera
  en Supabase (equipo, cuarto, reloj). Así el viewer podría mostrar los tiempos restantes
  de cada equipo por mitad.
- **Cuando exista el dato:** volver a poner la fila en el marcador, debajo de la tabla por
  cuarto, contando los tiempos usados de cada equipo en la mitad en curso. En móvil va
  después de la tabla.
