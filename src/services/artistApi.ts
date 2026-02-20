import { getDatabase } from './database';

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

function normalizeImageUrl(url: unknown): string | null {
    if (typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('https://')) return trimmed;
    if (trimmed.startsWith('http://')) return `https://${trimmed.slice('http://'.length)}`;
    return null;
}

/**
 * Fetches artist information from Deezer API with SQLite caching.
 */
export async function getArtistInfo(artistName: string): Promise<ArtistInfo | null> {
    if (!artistName || artistName === 'Unknown Artist') return null;

    try {
        const db = await getDatabase();

        // Sanitize name: Trim and remove common metadata noise like (Remaster), etc.
        const cleanName = artistName.split('(')[0].split('-')[0].split('[')[0].trim();
        if (!cleanName || cleanName === 'Unknown Artist') return null;

        // 1. Check SQLite cache first
        const cached = await db.getFirstAsync<{
            photo_url: string | null;
            biography: string | null;
            timestamp: number
        }>(
            'SELECT photo_url, biography, timestamp FROM artists WHERE name = ?',
            [cleanName]
        );

        const isExpired = cached ? (Date.now() - cached.timestamp > CACHE_EXPIRY) : true;

        // Force retry if any key data is missing from cache
        const shouldRetryBio = cached && !cached.biography;
        const shouldRetryPhoto = cached && !cached.photo_url;

        if (cached && !isExpired && !shouldRetryBio && !shouldRetryPhoto) {
            console.log(`[ArtistAPI] Cache hit for: ${cleanName}`);
            return {
                name: cleanName,
                photo_url: cached.photo_url,
                biography: cached.biography,
            };
        }

        // 2. Fetch from Deezer API (for Photo)
        console.log(`[ArtistAPI] Fetching photo from Deezer for: ${cleanName}`);
        let photo_url: string | null = cached?.photo_url || null;
        let deezer_id: number | undefined;

        try {
            const deezerRes = await fetch(
                `https://api.deezer.com/search/artist?q=${encodeURIComponent(cleanName)}`
            );
            const deezerData = await deezerRes.json();
            const artist = deezerData.data?.[0];
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

        // 3. Fetch from Wikipedia (for Bio)
        let biography: string | null = null;

        async function tryWiki(lang: string, name: string) {
            try {
                // Try direct hit first with summary API
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

                // If not found, try searching via Opensearch for better mapping
                console.log(`[ArtistAPI] Direct hit failed for ${name} (${lang}), searching...`);
                const searchRes = await fetch(
                    `https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(name)}&limit=1&format=json&origin=*`,
                    { headers: WIKI_HEADERS }
                );

                const searchData = await searchRes.json();
                const matchedTitle = searchData?.[1]?.[0];

                if (matchedTitle) {
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

        console.log(`[ArtistAPI] Fetching bio (ES) for: ${cleanName}`);
        biography = await tryWiki('es', cleanName);

        // Fallback to English if Spanish fails
        if (!biography) {
            console.log(`[ArtistAPI] ES Bio failed, trying EN for: ${cleanName}`);
            biography = await tryWiki('en', cleanName);
        }

        const info: ArtistInfo = {
            name: cleanName,
            photo_url,
            biography,
            deezer_id,
        };

        // 4. Cache result
        await db.runAsync(
            'INSERT OR REPLACE INTO artists (name, photo_url, biography, timestamp) VALUES (?, ?, ?, ?)',
            [cleanName, info.photo_url, info.biography || null, Date.now()]
        );

        return info;
    } catch (error) {
        console.error(`[ArtistAPI] Fatal catch for ${artistName}:`, error);
        return null;
    }
}
