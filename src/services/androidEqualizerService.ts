import { NativeModules, Platform } from 'react-native';
import { useSettingsStore } from '../stores';
import type {
    EqualizerBand,
    EqualizerBandLevels,
    EqualizerCapabilities,
    EqualizerMode,
    EqualizerNativePreset,
} from '../types';
import {
    createBandLevelsForPreset,
    createFlatBandLevels,
    getBandLevelsFromBands,
    getEqualizerBandKey,
    mergeStoredBandLevels,
} from './equalizerPresets';

type NativeEqualizerModule = {
    getCapabilities: () => Promise<NativeEqualizerCapabilities>;
    getAudioSessionId: () => Promise<number>;
    attachToCurrentSession: () => Promise<NativeEqualizerCapabilities>;
    setEnabled: (enabled: boolean) => Promise<void>;
    setBandLevel: (bandIndex: number, level: number) => Promise<void>;
    usePreset: (presetRef: string) => Promise<void>;
    resetToFlat: () => Promise<void>;
    openSystemEqualizerPanel: () => Promise<boolean>;
    release: () => Promise<void>;
};

type NativeEqualizerCapabilities = {
    available?: boolean;
    attached?: boolean;
    audioSessionId?: number;
    minLevel?: number;
    maxLevel?: number;
    bands?: Array<{
        index?: number;
        centerHz?: number;
        lowerHz?: number;
        upperHz?: number;
        level?: number;
        minLevel?: number;
        maxLevel?: number;
    }>;
    nativePresets?: Array<{
        index?: number;
        name?: string;
    }>;
    canOpenSystemPanel?: boolean;
    reason?: string | null;
};

type RawNativeBand = NonNullable<NativeEqualizerCapabilities['bands']>[number];

const nativeEqualizerModule: NativeEqualizerModule | null =
    Platform.OS === 'android' ? NativeModules.StaySoundEqualizer ?? null : null;

let syncInFlightPromise: Promise<EqualizerCapabilities | null> | null = null;
let lastSyncedAudioSessionId: number | null = null;
let lastAppliedBandsSignature = '';

export function isAndroidEqualizerAvailable(): boolean {
    return Platform.OS === 'android' && nativeEqualizerModule != null;
}

export async function getAndroidEqualizerAudioSessionId(): Promise<number> {
    if (!nativeEqualizerModule) return 0;
    return nativeEqualizerModule.getAudioSessionId();
}

export async function refreshAndroidEqualizerCapabilities(forceAttach = false): Promise<EqualizerCapabilities | null> {
    if (!nativeEqualizerModule) {
        useSettingsStore.getState().setEqualizerCapabilities(null);
        return null;
    }

    const raw = forceAttach
        ? await nativeEqualizerModule.attachToCurrentSession()
        : await nativeEqualizerModule.getCapabilities();
    const capabilities = normalizeCapabilities(raw);
    useSettingsStore.getState().setEqualizerCapabilities(capabilities);
    return capabilities;
}

export async function syncAndroidEqualizerFromSettings(): Promise<EqualizerCapabilities | null> {
    if (!nativeEqualizerModule) return null;
    if (syncInFlightPromise) return syncInFlightPromise;

    syncInFlightPromise = (async () => {
        const store = useSettingsStore.getState();
        const { equalizer } = store;

        if (!equalizer.enabled || equalizer.mode === 'off') {
            await nativeEqualizerModule.release();
            lastSyncedAudioSessionId = null;
            lastAppliedBandsSignature = '';
            return refreshAndroidEqualizerCapabilities(false);
        }

        if (equalizer.mode === 'system') {
            await nativeEqualizerModule.release();
            lastSyncedAudioSessionId = null;
            lastAppliedBandsSignature = '';
            return refreshAndroidEqualizerCapabilities(false);
        }

        const attached = normalizeCapabilities(await nativeEqualizerModule.attachToCurrentSession());
        store.setEqualizerCapabilities(attached);

        if (!attached.attached || attached.audioSessionId == null || attached.bands.length === 0) {
            return attached;
        }

        const mergedBandLevels = mergeStoredBandLevels(attached.bands, equalizer.bandLevels);
        store.setEqualizerBandLevels(mergedBandLevels);

        const nextBandsSignature = JSON.stringify(mergedBandLevels);
        const shouldReapplyBands =
            attached.audioSessionId !== lastSyncedAudioSessionId
            || nextBandsSignature !== lastAppliedBandsSignature;

        if (!shouldReapplyBands) {
            return attached;
        }

        await nativeEqualizerModule.setEnabled(true);
        await applyBandLevelsToNative(attached.bands, mergedBandLevels);
        lastSyncedAudioSessionId = attached.audioSessionId;
        lastAppliedBandsSignature = nextBandsSignature;

        return refreshAndroidEqualizerCapabilities(false);
    })()
        .finally(() => {
            syncInFlightPromise = null;
        });

    return syncInFlightPromise;
}

export async function setAndroidEqualizerMode(mode: EqualizerMode): Promise<EqualizerCapabilities | null> {
    const store = useSettingsStore.getState();

    if (mode === 'system') {
        const capabilities = await refreshAndroidEqualizerCapabilities(false);
        if (!capabilities?.canOpenSystemPanel) {
            return capabilities;
        }
    }

    store.setEqualizerMode(mode);

    if (mode === 'system' && nativeEqualizerModule) {
        await nativeEqualizerModule.release();
        await refreshAndroidEqualizerCapabilities(false);
        return openAndroidSystemEqualizerPanel();
    }

    return syncAndroidEqualizerFromSettings();
}

export async function setAndroidEqualizerBandLevel(band: EqualizerBand, level: number): Promise<EqualizerCapabilities | null> {
    if (!nativeEqualizerModule) return null;

    const safeLevel = clamp(level, band.minLevel, band.maxLevel);
    const bandKey = getEqualizerBandKey(band.centerHz);
    const store = useSettingsStore.getState();
    store.setEqualizerMode('app');
    store.setEqualizerBandLevel(bandKey, safeLevel);
    store.setEqualizerPresetId('custom');

    let capabilities = store.equalizerCapabilities;
    if (!capabilities?.attached) {
        capabilities = await syncAndroidEqualizerFromSettings();
    }
    if (!capabilities?.attached) return capabilities;

    await nativeEqualizerModule.setBandLevel(band.index, safeLevel);

    const nextCapabilities: EqualizerCapabilities = {
        ...capabilities,
        bands: capabilities.bands.map((item) =>
            item.index === band.index
                ? { ...item, level: safeLevel }
                : item
        ),
    };
    store.setEqualizerCapabilities(nextCapabilities);
    return nextCapabilities;
}

export async function applyAndroidEqualizerPreset(presetId: string, nativePresetIndex?: number): Promise<EqualizerCapabilities | null> {
    if (!nativeEqualizerModule) return null;

    const store = useSettingsStore.getState();
    store.setEqualizerMode('app');

    const attached = await syncAndroidEqualizerFromSettings();
    if (!attached?.attached || attached.bands.length === 0) return attached;

    if (typeof nativePresetIndex === 'number') {
        await nativeEqualizerModule.usePreset(String(nativePresetIndex));
        const refreshed = await refreshAndroidEqualizerCapabilities(false);
        if (refreshed?.bands.length) {
            store.setEqualizerPresetId(`native:${nativePresetIndex}`);
            store.setEqualizerBandLevels(getBandLevelsFromBands(refreshed.bands));
        }
        return refreshed;
    }

    const bandLevels = createBandLevelsForPreset(presetId, attached.bands);
    store.setEqualizerPresetId(presetId);
    store.setEqualizerBandLevels(bandLevels);

    if (presetId === 'flat') {
        await nativeEqualizerModule.resetToFlat();
    } else {
        await applyBandLevelsToNative(attached.bands, bandLevels);
    }

    return refreshAndroidEqualizerCapabilities(false);
}

export async function openAndroidSystemEqualizerPanel(): Promise<EqualizerCapabilities | null> {
    if (!nativeEqualizerModule) return null;

    const didOpen = await nativeEqualizerModule.openSystemEqualizerPanel();
    if (!didOpen) {
        return refreshAndroidEqualizerCapabilities(false);
    }

    return refreshAndroidEqualizerCapabilities(false);
}

export async function resetAndroidEqualizerToFlat(): Promise<EqualizerCapabilities | null> {
    if (!nativeEqualizerModule) return null;

    const attached = await syncAndroidEqualizerFromSettings();
    if (!attached?.attached) return attached;

    useSettingsStore.getState().setEqualizerPresetId('flat');
    useSettingsStore.getState().setEqualizerBandLevels(createFlatBandLevels(attached.bands));
    await nativeEqualizerModule.resetToFlat();
    return refreshAndroidEqualizerCapabilities(false);
}

export async function releaseAndroidEqualizer(): Promise<void> {
    if (!nativeEqualizerModule) return;
    await nativeEqualizerModule.release();
}

export function getDisplayBandLabel(centerHz: number): string {
    if (centerHz >= 1000) {
        const rounded = Math.round((centerHz / 1000) * 10) / 10;
        return `${stripTrailingZero(rounded)} kHz`;
    }

    return `${Math.round(centerHz)} Hz`;
}

export function getDisplayGainLabel(level: number): string {
    const value = Math.round((level / 100) * 10) / 10;
    const sign = value > 0 ? '+' : '';
    return `${sign}${stripTrailingZero(value)} dB`;
}

export function getRangeLabel(index: number, total: number): string {
    const chunk = total / 3;
    if (index < chunk) return 'equalizer.range.low';
    if (index >= chunk * 2) return 'equalizer.range.high';
    return 'equalizer.range.mid';
}

export function getNativePresetId(preset: EqualizerNativePreset): string {
    return `native:${preset.index}`;
}

async function applyBandLevelsToNative(bands: EqualizerBand[], levels: EqualizerBandLevels): Promise<void> {
    if (!nativeEqualizerModule) return;

    for (const band of bands) {
        const bandKey = getEqualizerBandKey(band.centerHz);
        const level = levels[bandKey] ?? band.level;
        await nativeEqualizerModule.setBandLevel(band.index, level);
    }
}

function normalizeCapabilities(raw: NativeEqualizerCapabilities | null | undefined): EqualizerCapabilities {
    const bands = (raw?.bands ?? [])
        .map(normalizeBand)
        .filter((band): band is EqualizerBand => band != null)
        .sort((a, b) => a.centerHz - b.centerHz);

    const nativePresets = (raw?.nativePresets ?? [])
        .map((preset) => {
            if (typeof preset?.index !== 'number' || !preset?.name) return null;
            return {
                index: preset.index,
                name: preset.name,
            } satisfies EqualizerNativePreset;
        })
        .filter((preset): preset is EqualizerNativePreset => preset != null);

    const audioSessionId = typeof raw?.audioSessionId === 'number' && raw.audioSessionId > 0
        ? raw.audioSessionId
        : null;

    return {
        available: raw?.available ?? false,
        attached: raw?.attached ?? false,
        audioSessionId,
        minLevel: typeof raw?.minLevel === 'number' ? raw.minLevel : 0,
        maxLevel: typeof raw?.maxLevel === 'number' ? raw.maxLevel : 0,
        bands,
        nativePresets,
        canOpenSystemPanel: raw?.canOpenSystemPanel ?? false,
        reason: raw?.reason ?? null,
    };
}

function normalizeBand(rawBand: RawNativeBand): EqualizerBand | null {
    if (
        typeof rawBand?.index !== 'number'
        || typeof rawBand.centerHz !== 'number'
        || typeof rawBand.lowerHz !== 'number'
        || typeof rawBand.upperHz !== 'number'
    ) {
        return null;
    }

    return {
        index: rawBand.index,
        centerHz: rawBand.centerHz,
        lowerHz: rawBand.lowerHz,
        upperHz: rawBand.upperHz,
        level: typeof rawBand.level === 'number' ? rawBand.level : 0,
        minLevel: typeof rawBand.minLevel === 'number' ? rawBand.minLevel : -1500,
        maxLevel: typeof rawBand.maxLevel === 'number' ? rawBand.maxLevel : 1500,
    };
}

function stripTrailingZero(value: number): string {
    return Number.isInteger(value) ? String(value) : String(value);
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
