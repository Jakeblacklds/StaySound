/**
 * MetadataService - Audio file metadata extraction
 * 
 * Extracts ID3 tags, album art, and other metadata from audio files.
 * Uses react-native-music-metadata for tag parsing.
 */

import { Album, Artist, Track } from '../types/audio';

// Note: react-native-music-metadata requires native module
// For now, we'll use filename-based parsing as fallback

/**
 * Parse artist and title from filename
 * Handles common formats: "Artist - Title.mp3", "01 Title.mp3", etc.
 */
export function parseFilename(filename: string): { title: string; artist: string } {
    // Remove extension
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');

    // Try "Artist - Title" format
    if (nameWithoutExt.includes(' - ')) {
        const parts = nameWithoutExt.split(' - ');
        if (parts.length >= 2) {
            return {
                artist: parts[0].trim(),
                title: parts.slice(1).join(' - ').trim(),
            };
        }
    }

    // Try to remove track number prefix
    const withoutTrackNum = nameWithoutExt.replace(/^\d+[\s._-]*/, '');

    return {
        title: withoutTrackNum || nameWithoutExt,
        artist: 'Unknown Artist',
    };
}

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
    const combined = `${albumName.toLowerCase()}_${artistName.toLowerCase()}`;
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
    const name = artistName.toLowerCase();
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
        } else {
            albums.set(albumId, {
                id: albumId,
                name: track.album,
                artist: track.artist,
                artistId: generateArtistId(track.artist),
                artwork: track.artwork,
                year: track.year,
                trackCount: 1,
                tracks: [track.id],
            });
        }
    }

    return albums;
}

/**
 * Organize tracks into artists
 */
export function organizeIntoArtists(tracks: Track[], albums: Map<string, Album>): Map<string, Artist> {
    const artists = new Map<string, Artist>();

    for (const track of tracks) {
        const artistId = generateArtistId(track.artist);

        if (artists.has(artistId)) {
            const artist = artists.get(artistId)!;
            artist.trackCount++;

            // Add album if not already included
            const albumId = generateAlbumId(track.album, track.artist);
            if (!artist.albums.includes(albumId)) {
                artist.albums.push(albumId);
                artist.albumCount++;
            }
        } else {
            const albumId = generateAlbumId(track.album, track.artist);
            artists.set(artistId, {
                id: artistId,
                name: track.artist,
                albumCount: 1,
                trackCount: 1,
                albums: [albumId],
            });
        }
    }

    return artists;
}

/**
 * Update track metadata from parsed filename
 */
export function enrichTrackFromFilename(track: Track, filename: string): Track {
    const parsed = parseFilename(filename);

    return {
        ...track,
        title: track.title === filename.replace(/\.[^/.]+$/, '') ? parsed.title : track.title,
        artist: track.artist === 'Unknown Artist' ? parsed.artist : track.artist,
    };
}
