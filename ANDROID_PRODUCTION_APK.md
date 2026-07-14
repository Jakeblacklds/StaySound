# APK de produccion en Android Studio

## 1) Configurar firma

1. Crea tu keystore (si no la tienes) en la carpeta `android`:

```bash
keytool -genkeypair -v -storetype PKCS12 -keystore android/release-keystore.jks -alias staysound-release -keyalg RSA -keysize 2048 -validity 10000
```

2. Copia `android/key.properties.example` a `android/key.properties` y completa los valores reales.

Ejemplo:

```properties
storeFile=release-keystore.jks
storePassword=TU_PASSWORD_STORE
keyAlias=staysound-release
keyPassword=TU_PASSWORD_KEY
```

## 2) Build desde Android Studio

1. Abre la carpeta `android` en Android Studio.
2. Espera el sync de Gradle.
3. Ve a `Build > Generate Signed Bundle / APK`.
4. Selecciona `APK` y elige el módulo `app`.
5. Usa el keystore `android/release-keystore.jks`.
6. Selecciona build variant `release` y finaliza.

APK generado en:

`android/app/build/outputs/apk/release/app-release.apk`

## 3) Ajustes ya aplicados

- Firma de release via `android/key.properties` (obligatoria para `release`).
- Minify (R8) habilitado: `android.enableMinifyInReleaseBuilds=true`.
- Shrink resources habilitado: `android.enableShrinkResourcesInReleaseBuilds=true`.
- Arquitecturas de release: `armeabi-v7a,arm64-v8a`.
- `versionCode` definido en `app.json`.

## 4) Publicar una actualizacion (auto-update desde la app + web)

Cada release se publica con un solo comando:

```bash
npm run android:publish:release
```

Que hace:

1. Compila el APK de produccion (`npm run android:build:release`). Usa `-- --skip-build` para reutilizar el APK ya compilado.
2. Crea/asegura el bucket publico `staysound-releases` en Supabase Storage.
3. Sube el APK versionado y un `android/prod/manifest.json` con version, URL publica del APK y SHA-256.
4. La app instalada revisa ese manifest al arrancar (y desde Ajustes) y ofrece descargar e instalar la nueva version.
5. El boton "Descargar app" de la web lee el mismo manifest y siempre apunta al ultimo APK.

Requisitos:

- `SUPABASE_SERVICE_ROLE_KEY` en `.env` (Dashboard > Settings > API Keys > service_role).
- Subir `ANDROID_VERSION_CODE` (y `APP_VERSION` si aplica) en `app.config.js` en cada release; si no, las apps instaladas no detectan la actualizacion. El script avisa si repites el versionCode.
- Opcional: ejecutar `supabase/migrations/20260422_app_binary_releases.sql` en el SQL editor para guardar historial de releases en la tabla `app_binary_releases` (si falta, el script solo muestra un warning).

Notas:

- La primera instalacion del APK debe hacerse manualmente (la actualizacion in-app requiere que la firma coincida).
- En el primer update Android pedira el permiso "instalar apps desconocidas" para StaySound.
