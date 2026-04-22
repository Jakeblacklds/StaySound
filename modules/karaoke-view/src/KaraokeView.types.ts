import type { ViewProps } from 'react-native';

export type KaraokeMotionProfile = 'ambient' | 'pulse' | 'fire' | 'velvet' | 'cosmic';

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

    /** Background color of the player — used to tint the ambient background orbs */
    backgroundColor?: any;

    /** Enables the slow animated orb background behind the lyrics (default: true) */
    enableAmbientBackground?: boolean;

    /** Whether to highlight the entire line instantly (LRCLIB mode) */
    isLineByLine?: boolean;

    /** Enables tap-to-seek behavior when touching lyrics */
    enableSeekOnTap?: boolean;

    /** Enables the suspended shimmer particles around the active lyric sweep */
    enableSpectralParticles?: boolean;

    /** Selects the visual ambience profile used around the lyric sweep */
    motionProfile?: KaraokeMotionProfile;

    /** Optional intro song title shown before first sung line */
    introTitle?: string;

    /** Optional intro artist/subtitle shown before first sung line */
    introSubtitle?: string;

    /** Called when active line changes */
    onLineChange?: (event: { nativeEvent: { lineIndex: number } }) => void;

    /** Called when active word changes */
    onWordChange?: (event: { nativeEvent: { lineIndex: number; wordIndex: number } }) => void;

    /** Called when user taps a line to seek */
    onSeek?: (event: { nativeEvent: { timeMs: number } }) => void;
}
