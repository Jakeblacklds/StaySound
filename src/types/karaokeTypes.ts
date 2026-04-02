/**
 * Karaoke Types - Word-level timed lyrics for karaoke effect
 */

// Raw JSON format from the file
export interface KaraokeLyricsJSON {
    meta: {
        song: string;
        artist: string;
        total_duration: number;
        offset?: number;
    };
    lyrics: KaraokeWordRaw[];
}

export interface KaraokeWordRaw {
    w: string;   // Word text
    s: number;   // Start time (seconds)
    e: number;   // End time (seconds)
    n: boolean;  // New line after this word?
    sp?: boolean; // Preserve a trailing space after this fragment
    bg?: boolean; // Background vocal / harmony fragment
    p?: boolean;  // Continuation of previous visual word
}

// Processed word with layout info
export interface KaraokeWord {
    text: string;
    startSec: number;
    endSec: number;
    isNewLine: boolean;
    index: number;  // Global word index
}

// A visual line of text
export interface KaraokeLine {
    words: KaraokeWord[];
    startSec: number;
    endSec: number;
}

// Full processed data
export interface KaraokeData {
    meta: {
        song: string;
        artist: string;
        totalDuration: number;
        offset: number;
    };
    words: KaraokeWord[];
    lines: KaraokeLine[];
}
