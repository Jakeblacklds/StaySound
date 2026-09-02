import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { FileSystemStorage } from '../services/storage';
import {
    DEFAULT_LYRICS_SOURCE_IDS,
    type LyricsSourceId,
    sanitizeLyricsSourceIds,
} from '../services/lyricsSources';
import { EqualizerCapabilities, EqualizerBandLevels, EqualizerMode, EqualizerSettings, TidalQuality } from '../types';
import { ThemeConfig, ThemeMode, ThemeStyle } from '../types/theme';
import { type LyricsFontId, sanitizeLyricsFont } from '../components/player/lyricsFonts';

export type AppLanguage = 'es' | 'en';

/** Visual theme for the player's audio spectrum (medios+agudos layer). */
export type SpectrumTheme = 'columns' | 'aurora' | 'caustics' | 'waveformArc' | 'refractionVeil';

const initialEqualizerState: EqualizerSettings = {
    mode: 'off',
    enabled: false,
    presetId: 'flat',
    bandLevels: {},
};

interface SettingsState extends ThemeConfig {
    language: AppLanguage;
    tidalDownloadQuality: TidalQuality;
    tidalMirror: string;
    equalizer: EqualizerSettings;
    equalizerCapabilities: EqualizerCapabilities | null;
    /** Latency compensation (ms) applied to the karaoke audio spectrum so it lines up with the sound. */
    spectrumDelayMs: number;
    /** Visual theme for the player spectrum's medios+agudos layer. */
    spectrumTheme: SpectrumTheme;
    /** Lyrics providers to query, in preference order. Empty falls back to defaults. */
    lyricsSources: LyricsSourceId[];
    /** Typography used by the native synchronized lyrics renderer. */
    lyricsFont: LyricsFontId;
    _hasHydrated: boolean;
}

interface SettingsActions {
    setLanguage: (language: AppLanguage) => void;
    setTidalDownloadQuality: (quality: TidalQuality) => void;
    setTidalMirror: (mirror: string) => void;
    setThemeStyle: (style: ThemeStyle) => void;
    setThemeMode: (mode: ThemeMode) => void;
    setAccentColor: (color: string) => void;
    setDynamicColors: (enabled: boolean) => void;
    setLightweightMode: (enabled: boolean) => void;
    setSchemeVariant: (variant: string) => void;
    setEqualizerMode: (mode: EqualizerMode) => void;
    setEqualizerEnabled: (enabled: boolean) => void;
    setEqualizerPresetId: (presetId: string | null) => void;
    setEqualizerBandLevel: (bandKey: string, level: number) => void;
    setEqualizerBandLevels: (bandLevels: EqualizerBandLevels) => void;
    setEqualizerCapabilities: (capabilities: EqualizerCapabilities | null) => void;
    setSpectrumDelayMs: (delayMs: number) => void;
    setSpectrumTheme: (theme: SpectrumTheme) => void;
    setLyricsSourceEnabled: (sourceId: LyricsSourceId, enabled: boolean) => void;
    setLyricsFont: (font: LyricsFontId) => void;
    resetEqualizer: () => void;
    setHasHydrated: (hasHydrated: boolean) => void;
}

export type SettingsStore = SettingsState & SettingsActions;

const initialState: SettingsState = {
    language: 'es',
    tidalDownloadQuality: 'MP3',
    tidalMirror: 'auto',
    style: 'material3',
    mode: 'system',
    accentColor: '#6750A4',
    dynamicColors: true,
    lightweightMode: false,
    schemeVariant: 'expressive',
    equalizer: initialEqualizerState,
    equalizerCapabilities: null,
    spectrumDelayMs: 380,
    spectrumTheme: 'aurora',
    lyricsSources: [...DEFAULT_LYRICS_SOURCE_IDS],
    lyricsFont: 'classic',
    _hasHydrated: false,
};

export const SPECTRUM_DELAY_MIN = 0;
export const SPECTRUM_DELAY_MAX = 650;
export const SPECTRUM_DELAY_STEP = 20;

type PersistedSettingsState = Pick<
    SettingsState,
    'language' | 'tidalDownloadQuality' | 'tidalMirror' | 'style' | 'mode' | 'accentColor' | 'dynamicColors' | 'lightweightMode' | 'schemeVariant' | 'equalizer' | 'spectrumDelayMs' | 'spectrumTheme' | 'lyricsSources' | 'lyricsFont'
>;

export const useSettingsStore = create<SettingsStore>()(
    persist(
        (set) => ({
            ...initialState,
            setLanguage: (language) => set({ language }),
            setTidalDownloadQuality: (tidalDownloadQuality) => set({ tidalDownloadQuality }),
            setTidalMirror: (tidalMirror) => set({ tidalMirror }),
            setThemeStyle: (style) => set({ style }),
            setThemeMode: (mode) => set({ mode }),
            setAccentColor: (accentColor) => set({ accentColor }),
            setDynamicColors: (dynamicColors) => set({ dynamicColors }),
            setLightweightMode: (lightweightMode) => set({ lightweightMode }),
            setSchemeVariant: (schemeVariant) => set({ schemeVariant }),
            setEqualizerMode: (mode) => set(state => ({
                equalizer: {
                    ...state.equalizer,
                    mode,
                    enabled: mode !== 'off',
                    presetId: mode === 'off' ? 'flat' : state.equalizer.presetId,
                },
            })),
            setEqualizerEnabled: (enabled) => set(state => ({
                equalizer: {
                    ...state.equalizer,
                    enabled,
                    mode: enabled ? (state.equalizer.mode === 'off' ? 'app' : state.equalizer.mode) : 'off',
                },
            })),
            setEqualizerPresetId: (presetId) => set(state => ({
                equalizer: {
                    ...state.equalizer,
                    presetId,
                },
            })),
            setEqualizerBandLevel: (bandKey, level) => set(state => ({
                equalizer: {
                    ...state.equalizer,
                    bandLevels: {
                        ...state.equalizer.bandLevels,
                        [bandKey]: level,
                    },
                },
            })),
            setEqualizerBandLevels: (bandLevels) => set(state => ({
                equalizer: {
                    ...state.equalizer,
                    bandLevels,
                },
            })),
            setEqualizerCapabilities: (equalizerCapabilities) => set({ equalizerCapabilities }),
            setSpectrumDelayMs: (delayMs) => set({
                spectrumDelayMs: Math.round(
                    Math.min(SPECTRUM_DELAY_MAX, Math.max(SPECTRUM_DELAY_MIN, delayMs)),
                ),
            }),
            setSpectrumTheme: (spectrumTheme) => set({ spectrumTheme }),
            setLyricsFont: (lyricsFont) => set({ lyricsFont: sanitizeLyricsFont(lyricsFont) }),
            setLyricsSourceEnabled: (sourceId, enabled) => set(state => {
                const current = new Set(state.lyricsSources);
                if (enabled) {
                    current.add(sourceId);
                } else {
                    // Keep at least one source enabled — ignore turning off the last one.
                    if (current.size <= 1) return {};
                    current.delete(sourceId);
                }
                return { lyricsSources: sanitizeLyricsSourceIds([...current]) };
            }),
            resetEqualizer: () => set({ equalizer: initialEqualizerState }),
            setHasHydrated: (hasHydrated) => set({ _hasHydrated: hasHydrated }),
        }),
        {
            name: 'staysound-settings',
            storage: createJSONStorage(() => FileSystemStorage),
            partialize: (state): PersistedSettingsState => ({
                language: state.language,
                tidalDownloadQuality: state.tidalDownloadQuality,
                tidalMirror: state.tidalMirror,
                style: state.style,
                mode: state.mode,
                accentColor: state.accentColor,
                dynamicColors: state.dynamicColors,
                lightweightMode: state.lightweightMode,
                schemeVariant: state.schemeVariant,
                equalizer: state.equalizer,
                spectrumDelayMs: state.spectrumDelayMs,
                spectrumTheme: state.spectrumTheme,
                lyricsSources: state.lyricsSources,
                lyricsFont: state.lyricsFont,
            }),
            onRehydrateStorage: () => (state) => {
                if (state) {
                    // Drop unknown ids / restore defaults if persisted empty.
                    state.lyricsSources = sanitizeLyricsSourceIds(state.lyricsSources);
                    state.lyricsFont = sanitizeLyricsFont(state.lyricsFont);
                }
                state?.setHasHydrated(true);
            },
        }
    )
);
