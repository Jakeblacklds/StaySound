# StaySound - Local Music Player App

A premium React Native Expo music player for local files with Apple Music-style animated lyrics, artist information integration, **Android Auto support**, and extensive **UI customization** including Material 3 Expressive.

---

## User Review Required

> [!IMPORTANT]
> **Expo SDK 54**: Using latest SDK with `expo-audio` (replacing deprecated expo-av) and development builds for Android Auto.

> [!WARNING]
> **Android Auto requires Development Build**: We'll need `npx expo prebuild` to configure native modules. Expo Go won't work for Android Auto testing.

> [!CAUTION]
> **Dual Audio Approach**: We'll use `expo-audio` as primary (cleaner API) + `react-native-track-player` for Android Auto media session. This is the recommended pattern for car integration.

---

## Technology Stack

| Category | Technology | Purpose |
|----------|-----------|---------|
| Framework | Expo SDK 54 | Latest with new architecture |
| Audio | `expo-audio` | Primary playback (modern API) |
| Android Auto | `react-native-track-player` | Media session for car systems |
| Animations | `react-native-reanimated` 3.x | UI animations & scroll |
| Graphics | `@shopify/react-native-skia` | Lyrics text effects (GPU) |
| State | `zustand` | Global state management |
| Database | `expo-sqlite` | Music library + localStorage |
| UI | `react-native-paper` 5.x | Material 3 Expressive components |
| Metadata | `react-native-music-metadata` | ID3 tag parsing |

---

## Project Architecture

```
StaySound/
├── src/
│   ├── app/                    # Expo Router screens
│   │   ├── (tabs)/
│   │   ├── player.tsx
│   │   ├── lyrics.tsx
│   │   └── ...
│   ├── components/
│   │   ├── ui/                 # Core UI primitives
│   │   └── player/
│   ├── services/
│   │   ├── audioEngine.ts      # Unified audio controller
│   │   ├── trackPlayer.ts      # Android Auto bridge
│   │   └── ...
│   ├── stores/
│   ├── theme/
│   │   ├── ThemeProvider.tsx   # Context & switching
│   │   ├── styles/
│   │   │   ├── minimal.ts      # Clean, Apple-like
│   │   │   ├── material3.ts    # Material 3 Expressive
│   │   │   ├── spotify.ts      # Dark, card-based
│   │   │   └── custom.ts       # User-created themes
│   │   └── tokens.ts           # Shared design tokens
│   └── types/
└── app.json
```

---

## Proposed Changes

### Phase 1: Project Setup (Expo SDK 54)

#### [NEW] [package.json](file:///c:/Users/final/OneDrive/Escritorio/StaySound/package.json)
```json
{
  "dependencies": {
    "expo": "~54.0.0",
    "expo-router": "~4.0.0",
    "expo-audio": "~0.3.0",
    "expo-file-system": "~18.0.0",
    "expo-media-library": "~17.0.0",
    "react-native-track-player": "^4.1.0",
    "react-native-reanimated": "~3.16.0",
    "@shopify/react-native-skia": "^1.6.0",
    "zustand": "^5.0.0",
    "expo-sqlite": "~15.0.0",
    "react-native-paper": "^5.12.5",
    "react-native-music-metadata": "^1.4.0"
  }
}
```

> [!NOTE]
> **No AsyncStorage**: Using `expo-sqlite` with integrated localStorage (SDK 54 feature).

#### [NEW] [app.json](file:///c:/Users/final/OneDrive/Escritorio/StaySound/app.json)
- Android Auto manifest configuration
- Background audio modes
- Media library permissions

---

### Phase 2: Dual Audio Architecture

#### [NEW] [src/services/audioEngine.ts](file:///c:/Users/final/OneDrive/Escritorio/StaySound/src/services/audioEngine.ts)
Unified controller managing both audio libraries:

```typescript
class AudioEngine {
  // Uses expo-audio for actual playback
  private player: Audio.Player;
  
  // Syncs state to react-native-track-player for Android Auto
  private syncToTrackPlayer() {
    TrackPlayer.updateNowPlayingMetadata({...});
  }
  
  async play(track: Track) {
    await this.player.play(track.uri);
    await this.syncToTrackPlayer();
  }
}
```

#### [NEW] [src/services/trackPlayerService.ts](file:///c:/Users/final/OneDrive/Escritorio/StaySound/src/services/trackPlayerService.ts)
Android Auto media session handler:
- Remote control events (from car head unit)
- Media notifications
- Bluetooth metadata

---

### Phase 3: Multi-Style Theme System

#### Theme Architecture
```
┌─────────────────────────────────────────┐
│           ThemeProvider                 │
│  ┌─────────────────────────────────┐   │
│  │   Active Theme (e.g. Material3)  │   │
│  │  ┌─────────┐  ┌─────────┐       │   │
│  │  │ colors  │  │ spacing │       │   │
│  │  │ shapes  │  │ motion  │       │   │
│  │  └─────────┘  └─────────┘       │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

#### [NEW] [src/theme/styles/minimal.ts](file:///c:/Users/final/OneDrive/Escritorio/StaySound/src/theme/styles/minimal.ts)
Apple Music-inspired:
- Pure whites/blacks
- Subtle shadows
- San Francisco-like typography
- Minimal borders, spacious layout

#### [NEW] [src/theme/styles/material3.ts](file:///c:/Users/final/OneDrive/Escritorio/StaySound/src/theme/styles/material3.ts)
Material 3 Expressive:
- Dynamic color from album art
- Expressive shapes (squircles, blobs)
- Tonal surfaces
- Bold typography
- Emphasis on motion and state layers

#### [NEW] [src/theme/styles/spotify.ts](file:///c:/Users/final/OneDrive/Escritorio/StaySound/src/theme/styles/spotify.ts)
Dark card-based:
- Rich blacks with vibrant greens
- Card-heavy layout
- Circular artist images
- Compact information density

#### [NEW] [src/theme/ThemeProvider.tsx](file:///c:/Users/final/OneDrive/Escritorio/StaySound/src/theme/ThemeProvider.tsx)
```typescript
interface ThemeConfig {
  style: 'minimal' | 'material3' | 'spotify' | 'custom';
  mode: 'light' | 'dark' | 'system';
  accentColor: string;
  dynamicColors: boolean; // Extract from album art
}
```

---

### Phase 4: UI Components (Style-Aware)

All components consume theme via hooks:

```typescript
// Example: Button adapts to active theme
function PlayButton() {
  const { theme, style } = useTheme();
  
  // Material 3: Filled tonal with state layer
  // Minimal: SF Symbol with subtle highlight
  // Spotify: Green filled rounded
  
  return <Pressable style={theme.button.primary}>...</Pressable>;
}
```

---

### Phase 5: Animated Lyrics with Skia ⭐

Using **@shopify/react-native-skia** combined with Reanimated for pixel-perfect text animations without re-renders.

#### Why Skia over Reanimated-only?
- **GPU-accelerated gradients**: Linear gradients animate at 60fps without JS bridge
- **Shader-based fill**: Smooth "karaoke fill" effect for held notes
- **No re-renders**: Skia draws directly to canvas, bypassing React reconciliation
- **Custom effects**: Glow, blur, shadows that animate per-word

#### [NEW] [src/components/lyrics/SkiaLyricLine.tsx](file:///c:/Users/final/OneDrive/Escritorio/StaySound/src/components/lyrics/SkiaLyricLine.tsx)

> [!TIP]
> **One Canvas per line, not per word** - Better memory usage with 10-15 words per line.

```typescript
import { Canvas, Text, LinearGradient, useFont, Group } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';

function SkiaLyricLine({ line, currentTime, offsets }) {
  const font = useFont(require('./Inter-Bold.ttf'), 32);
  
  return (
    <Canvas style={{ width: '100%', height: 48 }}>
      {line.words.map((word, i) => {
        const progress = useDerivedValue(() => 
          clamp((currentTime.value - word.start) / (word.end - word.start), 0, 1)
        );
        
        return (
          <Group key={i} transform={[{ translateX: offsets[i] }]}>
            <Text text={word.text} font={font} x={0} y={32}>
              <LinearGradient
                start={{ x: 0, y: 0 }}
                end={useDerivedValue(() => ({ x: word.width * progress.value, y: 0 }))}
                colors={['#FFFFFF', '#555555']}
              />
            </Text>
          </Group>
        );
      })}
    </Canvas>
  );
}
```

#### [NEW] [src/components/lyrics/LyricsCanvas.tsx](file:///c:/Users/final/OneDrive/Escritorio/StaySound/src/components/lyrics/LyricsCanvas.tsx)
Full screen Skia canvas for lyrics:
- Renders all visible lines in single canvas (performance)
- Animated blur background from album art
- Glow effect on active word
- Scroll position driven by Reanimated

#### Animation Effects
| Effect | Implementation |
|--------|---------------|
| Word fill | LinearGradient with animated `end` position |
| Long note hold | Slower gradient + subtle pulse scale |
| Active line glow | Blur filter with animated opacity |
| Past lines fade | Animated color to dim gray |
| Auto-scroll | Reanimated ScrollView + interpolate |

---

### Phase 6: Artist Information API

Using **Deezer API** with **SQLite caching** for offline support:

#### [NEW] [src/services/artistApi.ts](file:///c:/Users/final/OneDrive/Escritorio/StaySound/src/services/artistApi.ts)
```typescript
const CACHE_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days

async function getArtistPhoto(artistName: string): Promise<string | null> {
  // 1. Check SQLite cache first
  const cached = await db.getFirstAsync<{ photo_url: string; timestamp: number }>(
    'SELECT photo_url, timestamp FROM artists WHERE name = ?', [artistName]
  );
  
  if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY) {
    return cached.photo_url;
  }
  
  // 2. Fetch from Deezer API
  const response = await fetch(
    `https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}`
  );
  const data = await response.json();
  const photoUrl = data.data?.[0]?.picture_xl ?? null;
  
  // 3. Cache result
  if (photoUrl) {
    await db.runAsync(
      'INSERT OR REPLACE INTO artists (name, photo_url, timestamp) VALUES (?, ?, ?)',
      [artistName, photoUrl, Date.now()]
    );
  }
  
  return photoUrl;
}
```

Fallback: MusicBrainz → Wikidata → Wikimedia chain

---

### Phase 7: Android Auto Integration

#### [NEW] [android/app/src/main/AndroidManifest.xml](file:///c:/Users/final/OneDrive/Escritorio/StaySound/android/app/src/main/AndroidManifest.xml)
```xml
<meta-data
  android:name="com.google.android.gms.car.application"
  android:resource="@xml/automotive_app_desc"/>
```

#### [NEW] [android/app/src/main/res/xml/automotive_app_desc.xml](file:///c:/Users/final/OneDrive/Escritorio/StaySound/android/app/src/main/res/xml/automotive_app_desc.xml)
```xml
<automotiveApp>
  <uses name="media"/>
</automotiveApp>
```

---

### Phase 8: Settings & Personalization

#### [NEW] [src/theme/CustomThemeBuilder.tsx](file:///c:/Users/final/OneDrive/Escritorio/StaySound/src/theme/CustomThemeBuilder.tsx)
```typescript
interface CustomTheme {
  id: string;
  name: string;
  colors: {
    primary: string;
    background: string;
    surface: string;
    text: string;
  };
  shapes: {
    borderRadius: number;  // 0-32
    cardElevation: number; // 0-24
  };
  motion: {
    easing: 'linear' | 'easeOut' | 'spring';
    duration: number;  // 200-800ms
  };
  typography: {
    fontFamily: string;
    scale: number;  // 0.8-1.2
  };
}

// Persist to SQLite
await db.runAsync(
  'INSERT INTO custom_themes (id, data) VALUES (?, ?)',
  [theme.id, JSON.stringify(theme)]
);
```

**Features:**
- **Live Preview**: Real-time component samples (button, card, player) while editing
- **Theme Style Picker**: Visual preview of Minimal/Material3/Spotify
- **Accent Color**: Color wheel + preset palettes
- **Dynamic Colors Toggle**: Extract palette from album art
- **Android Auto Settings**: Simplified view options

---

## Verification Plan

### Development Build Setup
```bash
npx expo prebuild
npx expo run:android
```

### Android Auto Testing

> [!TIP]
> **Use Android Automotive OS Emulator** (more modern than deprecated DHU)

```bash
# In Android Studio → AVD Manager → Create Virtual Device
# Select "Automotive" tab → "Polestar 2" or "Generic Automotive"
```

1. Launch Automotive emulator from Android Studio
2. Build and install app: `npx expo run:android`
3. Verify media browsing and playback controls in car UI

### Theme Switching
1. Switch between Minimal → Material 3 → Spotify
2. Verify all screens adapt correctly
3. Test dynamic color extraction from colorful album art
