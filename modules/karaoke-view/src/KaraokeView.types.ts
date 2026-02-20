import type { ViewProps } from 'react-native';

/**
 * Raw lyric word format from JSON
 */
export interface LyricWordRaw {
    w: string;   // word text
    s: number;   // start time in SECONDS
    e: number;   // end time in SECONDS
    n: boolean;  // true = newline after this word
}

/**
 * Full lyrics JSON structure
 */
export interface LyricsJSON {
    meta: {
        song: string;
        artist: string;
        total_duration: number;
    };
    lyrics: LyricWordRaw[];
}

/**
 * Props for the native KaraokeView component
 */
export interface KaraokeViewProps extends ViewProps {
    /** Raw lyrics array - parsed in Kotlin */
    lyrics: LyricWordRaw[];

    /** Current playback position in milliseconds */
    currentTimeMs: number;

    /** Whether playback is active (prevents drift when paused) */
    isPlaying?: boolean;

    /** Optional font size override */
    fontSize?: number;

    /** Primary color for active lyrics */
    activeColor?: any;

    /** Color for inactive lyrics */
    inactiveColor?: any;

    /** Color for the glow effect */
    glowColor?: any;

    /** Whether to highlight the entire line instantly (LRCLIB mode) */
    isLineByLine?: boolean;

    /** Called when active line changes */
    onLineChange?: (event: { nativeEvent: { lineIndex: number } }) => void;

    /** Called when active word changes */
    onWordChange?: (event: { nativeEvent: { lineIndex: number; wordIndex: number } }) => void;

    /** Called when user taps a line to seek */
    onSeek?: (event: { nativeEvent: { timeMs: number } }) => void;
}
