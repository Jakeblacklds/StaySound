
export function getHexLuminance(hexColor: string): number {
    const normalized = hexColor.trim();
    const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized;

    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return 0;

    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;

    const toLinear = (channel: number) => (
        channel <= 0.03928
            ? channel / 12.92
            : Math.pow((channel + 0.055) / 1.055, 2.4)
    );

    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function getContrastingInk(bgColor: string, darkInk = '#111111', lightInk = '#F5EFE2') {
    return getHexLuminance(bgColor) > 0.42 ? darkInk : lightInk;
}

export function formatKHz(sampleRate?: number): string | null {
    if (!sampleRate || sampleRate <= 0) return null;
    const khz = sampleRate / 1000;
    return Number.isInteger(khz) ? `${khz} kHz` : `${khz.toFixed(1)} kHz`;
}

export function inferFormatFromUri(uri?: string): string | null {
    if (!uri) return null;
    const match = uri.toLowerCase().match(/\.([a-z0-9]+)(\?|$)/);
    if (!match) return null;
    return match[1].toUpperCase();
}

export function getTrackTechLabel(track?: { quality?: string; format?: string; sampleRate?: number; bitDepth?: number; uri?: string } | null): string {
    if (!track) return 'UNKNOWN';
    const formatLabel = (track.format ?? inferFormatFromUri(track.uri) ?? 'UNKNOWN').toUpperCase();
    const sampleRateLabel = formatKHz(track.sampleRate);
    const bitDepthLabel = track.bitDepth ? `${track.bitDepth}-bit` : null;

    const parts = [formatLabel, sampleRateLabel, bitDepthLabel].filter(Boolean);
    return parts.join('  •  ');
}

export function getQualityBadge(track?: { quality?: string; format?: string; uri?: string } | null) {
    if (!track) return { label: 'LOSSY', tone: '#D97706' };
    const qualityRaw = (track.quality ?? '').toUpperCase();
    const resolvedFormat = (track.format ?? inferFormatFromUri(track.uri) ?? '').toUpperCase();
    if (qualityRaw.includes('HI_RES')) return { label: 'HI-RES', tone: '#1FBF75' };
    if (qualityRaw.includes('LOSSLESS') || resolvedFormat === 'FLAC') {
        return { label: 'LOSSLESS', tone: '#3B82F6' };
    }
    return { label: 'LOSSY', tone: '#D97706' };
}
