# Shell Android de StaySound

`StaySoundShellScreen` renderiza el contenido de `/lyrics` y `/modal` en Kotlin.
Android usa el contenedor y la pila Kotlin descritos en [NAVIGATION.md](NAVIGATION.md).
El botón Cerrar emite `back`; Back del sistema lo resuelve el contenedor Android.
iOS y web conservan Expo Router. Durante estas rutas se retira
el FullPlayer global para que no cubra la pantalla ni intercepte su Back; los
stores y la reproducción permanecen activos.

La ruta de letras usa `LyricsRepository.getLyrics` y `playerStore` existentes.
Descarta respuestas de otra pista y distingue carga, vacío y error. Los cambios
KARAOKE/STANDARD quedan en el adaptador TS; `KaraokeView` recibe los mismos datos
crudos y activa su modo por línea para STANDARD. La posición se entrega con
Reanimated, sin renders React por frame; seek vuelve al playerStore. No hay
parser, reloj de audio, repositorio ni renderizador de karaoke nuevos.

`StaySoundOverlayHost` reemplaza los tres overlays globales que monta `_layout`:

- `ConfirmationModal`: MaterialAlertDialog, botones confirmación/cancelación,
  cancelación por Back o toque exterior.
- `ActionSheet`: BottomSheetDialog con portada, metadatos, acciones destructivas,
  scroll, cierre explícito, swipe, toque exterior y Back.
- `GlobalNotification`: Snackbar Material con FIFO, duración de 3 segundos,
  colores semánticos y acción Cerrar. Respeta la duración accesible de Material.

Prioridad: confirmación > hoja > notificación. La notificación se retira mientras
hay diálogo y reinicia su duración al reaparecer; nunca se elimina por una
suspensión programática. Back cancela únicamente el diálogo superior, nunca
confirma. Las notificaciones no interceptan Back de navegación.

## Contrato y propiedad del estado

`notificationStore` posee la única cola, incluyendo IDs monotónicos para mensajes
idénticos. Sus campos anteriores y `showNotification`/`hideNotification()` siguen
funcionando. `hideNotification(id)` evita que un timeout antiguo quite el mensaje
siguiente. El fallback Paper usa la misma cola.

`uiStore` conserva configuración, callbacks y visibilidad. Cada apertura recibe
un ID. El snapshot JSON solo transmite datos serializables: ningún callback cruza
el puente. Kotlin guarda la proyección que está mostrando y latches de entrega
hasta recibir el snapshot de TS; no ejecuta ni persiste acciones de negocio.

Los eventos incluyen `kind`, `id`, `action` y, en hojas, `index`. El adaptador
valida el estado vivo, prioridad, ID e índice, cierra antes de ejecutar el callback
y rechaza eventos duplicados/obsoletos. Una confirmación puede abrir otra sin que
el cierre de la anterior la borre. Al desmontarse, Kotlin elimina ventanas y
Snackbars sin emitir cancelaciones sintéticas.

## Compatibilidad y alcance

La detección requiere ambos módulos y Android. iOS/web y APKs antiguos conservan
las pantallas originales en `src/features/shell/React*Screen.tsx` y los tres
overlays React Native. Expo autolinking descubre `modules/android-shell`.

Auditoría del shell global: no hay otro Portal/Modal global en `AppBootstraps`.
Cola, opciones y sugerencias de letras del FullPlayer ya tienen UI Kotlin en
`player-chrome`; las versiones React quedan como fallback. Los diálogos locales
de pantallas fallback (por ejemplo ajustes/Tidal) no son overlays globales.
`Alert.alert` ya presenta un diálogo Android nativo. No se modifican audio,
descargas, Soulseek, lyricsRepository ni los archivos de karaoke-view.

## Validación

```sh
npx tsc --noEmit -p tsconfig.android.json
node scripts/build-android.mjs --variant development --task :android-shell:testDebugUnitTest
node scripts/test-android-shell.mjs
```

13 pruebas Kotlin: FIFO, mensajes repetidos, prioridad, suspensión/reanudación,
Back, confirmación, límites de índices, eventos obsoletos y entregas únicas.
6 pruebas del adaptador TS/store: cola, validación, cancelación y callbacks que
abren diálogos nuevos. Gradle compila también la dependencia karaoke-view.

No se genera APK ni se usa emulador. Pendiente de comprobación en dispositivo:
Back por gesto/botón, TalkBack, fuentes grandes, rotación, claro/oscuro, ventanas
al poner la app en segundo plano y navegación desde/hacia el reproductor.
