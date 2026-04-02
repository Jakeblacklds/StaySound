import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { FileSystemStorage } from '../services/storage';
import { EqualizerCapabilities, EqualizerBandLevels, EqualizerMode, EqualizerSettings, TidalQuality } from '../types';
import { ThemeConfig, ThemeMode, ThemeStyle } from '../types/theme';

export type AppLanguage = 'es' | 'en';

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
    resetEqualizer: () => void;
    setHasHydrated: (hasHydrated: boolean) => void;
}

export type SettingsStore = SettingsState & SettingsActions;

const initialState: SettingsState = {
    language: 'es',
    tidalDownloadQuality: 'HI_RES_LOSSLESS',
    tidalMirror: 'auto',
    style: 'material3',
    mode: 'system',
    accentColor: '#6750A4',
    dynamicColors: true,
    lightweightMode: false,
    schemeVariant: 'expressive',
    equalizer: initialEqualizerState,
    equalizerCapabilities: null,
    _hasHydrated: false,
};

type PersistedSettingsState = Pick<
    SettingsState,
    'language' | 'tidalDownloadQuality' | 'tidalMirror' | 'style' | 'mode' | 'accentColor' | 'dynamicColors' | 'lightweightMode' | 'schemeVariant' | 'equalizer'
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
            }),
            onRehydrateStorage: () => (state) => {
                state?.setHasHydrated(true);
            },
        }
    )
);
