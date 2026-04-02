import { NativeModules, Platform } from 'react-native';
import { useLibraryStore } from '../stores/libraryStore';
import type { Album, Artist, Playlist, Track } from '../types/audio';

type AndroidAutoTrack = {
    id: string;
    uri: string;
    title: string;
    artist: string;
    album: string;
    artwork?: string;
    duration?: number;
};

type AndroidAutoSection = {
    id: string;
    name: string;
    subtitle?: string;
    artwork?: string;
    trackIds: string[];
};

type AndroidAutoCatalogSnapshot = {
    tracks: AndroidAutoTrack[];
    albums: AndroidAutoSection[];
    artists: AndroidAutoSection[];
    playlists: AndroidAutoSection[];
};

type AndroidAutoCatalogModule = {
    updateCatalog: (catalogJson: string) => Promise<void>;
};

const nativeCatalogModule: AndroidAutoCatalogModule | null =
    Platform.OS === 'android' ? NativeModules.StaySoundAndroidAutoCatalog ?? null : null;

let syncTimeout: ReturnType<typeof setTimeout> | null = null;
let lastSerializedCatalog = '';

function normalizeText(value?: string | null): string {
    return value?.trim() || '';
}

function compareByName<T extends { name: string }>(a: T, b: T): number {
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

function compareTracks(a: AndroidAutoTrack, b: AndroidAutoTrack): number {
    const artist = a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' });
    if (artist !== 0) return artist;

    const album = a.album.localeCompare(b.album, undefined, { sensitivity: 'base' });
    if (album !== 0) return album;

    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
}

function serializeTrack(track: Track): AndroidAutoTrack {
    return {
        id: track.id,
        uri: track.uri,
        title: normalizeText(track.title) || 'Unknown Title',
        artist: normalizeText(track.artist) || 'Unknown Artist',
        album: normalizeText(track.album) || 'Unknown Album',
        artwork: normalizeText(track.artwork) || normalizeText(track.artworkThumb) || undefined,
        duration: track.duration,
    };
}

function serializeAlbum(album: Album, tracksById: Map<string, AndroidAutoTrack>): AndroidAutoSection {
    return {
        id: album.id,
        name: normalizeText(album.name) || 'Unknown Album',
        subtitle: normalizeText(album.artist) || undefined,
        artwork: normalizeText(album.artwork) || normalizeText(album.artworkThumb) || undefined,
        trackIds: album.tracks.filter(trackId => tracksById.has(trackId)),
    };
}

function serializeArtist(artist: Artist, sourceTracks: Track[]): AndroidAutoSection {
    const trackIds = sourceTracks
        .filter(track => track.artistId === artist.id || track.artist === artist.name)
        .map(track => track.id);

    return {
        id: artist.id,
        name: normalizeText(artist.name) || 'Unknown Artist',
        artwork: normalizeText(artist.artwork) || undefined,
        trackIds,
    };
}

function serializePlaylist(playlist: Playlist, tracksById: Map<string, AndroidAutoTrack>): AndroidAutoSection {
    return {
        id: playlist.id,
        name: normalizeText(playlist.name) || 'Playlist',
        subtitle: playlist.trackIds.length > 0 ? `${playlist.trackIds.length} tracks` : undefined,
        artwork: normalizeText(playlist.artwork) || undefined,
        trackIds: playlist.trackIds.filter(trackId => tracksById.has(trackId)),
    };
}

function buildCatalogSnapshot(): AndroidAutoCatalogSnapshot {
    const state = useLibraryStore.getState();
    const sourceTracks = Array.from(state.tracks.values());
    const tracks = sourceTracks
        .map(serializeTrack)
        .sort(compareTracks);
    const tracksById = new Map(tracks.map(track => [track.id, track]));

    const albums = Array.from(state.albums.values())
        .map(album => serializeAlbum(album, tracksById))
        .filter(album => album.trackIds.length > 0)
        .sort(compareByName);

    const artists = Array.from(state.artists.values())
        .map(artist => serializeArtist(artist, sourceTracks))
        .filter(artist => artist.trackIds.length > 0)
        .sort(compareByName);

    const playlists = Array.from(state.playlists.values())
        .map(playlist => serializePlaylist(playlist, tracksById))
        .filter(playlist => playlist.trackIds.length > 0)
        .sort(compareByName);

    return {
        tracks,
        albums,
        artists,
        playlists,
    };
}

export async function syncAndroidAutoCatalogNow(): Promise<void> {
    if (!nativeCatalogModule) return;

    const state = useLibraryStore.getState();
    if (!state._hasHydrated) return;

    const serialized = JSON.stringify(buildCatalogSnapshot());
    if (serialized === lastSerializedCatalog) return;

    lastSerializedCatalog = serialized;

    try {
        await nativeCatalogModule.updateCatalog(serialized);
    } catch (error) {
        console.warn('[AndroidAutoCatalog] Failed to sync native catalog:', error);
    }
}

export function scheduleAndroidAutoCatalogSync(delayMs = 400): void {
    if (!nativeCatalogModule) return;

    if (syncTimeout) {
        clearTimeout(syncTimeout);
    }

    syncTimeout = setTimeout(() => {
        syncTimeout = null;
        void syncAndroidAutoCatalogNow();
    }, delayMs);
}
