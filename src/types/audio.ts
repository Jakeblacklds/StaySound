// Audio types for StaySound

export interface Track {
    id: string;
    uri: string;
    title: string;
    artist: string;
    album: string;
    duration: number; // milliseconds
    artwork?: string; // URI to artwork image
    artworkThumb?: string; // Small thumbnail URI for list rendering
    albumId?: string;
    artistId?: string;
    trackNumber?: number;
    year?: number;
    genre?: string;
    format?: string;
    codec?: string;
    sampleRate?: number; // Hz
    bitDepth?: number;
    quality?: string;
    dateAdded: number;
    favorite?: boolean;
}

export interface Album {
    id: string;
    name: string;
    artist: string;
    artistId?: string;
    artwork?: string;
    artworkThumb?: string;
    year?: number;
    trackCount: number;
    tracks: string[]; // Track IDs
}

export interface Artist {
    id: string;
    name: string;
    artwork?: string; // From Deezer API
    albumCount: number;
    trackCount: number;
    albums: string[]; // Album IDs
}

export interface Playlist {
    id: string;
    name: string;
    description?: string;
    artwork?: string;
    trackIds: string[];
    createdAt: number;
    updatedAt: number;
}

export type RepeatMode = 'off' | 'one' | 'all';

export interface PlayerState {
    currentTrack: Track | null;
    queue: Track[];
    queueIndex: number;
    isPlaying: boolean;
    isLoading: boolean;
    position: number; // milliseconds
    duration: number; // milliseconds
    repeatMode: RepeatMode;
    shuffleEnabled: boolean;
    volume: number; // 0-1
    playerVariant: 'aurora' | 'cyber' | 'brutal' | 'immersive';
}

export interface ScanProgress {
    total: number;
    scanned: number;
    currentPath: string;
}

export type TidalQuality = 'HI_RES_LOSSLESS' | 'LOSSLESS' | 'HIGH' | 'LOW';

export interface TidalTrack {
    id: number;
    title: string;
    artist: string;
    artistId?: number;
    album: string;
    albumId?: number;
    durationMs: number;
    quality: string;
    isHiRes: boolean;
    coverUuid?: string | null;
    artworkUrl?: string;
    trackNumber?: number;
    year?: number;
    explicit?: boolean;
    popularity?: number;
    sampleRate?: number;
    bitDepth?: number;
    codec?: string;
}

export type TidalSearchResult = TidalTrack;

export interface TidalArtist {
    id: number;
    name: string;
    picture?: string;
    artworkUrl?: string;
    popularity?: number;
}

export interface TidalAlbum {
    id: number;
    title: string;
    artistId?: number;
    artistName: string;
    coverUuid?: string | null;
    artworkUrl?: string;
    releaseDate?: string;
    year?: number;
    numberOfTracks?: number;
    explicit?: boolean;
}

export interface TidalArtistDetail {
    artist: TidalArtist;
    topTracks: TidalTrack[];
    albums: TidalAlbum[];
}

export interface TidalAlbumDetail {
    album: TidalAlbum;
    tracks: TidalTrack[];
}

export interface DownloadState {
    status: 'idle' | 'downloading' | 'done' | 'error';
    progress: number;
    error?: string;
    updatedAt: number;
}

export interface LibraryState {
    tracks: Map<string, Track>;
    albums: Map<string, Album>;
    artists: Map<string, Artist>;
    playlists: Map<string, Playlist>;
    recentSearches: string[];
    isScanning: boolean;
    scanProgress: ScanProgress | null;
    lastScanDate: number | null;
    _hasHydrated: boolean;
}
