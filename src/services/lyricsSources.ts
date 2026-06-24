/**
 * Lyrics source registry — the single source of truth for which providers the
 * app can pull lyrics from, how to query each one, and how to label it in the UI.
 *
 * - `apple` is the Apple Music word-by-word path (binimum TTML cache).
 * - `lyricsplus` / `musixmatch` / `spotify` are KPoe (LyricsPlus backend) sources,
 *   queried one source at a time so we can offer "una versión por fuente".
 * - `lrclib` is the line-level LRC fallback (handled by the repository layer).
 */

export type LyricsSourceId = 'apple' | 'lyricsplus' | 'musixmatch' | 'spotify' | 'lrclib';

export interface LyricsSourceMeta {
    id: LyricsSourceId;
    /** Human-facing provider name shown in the picker and settings. */
    label: string;
    /** MaterialCommunityIcons glyph used in the settings toggles. */
    icon: string;
    /** KPoe `source` query value. Absent for non-KPoe sources (apple, lrclib). */
    kpoeSource?: string;
    /** Typical timing granularity, used only for the UI hint. */
    granularity: 'word' | 'line';
}

/**
 * Ordered by preference: the first source that returns lyrics becomes the default
 * selection, the rest stay available in the picker.
 */
export const LYRICS_SOURCES: LyricsSourceMeta[] = [
    { id: 'apple', label: 'Apple Music', icon: 'apple', granularity: 'word' },
    { id: 'lyricsplus', label: 'LyricsPlus', icon: 'text-box-multiple-outline', kpoeSource: 'lyricsplus', granularity: 'word' },
    { id: 'musixmatch', label: 'Musixmatch', icon: 'music-box-outline', kpoeSource: 'musixmatch', granularity: 'word' },
    { id: 'spotify', label: 'Spotify', icon: 'spotify', kpoeSource: 'spotify', granularity: 'line' },
    { id: 'lrclib', label: 'LRCLIB', icon: 'file-music-outline', granularity: 'line' },
];

export const DEFAULT_LYRICS_SOURCE_IDS: LyricsSourceId[] = LYRICS_SOURCES.map(source => source.id);

const SOURCE_BY_ID = new Map<LyricsSourceId, LyricsSourceMeta>(
    LYRICS_SOURCES.map(source => [source.id, source]),
);

export function getLyricsSourceMeta(id: LyricsSourceId): LyricsSourceMeta | undefined {
    return SOURCE_BY_ID.get(id);
}

export function getLyricsSourceLabel(id?: LyricsSourceId | null): string {
    if (!id) return '';
    return SOURCE_BY_ID.get(id)?.label ?? id;
}

/** Keep only known ids, in the registry's preferred order, de-duplicated. */
export function sanitizeLyricsSourceIds(ids?: LyricsSourceId[] | null): LyricsSourceId[] {
    if (!Array.isArray(ids)) return [...DEFAULT_LYRICS_SOURCE_IDS];
    const requested = new Set(ids.filter(id => SOURCE_BY_ID.has(id)));
    const ordered = DEFAULT_LYRICS_SOURCE_IDS.filter(id => requested.has(id));
    return ordered.length > 0 ? ordered : [...DEFAULT_LYRICS_SOURCE_IDS];
}
