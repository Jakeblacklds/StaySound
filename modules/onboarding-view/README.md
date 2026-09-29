# Onboarding Android en Kotlin

`StaySoundOnboardingView` es un módulo Expo local descubierto por autolinking.
La ruta `app/onboarding.tsx` lo activa solo en Android cuando el binario contiene
el módulo. iOS, web y APKs anteriores usan `ReactOnboardingScreen.tsx`, una copia
íntegra del onboarding anterior. No requiere cambios en Expo Router ni en los
módulos nativos existentes.

## Responsabilidades

- `OnboardingMachine.kt`: borrador, avance, validaciones, selección, búsqueda
  diferida, identificación de solicitudes y eventos de finalización.
- `OnboardingView.kt`: Android Views, controles Material, formularios, imágenes
  Glide, listas recicladas, teclado, insets y transiciones. Usa los colores y la
  fuente de StaySound y respeta modo ligero y animaciones desactivadas.
- `NativeOnboardingScreen.tsx`: adaptador de permisos, selector de avatar, escaneo,
  Tidal, generación de gustos, onboardingStore y navegación existente.
- `onboardingServices.ts`: resolución de sugerencias y fotos con los mismos seeds,
  normalización y fallbacks de la implementación anterior.

No existe UI de autenticación ni consumo de `authStore` en el onboarding actual,
las rutas o los componentes de la app. El store solo está definido y exportado.
Se conserva así: esta migración no incorpora login, OTP ni un nuevo bloqueo de
acceso. Supabase, authStore, almacenamiento y Tidal core no se modifican.

## Paridad del flujo

| Paso | Regla conservada |
| --- | --- |
| Bienvenida | Comenzar abre perfil. |
| Perfil | Continuar exige nombre con contenido; Saltar conserva el borrador. Galería y cámara mantienen opciones y permisos. |
| Artistas | Continuar requiere al menos 3; máximo 8; Saltar conserva incluso una selección parcial. |
| Búsquedas | Consulta recortada de al menos 2 caracteres, espera de 120 ms, máximo 24 resultados, errores recuperables cambiando la consulta. |
| Permisos / biblioteca | Consulta el permiso actual; al concederlo solicita escaneo. Denegar o fallar el escaneo no impide continuar. La fila de notificaciones sigue siendo informativa. |
| Listo | Guarda nombre no vacío, avatar existente, versión, artistas y limpia los IDs de gustos. |
| Generación | Con al menos 3 artistas marca pending y muestra building; aplica playlist y fecha si funciona, o failed si falla. Con menos artistas marca idle. Ambos casos completan onboarding. |

La entrada en frío sigue empezando en bienvenida y cargando solo los artistas
persistidos como selección inicial. No se añade almacenamiento de paso, nombre
provisional ni consultas. Para recrear la vista mientras la misma ruta TS sigue
montada, Kotlin emite un checkpoint opaco que el adaptador guarda en una ref.
Incluye paso, borrador, resultados, debounce pendiente e identidad de peticiones;
la nueva vista puede consumir las respuestas del trabajo todavía en curso.
No se usan bundles Android para conservar el paso después de morir el proceso.

Las respuestas tienen una secuencia y permanecen en el buzón durante la ruta,
para que un batch React no pierda respuestas concurrentes. Kotlin descarta
respuestas repetidas y búsquedas obsoletas. La finalización se emite una sola vez;
el adaptador mantiene el trabajo aceptado incluso si la ruta se desmonta antes
de recibir la confirmación nativa. Un error de generación no bloquea la entrada.

## Verificación

Desde la raíz, con JDK 17 disponible en `JAVA_HOME`:

```sh
./android/gradlew -p android :onboarding-view:testDebugUnitTest --console=plain
node --test modules/onboarding-view/tests/adapter.test.cjs
node modules/onboarding-view/typecheck.cjs
npx tsc --noEmit
```

- 22 pruebas Kotlin: avance, saltos, límites, permisos, búsquedas tardías y
  recuperación, restauración de pasos/debounce/peticiones y finalización única.
- 6 pruebas del adaptador real con servicios simulados: orden de persistencia,
  generación fallida, selección parcial, permisos/escaneo y desmontaje durante
  finalización. No ejecutan servicios de red.
- Typecheck móvil: sin errores. Usa las opciones del proyecto y excluye únicamente
  la app Vite separada de `web/`.
- Typecheck global: 125 errores existentes en `web/`. Se compararon los diagnósticos
  con el onboarding original: son idénticos. No se cambió el tsconfig global.

No se generó ningún APK ni se abrió un emulador. La comprobación visual y del
teclado en dispositivo queda pendiente; las pruebas realizadas son de compilación,
máquina de estados e integración del adaptador con servicios simulados.
