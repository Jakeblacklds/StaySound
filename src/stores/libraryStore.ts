/**
 * LibraryStore - Zustand store for music library
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { getArtistInfo } from '../services/artistApi';
import { MUSIC_FOLDERS, runConcurrent, scanMusicLibraryFast, withTimeout } from '../services/fileScanner';
import { enrichTrackFromUri, generateAlbumId, organizeIntoAlbums, organizeIntoArtists } from '../services/metadataService';
import { FileSystemStorage } from '../services/storage';
import { Album, Artist, LibraryState, Playlist, ScanProgress, Track } from '../types/audio';

const MAX_RECENT_SEARCHES = 12;
let isRefreshingArtistPhotos = false;

const isRemoteArtworkUri = (uri?: string) =>
    typeof uri === 'string' && (uri.startsWith('http://') || uri.startsWith('https://'));

interface LibraryActions {
    // Scanning
    scanLibrary: (folderPath?: string) => Promise<void>;
    cancelScan: () => void;
    refreshArtistPhotos: () => Promise<void>;

    // Track operations
    addTrack: (track: Track) => void;
    updateTrack: (id: string, updates: Partial<Track>) => void;
    applyAlbumArtwork: (album: string, artist: string, artwork: string) => void;
    removeTrack: (id: string) => void;
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
                    // Do NOT call organizeIntoAlbums/Artists per-batch (too expensive).
                    // Instead, accumulate into a local map and flush once after scanning.
                    const scanPath = folderPath ?? MUSIC_FOLDERS.download;
                    console.log(`[LibraryStore] FAST SCAN starting: ${scanPath || 'DOWNLOAD ONLY'}`);

                    const collectedTracks = new Map<string, Track>();
                    let batchCount = 0;
                    let lastUiFlush = 0;
                    const UI_FLUSH_INTERVAL_MS = 300;

                    const result = await scanMusicLibraryFast(
                        { folderPattern: scanPath },
                        (progress: ScanProgress) => {
                            set({ scanProgress: progress });
                        },
                        // During fast scan: sólo acumular tracks sin organizar en albums.
                        // Los nombres de álbumes del filename suelen ser incorrectos ("Unknown Album").
                        // Organizamos una sola vez al final con nombres correctos de carpeta.
                        (newTracks: Track[]) => {
                            batchCount++;
                            newTracks.forEach(track => {
                                const enriched = enrichTrackFromUri(track, track.uri);
                                collectedTracks.set(track.id, enriched);
                            });
                            // Throttle store writes to keep JS thread smooth.
                            const now = Date.now();
                            if (batchCount === 1 || now - lastUiFlush >= UI_FLUSH_INTERVAL_MS) {
                                lastUiFlush = now;
                                set({ tracks: new Map(collectedTracks) });
                            }
                            console.log(`[LibraryStore] Fast batch #${batchCount}: ${collectedTracks.size} tracks collected`);
                        }
                    );

                    const scanDuration = Date.now() - startTime;
                    console.log(`[LibraryStore] FAST SCAN complete in ${scanDuration}ms: ${collectedTracks.size} tracks total`);

                    // Organizar albums/artists UNA sola vez con los nombres de carpeta correctos
                    const finalTracks = Array.from(collectedTracks.values());
                    const initialAlbums = organizeIntoAlbums(finalTracks);
                    const initialArtists = organizeIntoArtists(finalTracks, initialAlbums);

                    console.log(`[LibraryStore] Initial organization: ${initialAlbums.size} albums, ${initialArtists.size} artists`);

                    set({
                        tracks: collectedTracks,
                        albums: initialAlbums,
                        artists: initialArtists,
                        isScanning: false,
                        scanProgress: null,
                        lastScanDate: Date.now(),
                    });

                    // No bulk metadata/artwork parsing here.
                    // Keep library scan instant and smooth like native players.

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
            },

            removeTrack: (id: string) => {
                const { tracks } = get();
                const newTracks = new Map(tracks);
                newTracks.delete(id);
                set({ tracks: newTracks });
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
