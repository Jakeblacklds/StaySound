import type { KaraokeLyricsJSON, KaraokeWordRaw } from '../types/karaokeTypes';

export interface LrcLibResponse {
    id: number;
    name: string;
    artistName: string;
    albumName: string;
    duration: number;
    instrumental: boolean;
    plainLyrics: string;
    syncedLyrics: string;
}

class LrcLibService {
    private readonly API_URL = 'https://lrclib.net/api/get';

    private cleanMetadata(value: string): string {
        return value
            // Remove everything in parentheses/brackets (e.g. "Song (feat. X)", "Song [Remastered]")
            .replace(/\s*[\(\[].*?[\)\]]/g, '')
            // Remove common suffixes after a dash
            .replace(/\s*-\s*(Remastered|Original Mix|Single Version|Edit|Mix|Radio|Official|Lyric|Video).*$/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private async sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async searchSyncLyrics(query: string, targetDuration?: number): Promise<LrcLibResponse | null> {
        try {
            const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
            console.log('[LrcLib] Searching API:', url);
            // Search API gets more retries as it's the last hope
            const responseText = await this.requestWithFallback(url, 3);
            if (!responseText) return null;

            const results: LrcLibResponse[] = JSON.parse(responseText);

            if (!Array.isArray(results) || results.length === 0) return null;

            // Filter for synced lyrics and pick best duration match
            const syncedResults = results.filter(r => r.syncedLyrics && !r.instrumental);
            if (syncedResults.length === 0) return null;

            if (targetDuration) {
                // Find closest duration within 20s
                const best = syncedResults.reduce((prev, curr) => {
                    const prevDiff = Math.abs(prev.duration - targetDuration);
                    const currDiff = Math.abs(curr.duration - targetDuration);
                    return currDiff < prevDiff ? curr : prev;
                });

                if (Math.abs(best.duration - targetDuration) < 20) {
                    return best;
                }
            }

            return syncedResults[0];
        } catch (error) {
            console.warn('[LrcLib] Search failed:', error);
            return null;
        }
    }

    private xhrGet(url: string, timeoutMs = 15000): Promise<string> {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.setRequestHeader('Accept', 'application/json');
            xhr.setRequestHeader('User-Agent', 'StaySound/1.0.0');
            xhr.timeout = timeoutMs;
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(xhr.responseText);
                } else {
                    reject(new Error(`HTTP ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error(`XHR network error`));
            xhr.ontimeout = () => reject(new Error(`XHR timeout`));
            xhr.send();
        });
    }

    private async fetchGet(url: string, timeoutMs = 15000): Promise<string> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'StaySound/1.0.0',
                    'Cache-Control': 'no-cache',
                },
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                if (response.status === 404) return ""; // Normal for "not found"
                throw new Error(`HTTP ${response.status}`);
            }
            return await response.text();
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    /**
     * More aggressive retry logic.
     * If even XHR and Fetch fail, it means the network stack is probably struggling.
     */
    private async requestWithFallback(url: string, retries = 3): Promise<string> {
        let lastError: any = null;

        for (let i = 0; i <= retries; i++) {
            try {
                // Alternar entre fetch y XHR cada intento para romper posibles bloqueos del stack nativo
                if (i % 2 === 0) {
                    try { return await this.fetchGet(url); } catch (e) { lastError = e; }
                    try { return await this.xhrGet(url); } catch (e) { lastError = e; }
                } else {
                    try { return await this.xhrGet(url); } catch (e) { lastError = e; }
                    try { return await this.fetchGet(url); } catch (e) { lastError = e; }
                }

                const msg = String(lastError?.message ?? '');
                if (msg.includes('HTTP 404')) return "";

                if (i < retries) {
                    const delay = 1500 * (i + 1); // Aumentamos delay para dar respiro al radio de Android
                    console.warn(`[LrcLib] Retry ${i + 1}/${retries} for URL after network glitch...`);
                    await this.sleep(delay);
                }
            } catch (err) {
                lastError = err;
            }
        }
        throw lastError || new Error('Request failed');
    }

    /**
     * Fetches synced lyrics from LRCLIB
     */
    async fetchLyrics(title: string, artist: string, duration?: number): Promise<KaraokeLyricsJSON | null> {
        const cleanTitle = this.cleanMetadata(title);
        const cleanArtist = this.cleanMetadata(artist);

        // Intentos en orden de especificidad
        const attempts: Array<{ t: string; a: string; d: boolean }> = [
            { t: title, a: artist, d: true },
            { t: cleanTitle, a: cleanArtist, d: true },
            { t: title, a: artist, d: false },
            { t: cleanTitle, a: cleanArtist, d: false },
        ];

        const seen = new Set<string>();

        for (const attempt of attempts) {
            if (!attempt.t || !attempt.a) continue;
            const key = `${attempt.t}|${attempt.a}|${attempt.d}`;
            if (seen.has(key)) continue;
            seen.add(key);

            try {
                let url = `${this.API_URL}?track_name=${encodeURIComponent(attempt.t)}&artist_name=${encodeURIComponent(attempt.a)}`;
                if (attempt.d && duration) {
                    url += `&duration=${Math.round(duration)}`;
                }

                console.log('[LrcLib] Fetching GET:', url);
                const responseText = await this.requestWithFallback(url, 2);
                if (!responseText) continue;

                const data: LrcLibResponse = JSON.parse(responseText);
                if (data.syncedLyrics && !data.instrumental) {
                    console.log('[LrcLib] Found synced lyrics via GET');
                    return this.parseLrc(data.syncedLyrics, title, artist, data.duration || duration || 0);
                }
            } catch (error: any) {
                // Skip to next variant
            }
        }

        // Si falló todo, intentamos con Search API (mucho más flexible)
        console.log('[LrcLib] All GET attempts failed or network error, trying Search API...');
        const searchResult = await this.searchSyncLyrics(`${cleanTitle} ${cleanArtist}`, duration);

        if (searchResult && searchResult.syncedLyrics) {
            console.log('[LrcLib] Found synced lyrics via Search API');
            return this.parseLrc(searchResult.syncedLyrics, title, artist, searchResult.duration);
        }

        console.log('[LrcLib] No synced lyrics found after all strategies');
        return null;
    }

    private parseLrc(lrc: string, title: string, artist: string, totalDuration: number): KaraokeLyricsJSON {
        const lines = lrc.split('\n');
        const lyrics: KaraokeWordRaw[] = [];
        const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(timeRegex);
            if (match) {
                const mins = parseInt(match[1]);
                const secs = parseInt(match[2]);
                const msStr = match[3];
                const ms = parseInt(msStr.padEnd(3, '0'));
                const startTime = mins * 60 + secs + ms / 1000;
                const text = match[4].trim();

                if (text) {
                    lyrics.push({
                        w: text,
                        s: startTime,
                        e: 0,
                        n: true,
                    });
                }
            }
        }

        for (let i = 0; i < lyrics.length; i++) {
            if (i < lyrics.length - 1) {
                lyrics[i].e = lyrics[i + 1].s;
            } else {
                lyrics[i].e = totalDuration > lyrics[i].s ? totalDuration : lyrics[i].s + 5;
            }
        }

        return {
            meta: {
                song: title,
                artist: artist,
                total_duration: totalDuration,
            },
            lyrics,
        };
    }
}

export const lrcLibService = new LrcLibService();
