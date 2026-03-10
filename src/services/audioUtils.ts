/**
 * Audio Utilities
 */

/**
 * Parse filename to extract artist, album and title
 * Handles formats like: 
 * - "Artist - Album - Title.mp3"
 * - "Artist - Title.mp3"
 * - "01 Title.mp3"
 */
export function parseFilename(filename: string): { title: string; artist: string; album: string } {
    if (!filename) {
        return { title: 'Unknown Title', artist: 'Unknown Artist', album: 'Unknown Album' };
    }

    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');

    // Split only on " - " / " — " / " – " (dash WITH spaces on both sides)
    // Important: We require spaces to avoid splitting hyphens in artist names like "Jay-Z", "Run-DMC"
    const parts = nameWithoutExt.split(/ [-—–] /).map(p => p.trim()).filter(Boolean);

    // Case 1: "Artist - Album - Title" (preferred for Tidal downloads)
    if (parts.length >= 3) {
        return {
            artist: parts[0],
            album: parts[1],
            title: parts.slice(2).join(' - '),
        };
    }

    // Case 2: "Artist - Title"
    if (parts.length === 2) {
        // Check if first part is just a track number (e.g. "01 Title")
        if (/^\d+$/.test(parts[0])) {
            return {
                artist: 'Unknown Artist',
                album: 'Unknown Album',
                title: parts[1],
            };
        }

        // This is the common case for many external files
        return {
            artist: parts[0],
            title: parts[1],
            album: 'Unknown Album',
        };
    }

    // Case 3: Single part (Title or "TrackNum Title")
    // Remove track number prefix like "01 " or "1. " or "01 - "
    const titleOnly = nameWithoutExt
        .replace(/^\d+[\s._-]*/, '')
        .replace(/^[-—–\s]+/, '')
        .trim();

    return {
        title: titleOnly || nameWithoutExt,
        artist: 'Unknown Artist',
        album: 'Unknown Album',
    };
}

/**
 * Clean up a string for use as a filename
 */
export function sanitizeFilename(input: string): string {
    return input
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
}

/**
 * Get format (extension) from URI or filename
 */
export function getFormatFromUri(uri: string): string | undefined {
    const match = uri.toLowerCase().match(/\.([a-z0-9]+)(\?|$)/);
    if (!match) return undefined;
    return match[1].toUpperCase();
}
