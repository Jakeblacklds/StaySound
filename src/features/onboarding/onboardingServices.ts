import { getArtistInfo } from '@/src/services/artistApi';
import { searchTidalArtists } from '@/src/services/tidalService';
import { OnboardingTasteArtist } from '@/src/stores/onboardingStore';

const QUICK_SEEDS = ['Bad Bunny', 'Taylor Swift', 'The Weeknd', 'Drake', 'Kendrick Lamar', 'Karol G', 'Feid', 'SZA', 'Rosalia', 'Arctic Monkeys'];
const QUICK_DYNAMIC_LIMIT = 8;

export type QuickSuggestion = { id?: number; name: string; artworkUrl: string; seed: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isBlockedTidalArtworkUrl(value?: string | null): boolean {
    return typeof value === 'string' && value.includes('resources.tidal.com/images/');
}

export function buildSeedPlaceholders(selectedArtists: OnboardingTasteArtist[]): QuickSuggestion[] {
    const selectedNames = new Set(selectedArtists.map(a => sanitizeSeedName(a.name)));
    return shuffle(QUICK_SEEDS)
        .filter(seed => !selectedNames.has(sanitizeSeedName(seed)))
        .slice(0, QUICK_DYNAMIC_LIMIT)
        .map(seed => ({ name: seed, artworkUrl: '', seed }));
}

export function sanitizeSeedName(name: string): string {
    return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

export async function fetchQuickSuggestionArtwork(seed: string): Promise<string | null> {
    try {
        const info = await getArtistInfo(seed, { includeBiography: false });
        if (info?.photo_url) return info.photo_url;
    } catch { /* fallback below */ }
    try {
        const response = await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(seed)}`);
        const data = await response.json();
        const normalizedSeed = sanitizeSeedName(seed);
        const candidates = Array.isArray(data?.data) ? data.data : [];
        const exactMatch = candidates.find((c: any) => sanitizeSeedName(c?.name ?? '') === normalizedSeed);
        const best = exactMatch ?? candidates[0];
        const artworkUrl = best?.picture_big ?? best?.picture_xl ?? best?.picture_medium ?? best?.picture ?? null;
        return typeof artworkUrl === 'string' ? artworkUrl : null;
    } catch {
        return null;
    }
}

export async function buildSeedSuggestion(seed: string): Promise<QuickSuggestion | null> {
    try {
        const results = await searchTidalArtists(seed);
        const normalizedSeed = sanitizeSeedName(seed);
        const match = results.find(c => sanitizeSeedName(c.name) === normalizedSeed) ?? results[0];
        if (match) {
            const tidalArtwork = match.artworkUrl;
            const artworkUrl = isBlockedTidalArtworkUrl(tidalArtwork)
                ? await fetchQuickSuggestionArtwork(match.name)
                : (tidalArtwork || await fetchQuickSuggestionArtwork(match.name));
            return { id: match.id, name: match.name, artworkUrl: artworkUrl ?? tidalArtwork ?? '', seed };
        }
    } catch { /* fallback below */ }
    const artworkUrl = await fetchQuickSuggestionArtwork(seed);
    return artworkUrl ? { name: seed, artworkUrl, seed } : null;
}

export function shuffle<T>(list: T[]): T[] {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}


export async function quickSuggestions(artists: OnboardingTasteArtist[]) {
    const selected = new Set(artists.map(a => sanitizeSeedName(a.name)));
    const seeds = shuffle(QUICK_SEEDS).filter(s => !selected.has(sanitizeSeedName(s))).slice(0, QUICK_DYNAMIC_LIMIT);
    const results = await Promise.allSettled(seeds.map(buildSeedSuggestion));
    return results.flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : []).slice(0, QUICK_DYNAMIC_LIMIT);
}
