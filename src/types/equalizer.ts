export type EqualizerMode = 'off' | 'app' | 'system';

export type EqualizerBandLevels = Record<string, number>;

export interface EqualizerBand {
    index: number;
    centerHz: number;
    lowerHz: number;
    upperHz: number;
    level: number;
    minLevel: number;
    maxLevel: number;
}

export interface EqualizerNativePreset {
    index: number;
    name: string;
}

export interface EqualizerCapabilities {
    available: boolean;
    attached: boolean;
    audioSessionId: number | null;
    minLevel: number;
    maxLevel: number;
    bands: EqualizerBand[];
    nativePresets: EqualizerNativePreset[];
    canOpenSystemPanel: boolean;
    reason?: string | null;
}

export interface EqualizerPresetDefinition {
    id: string;
    labelKey: string;
    nativePresetIndex?: number;
}

export interface EqualizerSettings {
    mode: EqualizerMode;
    enabled: boolean;
    presetId: string | null;
    bandLevels: EqualizerBandLevels;
}
