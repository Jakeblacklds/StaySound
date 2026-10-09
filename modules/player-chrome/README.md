# Android player chrome

Local Expo module, discovered from `modules/` during prebuild/autolinking. Android
provides `StaySoundMiniPlayer`, `StaySoundNavigationBar`, and `StaySoundFullPlayer`.
iOS and older APKs retain the existing React Native renderer.

Kotlin owns the player scene: mini player, shared cover/disc, expansion and dismissal
gestures, transport, native progress scrubbing, phrase preview, reorderable queue,
options, and lyrics controls. Typography, glyphs, geometry, timing curves, springs,
and album color transitions follow the existing player. Lyrics embed the existing
Kotlin karaoke renderer; spectrum and refraction use the same native renderers.
Android 7–12 uses a GLES port of the existing psychedelic background shader.

`AndroidFullPlayer.tsx` is a data/service adapter. Playback, library, lyrics fetching,
settings, sharing, and navigation continue through the existing stores and services.
No second player or playback queue is created. Queue edits validate the full queue
revision; track-specific actions validate their originating track before execution.
A cancelled seek, including replacement of the current track, cannot commit.

The native expansion event updates a Reanimated shared value on the UI thread. A
small animated host follows those bounds and coordinates the navigation bar exit;
this also keeps collapsed-player hit testing inside the dock. The shared playback
position goes directly to native props. The lyrics hook suppresses JS timeline
snapshots for this host, so lyrics and progress do not rerender React every frame.

Hidden lyrics and spectrum rendering are suspended. Animations stop on detach and
honor disabled Android system animations where supported. Buttons and the progress
control expose native TalkBack actions.

Validation:

- `npx tsc --noEmit -p tsconfig.android.json`
- `node scripts/build-android.mjs --variant production --arch arm64-v8a --task :player-chrome:testReleaseUnitTest`
- `npm run android:build:release`

Device checks: opening/closing by tap and swipe, interrupted gestures, transport,
rapid track changes, seeking/cancelling a seek, queue reordering, lyrics and options,
background/foreground, album colors, large fonts, TalkBack and Remove animations.

## Pulido del miniplayer y la navegación

El miniplayer utiliza una portada con esquinas suaves que se transforma en disco
al expandir el reproductor. El título y el artista tienen más presencia; el cambio
de pista y las pulsaciones usan transiciones cortas e interrumpibles. Los botones
conservan objetivos táctiles de 48 dp. En anchos menores de 350 dp o con fuente
grande, Anterior permanece disponible en el reproductor expandido y cede espacio
al título en el mini; con fuente a partir de 1,8× se muestra solo el título.

La barra conserva sus destinos y eventos de navegación. Una superficie tonal se
desliza bajo el icono seleccionado, con etiquetas de posición estable y sin halo.
La selección se confirma mediante navegación antes de animarse. Las animaciones
nuevas respetan el modo ligero y la opción del sistema de quitar animaciones.

La revisión conjunta está en `out/android/StaySound-ui-polished.apk`. Incluye
Home, miniplayer, navegación y biblioteca. La revisión visual y de gestos en
un dispositivo sigue pendiente porque el acceso está desactivado en este entorno.
