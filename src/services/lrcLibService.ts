import type { KaraokeLyricsJSON, KaraokeWordRaw } from '../types/karaokeTypes';
import { fetchLyricsFromLrclib, type LrclibLine } from './lrclibLookup';

/** Convert shared millisecond timings to the native karaoke document (seconds). */
export function lrclibLinesToKaraoke(lines: LrclibLine[], title: string, artist: string, duration = 0): KaraokeLyricsJSON | null {
    const lyrics: KaraokeWordRaw[] = [];
    for (const line of lines) {
        // Plain lyrics have no timing and cannot drive the native karaoke timeline.
        if (line.endtime <= line.timestamp) continue;
        const fragments: KaraokeWordRaw[] = [];
        for (const [parts, background] of [[line.text, false], [line.backgroundText, true]] as const) {
            for (let index = 0; index < parts.length; index++) {
                const part = parts[index];
                const text = part.text.replace(/\s+/g, ' ').trim();
                if (!text) continue;
                fragments.push({
                    w: text,
                    s: (part.timestamp ?? line.timestamp) / 1000,
                    e: (part.endtime ?? line.endtime) / 1000,
                    n: false,
                    sp: /\s$/.test(part.text),
                    bg: background,
                    p: index > 0 && Boolean(parts[index - 1].part) && !/\s$/.test(parts[index - 1].text),
                });
            }
        }
        if (fragments.length) {
            fragments[fragments.length - 1].n = true;
            lyrics.push(...fragments);
        }
    }
    return lyrics.length ? {
        meta: { song: title, artist, total_duration: Math.max(duration, ...lyrics.map(word => word.e)) },
        lyrics,
    } : null;
}

class LrcLibService {
    async fetchLyrics(title: string, artist: string, duration?: number, album?: string): Promise<KaraokeLyricsJSON | null> {
        const source = await fetchLyricsFromLrclib({ title, artist, album, durationMs: duration ? duration * 1000 : undefined });
        return source ? lrclibLinesToKaraoke(source.lines, title, artist, duration) : null;
    }
}

export const lrcLibService = new LrcLibService();
