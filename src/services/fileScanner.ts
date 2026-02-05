/**
 * FileScanner - Local music file discovery service
 * 
 * Scans device storage for audio files and extracts metadata.
 * Uses expo-music-info-2 for ID3 tag extraction including artwork.
 */

import * as MediaLibrary from 'expo-media-library';
import { MusicInfo } from 'expo-music-info-2';
import { ScanProgress, Track } from '../types/audio';

// Supported audio formats
const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'flac', 'wav', 'ogg', 'opus', 'aac', 'wma'];

export interface ScanResult {
    tracks: Track[];
    errors: string[];
    duration: number; // ms
}

export type ScanProgressCallback = (progress: ScanProgress) => void;

/**
 * Request media library permissions
 */
export async function requestPermissions(): Promise<boolean> {
    const { status } = await MediaLibrary.requestPermissionsAsync();

    if (status !== 'granted') {
        console.warn('[FileScanner] Permission denied');
        return false;
    }

    console.log('[FileScanner] Permission granted');
    return true;
}

/**
 * Check if permissions are granted
 */
export async function hasPermissions(): Promise<boolean> {
    const { status } = await MediaLibrary.getPermissionsAsync();
    return status === 'granted';
}

/**
 * Generate a unique ID for a track
 */
function generateTrackId(uri: string): string {
    let hash = 0;
    for (let i = 0; i < uri.length; i++) {
        const char = uri.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return `track_${Math.abs(hash).toString(16)}`;
}

/**
 * Extract ID3 metadata from audio file using expo-music-info-2
 */
async function extractMetadata(uri: string): Promise<{
    title?: string;
    artist?: string;
    album?: string;
    artwork?: string;
    year?: number;
    trackNumber?: number;
    genre?: string;
}> {
    try {
        // expo-music-info-2 expects a file:// URI
        const fileUri = uri.startsWith('file://') ? uri : `file://${uri}`;

        const metadata = await MusicInfo.getMusicInfoAsync(fileUri, {
            title: true,
            artist: true,
            album: true,
            genre: true,
            picture: true, // This gets the artwork
        });

        if (!metadata) {
            return {};
        }

        // Artwork comes as base64, we need to save it or use it directly
        let artworkUri: string | undefined;
        if (metadata.picture?.pictureData) {
            // Create a data URI from the base64 picture
            artworkUri = `data:image/jpeg;base64,${metadata.picture.pictureData}`;
        }

        return {
            title: metadata.title || undefined,
            artist: metadata.artist || undefined,
            album: metadata.album || undefined,
            artwork: artworkUri,
            genre: metadata.genre || undefined,
        };
    } catch (error) {
        console.warn(`[FileScanner] Metadata extraction failed for ${uri}:`, error);
        return {};
    }
}

/**
 * Convert MediaLibrary asset to our Track type with metadata extraction
 */
async function assetToTrack(asset: MediaLibrary.Asset): Promise<Track> {
    const filename = asset.filename || 'Unknown';
    const titleFromFilename = filename.replace(/\.[^/.]+$/, '');

    // Try to extract metadata from the file
    const metadata = await extractMetadata(asset.uri);

    return {
        id: generateTrackId(asset.uri),
        uri: asset.uri,
        title: metadata.title || titleFromFilename,
        artist: metadata.artist || 'Unknown Artist',
        album: metadata.album || 'Unknown Album',
        artwork: metadata.artwork,
        duration: (asset.duration || 0) * 1000,
        dateAdded: new Date(asset.creationTime).getTime(),
        year: metadata.year,
        trackNumber: metadata.trackNumber,
        genre: metadata.genre,
    };
}

/**
 * Scan device for audio files using MediaLibrary
 */
export async function scanMusicLibrary(
    onProgress?: ScanProgressCallback
): Promise<ScanResult> {
    const startTime = Date.now();
    const tracks: Track[] = [];
    const errors: string[] = [];

    const hasPerms = await hasPermissions();
    if (!hasPerms) {
        const granted = await requestPermissions();
        if (!granted) {
            return { tracks: [], errors: ['Permission denied'], duration: 0 };
        }
    }

    try {
        console.log('[FileScanner] Starting scan with metadata extraction...');

        let hasNextPage = true;
        let endCursor: string | undefined;
        let totalScanned = 0;
        let pageCount = 0;

        while (hasNextPage) {
            const result = await MediaLibrary.getAssetsAsync({
                mediaType: MediaLibrary.MediaType.audio,
                first: 50, // Smaller batch for metadata extraction
                after: endCursor,
                sortBy: [[MediaLibrary.SortBy.creationTime, false]],
            });

            pageCount++;

            // Process assets in parallel with a limit
            const batchPromises = result.assets
                .filter(asset => {
                    const ext = asset.filename?.split('.').pop()?.toLowerCase();
                    return ext && AUDIO_EXTENSIONS.includes(ext);
                })
                .map(async (asset) => {
                    try {
                        const track = await assetToTrack(asset);
                        return track;
                    } catch (error) {
                        errors.push(`Error processing ${asset.filename}: ${error}`);
                        return null;
                    }
                });

            const batchTracks = await Promise.all(batchPromises);

            for (const track of batchTracks) {
                if (track) {
                    tracks.push(track);
                }
                totalScanned++;

                if (onProgress && totalScanned % 5 === 0) {
                    onProgress({
                        total: result.totalCount,
                        scanned: totalScanned,
                        currentPath: track?.title || '',
                    });
                }
            }

            hasNextPage = result.hasNextPage;
            endCursor = result.endCursor;

            console.log(`[FileScanner] Page ${pageCount}: ${result.assets.length} assets, tracks with metadata: ${tracks.length}`);
        }

        const duration = Date.now() - startTime;
        console.log(`[FileScanner] Complete. Found ${tracks.length} tracks with metadata in ${duration}ms`);

        return { tracks, errors, duration };

    } catch (error) {
        console.error('[FileScanner] Scan error:', error);
        return {
            tracks,
            errors: [...errors, `Scan error: ${error}`],
            duration: Date.now() - startTime
        };
    }
}

/**
 * Get total audio file count without full scan
 */
export async function getAudioFileCount(): Promise<number> {
    const hasPerms = await hasPermissions();
    if (!hasPerms) return 0;

    try {
        const result = await MediaLibrary.getAssetsAsync({
            mediaType: MediaLibrary.MediaType.audio,
            first: 1,
        });
        return result.totalCount;
    } catch {
        return 0;
    }
}
