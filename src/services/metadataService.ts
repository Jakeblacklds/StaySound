/**
 * MetadataService - Audio file metadata extraction and organization
 */

import { Album, Artist, Track } from '../types/audio';
import { parseFilename } from './audioUtils';

/**
 * Format duration from milliseconds to mm:ss
 */
export function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Format duration to long format (1h 23m 45s)
 */
export function formatDurationLong(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}

/**
 * Generate unique ID for album based on name and artist
 */
export function generateAlbumId(albumName: string, artistName: string): string {
    const album = (albumName || 'Unknown Album').toLowerCase();
    const artist = (artistName || 'Unknown Artist').toLowerCase();
    const combined = `${album}_${artist}`;
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
        hash = ((hash << 5) - hash) + combined.charCodeAt(i);
        hash = hash & hash;
    }
    return `album_${Math.abs(hash).toString(16)}`;
}

/**
 * Generate unique ID for artist
 */
export function generateArtistId(artistName: string): string {
    const name = (artistName || 'Unknown Artist').toLowerCase();
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) - hash) + name.charCodeAt(i);
        hash = hash & hash;
    }
    return `artist_${Math.abs(hash).toString(16)}`;
}

/**
 * Organize tracks into albums
 */
export function organizeIntoAlbums(tracks: Track[]): Map<string, Album> {
    const albums = new Map<string, Album>();

    for (const track of tracks) {
        const albumId = generateAlbumId(track.album, track.artist);

        if (albums.has(albumId)) {
            const album = albums.get(albumId)!;
            album.tracks.push(track.id);
            album.trackCount++;

            // If album doesn't have artwork yet, try to take it from this track
            if (!album.artwork && track.artwork) {
                album.artwork = track.artwork;
            }
            if (!album.artworkThumb && track.artworkThumb) {
                album.artworkThumb = track.artworkThumb;
            }
        } else {
            albums.set(albumId, {
                id: albumId,
                name: track.album,
                artist: track.artist,
                artistId: generateArtistId(track.artist),
                artwork: track.artwork,
                artworkThumb: track.artworkThumb,
                year: track.year,
                trackCount: 1,
                tracks: [track.id],
            });
        }
    }

    return albums;
}

/**
 * Organize tracks into artists.
 *
 * Artist artwork should come from a dedicated API (e.g. Deezer) via
 * refreshArtistPhotos, NOT from track/album covers. When an optional
 * `existingArtists` map is supplied, previously-fetched remote artwork
 * (https:// URLs) is preserved across rebuilds so Deezer photos are
 * not overwritten by album covers.
 */
export function organizeIntoArtists(
    tracks: Track[],
    existingArtists?: Map<string, Artist>,
): Map<string, Artist> {
    const artists = new Map<string, Artist>();

    for (const track of tracks) {
        const artistId = generateArtistId(track.artist);
        const albumId = generateAlbumId(track.album, track.artist);

        if (artists.has(artistId)) {
            const artist = artists.get(artistId)!;
            artist.trackCount++;

            // Add album if not already included
            if (!artist.albums.includes(albumId)) {
                artist.albums.push(albumId);
                artist.albumCount++;
            }
        } else {
            // Preserve existing remote artwork (Deezer artist photo) if available
            const existingArtwork = existingArtists?.get(artistId)?.artwork;
            const preservedArtwork =
                (typeof existingArtwork === 'string' && existingArtwork.startsWith('https://'))
                    ? existingArtwork
                    : undefined;

            artists.set(artistId, {
                id: artistId,
                name: track.artist,
                artwork: preservedArtwork,
                albumCount: 1,
                trackCount: 1,
                albums: [albumId],
            });
        }
    }

    return artists;
}

/**
 * Update track metadata from parsed filename and folder structure
 */
export function enrichTrackFromUri(track: Track, uri: string): Track {
    const filename = uri.split('/').pop() || '';
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
    const parsed = parseFilename(filename);

    // Get parent directory name as potential album name
    const pathParts = uri.split('/');
    const parentFolder = pathParts.length > 2 ? pathParts[pathParts.length - 2] : null;

    const genericParentFolders = new Set([
        '0', 'download', 'downloads', 'music', 'musica', 'música', 'audio', 'documents', 'documentos', 'staysound', 'media', 'external'
    ]);

    return {
        ...track,
        title: (track.title === nameWithoutExt || track.title === 'Unknown' || track.title === 'Unknown Title') ? parsed.title : track.title,
        artist: (track.artist === 'Unknown Artist' || track.artist === 'Unknown') ? parsed.artist : track.artist,
        album: (track.album === 'Unknown Album' || track.album === 'Unknown')
            ? (parsed.album !== 'Unknown Album' ? parsed.album : (parentFolder && !genericParentFolders.has(parentFolder.toLowerCase()) ? decodeURIComponent(parentFolder) : 'Unknown Album'))
            : track.album,
    };
}

/**
 * Update track metadata from parsed filename (Deprecated in favor of enrichTrackFromUri)
 */
export function enrichTrackFromFilename(track: Track, filename: string): Track {
    return enrichTrackFromUri(track, `file:///${filename}`);
}

