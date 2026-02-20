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
