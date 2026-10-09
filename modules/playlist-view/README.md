# Playlists locales en Kotlin

`StaySoundPlaylistView` migra las tres rutas `playlists`, `playlist/[id]` y
`playlist-create`. Expo lo descubre mediante el autolinking local de `modules/`.
Las rutas detectan el módulo opcional únicamente en Android. iOS, web y APKs que
no lo incluyan mantienen las tres implementaciones React Native originales,
conservadas sin modificaciones en `src/features/playlists/React*Screen.tsx`.

## Responsabilidades

- Kotlin renderiza la lista, mezcla destacada, detalle, biblioteca con búsqueda,
  formularios, menús, confirmaciones, estados vacíos y feedback. Usa RecyclerView,
  controles Material, campos con etiquetas accesibles, objetivos táctiles de al
  menos 48 dp y diálogos que consumen Back. El botón Volver se conecta a Expo Router;
  Back físico/predictivo sigue en la pila existente. No crea Activity ni navegador.
- `NativePlaylistScreen.tsx` entrega metadatos desde `useLibraryStore` y conecta las
  acciones a ese mismo store, `usePlayerStore`, `useTidalDownload`, los servicios
  remotos/Spotify, el portapapeles, selector de imágenes y Expo Router. No crea
  persistencia, reproductor ni cola adicionales. Biblioteca, Inicio, Buscar, Tidal
  details, player-chrome, karaoke y Soulseek no se modifican.
- La lista conserva `updatedAt` descendente (con empates estables); las canciones
  conservan el orden persistido. El flujo original no tenía reordenamiento manual,
  por lo que no se agrega una segunda política de orden ni un gesto para persistirlo.
- Las acciones llevan `screen`, `playlistId`, `id` y `memberId`: este último es el ID
  de la relación guardada. El store puede resolver una canción remota a otra local
  con ID distinto. Quitar de playlist utiliza el ID guardado; reproducir, cola y
  descargas utilizan la canción resuelta por los servicios actuales. No se usan
  hashes ni posiciones como identidad. TypeScript valida el foco y las acciones
  contra el estado vivo, incluyendo los permisos `readonly` y los destinos.
- La reproducción mantiene el contexto completo de la playlist. Las listas mixtas
  pasan por `playResolvedRemoteTrack`, incluidas las que empiezan con un archivo
  local. Cola remota resuelve antes de llamar a `addToQueue`. La descarga reporta
  resolución/progreso y permite reintentar errores sin otro motor de descargas.
- La importación Spotify conserva detección del portapapeles, URL manual, servicio
  de importación, progreso, error y navegación al detalle. Volver antes de terminar
  evita confirmar una importación oculta. No se guardan formularios en el store.
- Las portadas nuevas son borradores por sesión. Cancelar limpia sólo esos archivos;
  guardar actualiza el store antes de limpiar la portada anterior. Ningún archivo
  referenciado por otra playlist se borra. El borrado de canciones/dispositivo y de
  playlists usa confirmaciones Material; quitar de playlist no borra el audio.
- El catálogo se procesa fuera del hilo UI con revisiones para descartar trabajos
  obsoletos. Reproducción y progreso se actualizan por separado. Los campos de
  búsqueda/editor no se reconstruyen en cada actualización; el selector de canciones
  es virtualizado. Las animaciones respetan modo ligero y la preferencia de Android.

## Verificación

```sh
npx tsc --noEmit -p tsconfig.android.json
node scripts/build-android.mjs --variant development --task :playlist-view:testDebugUnitTest
```

18 pruebas JVM cubren orden, comandos de crear/editar/eliminar, readonly, IDs opacos,
relaciones remotas/locales, búsqueda, colas, importación, navegación y estados vacíos.
Son pruebas del contrato/modelo usado por la vista: la persistencia continúa en el
store TypeScript. La tarea compila Kotlin y ejecuta pruebas, sin generar APK.

La comprobación visual y de interacción en dispositivo queda pendiente: temas,
fuente ampliada/teclado, portadas, importación real, reproducción, descargas y Back
con menús. No se abrió emulador ni se generó APK release para esta migración.
