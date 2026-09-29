# Detalles Tidal en Android

Módulo Expo local `StaySoundTidalDetailView`. Expo autolinking descubre este
paquete en `modules/`; no requiere cambios en los módulos nativos existentes.

Las cuatro rutas `app/tidal-{artist,album,playlist,genre}/[id].tsx` conservan sus
controladores TS y su renderizador RN. Si el módulo existe en Android, entregan
un snapshot al adaptador `src/features/tidal/details/NativeTidalDetail.tsx`.
En iOS, web y APKs anteriores se sigue mostrando el renderizador RN.
Los controladores se reinician al cambiar la identidad de la ruta, evitando
mezclar una petición anterior con el siguiente detalle.

## Responsabilidades

- **Kotlin:** hero, portada y fondo, barra superior ligada al scroll, secciones,
  filas reciclables, carruseles, mosaico, estados de carga/error/vacío,
  expansión de 8 canciones del artista y páginas de 16 tarjetas (máximo 96).
- **TS existente:** consultas Tidal y fallback de género, opciones Qobuz/Soulseek,
  resolución de streaming, reparación de archivos locales, descargas, cancelación,
  confirmación de MP3, Zustand y navegación Expo Router.
- **Adaptador TS:** mapea metadata/estado, extrae la paleta con el hook existente,
  valida las acciones contra el detalle enfocado y sus miembros actuales y llama
  a los manejadores compartidos con RN. Para cola usa el player store existente.

Kotlin no recibe credenciales ni URLs de audio y no crea reproductores, tareas de
transferencia, servicios de descarga ni conexiones a Tidal/Soulseek. Glide carga
únicamente las imágenes de presentación. Los cambios de progreso actualizan las
filas afectadas sin reconstruir los carruseles ni reiniciar el scroll.

## Contrato v1

`model` es un JSON versionado con `screenKey`, `kind`, `id`, metadata del hero,
`tracks`, `sections`, `grid` y estados TS. `appearance` contiene colores del tema
y de la portada; los insets se envían en dp. Los IDs cruzan el puente como strings
(incluidos UUIDs de playlists). Se preserva el orden y las repeticiones de pistas.

`onAction` entrega `{ screenKey, action, id, kind }`:

- `back`, `navigate` (artista, álbum, playlist o género presente en el snapshot).
- `play`, `playAll`, `shuffle`, `queue`.
- `download`, `cancelDownload`, `downloadAll`.

Las opciones de cada canción permiten agregar a cola. El botón Descargar del
artista llama a los manejadores TS de descarga; el renderizador RN anterior
conserva su comportamiento. Expandir/contraer y cargar más son estado visual local.
No se reimplementa en Kotlin ninguna decisión de reproducción o descarga.

## Verificación sin APK ni emulador

```sh
npx tsc --noEmit -p tsconfig.android.json
JAVA_HOME="$HOME/.jdks/jdk-17.0.19+10/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
./android/gradlew -p android :tidal-detail-view:testDebugUnitTest --console=plain
```

Las pruebas JVM cubren los cuatro tipos de detalle, JSON inválido y versiones,
IDs, nulls, orden/repeticiones, progreso, estados de lista, límites de paginación,
cambio de identidad, destinos permitidos y acciones según estado TS.
La validación visual en dispositivo queda pendiente; estas pruebas no ejecutan
API, streaming ni transferencias reales.
