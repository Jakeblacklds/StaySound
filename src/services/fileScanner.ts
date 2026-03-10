/**
 * FileScanner - Local music file discovery service
 *
 * FAST MODE: Uses Android MediaStore for instant scanning
 * - Gets files from MediaStore database (pre-indexed by Android)
 * - Defers metadata extraction to when tracks are played/viewed
 * - Supports folder selection for targeted scanning
 *
 * Performance utilities:
 * - runConcurrent: concurrency-limited async pool
 * - withTimeout: per-item timeout guard
 */

import { readDirectoryAsync } from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { MusicInfo } from 'expo-music-info-2';
import { ScanProgress, Track } from '../types/audio';
import { getFormatFromUri, parseFilename } from './audioUtils';
import { extractFlacMetadata, isFlacFile } from './flacParser';
import { canUseNativeLibraryIndexer, scanMusicNative } from './nativeLibraryIndexer';

// Supported audio formats
const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'flac', 'wav', 'ogg', 'opus', 'aac', 'wma'];

export interface ScanResult {
    tracks: Track[];
    errors: string[];
    duration: number; // ms
}

export interface ScanOptions {
    /** Folder path pattern to filter (e.g., /Download/, /Music/) */
    folderPattern?: string;
    /** If true, extracts full metadata (slow). If false, uses filename parsing (fast) */
    extractMetadata?: boolean;
}

export type ScanProgressCallback = (progress: ScanProgress) => void;
export type TrackFoundCallback = (tracks: Track[]) => void;

// Common folder patterns for music
export const MUSIC_FOLDERS = {
    download: '/storage/emulated/0/Download/',
    music: '/storage/emulated/0/Music/',
    all: '', // No filter
};

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
 * FAST: Convert MediaLibrary asset to Track without metadata extraction
 * Uses filename parsing instead of reading file metadata
 */
function assetToTrackFast(asset: MediaLibrary.Asset, folderName: string): Track {
    const filename = asset.filename || 'Unknown';
    const parsed = parseFilename(filename);

    // Use parent folder as album name if not generic
    const genericFolders = ['download', 'music', 'audio', '0', 'documents', 'staysound'];
    const albumFromFolder = (parsed.album === 'Unknown Album' && !genericFolders.includes(folderName.toLowerCase()))
        ? decodeURIComponent(folderName)
        : parsed.album;

    return {
        id: generateTrackId(asset.uri),
        uri: asset.uri,
        title: parsed.title,
        artist: parsed.artist,
        album: albumFromFolder,
        artwork: undefined, // Will be loaded on-demand
        duration: (asset.duration || 0) * 1000,
        format: getFormatFromUri(asset.uri),
        dateAdded: new Date(asset.creationTime).getTime(),
        _filename: filename,  // carry original filename for filename-based matching in libraryStore
    };
}

/**
 * Extract metadata from audio file (expensive operation)
 * Uses FLAC parser for FLAC files, expo-music-info-2 for others
 */
export async function extractMetadata(uri: string): Promise<{
    title?: string;
    artist?: string;
    album?: string;
    artwork?: string;
    year?: number;
    trackNumber?: number;
    genre?: string;
    format?: string;
    sampleRate?: number;
    bitDepth?: number;
}> {
    const fileUri = (uri.startsWith('file://') || uri.startsWith('content://')) ? uri : `file://${uri}`;

    // Use FLAC parser for FLAC files
    if (isFlacFile(uri)) {
        try {
            const flacMetadata = await extractFlacMetadata(fileUri);
            if (flacMetadata) {
                return {
                    title: flacMetadata.title,
                    artist: flacMetadata.artist,
                    album: flacMetadata.album,
                    artwork: flacMetadata.picture?.pictureData,
                    genre: flacMetadata.genre,
                    year: flacMetadata.year ? parseInt(flacMetadata.year, 10) : undefined,
                    trackNumber: flacMetadata.trackNumber ? parseInt(flacMetadata.trackNumber, 10) : undefined,
                    format: flacMetadata.format ?? 'FLAC',
                    sampleRate: flacMetadata.sampleRate,
                    bitDepth: flacMetadata.bitDepth,
                };
            }
        } catch (error) {
            console.debug(`[FileScanner] FLAC parsing failed for ${uri}: ${error}`);
        }
        return {};
    }

    // Use expo-music-info-2 for other formats (MP3, M4A, etc.)
    try {
        const metadata = await MusicInfo.getMusicInfoAsync(fileUri, {
            title: true,
            artist: true,
            album: true,
            genre: true,
            picture: true,
        });

        if (!metadata) {
            return {};
        }

        return {
            title: metadata.title || undefined,
            artist: metadata.artist || undefined,
            album: metadata.album || undefined,
            artwork: metadata.picture?.pictureData,
            genre: metadata.genre || undefined,
            format: getFormatFromUri(uri),
        };
    } catch (error) {
        console.debug(`[FileScanner] ID3 extraction failed for ${uri}: ${error}`);
        return {};
    }
}

/**
 * Wrap a promise with a timeout. Resolves to null if the timeout fires first.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    return Promise.race([
        promise,
        new Promise<null>(resolve => setTimeout(() => resolve(null), ms)),
    ]);
}

/**
 * Run async tasks with a concurrency limit.
 * @param items  Array of items to process
 * @param limit  Max number of tasks running at the same time
 * @param task   Async function receiving each item
 */
export async function runConcurrent<T>(
    items: T[],
    limit: number,
    task: (item: T, index: number) => Promise<void>
): Promise<void> {
    let index = 0;

    async function worker() {
        while (index < items.length) {
            const currentIndex = index++;
            await task(items[currentIndex], currentIndex);
        }
    }

    const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
    await Promise.all(workers);
}

/**
 * Enrich a track with full metadata (call on-demand, not during scan)
 */
export async function enrichTrackWithMetadata(track: Track): Promise<Track> {
    try {
        // Get local URI for file access
        const assetInfo = await MediaLibrary.getAssetInfoAsync(track.id.replace('track_', ''));
        const uri = assetInfo?.localUri || track.uri;

        const metadata = await extractMetadata(uri);

        return {
            ...track,
            title: metadata.title || track.title,
            artist: metadata.artist || track.artist,
            album: metadata.album || track.album,
            artwork: metadata.artwork || track.artwork,
            year: metadata.year,
            trackNumber: metadata.trackNumber,
            genre: metadata.genre,
            format: metadata.format || track.format,
            sampleRate: metadata.sampleRate || track.sampleRate,
            bitDepth: metadata.bitDepth || track.bitDepth,
        };
    } catch (error) {
        console.debug(`[FileScanner] enrichTrackWithMetadata failed: ${error}`);
        return track;
    }
}

/**
 * FAST SCAN: Get audio files from MediaStore instantly
 * Does NOT read metadata from files - just indexes what Android already knows
 */
export async function scanMusicLibraryFast(
    options: ScanOptions = {},
    onProgress?: ScanProgressCallback,
    onTrackFound?: TrackFoundCallback
): Promise<ScanResult> {
    const startTime = Date.now();
    const tracks: Track[] = [];
    const errors: string[] = [];
    const folderPattern = options.folderPattern || MUSIC_FOLDERS.all;

    const hasPerms = await hasPermissions();
    if (!hasPerms) {
        const granted = await requestPermissions();
        if (!granted) {
            return { tracks: [], errors: ['Permission denied'], duration: 0 };
        }
    }

    try {
        console.log(`[FileScanner] FAST SCAN starting - folder filter: "${folderPattern || 'ALL'}"`);

        if (canUseNativeLibraryIndexer()) {
            const nativeTracks = await scanMusicNative(folderPattern);
            tracks.push(...nativeTracks);

            if (onTrackFound && nativeTracks.length > 0) {
                const CHUNK_SIZE = 120;
                for (let i = 0; i < nativeTracks.length; i += CHUNK_SIZE) {
                    onTrackFound(nativeTracks.slice(i, i + CHUNK_SIZE));
                }
            }

            if (onProgress) {
                onProgress({
                    total: nativeTracks.length,
                    scanned: nativeTracks.length,
                    currentPath: `${nativeTracks.length} tracks found`,
                });
            }

            const duration = Date.now() - startTime;
            console.log(`[FileScanner] FAST SCAN (native) complete: ${tracks.length} tracks in ${duration}ms`);
            return { tracks, errors, duration };
        }

        let hasNextPage = true;
        let endCursor: string | undefined;
        let totalScanned = 0;

        while (hasNextPage) {
            const result = await MediaLibrary.getAssetsAsync({
                mediaType: MediaLibrary.MediaType.audio,
                first: 100,
                after: endCursor,
                sortBy: [[MediaLibrary.SortBy.creationTime, false]],
            });

            totalScanned += result.assets.length;

            // Filter by folder pattern and audio extension
            const matchingAssets = result.assets.filter(asset => {
                const ext = asset.filename?.split('.').pop()?.toLowerCase();
                if (!ext || !AUDIO_EXTENSIONS.includes(ext)) return false;

                if (folderPattern) {
                    const uri = decodeURIComponent(asset.uri || '');
                    return uri.includes(folderPattern);
                }
                return true;
            });

            if (matchingAssets.length > 0) {
                const batchTracks = matchingAssets.map(asset => {
                    const uriParts = decodeURIComponent(asset.uri).split('/');
                    const folderName = uriParts[uriParts.length - 2] || '';
                    return assetToTrackFast(asset, folderName);
                });

                tracks.push(...batchTracks);

                if (onTrackFound) {
                    onTrackFound(batchTracks);
                }

                if (onProgress) {
                    onProgress({
                        total: result.totalCount,
                        scanned: totalScanned,
                        currentPath: `${batchTracks.length} tracks found`,
                    });
                }
            }

            hasNextPage = result.hasNextPage;
            endCursor = result.endCursor;
        }

        const duration = Date.now() - startTime;
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
 * SLOW SCAN: Full metadata extraction (original behavior)
 * Use this for detailed library indexing
 */
export async function scanMusicLibrary(
    onProgress?: ScanProgressCallback,
    onTrackFound?: TrackFoundCallback
): Promise<ScanResult> {
    return scanMusicLibraryFast(
        { folderPattern: MUSIC_FOLDERS.download, extractMetadata: false },
        onProgress,
        onTrackFound
    );
}

/**
 * Find artwork image in the same folder as the audio file
 */
export async function findArtworkInFolder(audioUri: string, artist?: string, album?: string): Promise<string | undefined> {
    try {
        const decodedUri = decodeURIComponent(audioUri);
        const folderUri = audioUri.substring(0, audioUri.lastIndexOf('/') + 1);
        const folderPath = decodedUri.substring(0, decodedUri.lastIndexOf('/') + 1);
        const folderName = folderPath.split('/').filter(Boolean).pop() || '';

        let files: string[] = [];
        try {
            files = await readDirectoryAsync(folderUri);
        } catch (dirError) {
            files = await readDirectoryAsync(folderPath);
        }

        if (!files || files.length === 0) {
            return undefined;
        }

        const imageExtensions = ['.jpg', '.jpeg', '.png'];
        const priorityNames = ['cover', 'folder', 'album', 'front'];

        if (artist && album) {
            priorityNames.unshift(`${artist} - ${album}`);
        }
        if (album) {
            priorityNames.unshift(album);
        }

        const imageFiles = files.filter(file => {
            const lower = file.toLowerCase();
            const isImage = imageExtensions.some(ext => lower.endsWith(ext));
            const isSystemFile = lower.startsWith('.') ||
                lower.startsWith('thumb') ||
                lower.startsWith('resize') ||
                lower.startsWith('temp') ||
                lower.includes('cache');
            return isImage && !isSystemFile;
        });

        if (imageFiles.length === 0) {
            return undefined;
        }

        for (const name of priorityNames) {
            const normalizedName = name.toLowerCase();
            for (const ext of imageExtensions) {
                const target = `${normalizedName}${ext}`;
                const match = imageFiles.find(f => f.toLowerCase() === target);
                if (match) {
                    return `${folderUri}${match}`;
                }
            }
        }

        const audioFilename = decodedUri.split('/').pop()?.replace(/\.[^/.]+$/, '') || '';
        if (audioFilename) {
            for (const ext of imageExtensions) {
                const match = imageFiles.find(f => f.toLowerCase() === `${audioFilename.toLowerCase()}${ext}`);
                if (match) return `${folderUri}${match}`;
            }
        }

        const genericFolders = ['0', 'download', 'music', 'audio', 'dcim', 'documents', 'pictures', 'staysound'];
        if (genericFolders.includes(folderName.toLowerCase())) {
            return undefined;
        }

        const likelyCover = imageFiles.find(f => {
            const l = f.toLowerCase();
            return priorityNames.some(p => l.includes(p));
        });

        return `${folderUri}${likelyCover || imageFiles[0]}`;
    } catch (error) {
        console.debug(`[FileScanner] findArtworkInFolder error: ${error}`);
        return undefined;
    }
}
