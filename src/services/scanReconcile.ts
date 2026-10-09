import { sanitizeFilename } from './audioUtils';
import { enrichTrackFromUri } from './metadataService';
import type { Track } from '../types/audio';

/**
 * Pure scan reconciliation: how freshly scanned files are matched to what the library already knows.
 * Kept free of React Native imports so the Kotlin port (android-core ScanReconciler) can be checked against
 * this exact code with generated golden fixtures (scripts/generate-scan-golden.ts).
 */

const GENERIC_LIBRARY_VALUES = new Set(['unknown', 'unknown title', 'unknown artist', 'unknown album', 'media', 'external', 'staysound']);

export const hasMeaningfulLibraryValue = (value?: string) => {
    const normalized = value?.trim().toLowerCase();
    return !!normalized && !GENERIC_LIBRARY_VALUES.has(normalized);
};

export const isMediaStoreAlbumArtUri = (uri?: string) =>
    typeof uri === 'string' && uri.startsWith('content://media/external/audio/albumart/');

const normalizePathForJunkCheck = (value?: string) =>
    decodeURIComponent(value ?? '').toLowerCase().replace(/\\/g, '/');

const isCacheDownloadUri = (uri?: string) => {
    const normalized = normalizePathForJunkCheck(uri);
    return normalized.includes('/cache/staysound/downloads/')
        || (normalized.includes('/android/data/') && normalized.includes('/cache/'));
};

export const isLikelyJunkStaySoundTrack = (track: Track) => {
    const combined = [
        track.uri,
        track.relativePath,
        track._filename,
    ].map(normalizePathForJunkCheck).join('/');

    const looksLikeStaySound = combined.includes('staysound') || track.source === 'tidal';
    if (!looksLikeStaySound) return false;
    if (isCacheDownloadUri(track.uri) || isCacheDownloadUri(track.relativePath)) return true;

    const looksLikeAudio = /\.(flac|mp3|m4a|aac|wav|ogg|opus)(?:$|\?)/i.test(track._filename ?? track.uri ?? '');
    return looksLikeAudio && (track.duration ?? 0) <= 0;
};

export const resolveArtworkFromScan = (scannedArtwork?: string, existingArtwork?: string) => {
    if (!existingArtwork) return scannedArtwork;
    if (!scannedArtwork) return existingArtwork;
    if (isMediaStoreAlbumArtUri(scannedArtwork) && !isMediaStoreAlbumArtUri(existingArtwork)) {
        return existingArtwork;
    }
    return scannedArtwork;
};

/**
 * Filename -> existing track lookup.
 * WHY: Downloaded tracks use SAF URIs (content://com.android.externalstorage.documents/...)
 * but MediaStore gives the SAME file a completely different URI (content://media/external/...).
 * So matching by URI never works. Matching by filename (without extension) is reliable.
 */
export function buildExistingByFilename(currentTracks: Iterable<Track>): Map<string, Track> {
    const existingByFilename = new Map<string, Track>();
    for (const t of currentTracks) {
        if (!t.uri) continue;

        // Strategy 1: extract the filename from the URI (works for SAF URIs).
        const uriFilename = decodeURIComponent(t.uri)
            .split('/').pop()
            ?.replace(/\.[^/.]+$/, '')
            ?.toLowerCase()
            .trim();
        if (uriFilename && uriFilename.length > 5 && !/^\d+$/.test(uriFilename)) {
            // Reject pure numeric strings like "12345" (MediaStore IDs)
            existingByFilename.set(uriFilename, t);
        }

        // Strategy 2: reconstruct the expected filename from metadata (covers Tidal downloads).
        if (t.artist && t.album && t.title
            && t.artist !== 'Unknown Artist' && t.album !== 'Unknown Album') {
            const reconstructed = sanitizeFilename(`${t.artist} - ${t.album} - ${t.title}`)
                .toLowerCase()
                .trim();
            if (reconstructed) existingByFilename.set(reconstructed, t);
        }
    }
    return existingByFilename;
}

/** Returns the track to store for one scanned file, or null when it is junk. */
export function reconcileScannedTrack(track: Track, existingByFilename: Map<string, Track>): Track | null {
    if (isLikelyJunkStaySoundTrack(track)) return null;

    const enrichmentSource = track._filename || track.uri;
    const enriched = enrichTrackFromUri(track, enrichmentSource);
    if (isLikelyJunkStaySoundTrack(enriched)) return null;

    // MediaStore URIs like content://media/external/audio/media/12345 do not contain the file name, so prefer
    // _filename (MediaStore DISPLAY_NAME) and fall back to the decoded URI (SAF URIs).
    const rawFilenameSource = track._filename
        || decodeURIComponent(track.uri).split('/').pop()
        || '';
    const filenameKey = rawFilenameSource
        .replace(/\.[^/.]+$/, '')
        .toLowerCase()
        .trim();

    const existingTrack = filenameKey ? existingByFilename.get(filenameKey) : undefined;
    if (!existingTrack) return enriched;

    // Found a match by filename -> restore metadata from the stored track.
    // The stored title/artist/album win: MediaStore often reports the full filename as the title and the folder
    // name as the album for untagged files. Good Tidal artwork is protected from generic MediaStore albumart.
    const resolvedArtwork = resolveArtworkFromScan(enriched.artwork, existingTrack.artwork);
    const resolvedArtworkThumb = resolvedArtwork === existingTrack.artwork
        ? existingTrack.artworkThumb
        : undefined;

    return {
        ...enriched,
        title: hasMeaningfulLibraryValue(existingTrack.title) ? existingTrack.title : enriched.title,
        artist: hasMeaningfulLibraryValue(existingTrack.artist) ? existingTrack.artist : enriched.artist,
        album: hasMeaningfulLibraryValue(existingTrack.album) ? existingTrack.album : enriched.album,
        artwork: resolvedArtwork,
        artworkThumb: resolvedArtworkThumb,
        year: enriched.year || existingTrack.year,
        trackNumber: enriched.trackNumber || existingTrack.trackNumber,
        genre: enriched.genre || existingTrack.genre,
        quality: enriched.quality || existingTrack.quality,
        sampleRate: enriched.sampleRate || existingTrack.sampleRate,
        bitDepth: enriched.bitDepth || existingTrack.bitDepth,
        codec: enriched.codec || existingTrack.codec,
        source: enriched.source || existingTrack.source,
        tidalId: enriched.tidalId || existingTrack.tidalId,
        tidalAlbumId: enriched.tidalAlbumId || existingTrack.tidalAlbumId,
        favorite: existingTrack.favorite,
    };
}
