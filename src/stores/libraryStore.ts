/**
 * LibraryStore - Zustand store for music library
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { getArtistInfo } from '../services/artistApi';
import { getArtworkThumbUri } from '../services/artworkThumbnails';
import { MUSIC_FOLDERS, runConcurrent, scanMusicLibraryFast, withTimeout } from '../services/fileScanner';
import { enrichTrackFromUri, generateAlbumId, organizeIntoAlbums, organizeIntoArtists } from '../services/metadataService';
import { FileSystemStorage } from '../services/storage';
import { Album, Artist, LibraryState, Playlist, ScanProgress, Track } from '../types/audio';

const MAX_RECENT_SEARCHES = 12;
let isRefreshingArtistPhotos = false;
let isHydratingArtworkThumbs = false;

const isRemoteArtworkUri = (uri?: string) =>
    typeof uri === 'string' && (uri.startsWith('http://') || uri.startsWith('https://'));

const GENERIC_LIBRARY_VALUES = new Set(['unknown', 'unknown title', 'unknown artist', 'unknown album', 'media', 'external', 'staysound']);

const hasMeaningfulLibraryValue = (value?: string) => {
    const normalized = value?.trim().toLowerCase();
    return !!normalized && !GENERIC_LIBRARY_VALUES.has(normalized);
};

const isMediaStoreAlbumArtUri = (uri?: string) =>
    typeof uri === 'string' && uri.startsWith('content://media/external/audio/albumart/');

const resolveArtworkFromScan = (scannedArtwork?: string, existingArtwork?: string) => {
    if (!existingArtwork) return scannedArtwork;
    if (!scannedArtwork) return existingArtwork;
    if (isMediaStoreAlbumArtUri(scannedArtwork) && !isMediaStoreAlbumArtUri(existingArtwork)) {
        return existingArtwork;
    }
    return scannedArtwork;
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
    createPlaylist: (name: string, description?: string) => string;
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
    setHasHydrated: (state: boolean) => void;
}

export type LibraryStore = LibraryState & LibraryActions;

const initialState: LibraryState = {
    tracks: new Map(),
    albums: new Map(),
    artists: new Map(),
    playlists: new Map(),
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

            scanLibrary: async (folderPath?: string) => {
                const startTime = Date.now();
                set({ isScanning: true, scanProgress: { total: 0, scanned: 0, currentPath: 'Scanning...' } });

                try {
                    // PHASE 1: Fast scan — collect ALL tracks from MediaStore instantly
                    const scanPath = folderPath ?? MUSIC_FOLDERS.download;
                    console.log(`[LibraryStore] FAST SCAN starting: ${scanPath || 'DOWNLOAD ONLY'}`);

                    const collectedTracks = new Map<string, Track>();
                    const currentTracks = get().tracks;

                    // Build a filename → existing track lookup.
                    // WHY: Downloaded tracks use SAF URIs (content://com.android.externalstorage.documents/...)
                    // but MediaStore gives the SAME file a completely different URI (content://media/external/...).
                    // So matching by URI never works. Matching by filename (without extension) is reliable.
                    const existingByFilename = new Map<string, Track>(); // filename_no_ext (lowercase) → track
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
                                const enrichmentSource = track._filename || track.uri;
                                const enriched = enrichTrackFromUri(track, enrichmentSource);

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

                                // Strip _filename before storing (it's a temporary scan-only field)
                                const { _filename: _discard, ...cleanEnriched } = enriched;

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
                        isScanning: false,
                        scanProgress: null,
                        lastScanDate: Date.now(),
                    });

                    void get().ensureArtworkThumbsForTracks();

                    // Mantenimiento (DESACTIVADO TRAS EXPERIMENTO)
                    // const { syncInternalCacheHeaders } = require('../services/cacheHeadersProvider');
                    // void syncInternalCacheHeaders(true);

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
                        set({ artists: new Map(normalizedArtists) });
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
                            const info = await withTimeout(getArtistInfo(artist.name), 5000);
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
                        set({ artists: new Map(updatedArtists) });
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
                set({ tracks: newTracks });
            },

            updateTrack: (id: string, updates: Partial<Track>) => {
                const { tracks } = get();
                const track = tracks.get(id);
                if (track) {
                    const newTracks = new Map(tracks);
                    newTracks.set(id, { ...track, ...updates });
                    set({ tracks: newTracks });
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
                    set({ tracks: updatedTracks, albums: updatedAlbums });
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
                        set({ tracks: nextTracks, albums: nextAlbums });
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
                        return !!artwork && !track.artworkThumb;
                    });

                    if (tracksToHydrate.length === 0) return;

                    const nextTracks = new Map(state.tracks);
                    const nextAlbums = new Map(state.albums);
                    let changes = 0;

                    await runConcurrent(tracksToHydrate, 2, async (track) => {
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
                        set({ tracks: new Map(nextTracks), albums: new Map(nextAlbums) });
                    }
                } finally {
                    isHydratingArtworkThumbs = false;
                }
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
                });
            },

            deleteTrack: async (id: string, deleteFile = false) => {
                const { tracks, playlists } = get();
                const track = tracks.get(id);
                if (!track) return;

                // 1. Delete from File System if requested
                if (deleteFile) {
                    try {
                        if (id.startsWith('tidal_')) {
                            const FileSystem = require('expo-file-system/legacy');
                            if (track.uri) {
                                await FileSystem.deleteAsync(track.uri, { idempotent: true });
                            }
                        } else {
                            const { deleteAssetsAsync } = require('expo-media-library');
                            const assetId = id.startsWith('track_') ? id.replace('track_', '') : id;
                            await deleteAssetsAsync([assetId]);
                        }
                    } catch (e) {
                        console.warn('[LibraryStore] Failed to delete file from disk:', e);
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
                    ...(playlistsChanged ? { playlists: nextPlaylists } : {}),
                });
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
                return Array.from(tracksMap.values()).filter(t => t.artistId === id);
            },

            getTracksByArtist: (id: string) => {
                const artist = get().artists.get(id);
                if (!artist) return [];
                const { tracks: tracksMap } = get();
                return Array.from(tracksMap.values()).filter(t => t.artistId === id);
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

            createPlaylist: (name: string, description?: string) => {
                const { playlists } = get();
                const id = `playlist_${Date.now()} `;
                const newPlaylist: Playlist = {
                    id,
                    name,
                    description,
                    trackIds: [],
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                };
                const newPlaylists = new Map(playlists);
                newPlaylists.set(id, newPlaylist);
                set({ playlists: newPlaylists });
                return id;
            },

            updatePlaylist: (id: string, updates: { name?: string; description?: string; artwork?: string }) => {
                const { playlists } = get();
                const playlist = playlists.get(id);
                if (!playlist) return;

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
                set({ playlists: newPlaylists });
            },

            deletePlaylist: (id: string) => {
                const { playlists } = get();
                const newPlaylists = new Map(playlists);
                newPlaylists.delete(id);
                set({ playlists: newPlaylists });
            },

            addToPlaylist: (playlistId: string, trackId: string) => {
                const { playlists } = get();
                const playlist = playlists.get(playlistId);
                if (playlist && !playlist.trackIds.includes(trackId)) {
                    const newPlaylists = new Map(playlists);
                    newPlaylists.set(playlistId, {
                        ...playlist,
                        trackIds: [...playlist.trackIds, trackId],
                        updatedAt: Date.now(),
                    });
                    set({ playlists: newPlaylists });
                }
            },

            removeFromPlaylist: (playlistId: string, trackId: string) => {
                const { playlists } = get();
                const playlist = playlists.get(playlistId);
                if (playlist) {
                    const newPlaylists = new Map(playlists);
                    newPlaylists.set(playlistId, {
                        ...playlist,
                        trackIds: playlist.trackIds.filter(id => id !== trackId),
                        updatedAt: Date.now(),
                    });
                    set({ playlists: newPlaylists });
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
                return playlist.trackIds
                    .map(trackId => tracksMap.get(trackId))
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
                set({ tracks: newTracks, playlists: newPlaylists });
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
                    lastScanDate: null,
                });
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
                albums: state.isScanning ? [] : Array.from(state.albums.entries()),
                artists: state.isScanning ? [] : Array.from(state.artists.entries()),
                playlists: Array.from(state.playlists.entries()),
                recentSearches: state.recentSearches,
                lastScanDate: state.lastScanDate,
            } as any),
            // Custom hydration to convert arrays back to Maps
            onRehydrateStorage: () => (state) => {
                if (state) {
                    if (Array.isArray(state.tracks)) (state as any).tracks = new Map(state.tracks as any);
                    if (Array.isArray(state.albums)) (state as any).albums = new Map(state.albums as any);
                    if (Array.isArray(state.artists)) (state as any).artists = new Map(state.artists as any);
                    if (Array.isArray(state.playlists)) (state as any).playlists = new Map(state.playlists as any);
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







