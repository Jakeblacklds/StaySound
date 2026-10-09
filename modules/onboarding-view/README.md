# Onboarding Android en Kotlin

`StaySoundOnboardingView` es un módulo Expo local. La ruta `app/onboarding.tsx` lo usa en Android cuando el binario lo contiene; iOS, web y APKs anteriores siguen con `ReactOnboardingScreen.tsx` (el flujo antiguo de perfil y artistas).

## Flujo

| Paso | Qué pasa | Cómo se sale |
| --- | --- | --- |
| Bienvenida | Nombre opcional y la aclaración de que las descargas vienen de Soulseek y no son infalibles. | Empezar. |
| Tu música | Pide el permiso de audio y lanza el escaneo. Explica que las descargas se guardan dentro de la app. | Continuar, con o sin permiso. |
| Cuenta de Soulseek | Usuario y contraseña; si ya hay una cuenta guardada basta con continuar. | Guardar y continuar, o «Ahora no» (salta también la prueba). |
| Prueba | Una búsqueda directa en Soulseek, hasta 6 resultados, y la descarga del que se toque con su progreso. | Continuar o «Saltar por ahora»; bloqueado solo mientras descarga. |
| Listo | Dónde está cada cosa. | Entrar a StaySound. |

## Responsabilidades

- `OnboardingMachine.kt`: pasos, borradores, validación e identidad de las peticiones. Es pura; permisos, credenciales, búsqueda y descarga son efectos. La contraseña nunca entra en el checkpoint.
- `OnboardingView.kt`: Android Views con la tipografía, los colores y los iconos de StaySound. Cada paso se construye una vez y se actualiza en el sitio, para que escribir no pierda el foco.
- `NativeOnboardingScreen.tsx`: adaptador de servicios. Responde a cada efecto, también cuando falla, y reenvía el progreso de `useTidalDownload` al paso de prueba.

La carpeta de descargas no se puede elegir: `soulseekDownloadService.ts` escribe en el almacenamiento privado de la app (`StaySound/Soulseek/`), que además es la carpeta que se comparte en Soulseek.

## Verificación

Desde la raíz, con JDK 17 en `JAVA_HOME`:

```sh
./android/gradlew -p android :onboarding-view:testDebugUnitTest --console=plain
node --test modules/onboarding-view/tests/adapter.test.cjs
node modules/onboarding-view/typecheck.cjs
```

No se ha probado en un dispositivo: lo verificado es compilación, máquina de estados y adaptador con servicios simulados.
