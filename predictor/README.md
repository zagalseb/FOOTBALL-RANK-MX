# Simulador de la tabla general · Liga Mayor ONEFA 2026

Sitio estático (HTML, CSS y JavaScript con módulos ES, sin build) para pronosticar los juegos pendientes y ver la tabla recalculada con el reglamento de desempate de ONEFA.

## Estructura

```
predictor/
├── index.html
├── Calendario_2026.xlsx   ← fuente de datos (se lee en el navegador)
├── css/styles.css
├── js/
│   ├── parser.js          ← lee el Excel con SheetJS
│   ├── standings.js       ← tabla y desempates (lógica pura, sin DOM)
│   ├── scenario.js        ← codificación del escenario en el hash de la URL
│   ├── schedule.js        ← calendario y rivales de cada equipo (lógica pura)
│   ├── teams.js           ← equipos, logos y alias de nombres
│   └── app.js             ← interfaz y estado
├── vendor/xlsx.mjs        ← SheetJS 0.20.3 (copia local, licencia Apache 2.0)
└── tests/standings.test.js
```

Los logos se toman de `../Logos/` (la carpeta en la raíz del repo).

## Actualizar resultados

1. Abre `predictor/Calendario_2026.xlsx` y captura los marcadores en las dos columnas `Pts`.
   Un juego cuenta como jugado cuando ambos marcadores son números. Si lo dejas vacío o con `-`, sigue pendiente.
2. Guarda el archivo con el mismo nombre, haz commit y push. No hace falta generar nada más.

Si el sitio encuentra algo que no entiende en el Excel (un equipo desconocido, un solo marcador, una fila rara), muestra un aviso arriba de la página.

## Correrlo local

El navegador no puede leer el Excel si abres `index.html` con doble clic, así que necesitas un servidor local. Levántalo **desde la raíz del repo** para que `../Logos/` funcione:

```bash
cd "FOOTBALL RANK MX"
python3 -m http.server 8000
```

Luego abre <http://localhost:8000/predictor/>.

## Pruebas

Requiere Node 18 o superior:

```bash
cd predictor
node --test        # o: npm test
```

## Publicar en GitHub Pages

1. Haz merge de los cambios a `main` y haz push.
2. En GitHub ve a **Settings → Pages**. En *Build and deployment* elige **Deploy from a branch**, rama `main` y carpeta `/ (root)`.
   Si Pages ya está activo para el repo, no hay que cambiar nada.
3. El simulador queda en `https://zagalseb.github.io/FOOTBALL-RANK-MX/predictor/`.

Cada push a `main` (por ejemplo, con el Excel actualizado) vuelve a publicar el sitio en uno o dos minutos. La página pide el Excel con `cache: 'no-cache'`, así que los visitantes ven los resultados nuevos al recargar.

## Notas

- Los pronósticos se guardan en `localStorage`. Si el navegador no lo permite, la app sigue funcionando sin guardar.
- **Compartir** genera un link con el modo y los pronósticos en el hash (`#m=s&p=<id>:L,<id>:21-14`). Los ids de juegos desconocidos o ya jugados se ignoran.
- El id de cada juego es `s<semana>-<local>-vs-<visita>` en slug. Si cambias equipos o semanas en el Excel, los links viejos de ese juego dejan de aplicar.
