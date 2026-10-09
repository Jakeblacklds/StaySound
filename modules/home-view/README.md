# Home nativo para Android

`StaySoundHomeView` continúa la migración por pantallas: la interfaz de Inicio se
renderiza con Android Views y RecyclerView escritos en Kotlin. Expo descubre el
módulo local automáticamente; requiere un APK nuevo.

Conserva el saludo, la tipografía StaySound, la portada circular grande, el carrusel
con indicadores, las selecciones, el historial, las descargas, las incorporaciones
recientes y los álbumes. Recibe los colores del tema y del reproductor actuales,
respeta los insets del sistema y reserva espacio para el miniplayer.

Kotlin se encarga del desplazamiento, las imágenes con Glide, el carrusel, la
selección y ordenación de las secciones, los menús, las playlists y las
confirmaciones de borrado. El catálogo se prepara en un worker cancelable y el
historial llega por separado para evitar procesar toda la biblioteca al reproducir.
El carrusel respeta la opción del sistema de quitar animaciones y el modo ligero.
Las portadas usan la fuente original y Glide las decodifica al tamaño real de cada
vista; el thumbnail de 128 px queda únicamente como fallback.

`src/features/home/NativeHomeScreen.tsx` conecta las revisiones de datos y las
acciones explícitas con los servicios existentes: Zustand, el escáner, el motor de
reproducción y la navegación. Conserva la recuperación de pistas de streaming del
historial. La persistencia y esos servicios compartidos siguen formando parte de
la migración gradual; no se crea otra biblioteca ni otro reproductor.

La ruta activa Kotlin exclusivamente en Android si el binario contiene este módulo.
`ReactHomeScreen.tsx` conserva íntegra la implementación anterior para otras
plataformas y APKs antiguos.

## APK

```sh
npm run android:build:release
```

El APK ARM64 se genera en `out/android/app-prod-release.apk`.
La revisión visual y funcional del APK queda a cargo del usuario, según lo pedido.

### APK de la migración inicial

`out/android/StaySound-home-kotlin.apk` se compiló con Home nativo y excluyendo
`search-view` únicamente en esa invocación de Gradle, porque la migración paralela
de Buscar aún no compilaba. Buscar usa su fallback existente. No se modificaron
los archivos de esa migración ni la configuración permanente de autolinking.
El init script utilizado quedó en `out/android/home-build.gradle`.

### Pulido visual del Home

`out/android/StaySound-home-polished.apk` contiene la revisión visual del Home.
Se compila con el autolinking normal, incluyendo Buscar.

- Selección destacada sobre una superficie tonal, con contraste para el texto,
  portada circular y una acción de reproducción más visible.
- Jerarquía tipográfica más clara, títulos de pistas de hasta dos líneas y
  carriles que se desplazan hasta el borde de la pantalla.
- Entrada breve del carrusel, profundidad al deslizar, respuesta nativa a la
  pulsación y fundido de carátulas. Los gestos cancelados y las vistas retiradas
  restablecen la animación; se respetan el modo ligero y los ajustes del sistema.
- Los datos de calidad se muestran solo cuando existen en el catálogo.

Validación: compilación Kotlin, 7 pruebas del catálogo y APK release ARM64
correctos. La revisión visual y de gestos en dispositivo queda pendiente: el
acceso a dispositivos del entorno estaba desactivado durante esta revisión.
