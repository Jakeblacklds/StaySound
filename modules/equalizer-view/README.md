# Android Equalizer view

Material 3 controls for the existing Android equalizer. The view does not create or own an audio effect. `NativeEqualizerScreen.tsx` forwards mode, band, and preset actions to `androidEqualizerService.ts`, which uses the existing `StaySoundEqualizer` engine and settingsStore. The React Native editor remains the fallback for iOS, web, and APKs without this module.
