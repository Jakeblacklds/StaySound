# Detalles locales nativos de Android

`StaySoundDetailView` renderiza únicamente las rutas locales de artista y álbum.
Expo descubre el módulo en `modules/detail-view` mediante autolinking, sin cambios
a los módulos nativos existentes ni dependencias nuevas en el reproductor.

## Contrato

- `NativeDetailScreen.tsx` entrega un snapshot de metadatos de los mapas actuales
  de `useLibraryStore`. No contiene URIs de audio, persistencia ni una biblioteca
  adicional. La identidad canónica del artista procede de `generateArtistId`.
- Kotlin filtra las relaciones del artista, conserva el orden de `album.tracks`
  y `artist.albums`, elimina referencias ausentes/repetidas y muestra cinco Top
  Songs con el contexto completo del artista para reproducción. No inventa IDs ni
  reordena por título o número de pista (que podría alterar álbumes multidisco).
- El catálogo se procesa fuera del hilo UI. Las revisiones anteriores se descartan
  al cambiar de ruta o desmontar la vista. El ID de reproducción se actualiza por
  separado, sin serializar ni procesar de nuevo el catálogo.
- Las acciones llevan `kind`, `detailId`, `id` y, para reproducción, `trackIds` en
  orden. TypeScript valida el origen, el foco y la pertenencia contra el store vivo,
  omite pistas borradas y llama exclusivamente a `player.play` / `addToQueue`.
  Shuffle, límites de contexto y el motor de audio siguen siendo responsabilidad
  del reproductor existente.
- Kotlin gestiona RecyclerView, el carrusel de álbumes, taps, pulsación larga,
  menú de cola y expansión de biografía. `useArtistInfo` y `useDynamicColors`
  suministran los datos de los servicios existentes. La portada usa resolución
  completa con miniatura de respaldo; el fondo usa una imagen reducida y blur en
  Android 12+, y respeta el modo ligero.
- El botón Volver emite una acción para `router.back()`. El Back físico/predictivo
  sigue perteneciendo a Expo Router; no hay una segunda pila de navegación. El
  diálogo nativo de cola consume Back mientras está abierto. Al volver del álbum
  se conservan la posición de la lista y del carrusel del artista.

## Compatibilidad

Las rutas detectan `StaySoundDetailView` solamente en Android. Si falta (APK
antiguo), o en iOS/web, renderizan `ReactArtistDetailScreen` y
`ReactAlbumDetailScreen`, copias idénticas de las implementaciones anteriores.
La vista nativa estará disponible al instalar un binario que incluya este módulo.

## Validación

```sh
npx tsc --noEmit -p tsconfig.android.json
node scripts/build-android.mjs --variant development --task :detail-view:testDebugUnitTest
```

La tarea Gradle compila el módulo y ejecuta 14 pruebas JVM: parsing, modelos,
duración, orden, relaciones heredadas, IDs opacos y colisiones de hash, contexto
completo, navegación, cola, detalles vacíos/ausentes y rechazo de acciones
obsoletas. No genera APK ni inicia un emulador.

Pendiente de revisión en dispositivo cuando se solicite: fidelidad visual en
claro/oscuro y modo ligero, portadas locales/remotas/fallidas, desplazamiento con
bibliotecas grandes, artista → álbum → Back, Back con menú abierto, reproducción
y cola con el miniplayer existente y cambio de catálogo con el detalle abierto.
