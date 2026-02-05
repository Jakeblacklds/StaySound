/**
 * LyricsService - Parser and synchronization for LRC lyrics
 */

export interface LyricLine {
    time: number; // ms
    text: string;
}

export interface LyricsData {
    lines: LyricLine[];
    metadata: {
        title?: string;
        artist?: string;
        album?: string;
        offset?: number;
    };
}

/**
 * Parse a raw LRC string into a structured object
 */
export function parseLRC(rawLrc: string): LyricsData {
    const lines: LyricLine[] = [];
    const metadata: any = {};

    // Pattern for lyrics: [mm:ss.xx]Text
    const linePattern = /^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/;
    // Pattern for metadata: [key:value]
    const metaPattern = /^\[([a-z]+):(.*)\]$/i;

    const rawLines = rawLrc.split(/\r?\n/);

    for (const rawLine of rawLines) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;

        const lineMatch = trimmed.match(linePattern);
        if (lineMatch) {
            const minutes = parseInt(lineMatch[1], 10);
            const seconds = parseInt(lineMatch[2], 10);
            const hundredths = parseInt(lineMatch[3], 10);
            const text = lineMatch[4].trim();

            // Convert to ms. Hundredths depend on 2 or 3 digits
            const msFactor = lineMatch[3].length === 3 ? 1 : 10;
            const time = (minutes * 60 * 1000) + (seconds * 1000) + (hundredths * msFactor);

            lines.push({ time, text });
            continue;
        }

        const metaMatch = trimmed.match(metaPattern);
        if (metaMatch) {
            const key = metaMatch[1].toLowerCase();
            const value = metaMatch[2].trim();
            metadata[key] = value;
        }
    }

    // Sort by time just in case
    lines.sort((a, b) => a.time - b.time);

    return { lines, metadata };
}

/**
 * Find the active lyric line for a given timestamp
 */
export function getActiveLyricIndex(lines: LyricLine[], currentTimeMs: number): number {
    if (lines.length === 0) return -1;
    if (currentTimeMs < lines[0].time) return -1;

    for (let i = 0; i < lines.length; i++) {
        if (currentTimeMs < lines[i].time) {
            return i - 1;
        }
    }

    return lines.length - 1;
}

/**
 * Sample LRC for testing
 */
export const SAMPLE_LRC = `
[ti:Sample Song]
[ar:StaySound Artist]
[al:StaySound Album]
[00:00.00]StaySound - Premium Music Experience
[00:02.00]This is how synchronized lyrics look
[00:05.50]They flow smoothly with your music
[00:09.00]Transitions are handled with Reanimated
[00:12.50]Making every song feel alive
[00:16.00]Enjoy your music with StaySound
[00:20.00]...
`;
