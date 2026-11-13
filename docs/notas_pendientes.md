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
