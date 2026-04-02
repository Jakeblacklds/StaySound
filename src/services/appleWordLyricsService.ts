import { DOMParser } from '@xmldom/xmldom';
import type { KaraokeLyricsJSON, KaraokeWordRaw } from '../types/karaokeTypes';

type LyricsApiSearchResult = {
    timing_type?: string;
    lyricsUrl?: string;
    duration?: number;
    track_name?: string;
    artist_name?: string;
    album_name?: string;
    isrc?: string;
};

type LyricsApiSearchResponse = {
    results?: LyricsApiSearchResult[];
};

type KpoeSyllable = {
    time?: number;
    duration?: number;
    text?: string;
    isBackground?: boolean;
    part?: boolean;
};

type KpoeLine = {
    time?: number;
    duration?: number;
    text?: string;
    syllabus?: KpoeSyllable[];
    element?: {
        songPart?: string;
    };
};

type KpoePayload = {
    metadata?: {
        source?: string;
        totalDuration?: string;
    };
    lyrics?: KpoeLine[];
};

class AppleWordLyricsService {
    private readonly CACHE_API_URL = 'https://lyrics-api.binimum.org/';
    private readonly KPOE_SOURCE_ORDER = 'apple,lyricsplus,musixmatch,spotify,musixmatch-word';
    private readonly KPOE_SERVERS = [
        'https://lyricsplus.prjktla.workers.dev',
        'https://lyricsplus.binimum.org',
        'https://lyricsplus.atomix.one',
        'https://lyricsplus-seven.vercel.app',
        'https://lyrics-plus-backend.vercel.app',
    ];

    private cleanMetadata(value?: string | null): string {
        return (value ?? '')
            .replace(/\s*[\(\[].*?[\)\]]/g, '')
            .replace(/\s*-\s*(Remastered|Original Mix|Single Version|Edit|Mix|Radio|Official|Lyric|Video).*$/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private async sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private xhrGet(url: string, timeoutMs = 15000): Promise<string> {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.setRequestHeader('Accept', 'application/json, text/plain, application/xml, text/xml, */*');
            xhr.timeout = timeoutMs;
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(xhr.responseText);
                } else {
                    reject(new Error(`HTTP ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error('XHR network error'));
            xhr.ontimeout = () => reject(new Error('XHR timeout'));
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
                    Accept: 'application/json, text/plain, application/xml, text/xml, */*',
                    'Cache-Control': 'no-cache',
                },
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                if (response.status === 404) return '';
                throw new Error(`HTTP ${response.status}`);
            }

            return await response.text();
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    private async requestWithFallback(url: string, retries = 2): Promise<string> {
        let lastError: unknown = null;

        for (let attempt = 0; attempt <= retries; attempt += 1) {
            try {
                if (attempt % 2 === 0) {
                    try {
                        return await this.fetchGet(url);
                    } catch (error) {
                        lastError = error;
                    }
                    try {
                        return await this.xhrGet(url);
                    } catch (error) {
                        lastError = error;
                    }
                } else {
                    try {
                        return await this.xhrGet(url);
                    } catch (error) {
                        lastError = error;
                    }
                    try {
                        return await this.fetchGet(url);
                    } catch (error) {
                        lastError = error;
                    }
                }

                if (attempt < retries) {
                    await this.sleep(1000 * (attempt + 1));
                }
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError ?? new Error('Request failed');
    }

    private decodeXmlEntities(text: string): string {
        return text
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;|&apos;/g, "'")
            .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
            .replace(/&#(\d+);/g, (_, num: string) => String.fromCodePoint(parseInt(num, 10)));
    }

    private stripXmlTags(text: string): string {
        return text.replace(/<[^>]+>/g, ' ');
    }

    private readXmlAttribute(source: string, name: string): string | null {
        const match = source.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'));
        return match?.[1] ?? null;
    }

    private parseTtmlTimestamp(value?: string | null): number {
        const trimmed = value?.trim();
        if (!trimmed) return 0;

        const parts = trimmed.split(':');
        const numericParts = parts.map(part => Number(part));
        if (numericParts.some(Number.isNaN)) return 0;

        if (numericParts.length === 3) {
            const [hours, minutes, seconds] = numericParts;
            return hours * 3600 + minutes * 60 + seconds;
        }

        if (numericParts.length === 2) {
            const [minutes, seconds] = numericParts;
            return minutes * 60 + seconds;
        }

        return numericParts[0] ?? 0;
    }

    private parseDurationString(value?: string | null): number | null {
        const trimmed = value?.trim();
        if (!trimmed) return null;

        const parts = trimmed.split(':');
        const numericParts = parts.map(part => Number(part));
        if (numericParts.some(Number.isNaN)) return null;

        if (numericParts.length === 3) {
            const [hours, minutes, seconds] = numericParts;
            return hours * 3600 + minutes * 60 + seconds;
        }

        if (numericParts.length === 2) {
            const [minutes, seconds] = numericParts;
            return minutes * 60 + seconds;
        }

        return numericParts[0] ?? null;
    }

    private buildLyricsPayload(song: string, artist: string, lyrics: KaraokeWordRaw[], fallbackDurationSec?: number): KaraokeLyricsJSON | null {
        if (!lyrics.length) return null;

        const maxEnd = lyrics.reduce((current, word) => Math.max(current, word.e), 0);
        const totalDuration = Math.max(fallbackDurationSec ?? 0, maxEnd);

        return {
            meta: {
                song,
                artist,
                total_duration: totalDuration,
            },
            lyrics,
        };
    }

    private createWordFragment(
        rawText: string | null | undefined,
        startSec: number,
        endSec: number,
        options?: {
            background?: boolean;
            part?: boolean;
        }
    ): KaraokeWordRaw | null {
        const sourceText = rawText ?? '';
        const hasTrailingSpace = /\s$/.test(sourceText);
        const normalizedText = sourceText.replace(/\s+/g, ' ').trim();

        if (!normalizedText) {
            return null;
        }

        return {
            w: normalizedText,
            s: startSec,
            e: endSec > startSec ? endSec : startSec,
            n: false,
            sp: hasTrailingSpace,
            bg: options?.background,
            p: options?.part,
        };
    }

    private finalizeLineFragments(target: KaraokeWordRaw[], mainWords: KaraokeWordRaw[], backgroundWords: KaraokeWordRaw[]) {
        const lineWords = [...mainWords, ...backgroundWords];
        if (!lineWords.length) return;
        lineWords[lineWords.length - 1].n = true;
        target.push(...lineWords);
    }

    private parseTTML(ttmlText: string, song: string, artist: string, fallbackDurationSec?: number): KaraokeLyricsJSON | null {
        try {
            const parser = new DOMParser();
            const xml = parser.parseFromString(ttmlText, 'text/xml');
            const paragraphs = Array.from(xml.getElementsByTagName('p'));
            const lyrics: KaraokeWordRaw[] = [];

            for (const paragraph of paragraphs) {
                const paragraphBegin = this.parseTtmlTimestamp(paragraph.getAttribute('begin'));
                const paragraphEnd = this.parseTtmlTimestamp(paragraph.getAttribute('end'));
                const mainWords: KaraokeWordRaw[] = [];
                const backgroundWords: KaraokeWordRaw[] = [];
                const spans = Array.from(paragraph.getElementsByTagName('span'));

                if (spans.length > 0) {
                    for (const span of spans) {
                        const parentRole =
                            typeof span.parentNode?.nodeType === 'number' && span.parentNode.nodeType === 1
                                ? (span.parentNode as Element).getAttribute?.('ttm:role')
                                : null;

                        if (span.getAttribute('ttm:role') === 'x-bg') {
                            const bgInnerSpans = Array.from(span.getElementsByTagName('span'));
                            for (const bgSpan of bgInnerSpans) {
                                let bgText = bgSpan.textContent || '';
                                const nextNode = bgSpan.nextSibling;
                                if (
                                    nextNode &&
                                    nextNode.nodeType === 3 &&
                                    /^\s/.test(nextNode.textContent || '') &&
                                    !bgText.endsWith(' ')
                                ) {
                                    bgText += ' ';
                                }

                                const fragment = this.createWordFragment(
                                    bgText,
                                    this.parseTtmlTimestamp(bgSpan.getAttribute('begin')),
                                    this.parseTtmlTimestamp(bgSpan.getAttribute('end')),
                                    { background: true }
                                );
                                if (fragment) {
                                    backgroundWords.push(fragment);
                                }
                            }
                            continue;
                        }

                        if (parentRole === 'x-bg') {
                            continue;
                        }

                        let text = span.textContent || '';
                        const nextNode = span.nextSibling;
                        if (
                            nextNode &&
                            nextNode.nodeType === 3 &&
                            /^\s/.test(nextNode.textContent || '') &&
                            !text.endsWith(' ')
                        ) {
                            text += ' ';
                        }

                        const fragment = this.createWordFragment(
                            text,
                            this.parseTtmlTimestamp(span.getAttribute('begin')),
                            this.parseTtmlTimestamp(span.getAttribute('end'))
                        );
                        if (fragment) {
                            mainWords.push(fragment);
                        }
                    }
                }

                if (!mainWords.length && !backgroundWords.length) {
                    const lineText = this.decodeXmlEntities(paragraph.textContent ?? '').replace(/\s+/g, ' ').trim();
                    if (!lineText) continue;
                    mainWords.push({
                        w: lineText,
                        s: paragraphBegin,
                        e: paragraphEnd > paragraphBegin ? paragraphEnd : paragraphBegin,
                        n: false,
                    });
                }

                this.finalizeLineFragments(lyrics, mainWords, backgroundWords);
            }

            return this.buildLyricsPayload(song, artist, lyrics, fallbackDurationSec);
        } catch {
            return null;
        }
    }

    private convertKpoeLyrics(payload: KpoePayload, song: string, artist: string, fallbackDurationSec?: number): KaraokeLyricsJSON | null {
        const lines = Array.isArray(payload.lyrics) ? payload.lyrics : [];
        const lyrics: KaraokeWordRaw[] = [];

        for (const line of lines) {
            const mainWords: KaraokeWordRaw[] = [];
            const backgroundWords: KaraokeWordRaw[] = [];
            const syllabus = Array.isArray(line.syllabus) ? line.syllabus : [];

            if (syllabus.length > 0) {
                for (const syllable of syllabus) {
                    const startSec = (syllable.time ?? 0) / 1000;
                    const endSec = startSec + Math.max((syllable.duration ?? 0) / 1000, 0);
                    const fragment = this.createWordFragment(syllable.text, startSec, endSec, {
                        background: Boolean(syllable.isBackground),
                        part: Boolean(syllable.part),
                    });
                    if (!fragment) continue;

                    if (syllable.isBackground) {
                        backgroundWords.push(fragment);
                    } else {
                        mainWords.push(fragment);
                    }
                }
            } else {
                const text = (line.text ?? '').replace(/\s+/g, ' ').trim();
                if (!text) continue;

                const startSec = (line.time ?? 0) / 1000;
                const endSec = startSec + Math.max((line.duration ?? 0) / 1000, 0);
                mainWords.push({
                    w: text,
                    s: startSec,
                    e: endSec > startSec ? endSec : startSec,
                    n: false,
                });
            }

            this.finalizeLineFragments(lyrics, mainWords, backgroundWords);
        }

        const metadataDuration = this.parseDurationString(payload.metadata?.totalDuration);
        return this.buildLyricsPayload(song, artist, lyrics, metadataDuration ?? fallbackDurationSec);
    }

    private async fetchSearchResults(title: string, artist: string, album?: string, durationSec?: number): Promise<LyricsApiSearchResult[]> {
        const params = new URLSearchParams({
            track: title,
            artist,
        });

        if (album) params.append('album', album);
        if (durationSec && durationSec > 0) params.append('duration', Math.round(durationSec).toString());

        const rawResponse = await this.requestWithFallback(`${this.CACHE_API_URL}?${params.toString()}`, 1);
        if (!rawResponse) return [];

        try {
            const payload = JSON.parse(rawResponse) as LyricsApiSearchResponse;
            return Array.isArray(payload.results) ? payload.results : [];
        } catch {
            return [];
        }
    }

    private async fetchTtmlLyrics(lyricsUrl: string, song: string, artist: string, fallbackDurationSec?: number): Promise<KaraokeLyricsJSON | null> {
        try {
            const rawResponse = await this.requestWithFallback(lyricsUrl, 1);
            const trimmed = rawResponse.trim();
            if (!trimmed.startsWith('<')) {
                return null;
            }

            return this.parseTTML(trimmed, song, artist, fallbackDurationSec);
        } catch {
            return null;
        }
    }

    private async fetchKpoeLyrics(title: string, artist: string, album?: string, durationSec?: number): Promise<KaraokeLyricsJSON | null> {
        const params = new URLSearchParams({
            title,
            artist,
            source: this.KPOE_SOURCE_ORDER,
        });

        if (album) params.append('album', album);
        if (durationSec && durationSec > 0) params.append('duration', Math.round(durationSec).toString());

        for (const baseUrl of this.KPOE_SERVERS) {
            try {
                const rawResponse = await this.requestWithFallback(`${baseUrl}/v2/lyrics/get?${params.toString()}`, 1);
                if (!rawResponse) continue;

                const payload = JSON.parse(rawResponse) as KpoePayload;
                const lyrics = this.convertKpoeLyrics(payload, title, artist, durationSec);
                if (lyrics?.lyrics?.length) {
                    return lyrics;
                }
            } catch {
                continue;
            }
        }

        return null;
    }

    async searchWordLyrics(title: string, artist: string, album?: string, durationSec?: number, isrc?: string): Promise<KaraokeLyricsJSON | null> {
        const cleanTitle = this.cleanMetadata(title);
        const cleanArtist = this.cleanMetadata(artist);
        const cleanAlbum = this.cleanMetadata(album);

        if (!cleanTitle || !cleanArtist) return null;

        const searchResults = await this.fetchSearchResults(cleanTitle, cleanArtist, cleanAlbum || undefined, durationSec);
        const wordResult = searchResults.find(result => result.timing_type?.toLowerCase() === 'word' && !!result.lyricsUrl);

        if (wordResult?.lyricsUrl) {
            const ttmlLyrics = await this.fetchTtmlLyrics(wordResult.lyricsUrl, title, artist, wordResult.duration ?? durationSec);
            if (ttmlLyrics?.lyrics?.length) {
                console.log('[AppleWordLyrics] TTML result:', cleanTitle, '/', cleanArtist, 'isrc=', isrc ?? 'n/a');
                return ttmlLyrics;
            }
        }

        const kpoeLyrics = await this.fetchKpoeLyrics(cleanTitle, cleanArtist, cleanAlbum || undefined, durationSec);
        if (kpoeLyrics?.lyrics?.length) {
            console.log('[AppleWordLyrics] KPoe JSON result:', cleanTitle, '/', cleanArtist, 'isrc=', isrc ?? 'n/a');
            return {
                ...kpoeLyrics,
                meta: {
                    ...kpoeLyrics.meta,
                    song: title,
                    artist,
                },
            };
        }

        return null;
    }
}

export const appleWordLyricsService = new AppleWordLyricsService();
