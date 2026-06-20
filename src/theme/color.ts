/**
 * Color helpers shared across the app.
 *
 * `withAlpha` was previously copy-pasted into half a dozen screens
 * (tidal.tsx, tidal-album, tidal-artist, tidal-genre, TidalTrackRow…).
 * This is the single canonical implementation — import it from '@/src/theme'.
 */

/**
 * Append an 8-bit alpha channel (2-digit hex, e.g. 'CC') to a hex color.
 * Non-hex colors (named, rgb(), already-aliased) are returned unchanged so
 * callers can pass theme tokens blindly.
 */
export function withAlpha(color: string, alphaHex: string): string {
    if (!color || !color.startsWith('#')) return color;
    const hex = color.slice(1);
    if (hex.length === 6) return `#${hex}${alphaHex}`;
    if (hex.length === 8) return `#${hex.slice(0, 6)}${alphaHex}`;
    return color;
}
