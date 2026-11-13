# Verificación de la pestaña Individual (viewer.html)

Scripts de solo lectura: hacen GET a la REST API de Supabase (las mismas rutas
que `viewer.html`) y **nunca escriben**. Usan los 3 partidos de la semana TEST
(`common.mjs → GAMES`). Por defecto cargan `shared/stats-lib.js` del working
tree, que es la que carga el viewer. Casi todos aceptan otra ruta de
`stats-lib.js` como argumento.

Los scripts de las fases 3 a 6 **extraen el código real** de `viewer.html`
(los bloques sin JSX marcados `IND_*_START/END`, más `_indContext` y
`_indFirstDownBySeq`) y lo corren en Node. Así prueban el código del archivo,
no una copia.

Correr desde la raíz del repo:

| Script | Qué verifica |
|---|---|
| `f2_ofensiva.mjs` | Ofensiva (Pase, Recepción, Carrera); los totales cuadran con Team Stats |
| `roster_temporada.mjs` | Arreglo del roster por temporada: antes y después en las pestañas existentes; solo cambian los duplicados |
| `f3_qb.mjs` | QB Progression: tarjeta = Ofensiva·Pase = suma de filas. `--anuladas`: simula banderas en memoria |
| `f4_big_pen.mjs` | Big Plays (= existente filtrado a 20+/10+) y Penalties (= pestaña existente). `--simular`: banderas en memoria |
| `f56_def_st.mjs` | Defensiva y Equipos Especiales vs "{Apodo} Stats". `-v`: imprime las tablas |
| `tackles_antes_despues.mjs` | Corrección de tackles: por jugador y equipo, antes y después (rutas en la cabecera) |
| `tfl_equipo.mjs` | Fila TFL de Team Stats antes y después; ningún otro campo cambia |
| `team_stats_tabla.mjs` | Tabla Game Stats de Team Stats: (a) = lista de barras, (b) acarreos + intentos = jugadas, (c) tierra + aire = total, (d) promedios, (e) Σ cuartos = Totals, (f) = Individual, (g) = Comparación. `-v`: imprime la tabla |
| `fg_spot.mjs` | Gol de campo en `advanceGameState`: kickoff tras FG bueno, spot del FG fallado (35…5), FG anulado/declinado, bloqueados. Sin red. `--antes <stats-lib.js>`: los bloqueados deben dar lo mismo que esa versión |
| `sacks_compartidos.mjs` | TC-04: sacks compartidos (sack_by + otros en tackle_by) en "Capturas" de Individual y la tabla SACKS de Comparación (código real del viewer). Sin red |
| `check_jsx.cjs` | Compila el JSX de `viewer.html` con Babel 7.29.0 (ruta de Babel en la cabecera) |

Diferencias esperadas contra las pestañas existentes:
- Despejes: la pestaña nueva no cuenta los anulados por bandera (TEST: AT #8 Olvera, seq 31),
  ni fake punts ni snaps malos, y mide los downed/muffed (la existente les pone 0 yardas).
- Antes de unir `proposal/defensa-tackles`, Defensiva coincide con los números anteriores
  a la corrección; después, con los corregidos.

`FR_SCHEMA=covercero_staging` apunta los scripts al schema de entrenamiento.
