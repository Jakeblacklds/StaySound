// Audio types for StaySound

export interface Track {
    id: string;
    uri: string;
    title: string;
    artist: string;
    album: string;
    duration: number; // milliseconds
    artwork?: string; // URI to artwork image
    albumId?: string;
    artistId?: string;
    trackNumber?: number;
    year?: number;
    genre?: string;
    dateAdded: number;
}

export interface Album {
    id: string;
    name: string;
    artist: string;
    artistId?: string;
    artwork?: string;
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
}

export interface ScanProgress {
    total: number;
    scanned: number;
    currentPath: string;
}

export interface LibraryState {
    tracks: Map<string, Track>;
    albums: Map<string, Album>;
    artists: Map<string, Artist>;
    playlists: Map<string, Playlist>;
    isScanning: boolean;
    scanProgress: ScanProgress | null;
    lastScanDate: number | null;
}
