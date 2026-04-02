import { EqualizerBand, EqualizerBandLevels, EqualizerPresetDefinition } from '../types';

export const DEFAULT_EQUALIZER_PRESETS: EqualizerPresetDefinition[] = [
    { id: 'flat', labelKey: 'equalizer.presets.flat' },
    { id: 'bass-boost', labelKey: 'equalizer.presets.bassBoost' },
    { id: 'treble-boost', labelKey: 'equalizer.presets.trebleBoost' },
    { id: 'vocal', labelKey: 'equalizer.presets.vocal' },
    { id: 'electronic', labelKey: 'equalizer.presets.electronic' },
];

export function getEqualizerBandKey(centerHz: number): string {
    return String(Math.round(centerHz));
}

export function getBandLevelsFromBands(bands: EqualizerBand[]): EqualizerBandLevels {
    return bands.reduce<EqualizerBandLevels>((acc, band) => {
        acc[getEqualizerBandKey(band.centerHz)] = band.level;
        return acc;
    }, {});
}

export function createFlatBandLevels(bands: EqualizerBand[]): EqualizerBandLevels {
    return bands.reduce<EqualizerBandLevels>((acc, band) => {
        acc[getEqualizerBandKey(band.centerHz)] = 0;
        return acc;
    }, {});
}

export function mergeStoredBandLevels(bands: EqualizerBand[], storedLevels: EqualizerBandLevels): EqualizerBandLevels {
    return bands.reduce<EqualizerBandLevels>((acc, band) => {
        const key = getEqualizerBandKey(band.centerHz);
        acc[key] = storedLevels[key] ?? band.level;
        return acc;
    }, {});
}

export function createBandLevelsForPreset(presetId: string, bands: EqualizerBand[]): EqualizerBandLevels {
    if (presetId === 'flat') {
        return createFlatBandLevels(bands);
    }

    const peak = bands.reduce((acc, band) => Math.min(acc, Math.abs(band.minLevel), Math.abs(band.maxLevel)), Number.POSITIVE_INFINITY);
    const maxGain = Number.isFinite(peak) ? Math.round(peak * 0.68) : 1000;

    return bands.reduce<EqualizerBandLevels>((acc, band) => {
        const key = getEqualizerBandKey(band.centerHz);
        const weight = getPresetWeight(presetId, band.centerHz);
        const nextLevel = Math.round((weight * maxGain) / 25) * 25;
        acc[key] = clamp(nextLevel, band.minLevel, band.maxLevel);
        return acc;
    }, {});
}

function getPresetWeight(presetId: string, centerHz: number): number {
    const position = getNormalizedLogPosition(centerHz);

    switch (presetId) {
        case 'bass-boost':
            return gaussian(position, 0.18, 0.18) * 1.05 - gaussian(position, 0.82, 0.24) * 0.18;
        case 'treble-boost':
            return gaussian(position, 0.82, 0.18) * 1.05 - gaussian(position, 0.18, 0.24) * 0.12;
        case 'vocal':
            return gaussian(position, 0.58, 0.16) * 0.95 - gaussian(position, 0.18, 0.18) * 0.28 - gaussian(position, 0.9, 0.16) * 0.08;
        case 'electronic':
            return gaussian(position, 0.16, 0.18) * 0.88 + gaussian(position, 0.84, 0.16) * 0.72 - gaussian(position, 0.5, 0.18) * 0.4;
        default:
            return 0;
    }
}

function getNormalizedLogPosition(centerHz: number): number {
    const minHz = 20;
    const maxHz = 20000;
    const safeHz = Math.min(maxHz, Math.max(minHz, centerHz));
    const minLog = Math.log10(minHz);
    const maxLog = Math.log10(maxHz);
    return (Math.log10(safeHz) - minLog) / (maxLog - minLog);
}

function gaussian(value: number, mean: number, width: number): number {
    const distance = (value - mean) / width;
    return Math.exp(-(distance * distance));
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
