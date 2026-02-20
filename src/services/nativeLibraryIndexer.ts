import { Platform } from 'react-native';
import { Track } from '../types/audio';

type NativeScanTrack = {
    id: string;
    uri: string;
    title: string;
    artist: string;
    album: string;
    durationMs: number;
    dateAddedMs: number;
    artwork?: string;
    albumId?: string;
    relativePath?: string;
    displayName?: string;
};

type NativeLibraryIndexerApi = {
    isLibraryIndexerAvailable: () => boolean;
    scanTracksNative: (folderPattern?: string) => Promise<NativeScanTrack[]>;
};

let nativeApi: NativeLibraryIndexerApi | null = null;

function getNativeApi(): NativeLibraryIndexerApi | null {
    if (nativeApi) return nativeApi;
    if (Platform.OS !== 'android') return null;

    try {
        nativeApi = require('library-indexer') as NativeLibraryIndexerApi;
        return nativeApi;
    } catch {
        return null;
    }
}

export function canUseNativeLibraryIndexer(): boolean {
    const api = getNativeApi();
    if (!api) return false;

    try {
        return api.isLibraryIndexerAvailable();
    } catch {
        return false;
    }
}

export async function scanMusicNative(folderPattern?: string): Promise<Track[]> {
    const api = getNativeApi();
    if (!api) return [];

    const nativeTracks = await api.scanTracksNative(folderPattern);
    return nativeTracks.map((track) => ({
        id: track.id,
        uri: track.uri,
        title: track.title || 'Unknown Title',
        artist: track.artist || 'Unknown Artist',
        album: track.album || 'Unknown Album',
        duration: track.durationMs || 0,
        artwork: track.artwork,
        albumId: track.albumId,
        dateAdded: track.dateAddedMs || Date.now(),
        format: getFormatFromValue(track.displayName || track.uri),
    }));
}

function getFormatFromValue(value: string): string | undefined {
    const match = value.toLowerCase().match(/\.([a-z0-9]+)(\?|$)/);
    if (!match) return undefined;
    return match[1].toUpperCase();
}
