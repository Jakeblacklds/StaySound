import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { TidalSearchResult, Track } from '../types/audio';
import { FileSystemStorage } from './storage';

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

type TidalMetadataSidecar = Partial<Pick<Track, 'title' | 'artist' | 'album' | 'artwork' | 'trackNumber' | 'year' | 'quality' | 'codec' | 'sampleRate' | 'bitDepth' | 'source' | 'tidalId' | 'tidalAlbumId'>>;

type NativeLibraryIndexerApi = {
    isLibraryIndexerAvailable: () => boolean;
    scanTracksNative: (folderPattern?: string) => Promise<NativeScanTrack[]>;
};

type DirectoryEntryRef = {
    name: string;
    uri: string;
};

type PersistedPublicDownloadsPermission = {
    directoryUri: string;
};

const TIDAL_PUBLIC_DOWNLOADS_PERMISSION_KEY = 'tidal-public-downloads-permission';
const MAX_CONCURRENT_TIDAL_HYDRATIONS = 3;

let nativeApi: NativeLibraryIndexerApi | null = null;
const directoryEntriesCache = new Map<string, Promise<DirectoryEntryRef[]>>();
const metadataSidecarCache = new Map<string, Promise<TidalMetadataSidecar | null>>();
const tidalHydrationCache = new Map<string, Promise<TidalMetadataSidecar | null>>();
let activeHydrationCount = 0;
const pendingHydrationResolvers: Array<() => void> = [];

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

import { parseFilename, sanitizeFilename } from './audioUtils';

const UNKNOWN_TITLES = new Set(['unknown', 'unknown title']);
const UNKNOWN_ARTISTS = new Set(['unknown', 'unknown artist']);
const GENERIC_ALBUMS = new Set(['unknown', 'unknown album', 'staysound', 'download', 'downloads', 'music']);
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'];

function normalizeValue(value?: string): string {
    return (value ?? '').trim().toLowerCase();
}

function normalizeMatchValue(value?: string): string {
    return (value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function ensureTrailingSlash(value: string): string {
    return value.endsWith('/') ? value : `${value}/`;
}

function stripExtension(value: string): string {
    return value.replace(/\.[^/.]+$/, '').trim();
}

function getSafEntityName(uri: string): string {
    const decoded = decodeURIComponent(uri);
    const lastSlash = decoded.lastIndexOf('/');
    const lastSegment = lastSlash >= 0 ? decoded.slice(lastSlash + 1) : decoded;
    const colonIndex = lastSegment.lastIndexOf(':');
    const withoutProvider = colonIndex >= 0 ? lastSegment.slice(colonIndex + 1) : lastSegment;
    const pathParts = withoutProvider.split('/').filter(Boolean);
    return pathParts[pathParts.length - 1] ?? withoutProvider;
}

function shouldUseParsedTitle(rawTitle: string | undefined, displayName: string): boolean {
    const normalizedTitle = normalizeValue(rawTitle);
    if (!normalizedTitle || UNKNOWN_TITLES.has(normalizedTitle)) return true;

    const normalizedDisplayName = normalizeValue(stripExtension(displayName));
    return !!normalizedDisplayName && normalizedTitle === normalizedDisplayName;
}

function shouldUseParsedAlbum(rawAlbum: string | undefined): boolean {
    const normalizedAlbum = normalizeValue(rawAlbum);
    return !normalizedAlbum || GENERIC_ALBUMS.has(normalizedAlbum);
}

function isKnownAlbumValue(album?: string): boolean {
    const normalizedAlbum = normalizeValue(album);
    return !!normalizedAlbum && !GENERIC_ALBUMS.has(normalizedAlbum);
}

function isLikelyTidalDownload(relativePath?: string): boolean {
    return normalizeValue(relativePath).includes('staysound');
}

function getRelativeFolderUri(relativePath?: string): string | null {
    const normalizedRelativePath = relativePath?.replace(/\\/g, '/').trim() ?? '';
    if (!normalizedRelativePath || !normalizedRelativePath.toLowerCase().includes('staysound')) {
        return null;
    }

    const trimmedRelativePath = normalizedRelativePath.replace(/^\/+|\/+$/g, '');
    return ensureTrailingSlash(`file:///storage/emulated/0/${trimmedRelativePath}`);
}

function toFileDirectoryEntries(folderUri: string, names: string[]): DirectoryEntryRef[] {
    const baseUri = ensureTrailingSlash(folderUri);
    return names.map(name => ({ name, uri: `${baseUri}${name}` }));
}

async function getPersistedPublicDownloadsDirectoryUri(): Promise<string | null> {
    try {
        const raw = await FileSystemStorage.getItem(TIDAL_PUBLIC_DOWNLOADS_PERMISSION_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as Partial<PersistedPublicDownloadsPermission>;
        const directoryUri = typeof parsed.directoryUri === 'string' ? parsed.directoryUri : null;
        if (!directoryUri) return null;

        await FileSystem.StorageAccessFramework.readDirectoryAsync(directoryUri);
        return directoryUri;
    } catch {
        return null;
    }
}

async function getDirectoryEntries(relativePath?: string): Promise<DirectoryEntryRef[]> {
    const persistedSafUri = await getPersistedPublicDownloadsDirectoryUri();
    if (persistedSafUri) {
        const cacheKey = `saf:${persistedSafUri}`;
        if (!directoryEntriesCache.has(cacheKey)) {
            directoryEntriesCache.set(cacheKey, FileSystem.StorageAccessFramework.readDirectoryAsync(persistedSafUri)
                .then(entries => entries.map(uri => ({ name: getSafEntityName(uri), uri })))
                .catch(() => []));
        }
        return await directoryEntriesCache.get(cacheKey)!;
    }

    const folderUri = getRelativeFolderUri(relativePath);
    if (!folderUri) return [];

    const cacheKey = `file:${folderUri}`;
    if (!directoryEntriesCache.has(cacheKey)) {
        directoryEntriesCache.set(cacheKey, FileSystem.readDirectoryAsync(folderUri)
            .then(entries => toFileDirectoryEntries(folderUri, entries))
            .catch(() => []));
    }

    return await directoryEntriesCache.get(cacheKey)!;
}

async function readMetadataSidecar(relativePath: string | undefined, displayName: string | undefined): Promise<TidalMetadataSidecar | null> {
    const baseName = displayName ? stripExtension(displayName) : '';
    if (!baseName) return null;

    const entries = await getDirectoryEntries(relativePath);
    const metadataFilename = `${baseName}.json`;
    const cacheKey = `${normalizeValue(metadataFilename)}|${entries.length}`;

    if (!metadataSidecarCache.has(cacheKey)) {
        metadataSidecarCache.set(cacheKey, (async () => {
            const match = entries.find(entry => entry.name.toLowerCase() === metadataFilename.toLowerCase());
            if (!match) return null;

            try {
                const raw = await FileSystem.readAsStringAsync(match.uri);
                return JSON.parse(raw) as TidalMetadataSidecar;
            } catch {
                return null;
            }
        })());
    }

    return await metadataSidecarCache.get(cacheKey)!;
}

async function inferAlbumFromSidecar(relativePath: string | undefined, artist: string | undefined): Promise<string | undefined> {
    const safeArtist = artist?.trim();
    if (!safeArtist) return undefined;

    const entries = await getDirectoryEntries(relativePath);
    if (entries.length === 0) return undefined;

    const sanitizedArtistPrefix = `${sanitizeFilename(safeArtist)} - `.toLowerCase();
    const rawArtistPrefix = `${safeArtist} - `.toLowerCase();

    const match = entries.find((entry) => {
        const lower = entry.name.toLowerCase();
        return IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext))
            && (lower.startsWith(sanitizedArtistPrefix) || lower.startsWith(rawArtistPrefix));
    });

    if (!match) return undefined;

    const withoutExt = stripExtension(match.name);
    if (withoutExt.length <= safeArtist.length + 3) return undefined;

    const inferredAlbum = withoutExt.slice(withoutExt.indexOf(' - ') + 3).trim();
    return inferredAlbum || undefined;
}

async function findSidecarArtwork(relativePath?: string, artist?: string, album?: string): Promise<string | undefined> {
    const safeArtist = artist?.trim();
    const safeAlbum = album?.trim();
    if (!safeArtist || !safeAlbum) return undefined;

    const entries = await getDirectoryEntries(relativePath);
    if (entries.length === 0) return undefined;

    const normalizedCandidates = new Set([
        `${sanitizeFilename(`${safeArtist} - ${safeAlbum}`)}.jpg`.toLowerCase(),
        `${sanitizeFilename(`${safeArtist} - ${safeAlbum}`)}.jpeg`.toLowerCase(),
        `${sanitizeFilename(`${safeArtist} - ${safeAlbum}`)}.png`.toLowerCase(),
        `${safeArtist} - ${safeAlbum}.jpg`.toLowerCase(),
        `${safeArtist} - ${safeAlbum}.jpeg`.toLowerCase(),
        `${safeArtist} - ${safeAlbum}.png`.toLowerCase(),
    ]);

    const match = entries.find(entry => normalizedCandidates.has(entry.name.toLowerCase()));
    return match?.uri;
}

async function withTidalHydrationSlot<T>(task: () => Promise<T>): Promise<T> {
    if (activeHydrationCount >= MAX_CONCURRENT_TIDAL_HYDRATIONS) {
        await new Promise<void>(resolve => pendingHydrationResolvers.push(resolve));
    }

    activeHydrationCount += 1;
    try {
        return await task();
    } finally {
        activeHydrationCount = Math.max(0, activeHydrationCount - 1);
        const next = pendingHydrationResolvers.shift();
        next?.();
    }
}

function scoreTidalMatch(candidate: TidalSearchResult, title: string, artist: string, album?: string): number {
    const normalizedTitle = normalizeMatchValue(title);
    const normalizedArtist = normalizeMatchValue(artist);
    const normalizedAlbum = normalizeMatchValue(album);
    const candidateTitle = normalizeMatchValue(candidate.title);
    const candidateArtist = normalizeMatchValue(candidate.artist);
    const candidateAlbum = normalizeMatchValue(candidate.album);

    let score = 0;

    if (candidateTitle === normalizedTitle) score += 8;
    else if (candidateTitle.includes(normalizedTitle) || normalizedTitle.includes(candidateTitle)) score += 4;

    if (candidateArtist === normalizedArtist) score += 8;
    else if (candidateArtist.includes(normalizedArtist) || normalizedArtist.includes(candidateArtist)) score += 4;

    if (normalizedAlbum) {
        if (candidateAlbum === normalizedAlbum) score += 5;
        else if (candidateAlbum && (candidateAlbum.includes(normalizedAlbum) || normalizedAlbum.includes(candidateAlbum))) score += 2;
    }

    return score;
}

function findBestTidalMatch(results: TidalSearchResult[], title: string, artist: string, album?: string): TidalSearchResult | null {
    let bestMatch: TidalSearchResult | null = null;
    let bestScore = 0;

    for (const candidate of results) {
        const score = scoreTidalMatch(candidate, title, artist, album);
        if (score > bestScore) {
            bestScore = score;
            bestMatch = candidate;
        }
    }

    return bestScore >= 12 ? bestMatch : null;
}

async function hydrateMetadataFromTidal(title: string, artist: string, album: string | undefined, relativePath?: string): Promise<TidalMetadataSidecar | null> {
    if (!isLikelyTidalDownload(relativePath)) return null;
    if (!title || UNKNOWN_TITLES.has(normalizeValue(title))) return null;
    if (!artist || UNKNOWN_ARTISTS.has(normalizeValue(artist))) return null;

    const cacheKey = `${normalizeMatchValue(artist)}|${normalizeMatchValue(title)}|${normalizeMatchValue(album)}`;
    if (!tidalHydrationCache.has(cacheKey)) {
        tidalHydrationCache.set(cacheKey, withTidalHydrationSlot(async () => {
            const { searchTidal } = await import('./tidalService');
            const results = await searchTidal(`${artist} ${title}`.trim());
            const match = findBestTidalMatch(results, title, artist, album);
            if (!match) return null;

            return {
                title: match.title,
                artist: match.artist,
                album: match.album,
                artwork: match.artworkUrl,
                trackNumber: match.trackNumber,
                quality: match.quality,
                source: 'tidal',
                tidalId: match.id,
                tidalAlbumId: match.albumId,
            } satisfies TidalMetadataSidecar;
        }).catch(() => null));
    }

    return await tidalHydrationCache.get(cacheKey)!;
}

export async function scanMusicNative(folderPattern?: string): Promise<Track[]> {
    const api = getNativeApi();
    if (!api) return [];

    const nativeTracks = await api.scanTracksNative(folderPattern);
    return await Promise.all(nativeTracks.map(async (track) => {
        const sidecarMetadata = await readMetadataSidecar(track.relativePath, track.displayName);
        const parsed = parseFilename(track.displayName || track.uri);
        const resolvedArtist = sidecarMetadata?.artist
            || ((!track.artist || UNKNOWN_ARTISTS.has(normalizeValue(track.artist))) ? parsed.artist : track.artist);
        const inferredAlbum = !sidecarMetadata?.album && shouldUseParsedAlbum(track.album) && parsed.album === 'Unknown Album'
            ? await inferAlbumFromSidecar(track.relativePath, resolvedArtist)
            : undefined;
        const resolvedAlbum = sidecarMetadata?.album
            || (shouldUseParsedAlbum(track.album)
                ? (parsed.album !== 'Unknown Album' ? parsed.album : (inferredAlbum || 'Unknown Album'))
                : track.album);
        const resolvedTitle = sidecarMetadata?.title
            || (shouldUseParsedTitle(track.title, track.displayName || track.uri) ? parsed.title : track.title);
        const sidecarArtwork = await findSidecarArtwork(track.relativePath, resolvedArtist, resolvedAlbum);
        const shouldHydrateFromApi = isLikelyTidalDownload(track.relativePath)
            && (!isKnownAlbumValue(resolvedAlbum) || !(sidecarArtwork || sidecarMetadata?.artwork));
        const apiMetadata = shouldHydrateFromApi
            ? await hydrateMetadataFromTidal(resolvedTitle, resolvedArtist, resolvedAlbum, track.relativePath)
            : null;

        const finalTitle = sidecarMetadata?.title || apiMetadata?.title || resolvedTitle;
        const finalArtist = sidecarMetadata?.artist || apiMetadata?.artist || resolvedArtist;
        const finalAlbum = isKnownAlbumValue(resolvedAlbum)
            ? resolvedAlbum
            : (sidecarMetadata?.album || apiMetadata?.album || resolvedAlbum);
        const finalArtwork = sidecarArtwork
            || sidecarMetadata?.artwork
            || apiMetadata?.artwork
            || track.artwork;

        return {
            id: track.id,
            uri: track.uri,
            title: finalTitle,
            artist: finalArtist,
            album: finalAlbum,
            duration: track.durationMs || 0,
            artwork: finalArtwork,
            albumId: track.albumId,
            trackNumber: sidecarMetadata?.trackNumber || apiMetadata?.trackNumber,
            year: sidecarMetadata?.year || apiMetadata?.year,
            quality: sidecarMetadata?.quality || apiMetadata?.quality,
            codec: sidecarMetadata?.codec,
            sampleRate: sidecarMetadata?.sampleRate,
            bitDepth: sidecarMetadata?.bitDepth,
            source: sidecarMetadata?.source || apiMetadata?.source || (isLikelyTidalDownload(track.relativePath) ? 'tidal' : undefined),
            tidalId: sidecarMetadata?.tidalId || apiMetadata?.tidalId,
            tidalAlbumId: sidecarMetadata?.tidalAlbumId || apiMetadata?.tidalAlbumId,
            dateAdded: track.dateAddedMs || Date.now(),
            format: getFormatFromValue(track.displayName || track.uri),
            _filename: track.displayName || undefined,
        };
    }));
}

function getFormatFromValue(value: string): string | undefined {
    const match = value.toLowerCase().match(/\.([a-z0-9]+)(\?|$)/);
    if (!match) return undefined;
    return match[1].toUpperCase();
}
