import { DOMParser } from '@xmldom/xmldom';
import type { KaraokeLyricsJSON, KaraokeWordRaw } from '../types/karaokeTypes';
import {
    getLyricsSourceMeta,
    LYRICS_SOURCES,
    type LyricsSourceId,
    type LyricsSourceMeta,
    sanitizeLyricsSourceIds,
} from './lyricsSources';

export type AppleWordLyricsOption = {
    id: string;
    label: string;
    source: 'lrc-red' | 'binimum' | 'kpoe';
    /** Concrete provider this candidate came from (apple, lyricsplus, …). */
    sourceId: LyricsSourceId;
    /** Human-facing provider name for the picker ("Apple Music", "Musixmatch", …). */
    providerLabel: string;
    /** True when this candidate carries real per-word/syllable timing. */
    wordLevel: boolean;
    payload: KaraokeLyricsJSON;
    lyricsUrl?: string;
    timingType?: string;
    trackName?: string;
    artistName?: string;
    albumName?: string;
    durationSec?: number;
    isExactMatch: boolean;
};

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

type LrcRedHit = {
    isrc?: string;
    title?: string;
    artist?: string;
    album?: string;
    duration?: number;
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
    private readonly LRC_RED_URL = 'https://lrc.red';
    private readonly CACHE_API_URL = 'https://lyrics-api.binimum.org/';
    private readonly MAX_WORD_OPTIONS = 3;
    // Extra KPoe providers am-lyrics queries but we don't expose as toggles. Appended to
    // the combined source order so KPoe can still fall back on them for coverage.
    private readonly EXTRA_KPOE_SOURCES = ['qq', 'deezer', 'musixmatch-word'];
    private readonly KPOE_SERVERS = [
        'https://lyricsplus.prjktla.workers.dev',
        'https://lyricsplus.binimum.org',
        'https://lyricsplus.atomix.one',
        'https://lyricsplus-seven.vercel.app',
        'https://lyrics-plus-backend.vercel.app',
    ];
    private readonly MIN_GAP_BETWEEN_REQUESTS_MS = 420;
    private readonly BASE_HOST_COOLDOWN_MS = 25_000;
    private readonly STORAGE_HOST_COOLDOWN_MS = 45_000;
    private readonly MAX_COOLDOWN_EXPONENT = 3;
    private readonly MAX_SINGLE_WAIT_MS = 3_500;
    private readonly hostLastRequestAt = new Map<string, number>();
    private readonly hostCooldownUntil = new Map<string, number>();
    private readonly hostPenaltyStrikes = new Map<string, number>();

    private isLikelyUnsyncedTimingType(timingType?: string | null): boolean {
        const normalized = (timingType ?? '').trim().toLowerCase();
        if (!normalized) return false;
        return normalized === 'text' || normalized === 'plain' || normalized === 'unsynced' || normalized === 'static';
    }

    private isWordLevelTimingType(timingType?: string | null): boolean {
        const normalized = (timingType ?? '').trim().toLowerCase();
        return normalized === 'word' || normalized === 'syllable' || normalized === 'word-synced';
    }

    private isLineLevelTimingType(timingType?: string | null): boolean {
        const normalized = (timingType ?? '').trim().toLowerCase();
        return normalized === 'line' || normalized === 'line-synced' || normalized === 'linesync';
    }

    /**
     * True only when the parsed payload carries REAL per-word (ELRC) timing.
     *
     * A line-level result stores exactly one fragment per line, so every fragment is a
     * line terminator (`n === true`). Genuine word/syllable timing always produces at
     * least one intra-line fragment (`n !== true`). We discard line-level payloads so
     * the karaoke view never shows a whole line lit at once ("todo iluminado").
     */
    private hasWordLevelTiming(payload: KaraokeLyricsJSON | null | undefined): boolean {
        const lyrics = payload?.lyrics;
        if (!Array.isArray(lyrics) || lyrics.length === 0) return false;
        return lyrics.some(word => word.n !== true);
    }

    private cleanMetadata(value?: string | null): string {
        return (value ?? '')
            .replace(/\s*[\(\[].*?[\)\]]/g, '')
            .replace(/\s*-\s*(Remastered|Original Mix|Single Version|Edit|Mix|Radio|Official|Lyric|Video).*$/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private normalizeComparisonValue(value?: string | null): string {
        return (value ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private lrcRedBaseTitle(value: string): string {
        return this.normalizeComparisonValue(
            value.replace(/\s*[[(](?:feat\.?|ft\.?|featuring)\s+[^\])]*[\])]/gi, '')
        );
    }

    private lrcRedVersionMarker(value: string): boolean {
        return /\b(?:live|acoustic|remix|instrumental|karaoke|sped up|slowed|cover)\b/i.test(value);
    }

    private isMatchingLrcRedHit(hit: LrcRedHit, title: string, artist: string, album?: string, durationSec?: number): boolean {
        if (!hit.isrc || !hit.title || !hit.artist) return false;
        if (this.lrcRedBaseTitle(hit.title) !== this.lrcRedBaseTitle(title)) return false;
        if (this.lrcRedVersionMarker(hit.title) !== this.lrcRedVersionMarker(title)) return false;

        const durationDifference = durationSec && Number.isFinite(hit.duration)
            ? Math.abs(durationSec - (hit.duration as number))
            : null;
        if (durationDifference !== null && durationDifference > 12) return false;

        const requestedArtist = this.normalizeComparisonValue(artist);
        const resultArtist = this.normalizeComparisonValue(hit.artist);
        if (resultArtist === requestedArtist || (requestedArtist.length >= 6 && resultArtist.includes(requestedArtist))) {
            return true;
        }

        // lrc.red sometimes localizes the artist (Julieta Venegas appears in
        // Chinese). The exact title and close recording duration still identify it.
        const albumMatches = !album || this.normalizeComparisonValue(hit.album) === this.normalizeComparisonValue(album);
        return !/[a-z]/i.test(hit.artist)
            && albumMatches
            && durationDifference !== null
            && durationDifference <= (album ? 8 : 3);
    }

    private async fetchLrcRedOption(
        title: string,
        artist: string,
        album?: string,
        durationSec?: number,
        isrc?: string,
    ): Promise<AppleWordLyricsOption | null> {
        const makeOption = async (matchedIsrc: string, hit?: LrcRedHit): Promise<AppleWordLyricsOption | null> => {
            if (!/^[A-Z0-9]{12}$/i.test(matchedIsrc)) return null;
            const lyricsUrl = `${this.LRC_RED_URL}/s/${matchedIsrc.toUpperCase()}.ttml`;
            const payload = await this.fetchTtmlLyrics(lyricsUrl, title, artist, hit?.duration ?? durationSec);
            if (!payload || !this.hasWordLevelTiming(payload)) return null;
            return {
                id: 'lrc-red',
                label: 'lrc.red',
                source: 'lrc-red',
                sourceId: 'lrc-red',
                providerLabel: 'lrc.red',
                wordLevel: true,
                payload,
                lyricsUrl,
                timingType: 'word',
                trackName: hit?.title ?? title,
                artistName: hit?.artist ?? artist,
                albumName: hit?.album ?? album,
                durationSec: hit?.duration ?? durationSec,
                isExactMatch: true,
            };
        };

        if (isrc?.trim()) {
            const direct = await makeOption(isrc.trim());
            if (direct) return direct;
        }

        try {
            const url = `${this.LRC_RED_URL}/search.json?q=${encodeURIComponent(`${title} ${artist}`)}`;
            const raw = await this.requestWithFallback(url, 0);
            const hits = (JSON.parse(raw) as { hits?: LrcRedHit[] }).hits;
            if (!Array.isArray(hits)) return null;
            for (const hit of hits.filter(candidate => this.isMatchingLrcRedHit(candidate, title, artist, album, durationSec)).slice(0, 3)) {
                const option = await makeOption(hit.isrc!, hit);
                if (option) return option;
            }
            return null;
        } catch {
            return null;
        }
    }

    private async sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private getHost(url: string): string {
        try {
            return new URL(url).host.toLowerCase();
        } catch {
            return '';
        }
    }

    private isStorageHost(host: string): boolean {
        return host === 'storage.lyrics-api.binimum.org';
    }

    private getBaseCooldownForHost(host: string): number {
        return this.isStorageHost(host) ? this.STORAGE_HOST_COOLDOWN_MS : this.BASE_HOST_COOLDOWN_MS;
    }

    private extractHttpStatus(error: unknown): number | null {
        if (error instanceof Error) {
            const match = error.message.match(/HTTP\s+(\d{3})/i);
            if (match) {
                return Number(match[1]);
            }
        }
        return null;
    }

    private isHostCooldownError(error: unknown): boolean {
        return error instanceof Error && error.message.includes('HOST_COOLDOWN_ACTIVE');
    }

    private shouldFastFail(url: string, error: unknown): boolean {
        if (this.isHostCooldownError(error)) return true;
        const status = this.extractHttpStatus(error);
        const host = this.getHost(url);
        if (status === 429) return true;
        if (status === 403 && this.isStorageHost(host)) return true;
        return false;
    }

    private async waitForHostBudget(url: string): Promise<boolean> {
        const host = this.getHost(url);
        if (!host) return true;

        const now = Date.now();
        const cooldownUntil = this.hostCooldownUntil.get(host) ?? 0;
        const sinceLast = now - (this.hostLastRequestAt.get(host) ?? 0);
        const gapWait = Math.max(0, this.MIN_GAP_BETWEEN_REQUESTS_MS - sinceLast);
        const cooldownWait = Math.max(0, cooldownUntil - now);
        const waitMs = Math.max(gapWait, cooldownWait);
        if (waitMs > this.MAX_SINGLE_WAIT_MS) {
            console.log('[AppleWordLyrics] host cooldown active, skipping request:', host, `${waitMs}ms`);
            return false;
        }
        if (waitMs > 0) {
            await this.sleep(waitMs);
        }
        return true;
    }

    private registerHostRequest(url: string): void {
        const host = this.getHost(url);
        if (!host) return;
        this.hostLastRequestAt.set(host, Date.now());
    }

    private registerHostSuccess(url: string): void {
        const host = this.getHost(url);
        if (!host) return;
        this.hostPenaltyStrikes.set(host, 0);
        this.hostCooldownUntil.delete(host);
    }

    private registerHostPenalty(url: string, status: number | null): void {
        const host = this.getHost(url);
        if (!host) return;

        // 429 always cools down; 403 is treated as throttling only for the storage host.
        const shouldPenalize = status === 429 || (status === 403 && this.isStorageHost(host));
        if (!shouldPenalize) return;

        const current = this.hostPenaltyStrikes.get(host) ?? 0;
        const next = Math.min(current + 1, this.MAX_COOLDOWN_EXPONENT);
        this.hostPenaltyStrikes.set(host, next);

        const base = this.getBaseCooldownForHost(host);
        const cooldownMs = base * Math.pow(2, Math.max(0, next - 1));
        this.hostCooldownUntil.set(host, Date.now() + cooldownMs);
    }

    private async performRequestWithBudget(url: string, mode: 'fetch' | 'xhr'): Promise<string> {
        const canProceed = await this.waitForHostBudget(url);
        if (!canProceed) {
            throw new Error('HOST_COOLDOWN_ACTIVE');
        }
        this.registerHostRequest(url);

        try {
            const responseText = mode === 'fetch'
                ? await this.fetchGet(url)
                : await this.xhrGet(url);
            this.registerHostSuccess(url);
            return responseText;
        } catch (error) {
            const status = this.extractHttpStatus(error);
            this.registerHostPenalty(url, status);
            throw error;
        }
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
                        return await this.performRequestWithBudget(url, 'fetch');
                    } catch (error) {
                        lastError = error;
                        if (this.shouldFastFail(url, error)) {
                            break;
                        }
                    }
                    try {
                        return await this.performRequestWithBudget(url, 'xhr');
                    } catch (error) {
                        lastError = error;
                        if (this.shouldFastFail(url, error)) {
                            break;
                        }
                    }
                } else {
                    try {
                        return await this.performRequestWithBudget(url, 'xhr');
                    } catch (error) {
                        lastError = error;
                        if (this.shouldFastFail(url, error)) {
                            break;
                        }
                    }
                    try {
                        return await this.performRequestWithBudget(url, 'fetch');
                    } catch (error) {
                        lastError = error;
                        if (this.shouldFastFail(url, error)) {
                            break;
                        }
                    }
                }

                if (attempt < retries) {
                    const backoffMs = 1400 * (attempt + 1);
                    await this.sleep(backoffMs);
                }
            } catch (error) {
                lastError = error;
            }
        }

        if (lastError) {
            console.warn('[AppleWordLyrics] request failed:', url, lastError);
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

    private nodeMatchesLocalName(nodeName: string | null | undefined, target: string): boolean {
        if (!nodeName) return false;
        const normalized = nodeName.toLowerCase();
        const suffix = `:${target.toLowerCase()}`;
        return normalized === target.toLowerCase() || normalized.endsWith(suffix);
    }

    private getElementsByLocalName(root: Document | Element, target: string): Element[] {
        const all = Array.from(root.getElementsByTagName('*')) as Element[];
        return all.filter(element => this.nodeMatchesLocalName(element.nodeName, target));
    }

    private parseTtmlTimestamp(value?: string | null): number {
        const trimmed = value?.trim();
        if (!trimmed) return 0;

        const offsetTime = trimmed.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
        if (offsetTime) {
            const scale = { ms: 0.001, s: 1, m: 60, h: 3600 }[offsetTime[2] as 'ms' | 's' | 'm' | 'h'];
            return Number(offsetTime[1]) * scale;
        }

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

    private buildCandidateLabel(index: number, result?: LyricsApiSearchResult): string {
        const title = this.cleanMetadata(result?.track_name);
        const artist = this.cleanMetadata(result?.artist_name);
        const parts = [title, artist].filter(Boolean);
        if (parts.length > 0) {
            return parts.join(' • ');
        }
        return `Opción ${index + 1}`;
    }

    private scoreSearchResult(
        result: LyricsApiSearchResult,
        title: string,
        artist: string,
        durationSec?: number,
        isrc?: string,
    ): number {
        let score = 0;
        const normalizedTitle = this.normalizeComparisonValue(title);
        const normalizedArtist = this.normalizeComparisonValue(artist);
        const resultTitle = this.normalizeComparisonValue(result.track_name);
        const resultArtist = this.normalizeComparisonValue(result.artist_name);

        if (result.lyricsUrl) score += 5;
        if (!this.isLikelyUnsyncedTimingType(result.timing_type)) score += 20;
        // Strongly favour real word-by-word (ELRC) over line-level so a word candidate
        // is always fetched/selected before a line-level one when both exist.
        if (this.isWordLevelTimingType(result.timing_type)) score += 14;
        else if (this.isLineLevelTimingType(result.timing_type)) score -= 12;
        if (resultTitle && resultTitle === normalizedTitle) score += 18;
        if (resultArtist && resultArtist === normalizedArtist) score += 14;
        if (isrc && result.isrc && isrc.trim().toLowerCase() === result.isrc.trim().toLowerCase()) score += 30;

        if (durationSec && result.duration) {
            const delta = Math.abs(result.duration - durationSec);
            if (delta <= 1.5) score += 12;
            else if (delta <= 4) score += 8;
            else if (delta <= 8) score += 4;
        }

        return score;
    }

    private isExactSearchResult(
        result: LyricsApiSearchResult,
        title: string,
        artist: string,
        durationSec?: number,
        isrc?: string,
    ): boolean {
        const requestedIsrc = isrc?.trim().toLowerCase();
        const resultIsrc = result.isrc?.trim().toLowerCase();
        if (requestedIsrc && resultIsrc && requestedIsrc === resultIsrc) {
            return true;
        }

        const titleMatches =
            this.normalizeComparisonValue(result.track_name) === this.normalizeComparisonValue(title);
        const artistMatches =
            this.normalizeComparisonValue(result.artist_name) === this.normalizeComparisonValue(artist);
        if (!titleMatches || !artistMatches) return false;

        if (durationSec && result.duration) {
            return Math.abs(result.duration - durationSec) <= 4;
        }

        return true;
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
            const paragraphs = this.getElementsByLocalName(xml, 'p');
            const lyrics: KaraokeWordRaw[] = [];

            for (const paragraph of paragraphs) {
                const paragraphBegin = this.parseTtmlTimestamp(paragraph.getAttribute('begin'));
                const paragraphEnd = this.parseTtmlTimestamp(paragraph.getAttribute('end'));
                const mainWords: KaraokeWordRaw[] = [];
                const backgroundWords: KaraokeWordRaw[] = [];
                const spans = this.getElementsByLocalName(paragraph, 'span');

                if (spans.length > 0) {
                    for (const span of spans) {
                        const parentRole =
                            typeof span.parentNode?.nodeType === 'number' && span.parentNode.nodeType === 1
                                ? (span.parentNode as Element).getAttribute?.('ttm:role')
                                : null;

                        if (span.getAttribute('ttm:role') === 'x-bg') {
                            const bgInnerSpans = this.getElementsByLocalName(span, 'span');
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
        const roundedDuration = durationSec && durationSec > 0 ? Math.round(durationSec).toString() : null;
        const attempts: Array<{ includeAlbum: boolean; includeDuration: boolean }> = [
            { includeAlbum: true, includeDuration: Boolean(roundedDuration) },
            { includeAlbum: false, includeDuration: Boolean(roundedDuration) },
            { includeAlbum: true, includeDuration: false },
            { includeAlbum: false, includeDuration: false },
        ];

        for (const attempt of attempts) {
            const params = new URLSearchParams({
                track: title,
                artist,
            });

            if (attempt.includeAlbum && album) params.append('album', album);
            if (attempt.includeDuration && roundedDuration) params.append('duration', roundedDuration);

            const rawResponse = await this.requestWithFallback(`${this.CACHE_API_URL}?${params.toString()}`, 1);
            if (!rawResponse) continue;

            try {
                const payload = JSON.parse(rawResponse) as LyricsApiSearchResponse;
                const results = Array.isArray(payload.results) ? payload.results : [];
                if (results.length > 0) return results;
            } catch {
                continue;
            }
        }

        return [];
    }

    private async fetchTtmlLyrics(lyricsUrl: string, song: string, artist: string, fallbackDurationSec?: number): Promise<KaraokeLyricsJSON | null> {
        try {
            console.log('[AppleWordLyrics] fetching TTML:', lyricsUrl);
            const rawResponse = await this.requestWithFallback(lyricsUrl, 1);
            const trimmed = rawResponse.trim();
            if (!trimmed.startsWith('<')) {
                console.log('[AppleWordLyrics] TTML response is not XML');
                return null;
            }

            return this.parseTTML(trimmed, song, artist, fallbackDurationSec);
        } catch (error) {
            console.log('[AppleWordLyrics] TTML fetch failed:', error instanceof Error ? error.message : String(error));
            return null;
        }
    }

    /**
     * Single KPoe request with a COMBINED source order (am-lyrics style): KPoe picks the
     * best provider it has and we read which one answered. We shuffle the mirrors and try
     * up to 3 — one combined call, not one per source — so it stays fast and cheap.
     */
    private async fetchKpoeLyrics(kpoeSourceOrder: string, title: string, artist: string, album?: string, durationSec?: number): Promise<{ lyrics: KaraokeLyricsJSON; providerSource: string } | null> {
        const roundedDuration = durationSec && durationSec > 0 ? Math.round(durationSec).toString() : null;
        const attempts: Array<{ includeAlbum: boolean; includeDuration: boolean }> = [
            { includeAlbum: true, includeDuration: Boolean(roundedDuration) },
            { includeAlbum: false, includeDuration: false },
        ];

        const servers = [...this.KPOE_SERVERS].sort(() => Math.random() - 0.5).slice(0, 3);

        for (const attempt of attempts) {
            const params = new URLSearchParams({
                title,
                artist,
                source: kpoeSourceOrder,
            });

            if (attempt.includeAlbum && album) params.append('album', album);
            if (attempt.includeDuration && roundedDuration) params.append('duration', roundedDuration);

            for (const baseUrl of servers) {
                try {
                    const rawResponse = await this.requestWithFallback(`${baseUrl}/v2/lyrics/get?${params.toString()}`, 0);
                    if (!rawResponse) continue;

                    const payload = JSON.parse(rawResponse) as KpoePayload;
                    const lyrics = this.convertKpoeLyrics(payload, title, artist, durationSec);
                    if (lyrics?.lyrics?.length) {
                        return { lyrics, providerSource: payload.metadata?.source ?? '' };
                    }
                } catch {
                    continue;
                }
            }
        }

        return null;
    }

    /** Map the provider string KPoe reports back to one of our known sources. */
    private resolveKpoeProvider(providerSource: string): LyricsSourceMeta {
        const lower = providerSource.toLowerCase();
        const match = LYRICS_SOURCES.find(meta => meta.kpoeSource && lower.includes(meta.kpoeSource));
        return match ?? getLyricsSourceMeta('lyricsplus')!;
    }

    private async fetchCombinedKpoeOption(
        kpoeSourceOrder: string,
        title: string,
        artist: string,
        cleanTitle: string,
        cleanArtist: string,
        cleanAlbum: string,
        durationSec?: number,
    ): Promise<AppleWordLyricsOption | null> {
        const result = await this.fetchKpoeLyrics(kpoeSourceOrder, cleanTitle, cleanArtist, cleanAlbum || undefined, durationSec);
        if (!result?.lyrics?.lyrics?.length) return null;

        const provider = this.resolveKpoeProvider(result.providerSource);
        console.log('[AppleWordLyrics] KPoe hit:', provider.id, `(reported "${result.providerSource}")`, cleanTitle, '/', cleanArtist);

        return {
            id: `kpoe-${provider.id}`,
            label: provider.label,
            source: 'kpoe',
            sourceId: provider.id,
            providerLabel: provider.label,
            wordLevel: this.hasWordLevelTiming(result.lyrics),
            payload: {
                ...result.lyrics,
                meta: {
                    ...result.lyrics.meta,
                    song: title,
                    artist,
                },
            },
            trackName: cleanTitle,
            artistName: cleanArtist,
            albumName: cleanAlbum || undefined,
            durationSec,
            isExactMatch: true,
        };
    }

    /**
     * Builds the Apple Music (binimum TTML) candidates. Line-level results are kept
     * now — we tag them as such instead of discarding, so songs that only have
     * line-synced lyrics still show up (matching am-lyrics' coverage).
     */
    private async fetchAppleTtmlOptions(
        title: string,
        artist: string,
        cleanTitle: string,
        cleanArtist: string,
        cleanAlbum: string,
        durationSec?: number,
        isrc?: string,
    ): Promise<AppleWordLyricsOption[]> {
        const searchResults = await this.fetchSearchResults(cleanTitle, cleanArtist, cleanAlbum || undefined, durationSec);
        if (searchResults.length === 0) {
            console.log('[AppleWordLyrics] search candidates: 0', cleanTitle, '/', cleanArtist, 'isrc=', isrc ?? 'n/a');
            return [];
        }

        console.log(
            '[AppleWordLyrics] search candidates:',
            searchResults.length,
            searchResults
                .slice(0, 5)
                .map(result => `${result.timing_type ?? 'unknown'}|${result.track_name ?? '?'}|${result.artist_name ?? '?'}`)
                .join(' || ')
        );

        const sortedCandidates = searchResults
            .filter(result => !!result.lyricsUrl && !this.isLikelyUnsyncedTimingType(result.timing_type))
            .map(result => ({
                result,
                score: this.scoreSearchResult(result, cleanTitle, cleanArtist, durationSec, isrc),
            }))
            .sort((left, right) => right.score - left.score)
            .map(entry => entry.result);

        const options: AppleWordLyricsOption[] = [];
        const seenUrls = new Set<string>();
        const appleMeta = getLyricsSourceMeta('apple');

        for (const result of sortedCandidates) {
            if (!result.lyricsUrl || seenUrls.has(result.lyricsUrl)) continue;
            seenUrls.add(result.lyricsUrl);

            const ttmlLyrics = await this.fetchTtmlLyrics(result.lyricsUrl, title, artist, result.duration ?? durationSec);
            if (!ttmlLyrics?.lyrics?.length) {
                console.log('[AppleWordLyrics] selected candidate returned no parseable TTML');
                continue;
            }

            const optionIndex = options.length;
            options.push({
                id: `apple-${optionIndex + 1}`,
                label: this.buildCandidateLabel(optionIndex, result),
                source: 'binimum',
                sourceId: 'apple',
                providerLabel: appleMeta?.label ?? 'Apple Music',
                wordLevel: this.hasWordLevelTiming(ttmlLyrics),
                payload: ttmlLyrics,
                lyricsUrl: result.lyricsUrl,
                timingType: result.timing_type,
                trackName: this.cleanMetadata(result.track_name) || undefined,
                artistName: this.cleanMetadata(result.artist_name) || undefined,
                albumName: this.cleanMetadata(result.album_name) || undefined,
                durationSec: result.duration,
                isExactMatch: this.isExactSearchResult(
                    result,
                    cleanTitle,
                    cleanArtist,
                    durationSec,
                    isrc,
                ),
            });

            if (options.length >= this.MAX_WORD_OPTIONS) {
                break;
            }
        }

        return options;
    }

    async searchWordLyricsOptions(
        title: string,
        artist: string,
        album?: string,
        durationSec?: number,
        isrc?: string,
        sources?: LyricsSourceId[],
    ): Promise<AppleWordLyricsOption[]> {
        const cleanTitle = this.cleanMetadata(title);
        const cleanArtist = this.cleanMetadata(artist);
        const cleanAlbum = this.cleanMetadata(album);

        if (!cleanTitle || !cleanArtist) return [];

        const enabled = sanitizeLyricsSourceIds(sources);

        // Waterfall, am-lyrics style: take the first good source and stop. This is what
        // makes it fast and find "muchas" — we don't wait on every provider.

        // 1) The original word-timed TTML from lrc.red.
        if (enabled.includes('lrc-red')) {
            const lrcRedOption = await this.fetchLrcRedOption(title, artist, album, durationSec, isrc);
            if (lrcRedOption) return [lrcRedOption];
        }

        // 2) Apple Music (binimum TTML cache). If it answers, return immediately.
        if (enabled.includes('apple')) {
            const appleOptions = await this.fetchAppleTtmlOptions(
                title, artist, cleanTitle, cleanArtist, cleanAlbum, durationSec, isrc,
            );
            if (appleOptions.length > 0) {
                console.log('[AppleWordLyrics] options ready (apple):', appleOptions.length, cleanTitle, '/', cleanArtist);
                return appleOptions;
            }
        }

        // 3) One combined KPoe request over the enabled sources, in preference order.
        const enabledKpoeSources = enabled
            .map(sourceId => getLyricsSourceMeta(sourceId)?.kpoeSource)
            .filter((source): source is string => Boolean(source));

        // Broaden coverage like am-lyrics: append its extra KPoe providers that we don't
        // surface as toggles, so KPoe still has them to fall back on. Deduped, in order.
        const kpoeSourceList = enabledKpoeSources.length > 0
            ? [...new Set([...enabledKpoeSources, ...this.EXTRA_KPOE_SOURCES])]
            : [];
        const kpoeSourceOrder = kpoeSourceList.join(',');

        if (kpoeSourceOrder) {
            const kpoeOption = await this.fetchCombinedKpoeOption(
                kpoeSourceOrder, title, artist, cleanTitle, cleanArtist, cleanAlbum, durationSec,
            );
            if (kpoeOption) {
                console.log('[AppleWordLyrics] options ready (kpoe):', kpoeOption.sourceId, cleanTitle, '/', cleanArtist);
                return [kpoeOption];
            }
        }

        console.log('[AppleWordLyrics] options ready: 0', cleanTitle, '/', cleanArtist);
        return [];
    }

    async searchWordLyrics(title: string, artist: string, album?: string, durationSec?: number, isrc?: string, sources?: LyricsSourceId[]): Promise<KaraokeLyricsJSON | null> {
        const options = await this.searchWordLyricsOptions(title, artist, album, durationSec, isrc, sources);
        return options[0]?.payload ?? null;
    }
}

export const appleWordLyricsService = new AppleWordLyricsService();
