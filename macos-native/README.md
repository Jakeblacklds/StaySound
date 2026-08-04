# StaySound Native

Aplicación macOS nativa construida con SwiftUI, AppKit y AVFoundation. No usa
Tauri ni WKWebView para la interfaz.

## Compilar

```sh
./macos-native/build-app.sh
```

El bundle firmado localmente queda en `out/StaySound Native.app`.

La app reutiliza el sidecar de Soulseek existente y guarda su catálogo local en
`~/Library/Application Support/StaySoundNative/library.json`.

## Funciones nativas

- Escaneo recursivo de carpetas y catálogo persistente.
- Reproducción con cola, shuffle, repeat y control de volumen.
- Playlists locales persistentes.
- Karaoke palabra por palabra desde LyricsPlus/KPoe (QQ, Musixmatch y otros),
  con `.lrc` y LRCLIB como fallback por línea y caché local.
- Búsqueda y descarga por Soulseek; las descargas se agregan al catálogo.
- Carátulas embebidas, imágenes de carpeta, sidecars y colores dinámicos.
