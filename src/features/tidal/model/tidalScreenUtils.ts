import type { SoulseekSearchResult } from '@/src/services/soulseekDownloadService';
import type { TidalMirrorAvailability } from '@/src/services/tidalService';
import type { TidalTrack } from '@/src/types/audio';

export function formatRecentSearchTitle(query: string): string {
    const trimmed = query.trim();
    if (!trimmed) return 'Busqueda';
    return trimmed.length > 26 ? `${trimmed.slice(0, 26).trim()}…` : trimmed;
}

export function formatSoulseekMatchLabel(match: SoulseekSearchResult['match']): string {
    const extension = (match.extension || match.format || '').toString().replace(/^\./, '').toUpperCase();
    const bitrate = typeof match.bitRate === 'number' && match.bitRate > 0
        ? `${Math.round(match.bitRate)} kbps`
        : '';
    return [extension, bitrate].filter(Boolean).join(' · ');
}

export function splitSoulseekResultPath(filename: string): string[] {
    return filename
        .replace(/\//g, '\\')
        .split('\\')
        .map(segment => segment.trim())
        .filter(Boolean);
}

export function getSoulseekLeafFilename(filename: string): string {
    const segments = splitSoulseekResultPath(filename);
    if (segments.length === 0) return filename.trim();
    return segments[segments.length - 1] || filename.trim();
}

export function stripSoulseekLeafExtension(value: string): string {
    return value.replace(/\.[a-z0-9]+$/i, '').trim();
}

export function getSoulseekFolderPath(filename: string): string {
    const segments = splitSoulseekResultPath(filename);
    if (segments.length <= 1) return 'Raiz compartida';
    return segments.slice(0, -1).join(' \\ ');
}

export function normalizeTrackText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

// Bounded edit distance between two short strings (Levenshtein).
export function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    const al = a.length;
    const bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;
    let prev = new Array<number>(bl + 1);
    let curr = new Array<number>(bl + 1);
    for (let j = 0; j <= bl; j++) prev[j] = j;
    for (let i = 1; i <= al; i++) {
        curr[0] = i;
        const ai = a.charCodeAt(i - 1);
        for (let j = 1; j <= bl; j++) {
            const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        const tmp = prev;
        prev = curr;
        curr = tmp;
    }
    return prev[bl];
}

// 0..1 score of how well `candidate` matches the typed `query`, tolerant to typos
// and word order. Used to re-rank API results so the closest match floats to the top.
export function fuzzyRelevance(query: string, candidate: string): number {
    const q = normalizeTrackText(query);
    const c = normalizeTrackText(candidate);
    if (!q || !c) return 0;
    if (c === q) return 1;
    if (c.startsWith(q)) return 0.95;
    if (c.includes(q)) return 0.85;

    const qTokens = q.split(' ').filter(Boolean);
    const cTokens = c.split(' ').filter(Boolean);
    let tokenScore = 0;
    for (const qt of qTokens) {
        let best = 0;
        for (const ct of cTokens) {
            if (ct === qt) { best = 1; break; }
            if (ct.startsWith(qt) || qt.startsWith(ct)) { best = Math.max(best, 0.8); continue; }
            const dist = levenshtein(qt, ct);
            best = Math.max(best, 1 - dist / Math.max(qt.length, ct.length));
        }
        tokenScore += best;
    }
    tokenScore = qTokens.length ? tokenScore / qTokens.length : 0;

    const whole = 1 - levenshtein(q, c) / Math.max(q.length, c.length);
    return Math.max(tokenScore, whole) * 0.8;
}

// Stable re-rank by fuzzy relevance (ties keep the original API order).
export function rankByRelevance<T>(items: T[], query: string, getText: (item: T) => string): T[] {
    const trimmed = query.trim();
    if (!trimmed || items.length < 2) return items;
    return items
        .map((item, index) => ({ item, index, score: fuzzyRelevance(trimmed, getText(item)) }))
        .sort((a, b) => (b.score - a.score) || (a.index - b.index))
        .map(entry => entry.item);
}

export function scoreDownloadCandidate(source: TidalTrack, candidate: TidalTrack): number {
    let score = 0;

    if (source.id === candidate.id) score += 100;

    const sourceTitle = normalizeTrackText(source.title);
    const sourceArtist = normalizeTrackText(source.artist);
    const sourceAlbum = normalizeTrackText(source.album);
    const candidateTitle = normalizeTrackText(candidate.title);
    const candidateArtist = normalizeTrackText(candidate.artist);
    const candidateAlbum = normalizeTrackText(candidate.album);

    if (sourceTitle === candidateTitle) score += 50;
    else if (sourceTitle && candidateTitle && (sourceTitle.includes(candidateTitle) || candidateTitle.includes(sourceTitle))) score += 20;

    if (sourceArtist === candidateArtist) score += 40;
    else if (sourceArtist && candidateArtist && (sourceArtist.includes(candidateArtist) || candidateArtist.includes(sourceArtist))) score += 15;

    if (sourceAlbum && sourceAlbum === candidateAlbum) score += 15;

    if (source.durationMs > 0 && candidate.durationMs > 0) {
        const delta = Math.abs(source.durationMs - candidate.durationMs);
        if (delta <= 1200) score += 20;
        else if (delta <= 4000) score += 10;
    }

    return score;
}

export function normalizeCardImageUri(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    return trimmed
        .replace('100x100', '500x500')
        .replace('200x200', '500x500')
        .replace('300x300', '500x500');
}

export function formatMirrorStatus(availability?: TidalMirrorAvailability): string {
    if (!availability) return 'Verificando disponibilidad...';
    if (availability.status === 'available') {
        return availability.latencyMs ? `Disponible (${availability.latencyMs} ms)` : 'Disponible';
    }
    if (availability.status === 'slow') {
        return availability.latencyMs ? `Lento (${availability.latencyMs} ms)` : 'Disponible con latencia alta';
    }
    return 'No disponible ahora';
}

export function formatMirrorCapabilities(availability?: TidalMirrorAvailability): string {
    if (!availability) return 'Búsqueda pendiente';
    return availability.supportsSearch ? 'Búsqueda disponible' : 'Búsqueda no disponible';
}

export function getPrimaryMirrorOptions(availableMirrors: string[]): string[] {
    const pinnedMirrors = [
        'https://hifi.geeked.wtf',
        'https://eu-central.monochrome.tf',
        'https://api.monochrome.tf',
    ];

    return [...pinnedMirrors, ...availableMirrors.slice(0, 3)]
        .filter((mirror, index, all) => availableMirrors.includes(mirror) && all.indexOf(mirror) === index);
}
