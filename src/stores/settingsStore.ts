import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { FileSystemStorage } from '../services/storage';
import { TidalQuality } from '../types/audio';
import { ThemeConfig, ThemeMode, ThemeStyle } from '../types/theme';

interface SettingsState extends ThemeConfig {
    tidalDownloadQuality: TidalQuality;
    tidalMirror: string; // 'auto' or a specific URL
    _hasHydrated: boolean;
}

interface SettingsActions {
    setTidalDownloadQuality: (quality: TidalQuality) => void;
    setTidalMirror: (mirror: string) => void;
    setThemeStyle: (style: ThemeStyle) => void;
    setThemeMode: (mode: ThemeMode) => void;
    setAccentColor: (color: string) => void;
    setDynamicColors: (enabled: boolean) => void;
    setSchemeVariant: (variant: string) => void;
    setHasHydrated: (hasHydrated: boolean) => void;
}

export type SettingsStore = SettingsState & SettingsActions;

const initialState: SettingsState = {
    tidalDownloadQuality: 'HI_RES_LOSSLESS',
    tidalMirror: 'auto',
    style: 'material3',
    mode: 'system',
    accentColor: '#6750A4',
    dynamicColors: true,
    schemeVariant: 'expressive',
    _hasHydrated: false,
};

export const useSettingsStore = create<SettingsStore>()(
    persist(
        (set) => ({
            ...initialState,
            setTidalDownloadQuality: (tidalDownloadQuality) => set({ tidalDownloadQuality }),
            setTidalMirror: (tidalMirror) => set({ tidalMirror }),
            setThemeStyle: (style) => set({ style }),
            setThemeMode: (mode) => set({ mode }),
            setAccentColor: (accentColor) => set({ accentColor }),
            setDynamicColors: (dynamicColors) => set({ dynamicColors }),
            setSchemeVariant: (schemeVariant) => set({ schemeVariant }),
            setHasHydrated: (hasHydrated) => set({ _hasHydrated: hasHydrated }),
        }),
        {
            name: 'staysound-settings',
            storage: createJSONStorage(() => FileSystemStorage),
            onRehydrateStorage: () => (state) => {
                state?.setHasHydrated(true);
            },
        }
    )
);
