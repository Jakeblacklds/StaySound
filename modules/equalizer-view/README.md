# Android Equalizer

`EqualizerEngine` owns the one `android.media.audiofx.Equalizer`, bound to the audio session the playback service publishes; `EqualizerModule` (`StaySoundEqualizer`) is its JS surface, used only by `androidEqualizerService.ts`. `EqualizerView` is the screen: it is built once and updated in place, applies a band to the engine while it is being dragged, and reports the final value to `NativeEqualizerScreen.tsx` so settingsStore persists it. The React Native editor remains the fallback for iOS, web, and APKs without this module.
