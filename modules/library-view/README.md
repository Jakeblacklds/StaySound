# Library nativa para Android

Primera pantalla de la migración gradual a Kotlin. Expo descubre este módulo local
mediante `expo-module.config.json`; no requiere modificar el proyecto generado de
Android ni el proyecto Tauri.

## Alcance

- Cabecera, pestañas, búsqueda, canciones, álbumes y artistas: Android Views y
  RecyclerView, escritos en Kotlin.
- Menús, selección de carpeta, playlists y confirmaciones: diálogos Material nativos.
- Reciclaje, imágenes y desplazamiento no envían eventos a JavaScript.
- Parseo, ordenación y búsqueda sin acentos en un worker cancelable; diferencias de
  listas calculadas por ListAdapter fuera del hilo de UI.
- Glide decodifica las imágenes al tamaño de visualización y reutiliza su caché.
  Se prefiere la portada original para conservar nitidez; `artworkThumb` queda como
  fallback si la fuente principal no se puede cargar.
- Al cambiar la pista actual solo se notifican sus filas anterior y nueva.
- Etiquetas en español/inglés, colores del tema actual, controles de al menos 48 dp
  y márgenes para el minirreproductor y las barras del sistema.

`src/features/library/NativeLibraryScreen.tsx` conecta instantáneas mínimas del
catálogo y acciones explícitas con Zustand, el escáner, el reproductor y Expo Router.
La persistencia, reproducción, navegación general y las páginas de detalle de álbum
y artista continúan en su implementación actual. No se crean dos fuentes de datos.
Las actualizaciones del catálogo todavía serializan su proyección en JavaScript;
una futura migración del repositorio de datos puede eliminar ese paso.

La ruta usa Kotlin cuando el APK contiene `StaySoundLibraryView`. Otros binarios y
plataformas conservan `ReactLibraryScreen.tsx`. **Una OTA no instala código Kotlin**:
esta primera migración requiere instalar un APK nuevo.

## Verificación

```sh
npx tsc --noEmit -p tsconfig.android.json
node scripts/build-android.mjs --variant development --task :library-view:testDebugUnitTest
npm run android:build:release
```

Las pruebas verifican búsqueda por título/artista/álbum, acentos, ordenación,
identificadores por pestaña, duplicados, catálogo vacío y metadatos de las acciones.
El APK ARM64 queda en `out/android/app-prod-release.apk`.

## Validación pendiente en dispositivo

La compilación no demuestra 120 fps. No hubo un teléfono conectado y el AVD local
no arrancó porque su instalación de la imagen de sistema está incompleta.

En un teléfono con pantalla de 120 Hz, usar el APK release, frecuencia alta activada
y la misma biblioteca para comparar antes/después. Verificar:

1. Desplazamiento rápido y sostenido en las tres pestañas, con carátulas frías y ya
   cacheadas. Perfetto/FrameTimeline permite comprobar el presupuesto de 8,33 ms
   y los frames que pierden su plazo; el refresco lo decide Android/el dispositivo.
2. Buscar con acentos, borrar la búsqueda, cambiar de pestaña y girar el dispositivo.
3. Reproducir, añadir a cola/playlist, crear una playlist y regresar desde detalles.
4. Escaneo por carpeta, biblioteca vacía, búsqueda vacía y denegación de permisos.
5. Probar las dos confirmaciones de borrado usando archivos de prueba.
6. TalkBack, tamaño de fuente grande, teclado, botón Atrás y temas claro/oscuro.

Captura complementaria de frames (no sustituye FrameTimeline a 120 Hz):

```sh
adb shell dumpsys gfxinfo com.staysound.app.pro reset
# Desplazarse por Library durante 20–30 segundos.
adb shell dumpsys gfxinfo com.staysound.app.pro framestats > library-framestats.txt
```

Referencias: [vistas nativas Expo](https://docs.expo.dev/modules/native-view-tutorial/)
y [ListAdapter](https://developer.android.com/reference/androidx/recyclerview/widget/ListAdapter).

## Pulido visual

La cabecera se alinea con Home, las pestañas mantienen su ancho al seleccionarse
y el indicador se desliza sin cambiar el peso de las etiquetas. Las canciones
reservan hasta dos líneas para el título; las carátulas de álbum tienen radio de
16 dp y los artistas usan retratos circulares con texto fuera de la imagen.
La cuadrícula adapta sus columnas al ancho y al tamaño de fuente.

El cambio de sección tiene una entrada breve; las pulsaciones se cancelan al
iniciar un desplazamiento y al reciclar la fila. Las portadas aparecen con un
fundido corto. El modo ligero y la opción del sistema de quitar animaciones
anulan estos efectos. Una carga lenta muestra un indicador nativo en vez de
presentar prematuramente la biblioteca como vacía.

La revisión conjunta está en `out/android/StaySound-ui-polished.apk`.
