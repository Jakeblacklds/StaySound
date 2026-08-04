# StaySound lyrics cache + Supabase

Integracion implementada para lyrics con estrategia `local-first` en Android (React Native + modulo Kotlin `karaoke-view`).

## Variables requeridas

```bash
SUPABASE_URL=https://ucrtwqwaaadgjoerhgwg.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

## Configuracion segura (sin hardcodear keys)

Opciones soportadas por el modulo Kotlin (prioridad):

1. Propiedades de Gradle (`-PSUPABASE_SECRET_KEY=...`)
2. `android/local.properties` (no versionar):

```properties
SUPABASE_URL=https://ucrtwqwaaadgjoerhgwg.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

3. Variables de entorno del sistema (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`)

El modulo agrega headers en cada request:

- `apikey: <SUPABASE_SECRET_KEY>`
- `Authorization: Bearer <SUPABASE_SECRET_KEY>`

## Flujo

- Clave canonica local: `normalizedArtist + "::" + normalizedSong`
- Normalizacion: lowercase, trim, sin acentos, sin puntuacion, espacios colapsados
- `getLyrics(song, artist)`:
  - cache local primero
  - si falta, consulta Supabase y guarda local
- `forceRefreshLyrics(song, artist)`:
  - fuerza red y actualiza cache

Consulta exacta:

`GET /rest/v1/song_alignments?select=payload,updated_at,song,artist&song=eq.<song>&artist=eq.<artist>&limit=1`

Fallback si no hay match exacto: busqueda amplia + comparacion canonica normalizada en cliente.

## App de escritorio

StaySound Desktop reutiliza la interfaz de `web/` dentro de Tauri. Soulseek se
empaqueta como un sidecar autocontenido y se inicia/cierra junto con la app; el
usuario final no necesita instalar Node ni configurar `localhost`.

La importación de música usa el selector nativo de carpetas en escritorio. La
ruta autorizada se recuerda entre sesiones y los tracks se reproducen desde
disco mediante el asset protocol de Tauri, sin cargar la biblioteca completa en
memoria.

Requisitos para compilar:

- Node.js 22 o posterior.
- Rust estable.
- Las dependencias de sistema de Tauri para macOS, Windows o Linux.

Comandos:

```bash
# Desarrollo con recarga en caliente
npm run desktop:dev

# Instalador/app para el sistema operativo actual
npm run desktop:build
```

`desktop:sidecar` genera el companion de Soulseek para el target actual antes
de cada ejecución. Por eso las versiones de macOS, Windows y Linux deben
compilarse en sus respectivos runners o computadoras.

En macOS, un build local aparece en
`src-tauri/target/release/bundle/macos/StaySound.app`. Para distribuirlo fuera
de la máquina de desarrollo todavía se debe configurar firma y notarización.
