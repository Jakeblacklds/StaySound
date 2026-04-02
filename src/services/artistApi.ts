import { getDatabase } from './database';
import { getPerformanceProfile } from '../theme/performanceProfile';

const CACHE_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days

// Wikipedia API strictly requires a User-Agent header
const WIKI_HEADERS = {
    'User-Agent': 'StaySound/1.0 (contact: support@staysound.app) React-Native-Fetch',
};

export interface ArtistInfo {
    name: string;
    photo_url: string | null;
    biography?: string | null;
    deezer_id?: number;
}

interface GetArtistInfoOptions {
    includeBiography?: boolean;
}

type CachedArtistInfo = {
    photo_url: string | null;
    biography: string | null;
    deezer_id?: number;
    timestamp: number;
};

const artistInfoMemoryCache = new Map<string, CachedArtistInfo>();
const inflightArtistInfoRequests = new Map<string, Promise<ArtistInfo | null>>();

function getArtistMemoryCacheLimit(): number {
    try {
        const { useSettingsStore } = require('../stores/settingsStore');
        const settings = useSettingsStore.getState();
        return getPerformanceProfile(settings.lightweightMode, settings.dynamicColors).artistMemoryCacheLimit;
    } catch {
        return 80;
    }
}

function normalizeImageUrl(url: unknown): string | null {
    if (typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('https://')) return trimmed;
    if (trimmed.startsWith('http://')) return `https://${trimmed.slice('http://'.length)}`;
    return null;
}

function sanitizeArtistName(name: string): string {
    return name
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\[[^\]]*\]/g, ' ')
        .split(/\s[-–—]\s/)[0]
        .replace(/\b(feat|featuring|ft)\.?\b.*$/i, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function canonicalizeArtistName(name: string): string {
    return sanitizeArtistName(name)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/^the\s+/i, '')
        .replace(/[^a-z0-9]+/g, '');
}

function isConfidentArtistMatch(expectedName: string, candidateName: unknown): boolean {
    if (typeof candidateName !== 'string') return false;

    const expected = canonicalizeArtistName(expectedName);
    const candidate = canonicalizeArtistName(candidateName);

    if (!expected || !candidate) return false;
    if (expected === candidate) return true;
    if (expected.length >= 5 && (candidate.includes(expected) || expected.includes(candidate))) {
        return true;
    }

    return false;
}

function pickBestDeezerArtist(expectedName: string, candidates: unknown): any | null {
    if (!Array.isArray(candidates)) return null;
    return candidates.find(candidate => isConfidentArtistMatch(expectedName, (candidate as any)?.name)) ?? null;
}

function isCacheExpired(timestamp: number): boolean {
    return Date.now() - timestamp > CACHE_EXPIRY;
}

function getMemoryCache(cleanName: string): CachedArtistInfo | null {
    const cached = artistInfoMemoryCache.get(cleanName);
    if (!cached) return null;
    if (isCacheExpired(cached.timestamp)) {
        artistInfoMemoryCache.delete(cleanName);
        return null;
    }
    return cached;
}

function toArtistInfo(cleanName: string, cached: CachedArtistInfo): ArtistInfo {
    return {
        name: cleanName,
        photo_url: cached.photo_url,
        biography: cached.biography,
        deezer_id: cached.deezer_id,
    };
}

function setMemoryCache(cleanName: string, info: CachedArtistInfo) {
    if (artistInfoMemoryCache.has(cleanName)) {
        artistInfoMemoryCache.delete(cleanName);
    }
    artistInfoMemoryCache.set(cleanName, info);

    const limit = getArtistMemoryCacheLimit();
    while (artistInfoMemoryCache.size > limit) {
        const oldestKey = artistInfoMemoryCache.keys().next().value;
        if (!oldestKey) break;
        artistInfoMemoryCache.delete(oldestKey);
    }
}

/**
 * Fetches artist information from Deezer API with SQLite caching.
 */
export async function getArtistInfo(
    artistName: string,
    options: GetArtistInfoOptions = {},
): Promise<ArtistInfo | null> {
    if (!artistName || artistName === 'Unknown Artist') return null;

    const includeBiography = options.includeBiography ?? true;

    try {
        // Sanitize name: Trim and remove common metadata noise like (Remaster), etc.
        const cleanName = sanitizeArtistName(artistName);
        if (!cleanName || cleanName === 'Unknown Artist') return null;

        const memoryCached = getMemoryCache(cleanName);
        if (memoryCached && (!includeBiography || memoryCached.biography)) {
            console.log(`[ArtistAPI] Memory cache hit for: ${cleanName}`);
            return toArtistInfo(cleanName, memoryCached);
        }

        const inflightKey = `${cleanName}:${includeBiography ? 'full' : 'photo'}`;
        const inflight = inflightArtistInfoRequests.get(inflightKey);
        if (inflight) {
            return await inflight;
        }

        const request = (async (): Promise<ArtistInfo | null> => {
            const db = await getDatabase();

            // 1. Check SQLite cache first
            const cached = await db.getFirstAsync<{
                photo_url: string | null;
                biography: string | null;
                timestamp: number
            }>(
                'SELECT photo_url, biography, timestamp FROM artists WHERE name = ?',
                [cleanName]
            );

            const sqliteCached = cached && !isCacheExpired(cached.timestamp)
                ? {
                    photo_url: cached.photo_url,
                    biography: cached.biography,
                    deezer_id: undefined,
                    timestamp: cached.timestamp,
                }
                : null;

            if (sqliteCached) {
                setMemoryCache(cleanName, sqliteCached);
            }

            const needsBiography = includeBiography && !sqliteCached?.biography;
            const needsPhoto = !sqliteCached?.photo_url;

            if (sqliteCached && !needsBiography && !needsPhoto) {
                console.log(`[ArtistAPI] SQLite cache hit for: ${cleanName}`);
                return toArtistInfo(cleanName, sqliteCached);
            }

            // 2. Fetch from Deezer (for photo) only when we still need it
            console.log(`[ArtistAPI] Fetching photo from Deezer for: ${cleanName}`);
            let photo_url: string | null = sqliteCached?.photo_url || null;
            let deezer_id: number | undefined;

            if (needsPhoto) {
                try {
                    const deezerRes = await fetch(
                        `https://api.deezer.com/search/artist?q=${encodeURIComponent(cleanName)}`
                    );
                    const deezerData = await deezerRes.json();
                    const artist = pickBestDeezerArtist(cleanName, deezerData.data);
                    photo_url =
                        normalizeImageUrl(artist?.picture_big)
                        || normalizeImageUrl(artist?.picture_xl)
                        || normalizeImageUrl(artist?.picture_medium)
                        || normalizeImageUrl(artist?.picture)
                        || photo_url;
                    deezer_id = artist?.id;
                } catch (e) {
                    console.warn('[ArtistAPI] Deezer photo fetch failed');
                }
            }

            // 3. Fetch from Wikipedia only when the caller explicitly needs biography
            let biography: string | null = sqliteCached?.biography || null;

            async function tryWiki(lang: string, name: string) {
                try {
                    const wikiUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/\s+/g, '_'))}`;
                    console.log(`[ArtistAPI] Trying Wiki (${lang}): ${wikiUrl}`);

                    let wikiRes = await fetch(wikiUrl, { headers: WIKI_HEADERS });

                    if (!wikiRes.ok && wikiRes.status !== 404) {
                        console.warn(`[ArtistAPI] Wiki (${lang}) returned status: ${wikiRes.status}`);
                    }

                    if (wikiRes.ok) {
                        const wikiData = await wikiRes.json();
                        return wikiData.extract || null;
                    }

                    console.log(`[ArtistAPI] Direct hit failed for ${name} (${lang}), searching...`);
                    const searchRes = await fetch(
                        `https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(name)}&limit=1&format=json&origin=*`,
                        { headers: WIKI_HEADERS }
                    );

                    const searchData = await searchRes.json();
                    const matchedTitle = searchData?.[1]?.[0];

                    if (matchedTitle && isConfidentArtistMatch(name, matchedTitle)) {
                        console.log(`[ArtistAPI] Found potential match: ${matchedTitle}`);
                        const matchUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(matchedTitle.replace(/\s+/g, '_'))}`;
                        const matchRes = await fetch(matchUrl, { headers: WIKI_HEADERS });
                        if (matchRes.ok) {
                            const matchData = await matchRes.json();
                            return matchData.extract || null;
                        }
                    }
                } catch (e) {
                    console.debug(`[ArtistAPI] Wikipedia ${lang} request failed`, e);
                }
                return null;
            }

            if (includeBiography && !biography) {
                console.log(`[ArtistAPI] Fetching bio (ES) for: ${cleanName}`);
                biography = await tryWiki('es', cleanName);

                if (!biography) {
                    console.log(`[ArtistAPI] ES Bio failed, trying EN for: ${cleanName}`);
                    biography = await tryWiki('en', cleanName);
                }
            }

            const nextCacheEntry: CachedArtistInfo = {
                photo_url,
                biography,
                deezer_id: deezer_id ?? sqliteCached?.deezer_id,
                timestamp: Date.now(),
            };

            setMemoryCache(cleanName, nextCacheEntry);

            await db.runAsync(
                'INSERT OR REPLACE INTO artists (name, photo_url, biography, timestamp) VALUES (?, ?, ?, ?)',
                [cleanName, photo_url, biography, nextCacheEntry.timestamp]
            );

            return toArtistInfo(cleanName, nextCacheEntry);
        })();

        inflightArtistInfoRequests.set(inflightKey, request);

        try {
            return await request;
        } finally {
            inflightArtistInfoRequests.delete(inflightKey);
        }
    } catch (error) {
        console.error(`[ArtistAPI] Fatal catch for ${artistName}:`, error);
        return null;
    }
}
