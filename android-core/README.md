# Núcleo Android de StaySound

**Estado: primera capa implementada y probada de forma aislada; la migración completa NO está terminada ni activada en la aplicación.**

`model` es Kotlin/JVM; `data` usa Room 2.7.2, DataStore y coroutines, sin dependencias React/Expo. El build independiente también se incluye como composite build desde el plugin `withAndroidCore`. Los módulos Kotlin de UI, karaoke, indexación y Soulseek existentes se conservan.

## Qué funciona en esta capa

- Modelos de pistas con todos los campos persistidos actuales y extensiones desconocidas; IDs de álbum/artista compatibles con el hash UTF-16 de JavaScript.
- Room para pistas, playlists, entradas ordenadas (incluidas repeticiones y referencias ausentes), pistas de playlists cloud, historial, descargas y metadatos de artistas. Esquema v1 exportado en `data/schemas`.
- Álbumes y artistas derivados del catálogo de pistas. No existe un catálogo alternativo editable de álbumes/artistas.
- DataStore para ajustes, preferencias del reproductor y onboarding. Los documentos opacos —sesión de autenticación, credenciales Soulseek, permiso SAF, cachés de letras/colores y archivos no reconocidos— se conservan en Room sin interpretarlos como ajustes.
- Repositorios Kotlin, transacciones para favoritos/«Me gusta», playlists y publicación de descargas, selección local de pistas cloud, y `LibraryViewModel` con `StateFlow` de solo lectura.
- Importación de `files/storage/*.json` (incluidos subdirectorios) y de la tabla `artists` de `files/SQLite/staysound.db`. No se mueven archivos de audio ni se modifican sus URI.
- Adaptador temporal Android `modules/core-storage` / `src/services/storage.android.ts`: sigue sirviendo los JSON al runtime existente, pero serializa accesos, hace escrituras atómicas y mantiene el bloqueo de almacenamiento. iOS/web siguen usando exactamente el adaptador anterior, trasladado a `storage.legacy.ts`.

La UI aún **no usa** `LibraryViewModel`. Room/DataStore se activan únicamente en builds con el flag de abajo; no hay método de migración exportado a JavaScript.

## Modo de almacenamiento nativo (opt-in por build)

`STAYSOUND_NATIVE_DATA=1` durante `expo prebuild` añade `<meta-data app.staysound.NATIVE_DATA=true>` (plugin `withAndroidCore`). Con el flag, `StorageBootstrap` (llamado por `core-storage`) recupera cualquier migración interrumpida, importa los JSON antiguos una sola vez y sirve `getItem/setItem/removeItem` desde Room/DataStore (`NativeStorageSession`). Los stores JS conservan su lógica, pero la autoridad de los datos ya es Kotlin:

- Colecciones (`tracks`, `playlists`, `cloudPlaylistTracks`, historial) son filas; cada `setItem` se compara con lo guardado y solo escribe lo que cambió. Un documento malformado se rechaza sin tocar la biblioteca.
- Ajustes, jugador y onboarding van a DataStore; el resto (auth, letras, credenciales…) son documentos opacos en Room.
- Descargas y caché de artistas son de Kotlin: JS no puede escribir ni borrar `staysound-native-downloads-v1`.
- Sin el flag, un build posterior exporta los datos nativos actuales de vuelta a los JSON antes de abrir el modo legacy, así que alternar el flag no pierde cambios.
- `NativeStorageSession.data` es el `StaySoundData` único para futuros consumidores Kotlin (ViewModels de las vistas nativas).

Limitación conocida: la caché de artistas de Expo SQLite sigue escribiéndola JS. Al volver a legacy, la exportación no reemplaza filas más nuevas que las de Room.
Sin validar en dispositivo con datos reales; los tests (`NativeStorageTest`) cubren importación, diff de escritura, reinicio, rollback y rechazo de datos inválidos.

## Propiedad y recuperación

Una sesión mantiene un bloqueo de archivo del sistema operativo durante toda su vida. Otro runtime no puede hidratar estado editable ni crear otro DataStore sobre el mismo directorio. Además, cada operación comprueba el propietario y se serializa con un mutex.

```
LEGACY → IMPORTING → NATIVE → EXPORTING → LEGACY
```

1. La importación valida los documentos antes de tocar el destino. Los datos corruptos, versiones incompatibles e IDs inconsistentes provocan error; no se convierten en una biblioteca vacía.
2. Crea una copia de cada documento bajo `files/staysound-core/imports/<uuid>` con manifiesto SHA-256; lee lógicamente SQLite, incluido su WAL, sin copiar solo el archivo principal.
3. Marca `IMPORTING`, escribe Room en una transacción, escribe DataStore y verifica la equivalencia de la exportación antes de marcar `NATIVE`. Los originales quedan intactos y congelados. Son respaldo, no otra fuente activa.
4. Si el proceso muere, `recoverInterruptedMigration()` repite el paso pendiente de forma idempotente. `cancelInterruptedImport()` permite volver a LEGACY si los originales siguen coincidiendo con el manifiesto, incluso si se dañó una copia de respaldo.
5. `exportForLegacyAtShutdown()` exporta los **datos actuales**, incluidos cambios Kotlin posteriores. Prepara y verifica el snapshot antes de marcar `EXPORTING`; reemplaza los JSON atómicamente y actualiza la caché SQLite en una transacción conservando IDs, otras tablas y columnas desconocidas. Solo entonces marca `LEGACY`.
6. Una interrupción durante la exportación bloquea ambos escritores hasta que se complete la recuperación. El rollback rechaza descargas nativas en cola/en ejecución; deberán detenerse mediante el gestor futuro.

Room y DataStore no comparten una transacción física: el diario de propiedad impide exponer un estado parcialmente importado. No se usa migración destructiva de Room ni recuperación de corrupción con valores vacíos.

Las descargas antiguas se identifican por `downloadedAt` o por `source=tidal` con URI local. Se conservan todas las pistas, incluso si no se puede comprobar acceso al archivo. Las tareas de descarga del cliente anterior solo vivían en memoria: no se inventan tareas reanudables. El sidecar `staysound-native-downloads-v1.json` conserva los registros de descarga nativos al volver al cliente anterior; ese cliente los ignora. La caché de artistas tiene un sidecar equivalente.

Antes de un futuro cambio de runtime hay que cerrar todos los consumidores antiguos (incluidos SQLite, audio y tareas de red), cerrar la sesión de almacenamiento anterior, abrir **una** instancia de `StaySoundData`, recuperar/importar y después crear el grafo nativo. Al cerrar, detener los consumidores del grafo antes de `close()`. Estas APIs son una base de migración, no un selector de runtime listo para producción.

Un APK anterior que no tenga el bloqueo nuevo no puede respetarlo: **exportar a LEGACY antes de instalar una versión anterior**. El fallback del adaptador solo se permite cuando el módulo nativo no existe; un error/rechazo de Kotlin nunca dispara una escritura JS alternativa.

## Verificación sin APK ni emulador

```sh
node scripts/test-android-core.mjs
node --test scripts/tests/android-storage.test.mjs scripts/tests/android-core-plugin.test.cjs
npx tsc --noEmit -p tsconfig.android.json
node scripts/build-android.mjs --variant development --task :core-storage:compileDebugKotlin
```

El primer comando ejecuta JUnit del modelo, integración Room/DataStore/SQLite con Robolectric y un control del classpath que rechaza dependencias React/Expo. No ejecuta `assemble` ni genera APK. Los tests cubren datos originales intactos, campos nuevos, URI y Unicode, referencias ausentes, selección local, rollback con cambios posteriores, cierres simulados en cada límite durable, importación dañada, exclusión de runtimes, reinicio, favoritos concurrentes, opciones de letras, caché SQLite, y publicación atómica de pista/descarga. El esquema Room exportado debe versionarse con migraciones explícitas en cambios futuros.

No se ha hecho validación en dispositivo ni con una copia real de los datos del usuario.

## Trabajo pendiente, en el orden solicitado

| Capa | Estado real y siguiente integración |
| --- | --- |
| 1. Datos | Base anterior implementada. Falta conectar las vistas nativas a `NativeStorageSession.data`/ViewModels (los stores JS ya persisten en Room con el flag), completar las operaciones de escaneo/enriquecimiento y las acciones de biblioteca que todavía viven en `libraryStore`, y cerrar la paridad antes de activar el propietario Kotlin. |
| 2. Tidal | Sin migrar. Portar catálogo/token, mirrors y capacidades/health, metadata, endpoints de detalle, resolución de streaming y manifests desde `tidalService.ts` y `features/tidal/data`; probar fixtures de todas las variantes/fallbacks. |
| 3. Descargas | Sin migrar. Consumir directamente el cliente Kotlin Soulseek existente, portar ranking/fallback FLAC/MP3, progreso, cancelación, SAF/MediaStore, sidecars y publicación en el repositorio. No reemplazar su implementación por estilo. |
| 4. Reproducción | Sin migrar. Un único `MediaLibraryService`/Media3 con cola/sesión/estado; cierre verificable de AudioEngine/RNTP antes de arrancarlo. Mantener cero instancias adicionales durante la transición. |
| 5. Servicios | Sin migrar. Conectar letras/karaoke y EQ existentes; portar orquestación de letras, Android Auto, actualización y auth con sus pruebas y migraciones reversibles. Las credenciales actuales están preservadas, no convertidas en un servicio de autenticación Kotlin. |
| 6. Runtime/puentes | Sin retirar. Las vistas actuales aún heredan de `ExpoView` y utilizan `AppContext`, `EventDispatcher` y en ocasiones `ReactFontManager`; además del núcleo falta desacoplar ese anfitrión conservando renderizadores y rendimiento. Sustituir `MainApplication`/`MainActivity` y sus dependencias solo después de la paridad. |

No hay un segundo reproductor implementado en este cambio. La comprobación «Android arranca sin React Native» sigue pendiente y no debe inferirse del build independiente del núcleo.
