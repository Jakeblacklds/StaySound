/**
 * LibraryStore - Zustand store for music library
 */

import { create } from 'zustand';
import { scanMusicLibrary } from '../services/fileScanner';
import { enrichTrackFromFilename, organizeIntoAlbums, organizeIntoArtists } from '../services/metadataService';
import { Album, Artist, LibraryState, Playlist, ScanProgress, Track } from '../types/audio';

interface LibraryActions {
    // Scanning
    scanLibrary: () => Promise<void>;
    cancelScan: () => void;

    // Track operations
    addTrack: (track: Track) => void;
    updateTrack: (id: string, updates: Partial<Track>) => void;
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
    deletePlaylist: (id: string) => void;
    addToPlaylist: (playlistId: string, trackId: string) => void;
    removeFromPlaylist: (playlistId: string, trackId: string) => void;
    getPlaylist: (id: string) => Playlist | undefined;
    getAllPlaylists: () => Playlist[];
    getPlaylistTracks: (id: string) => Track[];

    // Search
    search: (query: string) => { tracks: Track[]; albums: Album[]; artists: Artist[] };

    // Clear
    clearLibrary: () => void;
}

type LibraryStore = LibraryState & LibraryActions;

const initialState: LibraryState = {
    tracks: new Map(),
    albums: new Map(),
    artists: new Map(),
    playlists: new Map(),
    isScanning: false,
    scanProgress: null,
    lastScanDate: null,
};

export const useLibraryStore = create<LibraryStore>((set, get) => ({
    ...initialState,

    scanLibrary: async () => {
        set({ isScanning: true, scanProgress: { total: 0, scanned: 0, currentPath: '' } });

        try {
            const result = await scanMusicLibrary((progress: ScanProgress) => {
                set({ scanProgress: progress });
            });

            // Enrich tracks with filename parsing
            const enrichedTracks = result.tracks.map(track => {
                const filename = track.uri.split('/').pop() || '';
                return enrichTrackFromFilename(track, filename);
            });

            // Create maps
            const tracksMap = new Map<string, Track>();
            enrichedTracks.forEach(track => tracksMap.set(track.id, track));

            // Organize into albums and artists
            const albumsMap = organizeIntoAlbums(enrichedTracks);
            const artistsMap = organizeIntoArtists(enrichedTracks, albumsMap);

            set({
                tracks: tracksMap,
                albums: albumsMap,
                artists: artistsMap,
                isScanning: false,
                scanProgress: null,
                lastScanDate: Date.now(),
            });

            console.log(`[LibraryStore] Scan complete: ${tracksMap.size} tracks, ${albumsMap.size} albums, ${artistsMap.size} artists`);

        } catch (error) {
            console.error('[LibraryStore] Scan error:', error);
            set({ isScanning: false, scanProgress: null });
        }
    },

    cancelScan: () => {
        // TODO: Implement cancellation
        set({ isScanning: false, scanProgress: null });
    },

    addTrack: (track) => {
        const { tracks } = get();
        const newTracks = new Map(tracks);
        newTracks.set(track.id, track);
        set({ tracks: newTracks });
    },

    updateTrack: (id, updates) => {
        const { tracks } = get();
        const track = tracks.get(id);
        if (track) {
            const newTracks = new Map(tracks);
            newTracks.set(id, { ...track, ...updates });
            set({ tracks: newTracks });
        }
    },

    removeTrack: (id) => {
        const { tracks } = get();
        const newTracks = new Map(tracks);
        newTracks.delete(id);
        set({ tracks: newTracks });
    },

    getTrack: (id) => {
        return get().tracks.get(id);
    },

    getAllTracks: () => {
        return Array.from(get().tracks.values());
    },

    getAlbum: (id) => {
        return get().albums.get(id);
    },

    // Alias for getAlbum
    getAlbumById: (id) => {
        return get().albums.get(id);
    },

    getAllAlbums: () => {
        return Array.from(get().albums.values());
    },

    getAlbumTracks: (id) => {
        const album = get().albums.get(id);
        if (!album) return [];
        return album.tracks
            .map(trackId => get().tracks.get(trackId))
            .filter((t): t is Track => t !== undefined);
    },

    // Alias for getAlbumTracks
    getTracksByAlbum: (id) => {
        const album = get().albums.get(id);
        if (!album) return [];
        return album.tracks
            .map(trackId => get().tracks.get(trackId))
            .filter((t): t is Track => t !== undefined);
    },

    getArtist: (id) => {
        return get().artists.get(id);
    },

    // Alias for getArtist
    getArtistById: (id) => {
        return get().artists.get(id);
    },

    getAllArtists: () => {
        return Array.from(get().artists.values());
    },

    getArtistTracks: (id) => {
        const artist = get().artists.get(id);
        if (!artist) return [];

        return get().getAllTracks().filter(
            track => track.artist.toLowerCase() === artist.name.toLowerCase()
        );
    },

    // Alias for getArtistTracks
    getTracksByArtist: (id) => {
        const artist = get().artists.get(id);
        if (!artist) return [];

        return get().getAllTracks().filter(
            track => track.artist.toLowerCase() === artist.name.toLowerCase()
        );
    },

    getArtistAlbums: (id) => {
        const artist = get().artists.get(id);
        if (!artist) return [];

        return artist.albums
            .map(albumId => get().albums.get(albumId))
            .filter((a): a is Album => a !== undefined);
    },

    // Alias for getArtistAlbums
    getAlbumsByArtist: (id) => {
        const artist = get().artists.get(id);
        if (!artist) return [];

        return artist.albums
            .map(albumId => get().albums.get(albumId))
            .filter((a): a is Album => a !== undefined);
    },

    createPlaylist: (name, description) => {
        const id = `playlist_${Date.now()}`;
        const { playlists } = get();
        const newPlaylists = new Map(playlists);

        newPlaylists.set(id, {
            id,
            name,
            description,
            trackIds: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });

        set({ playlists: newPlaylists });
        return id;
    },

    deletePlaylist: (id) => {
        const { playlists } = get();
        const newPlaylists = new Map(playlists);
        newPlaylists.delete(id);
        set({ playlists: newPlaylists });
    },

    addToPlaylist: (playlistId, trackId) => {
        const { playlists } = get();
        const playlist = playlists.get(playlistId);
        if (!playlist) return;

        if (!playlist.trackIds.includes(trackId)) {
            const newPlaylists = new Map(playlists);
            newPlaylists.set(playlistId, {
                ...playlist,
                trackIds: [...playlist.trackIds, trackId],
                updatedAt: Date.now(),
            });
            set({ playlists: newPlaylists });
        }
    },

    removeFromPlaylist: (playlistId, trackId) => {
        const { playlists } = get();
        const playlist = playlists.get(playlistId);
        if (!playlist) return;

        const newPlaylists = new Map(playlists);
        newPlaylists.set(playlistId, {
            ...playlist,
            trackIds: playlist.trackIds.filter(id => id !== trackId),
            updatedAt: Date.now(),
        });
        set({ playlists: newPlaylists });
    },

    getPlaylist: (id) => {
        return get().playlists.get(id);
    },

    getAllPlaylists: () => {
        return Array.from(get().playlists.values());
    },

    getPlaylistTracks: (id) => {
        const playlist = get().playlists.get(id);
        if (!playlist) return [];

        return playlist.trackIds
            .map(trackId => get().tracks.get(trackId))
            .filter((t): t is Track => t !== undefined);
    },

    search: (query) => {
        const q = query.toLowerCase();
        const { tracks, albums, artists } = get();

        return {
            tracks: Array.from(tracks.values()).filter(t =>
                t.title.toLowerCase().includes(q) ||
                t.artist.toLowerCase().includes(q) ||
                t.album.toLowerCase().includes(q)
            ),
            albums: Array.from(albums.values()).filter(a =>
                a.name.toLowerCase().includes(q) ||
                a.artist.toLowerCase().includes(q)
            ),
            artists: Array.from(artists.values()).filter(a =>
                a.name.toLowerCase().includes(q)
            ),
        };
    },

    clearLibrary: () => {
        set({
            tracks: new Map(),
            albums: new Map(),
            artists: new Map(),
            lastScanDate: null,
        });
    },
}));
