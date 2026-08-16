# FOOTBALL RANK MX

Repo de prueba para verificar que el flujo de Git/GitHub funciona correctamente.

## Cómo ligar una carpeta local con un repo de GitHub

1. Abrir terminal en la carpeta del proyecto.
2. `git init` — inicializa git en la carpeta.
3. Copiar la URL del repo desde GitHub (botón verde "Code").
4. `git remote add origin URL_DEL_REPO` — conecta la carpeta local con el remoto.
5. `git remote -v` — verifica que quedó bien ligado.
6. `git add .` — agrega los archivos al staging.
7. `git commit -m "mensaje"` — crea el commit local.
8. `git branch -M main` — asegura que la rama se llame main.
9. `git push -u origin main` — sube todo y liga la rama local con la remota.

Después de esto, para trabajar normal:

- `git add .`
- `git commit -m "mensaje descriptivo"`
- `git push`

Y para traer cambios de otro dispositivo:

- `git pull`
