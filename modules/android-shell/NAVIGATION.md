# Navegación Android

Android entra por `src/AppRoot.android.tsx`. No monta `ExpoRoot`, `Stack`, `Tabs`
ni un `NavigationContainer` JavaScript. iOS y web entran por `src/AppRoot.tsx`
y conservan Expo Router y las rutas `app/`.

`NavigationState` (Kotlin) posee las entradas con claves estables, argumentos,
pestaña activa, historial de pestañas y pila de detalles/modales. Las pestañas
visitadas permanecen montadas; seleccionar una pestaña cierra sus detalles y
Back recorre las pestañas en orden de uso sin duplicados. `navigate` vuelve a
una entrada equivalente; `replace` sustituye el detalle superior. Los argumentos
forman parte de la identidad, incluido `source` en detalles Tidal.

`NavigationHostView` hospeda las vistas migradas mediante slots nativos. Solo
Kotlin decide qué slot se muestra, recibe interacción y queda accesible.
TypeScript recibe una proyección del estado para montar los adaptadores de
servicios y comunicar foco/argumentos. No mantiene una segunda pila. Los
adaptadores de Tidal siguen ejecutando los servicios existentes. No se migra
catálogo, descargas, audio, stores ni persistencia de datos de usuario.

La barra es la misma `NavigationBarView` de `player-chrome`, con selección y
acciones conectadas directamente al contenedor. Un acceso nativo a Ajustes en
Inicio permite llegar a la pestaña oculta sin añadir un quinto ítem a la barra. El player Kotlin existente sigue
hospedado sobre el contenido y `/player` es una entrada real de navegación.
`playerVisible` es una proyección de compatibilidad; las peticiones del store
se envían a Kotlin y las actualizaciones nativas no vuelven a enviarse al store
como órdenes nuevas. Letras, modal y onboarding ocultan el player global.

## Enlaces y restauración

Se aceptan las rutas actuales, grupos `(tabs)`, esquemas `staysound://`,
`exp+staysound://` y rutas de desarrollo `exp://…/--/…`. `/notification.click`
abre `/player`; `/search` es un alias de `/tidal`. Se decodifican una sola vez
los IDs y parámetros. Un parámetro `id` en la query no sustituye el ID del path.
Se ignoran rutas desconocidas y esquemas ajenos al manifiesto.

Los enlaces de arranque llegan desde el Intent de la Activity; los posteriores
usan `OnNewIntent`. Onboarding actúa como una puerta sobre el destino solicitado:
completar el store reanuda ese destino, sin un redirect a Inicio que lo borre.

`NavigationSession` combina ViewModel para recreación de Activity con
SavedStateRegistry para reconstrucción en un proceso nuevo. Guarda únicamente
estado de navegación serializable, con versión; datos corruptos vuelven a Inicio.
No reproduce el Intent antiguo sobre una pila restaurada. Un Intent nuevo
recibido al recrear el proceso se aplica encima de la pila recuperada.

`withAndroidNavigation` conserva `savedInstanceState` en `MainActivity`, activa
predictive Back en el manifiesto y envía Back antiguo al dispatcher AndroidX
sin pasar por `BackHandler` de JavaScript. El plugin es necesario porque
`android/` es generado e ignorado por Git.

## Back

Los diálogos Material existentes reciben Back en su propia ventana. En el player,
opciones, letras internas y cola consumen Back antes de cerrar `/player`.
La navegación usa `OnBackPressedCallback`: durante predictive Back muestra la
entrada anterior sin modificar la pila; cancelar restaura las transformaciones;
confirmar realiza el pop. Un enlace recibido durante el gesto invalida su pop
para que no cierre accidentalmente el nuevo destino. En Inicio el contenedor
no consume Back; la Activity conserva la salida del sistema.

## Validación

- Pruebas JVM de rutas, argumentos, aliases, pestañas, replace/navigate, Back,
  player, onboarding y serialización.
- Pruebas del callback AndroidX: progreso, cancelación, confirmación, prioridad
  de paneles y enlaces durante el gesto.
- Robolectric: SavedStateRegistry real, recreación de Activity, ViewModel nuevo,
  reanexado del contenedor y nuevo enlace durante restauración del proceso.

```sh
npx tsc --noEmit -p tsconfig.android.json
npx tsc --noEmit -p tsconfig.android.json --moduleSuffixes .android,
node scripts/build-android.mjs --variant development --task :android-shell:testDebugUnitTest
node scripts/build-android.mjs --variant development --task :player-chrome:testDebugUnitTest
node scripts/build-android.mjs --variant development --task :app:assembleDevDebug
node scripts/check-android-navigation-bundle.mjs
node --test scripts/tests/android-navigation-plugin.test.cjs
```

El build debug valida integración y bundle Android. Las pruebas locales no
sustituyen una revisión visual de los gestos en un dispositivo. No se abre
emulador ni se construye release como parte de esta fase.

Resultado de esta fase: 32 pruebas nuevas de navegación (22 rutas/estado, 6 Back,
4 Activity/restauración), más 13 del shell y 6 de player-chrome. También pasan
los 3 tests del plugin, los 6 tests TS del shell, TypeScript, bundle iOS y build web.
El grafo final del bundle Android contiene el entry y adaptador `.android` y
ningún módulo de Expo Router. APK debug: `android/app/build/outputs/apk/dev/debug/app-dev-debug.apk`.
