# Actualizaciones de StaySound Desktop

La primera versión se instala manualmente desde el DMG. Las siguientes se
instalan desde el botón **Actualizar** dentro de la app. No hace falta una
cuenta de Apple Developer para este flujo familiar, pero macOS puede pedir a
cada persona abrir la primera instalación con clic derecho > **Abrir**.

## Preparar una versión

1. Sube `version` en `src-tauri/tauri.conf.json` (por ejemplo, `1.0.1`).
2. Genera el paquete desde este equipo. La clave privada vive fuera del
   repositorio en `/Users/jacob/.tauri/staysound-updater.key`; no se debe
   copiar ni subir a GitHub.

   ```bash
   npm run desktop:build

   TAURI_SIGNING_PRIVATE_KEY_PATH=/Users/jacob/.tauri/staysound-updater.key \
   TAURI_SIGNING_PRIVATE_KEY_PASSWORD='' \
   npx tauri signer sign src-tauri/target/release/bundle/macos/StaySound.app.tar.gz
   ```

3. Crea un GitHub Release con el tag `v1.0.1` y súbele estos archivos desde
   `src-tauri/target/release/bundle/macos/`:

   - El `.dmg` para quien aún no tiene la app.
   - `StaySound.app.tar.gz` y `StaySound.app.tar.gz.sig` para el actualizador.
   - Un archivo llamado `latest.json`, con este contenido (sustituye la firma
     por el contenido completo del archivo `.sig`):

   ```json
   {
     "version": "1.0.1",
     "notes": "Mejoras y correcciones.",
     "pub_date": "2026-07-24T00:00:00Z",
     "platforms": {
       "darwin-aarch64": {
         "url": "https://github.com/Jakeblacklds/StaySound/releases/download/v1.0.1/StaySound.app.tar.gz",
         "signature": "CONTENIDO-DE-StaySound.app.tar.gz.sig"
       }
     }
   }
   ```

4. Publica el Release (no lo dejes como borrador). Al abrir una versión
   anterior, StaySound detectará `latest.json`, verificará la firma y mostrará
   el botón de actualización.

Actualmente el build se genera para Apple Silicon (`darwin-aarch64`). Si una
persona usa un Mac Intel, se debe publicar además el artefacto `darwin-x86_64`
en el mismo `latest.json`.
