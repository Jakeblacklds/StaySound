/**
 * LibraryStore - Zustand store for music library
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import * as FileSystem from 'expo-file-system/legacy';
import { getArtistInfo } from '../services/artistApi';
import { getArtworkThumbUri } from '../services/artworkThumbnails';
import { extractMetadata, MUSIC_FOLDERS, runConcurrent, scanMusicLibraryFast, withTimeout } from '../services/fileScanner';
import { enrichTrackFromUri, generateAlbumId, generateArtistId, organizeIntoAlbums, organizeIntoArtists } from '../services/metadataService';
import { hydrateArtworkForLocalTracks, hydrateDeferredTidalMetadata } from '../services/nativeLibraryIndexer';
import { FileSystemStorage } from '../services/storage';
import { Album, Artist, LibraryState, Playlist, ScanProgress, Track } from '../types/audio';

const MAX_RECENT_SEARCHES = 12;
const INITIAL_SCAN_THUMBNAIL_PRELOAD_COUNT = 72;
let isRefreshingArtistPhotos = false;
let isHydratingArtworkThumbs = false;

function rebuildDerivedLibraryCollections(tracksMap: Map<string, Track>) {
    const trackList = Array.from(tracksMap.values());
    const albums = organizeIntoAlbums(trackList);
    const artists = organizeIntoArtists(trackList, albums);

    return { albums, artists };
}

function queuePlaylistSync() {
    // Cloud playlist sync was removed. Playlists now live locally on-device.
}

const isRemoteArtworkUri = (uri?: string) =>
    typeof uri === 'string' && (uri.startsWith('http://') || uri.startsWith('https://'));

const GENERIC_LIBRARY_VALUES = new Set(['unknown', 'unknown title', 'unknown artist', 'unknown album', 'media', 'external', 'staysound']);

const hasMeaningfulLibraryValue = (value?: string) => {
    const normalized = value?.trim().toLowerCase();
    return !!normalized && !GENERIC_LIBRARY_VALUES.has(normalized);
};

const trackNeedsMetadataRepair = (track: Track) =>
    !hasMeaningfulLibraryValue(track.title)
    || !hasMeaningfulLibraryValue(track.artist);

const normalizeRequestedScanPath = (value?: unknown) =>
    typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : MUSIC_FOLDERS.download;

const isMediaStoreAlbumArtUri = (uri?: string) =>
    typeof uri === 'string' && uri.startsWith('content://media/external/audio/albumart/');

const MEDIASTORE_AUDIO_URI_PATTERN = /content:\/\/media\/[^/]+\/audio\/media\/(\d+)/i;

const resolveMediaLibraryAssetId = (trackId: string, trackUri?: string): string | null => {
    const normalizedId = (trackId ?? '').trim();
    if (/^\d+$/.test(normalizedId)) return normalizedId;

    if (normalizedId.startsWith('ms_')) {
        const msId = normalizedId.slice(3);
        if (/^\d+$/.test(msId)) return msId;
    }

    if (normalizedId.startsWith('track_')) {
        const trackHashOrId = normalizedId.slice(6);
        if (/^\d+$/.test(trackHashOrId)) return trackHashOrId;
    }

    const uriMatch = trackUri?.match(MEDIASTORE_AUDIO_URI_PATTERN);
    if (uriMatch?.[1]) return uriMatch[1];

    return null;
};

const isDirectFileUri = (uri?: string) =>
    typeof uri === 'string' && (uri.startsWith('file://') || uri.startsWith('/'));

const normalizePathForJunkCheck = (value?: string) =>
    decodeURIComponent(value ?? '').toLowerCase().replace(/\\/g, '/');

const isCacheDownloadUri = (uri?: string) => {
    const normalized = normalizePathForJunkCheck(uri);
    return normalized.includes('/cache/staysound/downloads/')
        || (normalized.includes('/android/data/') && normalized.includes('/cache/'));
};

const isLikelyJunkStaySoundTrack = (track: Track) => {
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

const removeTrackIdsFromPlaylists = (playlists: Map<string, Playlist>, removedIds: Set<string>) => {
    if (removedIds.size === 0) return { playlists, changed: false };

    let changed = false;
    const nextPlaylists = new Map(playlists);
    nextPlaylists.forEach((playlist, id) => {
        const nextTrackIds = playlist.trackIds.filter(trackId => !removedIds.has(trackId));
        if (nextTrackIds.length === playlist.trackIds.length) return;

        changed = true;
        nextPlaylists.set(id, {
            ...playlist,
            trackIds: nextTrackIds,
            updatedAt: Date.now(),
        });
    });

    return { playlists: changed ? nextPlaylists : playlists, changed };
};

const resolveArtworkFromScan = (scannedArtwork?: string, existingArtwork?: string) => {
    if (!existingArtwork) return scannedArtwork;
    if (!scannedArtwork) return existingArtwork;
    if (isMediaStoreAlbumArtUri(scannedArtwork) && !isMediaStoreAlbumArtUri(existingArtwork)) {
        return existingArtwork;
    }
    return scannedArtwork;
};

const normalizeTrackMatchValue = (value?: string) =>
    (value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\((feat|ft)\.?.*?\)/g, ' ')
        .replace(/\[(feat|ft)\.?.*?\]/g, ' ')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const valuesLooselyMatch = (left?: string, right?: string) => {
    const normalizedLeft = normalizeTrackMatchValue(left);
    const normalizedRight = normalizeTrackMatchValue(right);

    if (!normalizedLeft || !normalizedRight) return false;
    if (normalizedLeft === normalizedRight) return true;

    return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
};

const getLocalTrackMatchScore = (remoteTrack: Track, localTrack: Track) => {
    if (localTrack.cloudOnly) return -1;

    let score = 0;

    if (remoteTrack.isrc && localTrack.isrc && remoteTrack.isrc === localTrack.isrc) {
        score += 100;
    }

    if (valuesLooselyMatch(remoteTrack.title, localTrack.title)) {
        score += 6;
    } else {
        return -1;
    }

    if (valuesLooselyMatch(remoteTrack.artist, localTrack.artist)) {
        score += 5;
    } else {
        return -1;
    }

    if (remoteTrack.album && localTrack.album && valuesLooselyMatch(remoteTrack.album, localTrack.album)) {
        score += 2;
    }

    if (remoteTrack.duration > 0 && localTrack.duration > 0) {
        const durationDelta = Math.abs(remoteTrack.duration - localTrack.duration);
        if (durationDelta <= 2500) {
            score += 4;
        } else if (durationDelta <= 6000) {
            score += 2;
        } else if (durationDelta > 15000) {
            return -1;
        }
    }

    return score;
};

const findBestLocalTrackMatch = (remoteTrack: Track, tracksMap: Map<string, Track>) => {
    let bestMatch: Track | undefined;
    let bestScore = -1;

    tracksMap.forEach(localTrack => {
        const score = getLocalTrackMatchScore(remoteTrack, localTrack);
        if (score > bestScore) {
            bestScore = score;
            bestMatch = localTrack;
        }
    });

    return bestScore >= 11 ? bestMatch : undefined;
};

interface LibraryActions {
    // Scanning
    scanLibrary: (folderPath?: string) => Promise<void>;
    cancelScan: () => void;
    refreshArtistPhotos: () => Promise<void>;

    // Track operations
    addTrack: (track: Track) => void;
    updateTrack: (id: string, updates: Partial<Track>) => void;
    applyAlbumArtwork: (album: string, artist: string, artwork: string) => void;
    ensureArtworkThumbsForTracks: (trackIds?: string[]) => Promise<void>;
    repairMissingMetadata: () => Promise<number>;
    hydrateMetadataFromTidalForLibrary: (onLog?: (message: string) => void) => Promise<number>;
    removeTrack: (id: string) => void;
    deleteTrack: (id: string, deleteFile?: boolean) => Promise<void>;
    getTrack: (id: string) => Track | undefined;
    getAllTracks: () => Track[];

    // Album operations
    getAlbum: (id: string) => Album | undefined;
    getAlbumById: (id: string) => Album | undefined;
    getAllAlbums: () => Album[];
    getAlbumTracks: (id: string) => Track[];
    getTracksByAlbum: (id: string) => Track[];

    // Artist operations  
    getArtist: (id: string) => Artist | undefined;
    getArtistById: (id: string) => Artist | undefined;
    getAllArtists: () => Artist[];
    getArtistTracks: (id: string) => Track[];
    getTracksByArtist: (id: string) => Track[];
    getArtistAlbums: (id: string) => Album[];
    getAlbumsByArtist: (id: string) => Album[];

    // Playlist operations
    createPlaylist: (name: string, description?: string, artwork?: string) => string;
    updatePlaylist: (id: string, updates: { name?: string; description?: string; artwork?: string }) => void;
    deletePlaylist: (id: string) => void;
    addToPlaylist: (playlistId: string, trackId: string) => void;
    removeFromPlaylist: (playlistId: string, trackId: string) => void;
    getPlaylist: (id: string) => Playlist | undefined;
    getAllPlaylists: () => Playlist[];
    getPlaylistTracks: (id: string) => Track[];

    // Favorite operations
    toggleFavorite: (trackId: string) => void;

    // Search
    search: (query: string) => { tracks: Track[]; albums: Album[]; artists: Artist[] };
    addRecentSearch: (query: string) => void;
    removeRecentSearch: (query: string) => void;
    clearRecentSearches: () => void;

    // Clear
    clearLibrary: () => void;

    // Hydration
    pruneInvalidLibraryEntries: () => Promise<number>;
    setHasHydrated: (state: boolean) => void;
    bumpCatalogRevision: () => void;
}

export type LibraryStore = LibraryState & LibraryActions;

const initialState: LibraryState = {
    tracks: new Map(),
    albums: new Map(),
    artists: new Map(),
    playlists: new Map(),
    cloudPlaylistTracks: new Map(),
    catalogRevision: 0,
    recentSearches: [],
    isScanning: false,
    scanProgress: null,
    lastScanDate: null,
    _hasHydrated: false,
};

export const useLibraryStore = create<LibraryStore>()(
    persist(
        (set, get) => ({
            ...initialState,
            bumpCatalogRevision: () => {
                set(state => ({ catalogRevision: state.catalogRevision + 1 }));
            },

            scanLibrary: async (folderPath?: string) => {
                const startTime = Date.now();
                set({ isScanning: true, scanProgress: { total: 0, scanned: 0, currentPath: 'Scanning...' } });

                try {
                    // PHASE 1: Fast scan â€” collect ALL tracks from MediaStore instantly
                    const scanPath = normalizeRequestedScanPath(folderPath);
                    console.log(`[LibraryStore] FAST SCAN starting: ${scanPath || 'DOWNLOAD ONLY'}`);

                    const collectedTracks = new Map<string, Track>();
                    const currentTracks = get().tracks;

                    // Build a filename â†’ existing track lookup.
                    // WHY: Downloaded tracks use SAF URIs (content://com.android.externalstorage.documents/...)
                    // but MediaStore gives the SAME file a completely different URI (content://media/external/...).
                    // So matching by URI never works. Matching by filename (without extension) is reliable.
                    const existingByFilename = new Map<string, Track>(); // filename_no_ext (lowercase) â†’ track
                    const { sanitizeFilename: sanitize } = require('../services/audioUtils');

                    currentTracks.forEach((t) => {
                        if (!t.uri) return;

                        // Strategy 1: Extract filename from the URI (works for SAF URIs)
                        // SAF URIs: content://...primary%3ADownload%2FStaySound%2FArtist+-+Album+-+Title.flac
                        // Decoding and splitting gives "Artist - Album - Title.flac"
                        const uriFilename = decodeURIComponent(t.uri)
                            .split('/').pop()
                            ?.replace(/\.[^/.]+$/, '')  // strip extension
                            ?.toLowerCase()
                            .trim();
                        if (uriFilename && uriFilename.length > 5 && !/^\d+$/.test(uriFilename)) {
                            // Reject pure numeric strings like "12345" (MediaStore IDs)
                            existingByFilename.set(uriFilename, t);
                        }

                        // Strategy 2: Reconstruct expected filename from metadata (covers Tidal downloads)
                        // Tidal saves files as: sanitize("Artist - Album - Title")
                        // So we can reverse-engineer the expected filename key from stored metadata.
                        if (t.artist && t.album && t.title
                            && t.artist !== 'Unknown Artist' && t.album !== 'Unknown Album') {
                            const reconstructed = sanitize(`${t.artist} - ${t.album} - ${t.title}`)
                                .toLowerCase()
                                .trim();
                            if (reconstructed) existingByFilename.set(reconstructed, t);
                        }
                    });

                    let batchCount = 0;
                    let lastUiFlush = 0;
                    const UI_FLUSH_INTERVAL_MS = 250;

                    await scanMusicLibraryFast(
                        { folderPattern: scanPath },
                        (progress: ScanProgress) => {
                            set({ scanProgress: progress });
                        },
                        (newTracks: Track[]) => {
                            batchCount++;
                            newTracks.forEach(track => {
                                if (isLikelyJunkStaySoundTrack(track)) {
                                    return;
                                }

                                const enrichmentSource = track._filename || track.uri;
                                const enriched = enrichTrackFromUri(track, enrichmentSource);
                                if (isLikelyJunkStaySoundTrack(enriched)) {
                                    return;
                                }

                                // Build the filename key for matching:
                                // 1. Prefer track._filename (set by NativeLibraryIndexer from MediaStore DISPLAY_NAME)
                                //    This is necessary because MediaStore URIs like content://media/external/audio/media/12345
                                //    don't contain the actual filename - extracting the last segment gives just "12345".
                                // 2. Fall back to URI decoding (works for SAF URIs from the non-native path)
                                const rawFilenameSource = track._filename
                                    || decodeURIComponent(track.uri).split('/').pop()
                                    || '';
                                const filenameKey = rawFilenameSource
                                    .replace(/\.[^/.]+$/, '') // strip extension
                                    .toLowerCase()
                                    .trim();

                                const existingTrack = filenameKey ? existingByFilename.get(filenameKey) : undefined;

                                // Keep _filename on stored local tracks.
                                // Playback fallback for MediaStore content:// IDs needs it to rebuild
                                // a concrete file:///storage/... URI when the extractor fails on content://.
                                const cleanEnriched = enriched;

                                if (existingTrack) {
                                    // Found a match by filename -> fully restore metadata from the stored track.
                                    // WHY we always prefer stored title/artist/album:
                                    // - MediaStore title: often the full filename ("SZA - SOS - Kill Bill") for untagged files
                                    // - MediaStore album: often the folder name ("StaySound") for untagged files
                                    // We also protect good Tidal artwork from being overwritten by a generic MediaStore albumart URI.
                                    const resolvedArtwork = resolveArtworkFromScan(cleanEnriched.artwork, existingTrack.artwork);
                                    const resolvedArtworkThumb = resolvedArtwork === existingTrack.artwork
                                        ? existingTrack.artworkThumb
                                        : undefined;

                                    collectedTracks.set(cleanEnriched.id, {
                                        ...cleanEnriched,            // base: uri, duration, format, dateAdded from scanner
                                        title: hasMeaningfulLibraryValue(existingTrack.title) ? existingTrack.title : cleanEnriched.title,
                                        artist: hasMeaningfulLibraryValue(existingTrack.artist) ? existingTrack.artist : cleanEnriched.artist,
                                        album: hasMeaningfulLibraryValue(existingTrack.album) ? existingTrack.album : cleanEnriched.album,
                                        artwork: resolvedArtwork,
                                        artworkThumb: resolvedArtworkThumb,
                                        year: cleanEnriched.year || existingTrack.year,
                                        trackNumber: cleanEnriched.trackNumber || existingTrack.trackNumber,
                                        genre: cleanEnriched.genre || existingTrack.genre,
                                        quality: cleanEnriched.quality || existingTrack.quality,
                                        sampleRate: cleanEnriched.sampleRate || existingTrack.sampleRate,
                                        bitDepth: cleanEnriched.bitDepth || existingTrack.bitDepth,
                                        codec: cleanEnriched.codec || existingTrack.codec,
                                        source: cleanEnriched.source || existingTrack.source,
                                        tidalId: cleanEnriched.tidalId || existingTrack.tidalId,
                                        tidalAlbumId: cleanEnriched.tidalAlbumId || existingTrack.tidalAlbumId,
                                        favorite: existingTrack.favorite,
                                    });
                                } else {
                                    collectedTracks.set(cleanEnriched.id, cleanEnriched);
                                }
                            });

                            const now = Date.now();
                            if (batchCount === 1 || now - lastUiFlush >= UI_FLUSH_INTERVAL_MS) {
                                lastUiFlush = now;
                                set({ tracks: new Map(collectedTracks) });
                            }
                        }
                    );

                    const scanDuration = Date.now() - startTime;
                    console.log(`[LibraryStore] Scan complete in ${scanDuration}ms: ${collectedTracks.size} total`);

                    // PHASE 3: Final Organization
                    const finalTracks = Array.from(collectedTracks.values());
                    const initialAlbums = organizeIntoAlbums(finalTracks);
                    const initialArtists = organizeIntoArtists(finalTracks, initialAlbums);

                    set({
                        tracks: collectedTracks,
                        albums: initialAlbums,
                        artists: initialArtists,
                        catalogRevision: get().catalogRevision + 1,
                        isScanning: false,
                        scanProgress: null,
                        lastScanDate: Date.now(),
                    });

                    void get().ensureArtworkThumbsForTracks(
                        finalTracks
                            .slice(0, INITIAL_SCAN_THUMBNAIL_PRELOAD_COUNT)
                            .map(track => track.id)
                    );
                    void hydrateDeferredTidalMetadata(finalTracks, (updates) => {
                        if (updates.length === 0) return;

                        set((state) => {
                            if (state.tracks.size === 0) return state;

                            let changed = false;
                            const nextTracks = new Map(state.tracks);

                            for (const updatedTrack of updates) {
                                const currentTrack = nextTracks.get(updatedTrack.id);
                                if (!currentTrack) continue;

                                nextTracks.set(updatedTrack.id, {
                                    ...currentTrack,
                                    ...updatedTrack,
                                    artwork: updatedTrack.artwork || currentTrack.artwork,
                                    artworkThumb: currentTrack.artworkThumb,
                                });
                                changed = true;
                            }

                            if (!changed) return state;

                            const { albums, artists } = rebuildDerivedLibraryCollections(nextTracks);
                            return {
                                tracks: nextTracks,
                                albums,
                                artists,
                            };
                        });
                    });

                    // Second pass: fetch artwork from Tidal for local tracks that have no artwork
                    void hydrateArtworkForLocalTracks(finalTracks, (updates) => {
                        if (updates.length === 0) return;

                        set((state) => {
                            if (state.tracks.size === 0) return state;

                            let changed = false;
                            const nextTracks = new Map(state.tracks);

                            for (const updatedTrack of updates) {
                                const currentTrack = nextTracks.get(updatedTrack.id);
                                if (!currentTrack) continue;
                                // Skip if the track already has a high-quality (non-MediaStore) artwork
                                const isMediaStoreArt = typeof currentTrack.artwork === 'string'
                                    && currentTrack.artwork.startsWith('content://media/external/audio/albumart');
                                if (currentTrack.artwork && !isMediaStoreArt) continue;

                                console.log(`[LibraryStore] Applying Tidal artwork to local track: ${updatedTrack.artist} - ${updatedTrack.title}`);
                                nextTracks.set(updatedTrack.id, {
                                    ...currentTrack,
                                    artwork: updatedTrack.artwork,
                                });
                                changed = true;
                            }

                            if (!changed) return state;

                            const { albums, artists } = rebuildDerivedLibraryCollections(nextTracks);
                            return {
                                tracks: nextTracks,
                                albums,
                                artists,
                                catalogRevision: state.catalogRevision + 1,
                            };
                        });

                        // Generate thumbnails for newly-artwork'd tracks
                        void get().ensureArtworkThumbsForTracks(updates.map(t => t.id));
                    });

                    // Mantenimiento (DESACTIVADO TRAS EXPERIMENTO)

                } catch (error) {
                    console.error('[LibraryStore] Scan error:', error);
                    set({ isScanning: false, scanProgress: null });
                }
            },

            cancelScan: () => {
                set({ isScanning: false, scanProgress: null });
            },

            refreshArtistPhotos: async () => {
                if (isRefreshingArtistPhotos) return;
                isRefreshingArtistPhotos = true;

                try {
                    const latestState = get();
                    const normalizedArtists = new Map(latestState.artists);
                    let normalizedCount = 0;

                    for (const artist of normalizedArtists.values()) {
                        if (typeof artist.artwork === 'string' && artist.artwork.startsWith('http://')) {
                            normalizedArtists.set(artist.id, {
                                ...artist,
                                artwork: `https://${artist.artwork.slice('http://'.length)}`,
                            });
                            normalizedCount++;
                        }
                    }

                    if (normalizedCount > 0) {
                        set(state => ({
                            artists: new Map(normalizedArtists),
                            catalogRevision: state.catalogRevision + 1,
                        }));
                    }

                    const artistsWithoutArtwork = Array.from(normalizedArtists.values()).filter(
                        artist => !isRemoteArtworkUri(artist.artwork) && artist.name && artist.name !== 'Unknown Artist' && artist.name !== 'Unknown'
                    );

                    if (artistsWithoutArtwork.length === 0) return;

                    console.log(`[LibraryStore] Fetching artist photos for ${artistsWithoutArtwork.length} artists (5 concurrent)...`);

                    const updatedArtists = new Map(latestState.artists);
                    let apiPhotosFound = 0;

                    // Fetch 5 artist photos at the same time instead of one-by-one
                    await runConcurrent(artistsWithoutArtwork, 5, async (artist: Artist) => {
                        try {
                            const info = await withTimeout(getArtistInfo(artist.name, { includeBiography: false }), 5000);
                            if (!info?.photo_url) return;

                            const currentArtist = updatedArtists.get(artist.id);
                            if (!currentArtist || isRemoteArtworkUri(currentArtist.artwork)) return;

                            updatedArtists.set(artist.id, { ...currentArtist, artwork: info.photo_url });
                            apiPhotosFound++;

                            // Flush to UI every 5 photos
                            if (apiPhotosFound % 5 === 0) {
                                set({ artists: new Map(updatedArtists) });
                            }
                        } catch (e) {
                            // Silently ignore per-artist errors
                        }
                    });

                    if (apiPhotosFound > 0) {
                        set(state => ({
                            artists: new Map(updatedArtists),
                            catalogRevision: state.catalogRevision + 1,
                        }));
                        console.log(`[LibraryStore] Artist photos updated: ${apiPhotosFound}`);
                    }
                } finally {
                    isRefreshingArtistPhotos = false;
                }
            },

            addTrack: (track: Track) => {
                const { tracks } = get();
                const newTracks = new Map(tracks);
                newTracks.set(track.id, track);
                set(state => ({
                    tracks: newTracks,
                    catalogRevision: state.catalogRevision + 1,
                }));
            },

            updateTrack: (id: string, updates: Partial<Track>) => {
                const { tracks } = get();
                const track = tracks.get(id);
                if (track) {
                    const newTracks = new Map(tracks);
                    newTracks.set(id, { ...track, ...updates });
                    set(state => ({
                        tracks: newTracks,
                        catalogRevision: state.catalogRevision + 1,
                    }));
                }
            },

            applyAlbumArtwork: (album: string, artist: string, artwork: string) => {
                if (!artwork) return;

                const state = get();
                const updatedTracks = new Map(state.tracks);
                let changed = false;

                for (const [id, track] of updatedTracks.entries()) {
                    if (track.album === album && track.artist === artist && !track.artwork) {
                        updatedTracks.set(id, { ...track, artwork });
                        changed = true;
                    }
                }

                const albumId = generateAlbumId(album, artist);
                const albumEntry = state.albums.get(albumId);
                const updatedAlbums = new Map(state.albums);
                if (albumEntry && !albumEntry.artwork) {
                    updatedAlbums.set(albumId, { ...albumEntry, artwork });
                    changed = true;
                }

                if (changed) {
                    set(state => ({
                        tracks: updatedTracks,
                        albums: updatedAlbums,
                        catalogRevision: state.catalogRevision + 1,
                    }));
                }

                void (async () => {
                    const thumbUri = await getArtworkThumbUri(artwork);
                    if (!thumbUri) return;

                    const latestState = get();
                    const nextTracks = new Map(latestState.tracks);
                    const nextAlbums = new Map(latestState.albums);
                    let thumbChanged = false;

                    for (const [id, track] of nextTracks.entries()) {
                        if (track.album === album && track.artist === artist && track.artworkThumb !== thumbUri) {
                            nextTracks.set(id, { ...track, artworkThumb: thumbUri });
                            thumbChanged = true;
                        }
                    }

                    const albumId = generateAlbumId(album, artist);
                    const albumEntry = nextAlbums.get(albumId);
                    if (albumEntry && albumEntry.artworkThumb !== thumbUri) {
                        nextAlbums.set(albumId, { ...albumEntry, artworkThumb: thumbUri });
                        thumbChanged = true;
                    }

                    if (thumbChanged) {
                        set(state => ({
                            tracks: nextTracks,
                            albums: nextAlbums,
                            catalogRevision: state.catalogRevision + 1,
                        }));
                    }
                })();
            },

            ensureArtworkThumbsForTracks: async (trackIds?: string[]) => {
                if (isHydratingArtworkThumbs) return;
                isHydratingArtworkThumbs = true;

                try {
                    const state = get();
                    const sourceTracks = trackIds && trackIds.length > 0
                        ? trackIds.map(id => state.tracks.get(id)).filter((track): track is Track => !!track)
                        : Array.from(state.tracks.values());

                    const tracksToHydrate = sourceTracks.filter(track => {
                        const artwork = track.artwork?.trim();
                        return !!artwork;
                    });

                    if (tracksToHydrate.length === 0) return;

                    const nextTracks = new Map(state.tracks);
                    const nextAlbums = new Map(state.albums);
                    let changes = 0;

                    await runConcurrent(tracksToHydrate, 2, async (track) => {
                        if (track.artworkThumb?.startsWith('file://')) {
                            const existingThumb = await FileSystem.getInfoAsync(track.artworkThumb);
                            if (existingThumb.exists) return;
                        } else if (track.artworkThumb) {
                            return;
                        }

                        const thumbUri = await getArtworkThumbUri(track.artwork);
                        if (!thumbUri) return;

                        const latestTrack = nextTracks.get(track.id);
                        if (!latestTrack || latestTrack.artworkThumb === thumbUri) return;

                        nextTracks.set(track.id, { ...latestTrack, artworkThumb: thumbUri });
                        changes++;

                        const albumId = generateAlbumId(latestTrack.album, latestTrack.artist);
                        const albumEntry = nextAlbums.get(albumId);
                        if (albumEntry && albumEntry.artwork === latestTrack.artwork && !albumEntry.artworkThumb) {
                            nextAlbums.set(albumId, { ...albumEntry, artworkThumb: thumbUri });
                        }

                        if (changes % 12 === 0) {
                            set({ tracks: new Map(nextTracks), albums: new Map(nextAlbums) });
                        }
                    });

                    if (changes > 0) {
                        set(state => ({
                            tracks: new Map(nextTracks),
                            albums: new Map(nextAlbums),
                            catalogRevision: state.catalogRevision + 1,
                        }));
                    }
                } finally {
                    isHydratingArtworkThumbs = false;
                }
            },

            repairMissingMetadata: async () => {
                const state = get();
                const candidates = Array.from(state.tracks.values()).filter(trackNeedsMetadataRepair);
                if (candidates.length === 0) return 0;

                const nextTracks = new Map(state.tracks);
                const changedTrackIds: string[] = [];

                for (const track of candidates) {
                    const currentTrack = nextTracks.get(track.id);
                    if (!currentTrack) continue;

                    const filenameSource = currentTrack._filename
                        || decodeURIComponent(currentTrack.uri).split('/').pop()
                        || currentTrack.uri;
                    const repairedTrack = enrichTrackFromUri(currentTrack, filenameSource);

                    const updatedTrack: Track = {
                        ...currentTrack,
                        title: hasMeaningfulLibraryValue(currentTrack.title) ? currentTrack.title : repairedTrack.title,
                        artist: hasMeaningfulLibraryValue(currentTrack.artist) ? currentTrack.artist : repairedTrack.artist,
                        album: hasMeaningfulLibraryValue(currentTrack.album) ? currentTrack.album : repairedTrack.album,
                    };

                    const changed = updatedTrack.title !== currentTrack.title
                        || updatedTrack.artist !== currentTrack.artist
                        || updatedTrack.album !== currentTrack.album;

                    if (!changed) continue;
                    nextTracks.set(track.id, updatedTrack);
                    changedTrackIds.push(track.id);
                }

                if (changedTrackIds.length === 0) return 0;

                const { albums, artists } = rebuildDerivedLibraryCollections(nextTracks);
                set(state => ({
                    tracks: nextTracks,
                    albums,
                    artists,
                    catalogRevision: state.catalogRevision + 1,
                }));

                void get().ensureArtworkThumbsForTracks(changedTrackIds);
                return changedTrackIds.length;
            },

            hydrateMetadataFromTidalForLibrary: async (onLog?: (message: string) => void) => {
                const state = get();
                const sourceTracks = Array.from(state.tracks.values());
                if (sourceTracks.length === 0) return 0;

                const isMissingArtwork = (track: Track) => {
                    if (!track.artwork) return true;
                    return isMediaStoreAlbumArtUri(track.artwork);
                };
                const artworkCandidates = sourceTracks.filter(isMissingArtwork);
                onLog?.(`[Artwork] Biblioteca: ${sourceTracks.length} pistas`);
                onLog?.(`[Artwork] Candidatas sin portada: ${artworkCandidates.length}`);
                if (artworkCandidates.length === 0) {
                    onLog?.('[Artwork] No hay pistas pendientes');
                    return 0;
                }

                let changedTrackIds = new Set<string>();
                const staySoundCandidates = artworkCandidates.filter(track =>
                    (track.relativePath ?? '').toLowerCase().includes('staysound')
                );
                const localCandidates = artworkCandidates.filter(track =>
                    !(track.relativePath ?? '').toLowerCase().includes('staysound')
                );
                onLog?.(`[Artwork] StaySound sin portada: ${staySoundCandidates.length}`);
                onLog?.(`[Artwork] Locales sin portada: ${localCandidates.length}`);

                // Paso 1: intentar artwork embebido real del archivo (FLAC tags) antes de cualquier API.
                const embeddedCandidates = [...staySoundCandidates, ...localCandidates];
                if (embeddedCandidates.length > 0) {
                    onLog?.(`[Artwork] Intentando extraer artwork embebido en ${embeddedCandidates.length} pistas...`);
                    await runConcurrent(embeddedCandidates, 2, async (track) => {
                        try {
                            const meta = await withTimeout(extractMetadata(track.uri), 5000);
                            const embeddedArtwork = meta?.artwork;
                            if (!embeddedArtwork) return;

                            set((currentState) => {
                                const currentTrack = currentState.tracks.get(track.id);
                                if (!currentTrack) return currentState;
                                if (currentTrack.artwork && !isMediaStoreAlbumArtUri(currentTrack.artwork)) return currentState;
                                if (currentTrack.artwork === embeddedArtwork) return currentState;

                                const nextTracks = new Map(currentState.tracks);
                                nextTracks.set(track.id, {
                                    ...currentTrack,
                                    artwork: embeddedArtwork,
                                });
                                const { albums, artists } = rebuildDerivedLibraryCollections(nextTracks);
                                changedTrackIds.add(track.id);
                                onLog?.(`[Artwork] EMBEDDED OK ${currentTrack.artist} - ${currentTrack.title}`);
                                return {
                                    tracks: nextTracks,
                                    albums,
                                    artists,
                                    catalogRevision: currentState.catalogRevision + 1,
                                };
                            });
                        } catch {
                            // seguimos con fallback de API
                        }
                    });
                }

                if (staySoundCandidates.length > 0) {
                    await hydrateDeferredTidalMetadata(staySoundCandidates, (updates) => {
                        if (updates.length === 0) return;
                        onLog?.(`[Artwork] Lote StaySound: ${updates.length}`);

                        set((currentState) => {
                            if (currentState.tracks.size === 0) return currentState;

                            let changed = false;
                            const nextTracks = new Map(currentState.tracks);

                            for (const updatedTrack of updates) {
                                const currentTrack = nextTracks.get(updatedTrack.id);
                                if (!currentTrack) continue;

                                const isMediaStoreArt = typeof currentTrack.artwork === 'string'
                                    && currentTrack.artwork.startsWith('content://media/external/audio/albumart');
                                if (currentTrack.artwork && !isMediaStoreArt) continue;
                                if (!updatedTrack.artwork || updatedTrack.artwork === currentTrack.artwork) continue;
                                nextTracks.set(updatedTrack.id, {
                                    ...currentTrack,
                                    artwork: updatedTrack.artwork,
                                });
                                onLog?.(`[Artwork] OK ${currentTrack.artist} - ${currentTrack.title}`);
                                changedTrackIds.add(updatedTrack.id);
                                changed = true;
                            }

                            if (!changed) return currentState;

                            const { albums, artists } = rebuildDerivedLibraryCollections(nextTracks);
                            return {
                                tracks: nextTracks,
                                albums,
                                artists,
                                catalogRevision: currentState.catalogRevision + 1,
                            };
                        });
                    });
                }

                await hydrateArtworkForLocalTracks(localCandidates, (updates) => {
                    if (updates.length === 0) return;
                    onLog?.(`[Artwork] Lote recibido: ${updates.length}`);

                    set((currentState) => {
                        if (currentState.tracks.size === 0) return currentState;

                        let changed = false;
                        const nextTracks = new Map(currentState.tracks);

                        for (const updatedTrack of updates) {
                            const currentTrack = nextTracks.get(updatedTrack.id);
                            if (!currentTrack) continue;

                            const isMediaStoreArt = typeof currentTrack.artwork === 'string'
                                && currentTrack.artwork.startsWith('content://media/external/audio/albumart');
                            if (currentTrack.artwork && !isMediaStoreArt) continue;
                            if (!updatedTrack.artwork || updatedTrack.artwork === currentTrack.artwork) continue;

                            nextTracks.set(updatedTrack.id, {
                                ...currentTrack,
                                artwork: updatedTrack.artwork,
                            });
                            onLog?.(`[Artwork] OK ${currentTrack.artist} - ${currentTrack.title}`);
                            changedTrackIds.add(updatedTrack.id);
                            changed = true;
                        }

                        if (!changed) return currentState;

                        const { albums, artists } = rebuildDerivedLibraryCollections(nextTracks);
                        return {
                            tracks: nextTracks,
                            albums,
                            artists,
                            catalogRevision: currentState.catalogRevision + 1,
                        };
                    });
                }, {
                    maxCandidates: Math.max(localCandidates.length, 1),
                });

                const changedIds = Array.from(changedTrackIds);
                if (changedIds.length > 0) {
                    void get().ensureArtworkThumbsForTracks(changedIds);
                }
                onLog?.(`[Artwork] Finalizado. Actualizadas: ${changedIds.length}`);

                return changedIds.length;
            },

            removeTrack: (id: string) => {
                const { tracks } = get();
                if (!tracks.has(id)) return;

                const newTracks = new Map(tracks);
                newTracks.delete(id);

                // Re-organize to maintain consistency in albums/artists
                const tracksArray = Array.from(newTracks.values());
                const nextAlbums = organizeIntoAlbums(tracksArray);
                const nextArtists = organizeIntoArtists(tracksArray, nextAlbums);

                set({
                    tracks: newTracks,
                    albums: nextAlbums,
                    artists: nextArtists,
                    catalogRevision: get().catalogRevision + 1,
                });
            },

            deleteTrack: async (id: string, deleteFile = false) => {
                const { tracks, playlists } = get();
                const track = tracks.get(id);
                if (!track) return;

                // 1. Delete from File System if requested
                if (deleteFile) {
                    let deletedFromDisk = false;
                    try {
                        const FileSystem = require('expo-file-system/legacy');
                        if (id.startsWith('tidal_')) {
                            if (track.uri) {
                                await FileSystem.deleteAsync(track.uri, { idempotent: true });
                                deletedFromDisk = true;
                            }
                        } else {
                            const { deleteAssetsAsync } = require('expo-media-library');
                            const assetId = resolveMediaLibraryAssetId(id, track.uri);

                            if (assetId) {
                                await deleteAssetsAsync([assetId]);
                                deletedFromDisk = true;
                            } else if (isDirectFileUri(track.uri)) {
                                await FileSystem.deleteAsync(track.uri, { idempotent: true });
                                deletedFromDisk = true;
                            }
                        }
                    } catch (e) {
                        console.warn('[LibraryStore] Failed to delete file from disk:', e);
                    }

                    if (!deletedFromDisk) {
                        console.warn('[LibraryStore] Could not resolve file deletion target for track:', {
                            id,
                            uri: track.uri,
                        });
                    }
                }

                // 2. Remove from Tracks
                const nextTracks = new Map(tracks);
                nextTracks.delete(id);

                // 3. Update Playlists
                const nextPlaylists = new Map(playlists);
                let playlistsChanged = false;
                for (const [pid, playlist] of nextPlaylists.entries()) {
                    if (playlist.trackIds.includes(id)) {
                        nextPlaylists.set(pid, {
                            ...playlist,
                            trackIds: playlist.trackIds.filter(tid => tid !== id),
                            updatedAt: Date.now(),
                        });
                        playlistsChanged = true;
                    }
                }

                // 4. Re-organize Albums and Artists
                const tracksArray = Array.from(nextTracks.values());
                const nextAlbums = organizeIntoAlbums(tracksArray);
                const nextArtists = organizeIntoArtists(tracksArray, nextAlbums);

                set({
                    tracks: nextTracks,
                    albums: nextAlbums,
                    artists: nextArtists,
                    catalogRevision: get().catalogRevision + 1,
                    ...(playlistsChanged ? { playlists: nextPlaylists } : {}),
                });
                if (playlistsChanged) queuePlaylistSync();
            },

            getTrack: (id: string) => {
                return get().tracks.get(id);
            },

            getAllTracks: () => {
                return Array.from(get().tracks.values());
            },

            getAlbum: (id: string) => {
                return get().albums.get(id);
            },

            getAlbumById: (id: string) => {
                return get().albums.get(id);
            },

            getAllAlbums: () => {
                return Array.from(get().albums.values());
            },

            getAlbumTracks: (id: string) => {
                const album = get().albums.get(id);
                if (!album) return [];
                const { tracks: tracksMap } = get();
                return album.tracks
                    .map(trackId => tracksMap.get(trackId))
                    .filter((t): t is Track => t !== undefined);
            },

            getTracksByAlbum: (id: string) => {
                const album = get().albums.get(id);
                if (!album) return [];
                const { tracks: tracksMap } = get();
                return album.tracks
                    .map(trackId => tracksMap.get(trackId))
                    .filter((t): t is Track => t !== undefined);
            },

            getArtist: (id: string) => {
                return get().artists.get(id);
            },

            getArtistById: (id: string) => {
                return get().artists.get(id);
            },

            getAllArtists: () => {
                return Array.from(get().artists.values());
            },

            getArtistTracks: (id: string) => {
                const artist = get().artists.get(id);
                if (!artist) return [];
                const { tracks: tracksMap } = get();
                return Array.from(tracksMap.values()).filter(t =>
                    t.artistId === id || generateArtistId(t.artist) === id || t.artist === artist.name
                );
            },

            getTracksByArtist: (id: string) => {
                const artist = get().artists.get(id);
                if (!artist) return [];
                const { tracks: tracksMap } = get();
                return Array.from(tracksMap.values()).filter(t =>
                    t.artistId === id || generateArtistId(t.artist) === id || t.artist === artist.name
                );
            },

            getArtistAlbums: (id: string) => {
                const artist = get().artists.get(id);
                if (!artist) return [];
                const { albums: albumsMap } = get();
                return artist.albums
                    .map(albumId => albumsMap.get(albumId))
                    .filter((a): a is Album => a !== undefined);
            },

            getAlbumsByArtist: (id: string) => {
                const artist = get().artists.get(id);
                if (!artist) return [];
                const { albums: albumsMap } = get();
                return artist.albums
                    .map(albumId => albumsMap.get(albumId))
                    .filter((a): a is Album => a !== undefined);
            },

            createPlaylist: (name: string, description?: string, artwork?: string) => {
                const { playlists } = get();
                const id = `playlist_${Date.now()}`;
                const newPlaylist: Playlist = {
                    id,
                    name,
                    description,
                    artwork: artwork?.trim() || undefined,
                    trackIds: [],
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                };
                const newPlaylists = new Map(playlists);
                newPlaylists.set(id, newPlaylist);
                set(state => ({
                    playlists: newPlaylists,
                    catalogRevision: state.catalogRevision + 1,
                }));
                queuePlaylistSync();
                return id;
            },

            updatePlaylist: (id: string, updates: { name?: string; description?: string; artwork?: string }) => {
                const { playlists } = get();
                const playlist = playlists.get(id);
                if (!playlist || playlist.readonly) return;

                const nextName = updates.name?.trim();
                const nextDescription = updates.description?.trim();
                const nextArtwork = updates.artwork?.trim();

                const newPlaylists = new Map(playlists);
                newPlaylists.set(id, {
                    ...playlist,
                    name: nextName && nextName.length > 0 ? nextName : playlist.name,
                    description: typeof updates.description === 'string'
                        ? (nextDescription && nextDescription.length > 0 ? nextDescription : undefined)
                        : playlist.description,
                    artwork: typeof updates.artwork === 'string'
                        ? (nextArtwork && nextArtwork.length > 0 ? nextArtwork : undefined)
                        : playlist.artwork,
                    updatedAt: Date.now(),
                });
                set(state => ({
                    playlists: newPlaylists,
                    catalogRevision: state.catalogRevision + 1,
                }));
                queuePlaylistSync();
            },

            deletePlaylist: (id: string) => {
                const { playlists } = get();
                const playlist = playlists.get(id);
                if (playlist?.readonly) return;
                const newPlaylists = new Map(playlists);
                newPlaylists.delete(id);
                set(state => ({
                    playlists: newPlaylists,
                    catalogRevision: state.catalogRevision + 1,
                }));
                queuePlaylistSync();
            },

            addToPlaylist: (playlistId: string, trackId: string) => {
                const { playlists } = get();
                const playlist = playlists.get(playlistId);
                if (playlist && !playlist.readonly && !playlist.trackIds.includes(trackId)) {
                    const newPlaylists = new Map(playlists);
                    newPlaylists.set(playlistId, {
                        ...playlist,
                        trackIds: [...playlist.trackIds, trackId],
                        updatedAt: Date.now(),
                    });
                    set(state => ({
                        playlists: newPlaylists,
                        catalogRevision: state.catalogRevision + 1,
                    }));
                    queuePlaylistSync();
                }
            },

            removeFromPlaylist: (playlistId: string, trackId: string) => {
                const { playlists } = get();
                const playlist = playlists.get(playlistId);
                if (playlist && !playlist.readonly) {
                    const newPlaylists = new Map(playlists);
                    newPlaylists.set(playlistId, {
                        ...playlist,
                        trackIds: playlist.trackIds.filter(id => id !== trackId),
                        updatedAt: Date.now(),
                    });
                    set(state => ({
                        playlists: newPlaylists,
                        catalogRevision: state.catalogRevision + 1,
                    }));
                    queuePlaylistSync();
                }
            },

            getPlaylist: (id: string) => {
                return get().playlists.get(id);
            },

            getAllPlaylists: () => {
                return Array.from(get().playlists.values());
            },

            getPlaylistTracks: (id: string) => {
                const playlist = get().playlists.get(id);
                if (!playlist) return [];
                const { tracks: tracksMap } = get();
                const cloudTracks = get().cloudPlaylistTracks.get(id);
                return playlist.trackIds
                    .map(trackId => {
                        const localTrack = tracksMap.get(trackId);
                        if (localTrack) return localTrack;

                        const cloudTrack = cloudTracks?.get(trackId);
                        if (!cloudTrack) return undefined;

                        return findBestLocalTrackMatch(cloudTrack, tracksMap) ?? cloudTrack;
                    })
                    .filter((t): t is Track => t !== undefined);
            },

            toggleFavorite: (trackId: string) => {
                const { tracks, playlists } = get();
                const track = tracks.get(trackId);
                if (!track) return;

                const isFavorite = !track.favorite;
                const newTracks = new Map(tracks);
                newTracks.set(trackId, { ...track, favorite: isFavorite });

                // Sync with "Me gusta" playlist
                const LIKED_PLAYLIST_ID = 'playlist_liked';
                const newPlaylists = new Map(playlists);
                let likedPlaylist = newPlaylists.get(LIKED_PLAYLIST_ID);

                if (!likedPlaylist) {
                    likedPlaylist = {
                        id: LIKED_PLAYLIST_ID,
                        name: 'Me gusta',
                        description: 'Canciones que te gustan',
                        trackIds: [],
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                    };
                }

                if (isFavorite) {
                    if (!likedPlaylist.trackIds.includes(trackId)) {
                        likedPlaylist = {
                            ...likedPlaylist,
                            trackIds: [trackId, ...likedPlaylist.trackIds],
                            updatedAt: Date.now(),
                        };
                    }
                } else {
                    likedPlaylist = {
                        ...likedPlaylist,
                        trackIds: likedPlaylist.trackIds.filter(id => id !== trackId),
                        updatedAt: Date.now(),
                    };
                }

                newPlaylists.set(LIKED_PLAYLIST_ID, likedPlaylist);
                set(state => ({
                    tracks: newTracks,
                    playlists: newPlaylists,
                    catalogRevision: state.catalogRevision + 1,
                }));
                queuePlaylistSync();
            },

            search: (query: string) => {
                const { tracks, albums, artists } = get();
                const q = query.toLowerCase();
                return {
                    tracks: Array.from(tracks.values()).filter(t =>
                        t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)
                    ),
                    albums: Array.from(albums.values()).filter(a =>
                        a.name.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q)
                    ),
                    artists: Array.from(artists.values()).filter(a =>
                        a.name.toLowerCase().includes(q)
                    ),
                };
            },

            addRecentSearch: (query: string) => {
                const trimmed = query.trim();
                if (!trimmed) return;

                set(state => {
                    const normalized = trimmed.toLowerCase();
                    const next = [
                        trimmed,
                        ...state.recentSearches.filter(item => item.toLowerCase() !== normalized),
                    ].slice(0, MAX_RECENT_SEARCHES);

                    return { recentSearches: next };
                });
            },

            removeRecentSearch: (query: string) => {
                const normalized = query.trim().toLowerCase();
                if (!normalized) return;

                set(state => ({
                    recentSearches: state.recentSearches.filter(item => item.toLowerCase() !== normalized),
                }));
            },

            clearRecentSearches: () => {
                set({ recentSearches: [] });
            },

            clearLibrary: () => {
                set({
                    tracks: new Map(),
                    albums: new Map(),
                    artists: new Map(),
                    catalogRevision: get().catalogRevision + 1,
                    lastScanDate: null,
                });
            },

            pruneInvalidLibraryEntries: async () => {
                const { tracks, playlists } = get();
                if (tracks.size === 0) return 0;

                const nextTracks = new Map(tracks);
                const removedIds = new Set<string>();

                for (const [id, track] of tracks.entries()) {
                    let shouldRemove = isLikelyJunkStaySoundTrack(track);

                    if (!shouldRemove && isDirectFileUri(track.uri)) {
                        try {
                            const info = await FileSystem.getInfoAsync(track.uri);
                            shouldRemove = !info.exists || (typeof info.size === 'number' && info.size <= 0);
                        } catch {
                            shouldRemove = true;
                        }
                    }

                    if (!shouldRemove) continue;
                    nextTracks.delete(id);
                    removedIds.add(id);
                }

                if (removedIds.size === 0) return 0;

                const { albums, artists } = rebuildDerivedLibraryCollections(nextTracks);
                const playlistResult = removeTrackIdsFromPlaylists(playlists, removedIds);

                set(state => ({
                    tracks: nextTracks,
                    albums,
                    artists,
                    playlists: playlistResult.playlists,
                    catalogRevision: state.catalogRevision + 1,
                }));

                if (playlistResult.changed) queuePlaylistSync();
                return removedIds.size;
            },

            setHasHydrated: (state: boolean) => {
                set({ _hasHydrated: state });
            },
        }),
        {
            name: 'staysound-library',
            storage: createJSONStorage(() => FileSystemStorage),
            // Custom serialization for Maps
            partialize: (state: LibraryStore) => ({
                tracks: state.isScanning ? [] : Array.from(state.tracks.entries()),
                playlists: Array.from(state.playlists.entries()),
                cloudPlaylistTracks: Array.from(state.cloudPlaylistTracks.entries()).map(([playlistId, tracks]) => [playlistId, Array.from(tracks.entries())]),
                recentSearches: state.recentSearches,
                lastScanDate: state.lastScanDate,
            } as any),
            // Custom hydration to convert arrays back to Maps
            onRehydrateStorage: () => (state) => {
                if (state) {
                    if (Array.isArray(state.tracks)) (state as any).tracks = new Map(state.tracks as any);
                    const hydratedTracks = (state as any).tracks instanceof Map
                        ? (state as any).tracks as Map<string, Track>
                        : new Map<string, Track>();
                    const cleanedTracks = new Map<string, Track>();
                    const removedIds = new Set<string>();
                    hydratedTracks.forEach((track, id) => {
                        if (isLikelyJunkStaySoundTrack(track)) {
                            removedIds.add(id);
                            return;
                        }
                        cleanedTracks.set(id, track);
                    });
                    (state as any).tracks = cleanedTracks;
                    const { albums, artists } = rebuildDerivedLibraryCollections(cleanedTracks);
                    console.log('[LibraryStore] Hydrated library snapshot:', {
                        tracks: cleanedTracks.size,
                        albums: albums.size,
                        artists: artists.size,
                        pruned: removedIds.size,
                    });
                    (state as any).albums = albums;
                    (state as any).artists = artists;
                    if (Array.isArray(state.playlists)) (state as any).playlists = new Map(state.playlists as any);
                    if ((state as any).playlists instanceof Map && removedIds.size > 0) {
                        const playlistResult = removeTrackIdsFromPlaylists((state as any).playlists, removedIds);
                        (state as any).playlists = playlistResult.playlists;
                    }
                    if (Array.isArray((state as any).cloudPlaylistTracks)) {
                        (state as any).cloudPlaylistTracks = new Map(((state as any).cloudPlaylistTracks as any[]).map(([playlistId, tracks]) => [playlistId, new Map(tracks)]));
                    }
                    // Force hydrated flag AFTER Map conversion
                    state.setHasHydrated(true);
                } else {
                    // Fallback for empty/new storage
                    setTimeout(() => {
                        useLibraryStore.getState().setHasHydrated(true);
                    }, 500);
                }
            },
        }
    )
);












