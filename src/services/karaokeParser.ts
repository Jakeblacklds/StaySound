/**
 * Karaoke Parser - Simple parser for word-level lyrics
 */

import type {
    KaraokeData,
    KaraokeLine,
    KaraokeLyricsJSON,
    KaraokeWord
} from '../types/karaokeTypes';

/**
 * Parse raw JSON into structured karaoke data
 */
export function parseKaraokeLyrics(json: KaraokeLyricsJSON): KaraokeData {
    const words: KaraokeWord[] = [];
    const lines: KaraokeLine[] = [];

    let currentLineWords: KaraokeWord[] = [];
    let lineStart = Infinity;
    let lineEnd = 0;

    json.lyrics.forEach((raw, index) => {
        const word: KaraokeWord = {
            text: raw.w,
            startSec: raw.s,
            endSec: raw.e,
            isNewLine: raw.n,
            index,
        };

        words.push(word);
        currentLineWords.push(word);

        lineStart = Math.min(lineStart, raw.s);
        lineEnd = Math.max(lineEnd, raw.e);

        // End of line
        if (raw.n) {
            lines.push({
                words: [...currentLineWords],
                startSec: lineStart,
                endSec: lineEnd,
            });
            currentLineWords = [];
            lineStart = Infinity;
            lineEnd = 0;
        }
    });

    // Handle last line if no trailing newline
    if (currentLineWords.length > 0) {
        lines.push({
            words: [...currentLineWords],
            startSec: lineStart,
            endSec: lineEnd,
        });
    }

    return {
        meta: {
            song: json.meta.song,
            artist: json.meta.artist,
            totalDuration: json.meta.total_duration,
            offset: json.meta.offset ?? 0,
        },
        words,
        lines,
    };
}

/**
 * Find active line index at given time
 */
export function findActiveLineIndex(lines: KaraokeLine[], timeSec: number): number {
    if (lines.length === 0) return -1;
    if (timeSec < lines[0].startSec) return 0;

    for (let i = 0; i < lines.length; i++) {
        if (timeSec >= lines[i].startSec && timeSec <= lines[i].endSec) {
            return i;
        }
        if (i + 1 < lines.length && timeSec < lines[i + 1].startSec) {
            return i;
        }
    }

    return lines.length - 1;
}

/**
 * Calculate word fill progress (0 to 1)
 * 0 = not started, 1 = complete
 */
export function getWordProgress(word: KaraokeWord, timeSec: number): number {
    'worklet';
    if (timeSec < word.startSec) return 0;
    if (timeSec >= word.endSec) return 1;
    return (timeSec - word.startSec) / (word.endSec - word.startSec);
}
