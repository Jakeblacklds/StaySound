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
