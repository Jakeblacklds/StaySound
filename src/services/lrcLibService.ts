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

    private normalizeQueryValue(value: string): string {
        return value
            .replace(/[\u2013\u2014]/g, '-')
            .replace(/\s+-\s*$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Makes an HTTP GET request using XMLHttpRequest.
     * More reliable than fetch() on Android for certain servers (HTTP/1.1 compatibility).
     */
    private xhrGet(url: string, timeoutMs = 20000): Promise<string> {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.timeout = timeoutMs;
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(xhr.responseText);
                } else {
                    reject(new Error(`HTTP ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error(`XHR network error for ${url}`));
            xhr.ontimeout = () => reject(new Error(`XHR timeout after ${timeoutMs}ms`));
            xhr.send();
        });
    }

    private async fetchGet(url: string, timeoutMs = 20000): Promise<string> {
        const timeout = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Fetch timeout after ${timeoutMs}ms`)), timeoutMs);
        });

        const request = fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'Cache-Control': 'no-cache',
            },
        }).then(async (response) => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return await response.text();
        });

        return await Promise.race([request, timeout]);
    }

    private async requestWithFallback(url: string): Promise<string> {
        try {
            return await this.xhrGet(url);
        } catch (xhrError: any) {
            const msg = String(xhrError?.message ?? xhrError ?? '');
            const shouldTryFetch = msg.includes('XHR network error') || msg.includes('XHR timeout');

            if (!shouldTryFetch) {
                throw xhrError;
            }

            console.warn('[LrcLib] XHR failed, trying fetch fallback:', msg);
            return await this.fetchGet(url);
        }
    }

    /**
     * Fetches synced lyrics from LRCLIB
     */
    async fetchLyrics(title: string, artist: string, duration?: number): Promise<KaraokeLyricsJSON | null> {
        const cleanTitle = this.normalizeQueryValue(title);
        const cleanArtist = this.normalizeQueryValue(artist);

        const attempts: Array<{ title: string; artist: string; withDuration: boolean }> = [
            { title, artist, withDuration: true },
            { title: cleanTitle, artist: cleanArtist, withDuration: true },
            { title, artist, withDuration: false },
            { title: cleanTitle, artist: cleanArtist, withDuration: false },
        ];

        const seen = new Set<string>();

        for (const attempt of attempts) {
            const key = `${attempt.title}|${attempt.artist}|${attempt.withDuration ? 'dur' : 'nodur'}`;
            if (seen.has(key)) continue;
            seen.add(key);

            try {
                let url = `${this.API_URL}?track_name=${encodeURIComponent(attempt.title)}&artist_name=${encodeURIComponent(attempt.artist)}`;
                if (attempt.withDuration && duration) {
                    url += `&duration=${Math.round(duration)}`;
                }

                console.log('[LrcLib] Fetching from:', url);
                const responseText = await this.requestWithFallback(url);
                const data: LrcLibResponse = JSON.parse(responseText);

                if (!data.syncedLyrics) {
                    continue;
                }

                return this.parseLrc(data.syncedLyrics, title, artist, data.duration);
            } catch (error: any) {
                console.error('[LrcLib] Attempt failed:', error?.message ?? error);
            }
        }

        console.log('[LrcLib] No synced lyrics found after all attempts');
        return null;
    }


    /**
     * Parses LRC format string into KaraokeLyricsJSON
     */
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
                // Handle both .xx and .xxx
                const ms = parseInt(msStr.padEnd(3, '0'));
                const startTime = mins * 60 + secs + ms / 1000;
                const text = match[4].trim();

                if (text) {
                    lyrics.push({
                        w: text,
                        s: startTime,
                        e: 0, // Will fill in next pass
                        n: true,
                    });
                }
            }
        }

        // Fill in end times based on the next line's start time
        for (let i = 0; i < lyrics.length; i++) {
            if (i < lyrics.length - 1) {
                lyrics[i].e = lyrics[i + 1].s;
            } else {
                // Last line duration: either up to totalDuration or +5s
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
