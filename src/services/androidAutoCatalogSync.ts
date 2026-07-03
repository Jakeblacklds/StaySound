import { NativeModules, Platform } from 'react-native';
import { generateArtistId } from './metadataService';
import { isTrackPlayable } from './trackPlayerService';
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

async function ensureLibraryStoreReady(): Promise<boolean> {
    const libraryStore = useLibraryStore as typeof useLibraryStore & {
        persist?: {
            rehydrate?: () => Promise<void> | void;
        };
    };

    const state = useLibraryStore.getState();
    if (state._hasHydrated) return true;

    try {
        await libraryStore.persist?.rehydrate?.();
    } catch {
        return useLibraryStore.getState()._hasHydrated;
    }

    return useLibraryStore.getState()._hasHydrated;
}

function normalizeText(value?: string | null): string {
    return value?.trim() || '';
}

function normalizeArtworkUri(value?: string | null): string | undefined {
    const uri = normalizeText(value);
    if (!uri) return undefined;

    // Android Auto/Media3 does not reliably render embedded data URIs.
    if (uri.startsWith('data:')) return undefined;

    if (
        uri.startsWith('content://')
        || uri.startsWith('file://')
        || uri.startsWith('http://')
        || uri.startsWith('https://')
    ) {
        return uri;
    }

    if (uri.startsWith('/')) {
        return `file://${uri}`;
    }

    return undefined;
}

function resolveTrackArtwork(track: Track): string | undefined {
    return normalizeArtworkUri(track.artworkThumb) ?? normalizeArtworkUri(track.artwork);
}

const MEDIA_STORE_AUDIO_RE = /^content:\/\/media\/[^/]+\/audio\/media\/\d+/i;

function normalizeRelativePath(relativePath?: string): string {
    return (relativePath ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function encodePathSegments(pathValue: string): string {
    return pathValue
        .split('/')
        .filter(Boolean)
        .map(segment => encodeURIComponent(segment))
        .join('/');
}

function buildFilePlaybackUri(track: Track): string | undefined {
    const relativePath = normalizeRelativePath(track.relativePath);
    const fileName = (track._filename ?? '').trim();
    if (!relativePath || !fileName) return undefined;

    return `file:///storage/emulated/0/${encodePathSegments(relativePath)}/${encodeURIComponent(fileName)}`;
}

/**
 * Produce a directly-playable URI for the native Android Auto catalog.
 *
 * The car plays from a headless service where content:// MediaStore URIs fail on
 * many devices, so we hand the native player the reconstructed file:// path —
 * mirroring trackPlayerService.resolveNativePlaybackUrl's primary branch. The
 * native side has no access to Expo FileSystem to resolve this at play time, so
 * it must be baked into the catalog snapshot.
 */
function resolvePlaybackUri(track: Track): string {
    const uri = normalizeText(track.uri);

    if (MEDIA_STORE_AUDIO_RE.test(uri)) {
        const fileUri = buildFilePlaybackUri(track);
        if (fileUri) return fileUri;
    }

    if (uri.startsWith('/')) return `file://${uri}`;

    return uri;
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
        uri: resolvePlaybackUri(track),
        title: normalizeText(track.title) || 'Unknown Title',
        artist: normalizeText(track.artist) || 'Unknown Artist',
        album: normalizeText(track.album) || 'Unknown Album',
        artwork: resolveTrackArtwork(track),
        duration: track.duration,
    };
}

function serializeAlbum(album: Album, tracksById: Map<string, AndroidAutoTrack>): AndroidAutoSection {
    return {
        id: album.id,
        name: normalizeText(album.name) || 'Unknown Album',
        subtitle: normalizeText(album.artist) || undefined,
        artwork: normalizeArtworkUri(album.artworkThumb) ?? normalizeArtworkUri(album.artwork),
        trackIds: album.tracks.filter(trackId => tracksById.has(trackId)),
    };
}

function serializeArtist(artist: Artist, sourceTracks: Track[]): AndroidAutoSection {
    const trackIds = sourceTracks
        .filter(track => track.artistId === artist.id || generateArtistId(track.artist) === artist.id || track.artist === artist.name)
        .map(track => track.id);

    return {
        id: artist.id,
        name: normalizeText(artist.name) || 'Unknown Artist',
        artwork: normalizeArtworkUri(artist.artwork),
        trackIds,
    };
}

function serializePlaylist(playlist: Playlist, tracksById: Map<string, AndroidAutoTrack>): AndroidAutoSection {
    return {
        id: playlist.id,
        name: normalizeText(playlist.name) || 'Playlist',
        subtitle: playlist.trackIds.length > 0 ? `${playlist.trackIds.length} tracks` : undefined,
        artwork: normalizeArtworkUri(playlist.artwork),
        trackIds: playlist.trackIds.filter(trackId => tracksById.has(trackId)),
    };
}

function buildCatalogSnapshot(): AndroidAutoCatalogSnapshot {
    const state = useLibraryStore.getState();
    // Only expose tracks the native player can actually start; cloud-only / spotify://
    // / unsupported-container tracks would show in the car but play silence.
    const sourceTracks = Array.from(state.tracks.values()).filter(track => isTrackPlayable(track));
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

    const isReady = await ensureLibraryStoreReady();
    if (!isReady) return;

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
