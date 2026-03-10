import { decode as decodeBase64 } from 'base-64';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { useNotificationStore } from '../stores/notificationStore';
import { useSettingsStore } from '../stores/settingsStore';
import {
    TidalAlbum,
    TidalAlbumDetail,
    TidalArtist,
    TidalArtistDetail,
    TidalPlaylist,
    TidalPlaylistDetail,
    TidalQuality,
    TidalSearchResult,
    TidalTrack,
    Track,
} from '../types/audio';
import { FileSystemStorage } from './storage';

export const TIDAL_API_BASES = [
    'https://triton.squid.wtf',
    'https://dabmusic.xyz/api',
    'https://dab.monochrome.tf',
    'https://hifi.monochrome.tf',
    'https://arran.monochrome.tf',
    'https://music.binimum.org',
];

export const TIDAL_MIRROR_NAMES: Record<string, string> = {
    'https://triton.squid.wtf': 'Fuente Principal (Alta Velocidad)',
    'https://dabmusic.xyz/api': 'Fuente Alternativa (Estable)',
    'https://dab.monochrome.tf': 'Servidor Espejo A',
    'https://hifi.monochrome.tf': 'Servidor Espejo B',
    'https://arran.monochrome.tf': 'Servidor Espejo C',
    'https://music.binimum.org': 'Fuente de Respaldo',
    'auto': 'Selección Automática (Recomendado)',
};

let currentBaseIndex = 0;
const TIDAL_ARTWORK_BASE = 'https://resources.tidal.com/images';
const TIDAL_TEMP_DOWNLOADS_DIR = `${FileSystem.cacheDirectory}StaySound/Downloads/`;
const TIDAL_PUBLIC_FOLDER = 'StaySound';
const TIDAL_PUBLIC_DOWNLOADS_PERMISSION_KEY = 'tidal-public-downloads-permission';
const REQUEST_TIMEOUT_MS = 12000;

interface TidalTrackApiResponse {
    id: number;
    title: string;
    duration: number;
    trackNumber?: number;
    explicit?: boolean;
    audioQuality?: string;
    mediaMetadata?: { tags?: string[] };
    album?: { id?: number; title?: string; cover?: string | null; releaseDate?: string; numberOfTracks?: number };
    artist?: { id?: number; name?: string; picture?: string | null };
    artists?: Array<{ id?: number; name?: string; picture?: string | null }>;
    popularity?: number;
}

interface TidalSearchApiResponse {
    data?: {
        items?: TidalTrackApiResponse[];
    };
}

interface TidalArtistApiResponse {
    id: number;
    name: string;
    picture?: string | null;
    popularity?: number;
}

interface TidalArtistSearchApiResponse {
    data?: {
        artists?: {
            items?: TidalArtistApiResponse[];
        };
        items?: TidalArtistApiResponse[];
    };
}

interface TidalArtistDetailApiResponse {
    artist?: TidalArtistApiResponse;
    cover?: {
        ['750']?: string;
    };
}

interface TidalAlbumApiResponse {
    id: number;
    title: string;
    releaseDate?: string;
    explicit?: boolean;
    numberOfTracks?: number;
    cover?: string | null;
    artist?: {
        id?: number;
        name?: string;
    };
    artists?: Array<{
        id?: number;
        name?: string;
    }>;
}

interface TidalAlbumDetailApiResponse {
    data?: TidalAlbumApiResponse & {
        items?: Array<{
            item?: TidalTrackApiResponse;
        }>;
    };
}

interface TidalPlaylistApiResponse {
    uuid: string;
    title: string;
    description?: string;
    numberOfTracks?: number;
    image?: string;
    cover?: string;
    picture?: string;
    squareImage?: string;
}

interface TidalPlaylistSearchApiResponse {
    data?: {
        playlists?: {
            items?: TidalPlaylistApiResponse[];
        };
        items?: TidalPlaylistApiResponse[];
    };
}

interface TidalPlaylistDetailApiResponse {
    data?: TidalPlaylistApiResponse & {
        items?: Array<{
            item?: TidalTrackApiResponse;
        }>;
    };
    playlist?: TidalPlaylistApiResponse;
    items?: Array<{
        item?: TidalTrackApiResponse;
    }>;
}

interface TidalManifestApiResponse {
    data?: {
        manifest?: string;
        manifestMimeType?: string;
        audioQuality?: string;
        bitDepth?: number;
        sampleRate?: number;
    };
}

interface ParsedManifest {
    urls: string[];
    quality: string;
    mimeType?: string;
    codecs?: string;
    isSegmented: boolean;
    sampleRate?: number;
    bitDepth?: number;
}

interface DownloadOptions {
    onProgress?: (progress: number) => void;
    onTask?: (task: FileSystem.DownloadResumable | null) => void;
}

type PersistedPublicDownloadsPermission = {
    directoryUri: string;
};

import { sanitizeFilename as utilsSanitizeFilename } from './audioUtils';

function sanitizeFilename(input: string): string {
    return utilsSanitizeFilename(input);
}

function getTrackBaseFilename(track: Pick<TidalTrack, 'id' | 'title' | 'artist' | 'album'>): string {
    const sanitized = sanitizeFilename(`${track.artist} - ${track.album} - ${track.title}`);
    if (sanitized.length > 0) return sanitized;
    return `tidal_${track.id}`;
}

function getExtensionFromMime(mimeType?: string, codecs?: string): string {
    const m = (mimeType ?? '').toLowerCase();
    const c = (codecs ?? '').toLowerCase();
    if (m.includes('flac') || c.includes('flac')) return 'flac';
    if (m.includes('mp4') || m.includes('aac') || m.includes('m4a') || c.includes('mp4') || c.includes('aac')) return 'm4a';
    if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
    return 'flac'; // fallback
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

async function getPersistedPublicDownloadsDirectoryUri(): Promise<string | null> {
    try {
        const raw = await FileSystemStorage.getItem(TIDAL_PUBLIC_DOWNLOADS_PERMISSION_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as Partial<PersistedPublicDownloadsPermission>;
        return typeof parsed.directoryUri === 'string' ? parsed.directoryUri : null;
    } catch {
        return null;
    }
}

async function setPersistedPublicDownloadsDirectoryUri(directoryUri: string): Promise<void> {
    await FileSystemStorage.setItem(
        TIDAL_PUBLIC_DOWNLOADS_PERMISSION_KEY,
        JSON.stringify({ directoryUri } satisfies PersistedPublicDownloadsPermission),
    );
}

async function findSafChildByName(parentUri: string, targetName: string): Promise<string | null> {
    const entries = await FileSystem.StorageAccessFramework.readDirectoryAsync(parentUri);
    const normalizedTarget = targetName.toLowerCase();

    for (const entry of entries) {
        if (getSafEntityName(entry).toLowerCase() === normalizedTarget) {
            return entry;
        }
    }

    return null;
}

async function ensureStaySoundPublicDirectory(baseDirectoryUri: string): Promise<string> {
    const baseName = getSafEntityName(baseDirectoryUri).toLowerCase();
    if (baseName === TIDAL_PUBLIC_FOLDER.toLowerCase()) {
        return baseDirectoryUri;
    }

    const existing = await findSafChildByName(baseDirectoryUri, TIDAL_PUBLIC_FOLDER);
    if (existing) return existing;

    return await FileSystem.StorageAccessFramework.makeDirectoryAsync(baseDirectoryUri, TIDAL_PUBLIC_FOLDER);
}

async function requestPublicDownloadsDirectoryUri(): Promise<string> {
    const initialDirectory = FileSystem.StorageAccessFramework.getUriForDirectoryInRoot('Download');
    const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(initialDirectory);

    if (!permissions.granted) {
        throw new Error('Necesitamos permiso a Download para guardar en Download/StaySound');
    }

    return await ensureStaySoundPublicDirectory(permissions.directoryUri);
}

async function getPublicDownloadsDirectoryUri(): Promise<string> {
    if (Platform.OS !== 'android') {
        throw new Error('Public download directory is only available on Android');
    }

    const persisted = await getPersistedPublicDownloadsDirectoryUri();
    if (persisted) {
        try {
            await FileSystem.StorageAccessFramework.readDirectoryAsync(persisted);
            return persisted;
        } catch {
            // Persisted permission is no longer valid.
        }
    }

    const selectedDirectory = await requestPublicDownloadsDirectoryUri();
    await setPersistedPublicDownloadsDirectoryUri(selectedDirectory);
    return selectedDirectory;
}

async function findExistingPublicTrackUri(filename: string): Promise<string | null> {
    const directoryUri = await getPublicDownloadsDirectoryUri();
    return await findSafChildByName(directoryUri, filename);
}

async function persistInPublicDownloads(tempUri: string, baseFilename: string, extension: string): Promise<string> {
    const filename = `${baseFilename}.${extension}`;
    const existing = await findExistingPublicTrackUri(filename);
    if (existing) return existing;

    const directoryUri = await getPublicDownloadsDirectoryUri();
    const mimeMap: Record<string, string> = {
        flac: 'audio/flac',
        m4a: 'audio/mp4',
        mp3: 'audio/mpeg',
    };

    const destinationUri = await FileSystem.StorageAccessFramework.createFileAsync(
        directoryUri,
        baseFilename,
        mimeMap[extension] || 'audio/flac',
    );

    const payload = await FileSystem.readAsStringAsync(tempUri, {
        encoding: FileSystem.EncodingType.Base64,
    });

    await FileSystem.StorageAccessFramework.writeAsStringAsync(destinationUri, payload, {
        encoding: FileSystem.EncodingType.Base64,
    });

    return destinationUri;
}

async function persistArtworkInPublicDownloads(artworkUrl: string, artist: string, album: string): Promise<void> {
    try {
        if (!artworkUrl) return;

        const directoryUri = await getPublicDownloadsDirectoryUri();
        const baseFilename = sanitizeFilename(`${artist} - ${album}`);
        const filename = `${baseFilename}.jpg`;

        const existing = await findSafChildByName(directoryUri, filename);
        if (existing) return;

        const tempArtworkUri = `${FileSystem.cacheDirectory}temp_artwork.jpg`;
        await FileSystem.downloadAsync(artworkUrl, tempArtworkUri);

        const destinationUri = await FileSystem.StorageAccessFramework.createFileAsync(
            directoryUri,
            baseFilename,
            'image/jpeg',
        );

        const payload = await FileSystem.readAsStringAsync(tempArtworkUri, {
            encoding: FileSystem.EncodingType.Base64,
        });

        await FileSystem.StorageAccessFramework.writeAsStringAsync(destinationUri, payload, {
            encoding: FileSystem.EncodingType.Base64,
        });

        await FileSystem.deleteAsync(tempArtworkUri, { idempotent: true });
    } catch (error) {
        console.warn('[TidalService] Failed to persist artwork:', error);
    }
}

async function persistMetadataInPublicDownloads(track: TidalTrack, baseFilename: string): Promise<void> {
    try {
        const directoryUri = await getPublicDownloadsDirectoryUri();
        const filename = `${baseFilename}.json`;
        const payload = JSON.stringify({
            title: track.title,
            artist: track.artist,
            album: track.album,
            artwork: track.artworkUrl,
            trackNumber: track.trackNumber,
            year: track.year,
            quality: track.quality,
            codec: track.codec,
            sampleRate: track.sampleRate,
            bitDepth: track.bitDepth,
            source: 'tidal',
            tidalId: track.id,
            tidalAlbumId: track.albumId,
        });

        const existing = await findSafChildByName(directoryUri, filename);
        if (existing) {
            await FileSystem.StorageAccessFramework.writeAsStringAsync(existing, payload);
            return;
        }

        const destinationUri = await FileSystem.StorageAccessFramework.createFileAsync(
            directoryUri,
            baseFilename,
            'application/json',
        );

        await FileSystem.StorageAccessFramework.writeAsStringAsync(destinationUri, payload);
    } catch (error) {
        console.warn('[TidalService] Failed to persist metadata:', error);
    }
}

function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    return {
        signal: controller.signal,
        cleanup: () => clearTimeout(timeout),
    };
}

async function fetchJson<T>(path: string, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<T> {
    const { tidalMirror } = useSettingsStore.getState();
    const showNotification = useNotificationStore.getState().showNotification;
    let lastError: Error | null = null;
    const startBaseIndex = currentBaseIndex;

    // If user selected a specific mirror, try it first
    if (tidalMirror && tidalMirror !== 'auto') {
        const url = `${tidalMirror}${path}`;
        const { signal, cleanup } = withTimeoutSignal(timeoutMs);
        try {
            console.log(`[TidalService] Requesting (Manual Mirror): ${url}`);
            const response = await fetch(url, { signal });
            if (response.ok) {
                cleanup();
                return await response.json() as T;
            }
            throw new Error(`Manual mirror issue: ${response.status}`);
        } catch (error: any) {
            cleanup();
            console.warn(`[TidalService] Manual mirror ${tidalMirror} failed: ${error.message}. Falling back to auto...`);
            showNotification('Conexión inestable con el servidor elegido. Buscando alternativa...', 'warning');
            lastError = error;
        }
    }

    for (let i = 0; i < TIDAL_API_BASES.length; i++) {
        const base = TIDAL_API_BASES[currentBaseIndex];
        const url = `${base}${path}`;
        const { signal, cleanup } = withTimeoutSignal(timeoutMs);

        try {
            console.log(`[TidalService] Requesting: ${url}`);
            const response = await fetch(url, { signal });

            if (response.ok) {
                cleanup();
                return await response.json() as T;
            }

            // If it's a server error (5xx) or a possible proxy misconfiguration (404 on common paths)
            if (response.status >= 500 || (response.status === 404 && base.includes('music.binimum.org'))) {
                throw new Error(`Mirror issue: ${response.status}`);
            }

            // If we are at dabmusic.xyz, it might need /api/search instead of /search
            // but our fetchJson prepends /search, so we adjust current path if needed or just skip
            if (response.status === 404 && base.includes('dabmusic.xyz')) {
                throw new Error(`Endpoint not found on this mirror: ${response.status}`);
            }

            const errorBody = await response.text().catch(() => 'No body');
            throw new Error(`Tidal request failed (${response.status}): ${errorBody}`);
        } catch (error: any) {
            cleanup();
            lastError = error;
            console.warn(`[TidalService] Base ${base} failed: ${error.message}. Trying next...`);

            // Cycle to next base
            currentBaseIndex = (currentBaseIndex + 1) % TIDAL_API_BASES.length;

            const nextBase = TIDAL_API_BASES[currentBaseIndex];
            showNotification(`Cambiando a ${TIDAL_MIRROR_NAMES[nextBase] || 'otro servidor'} para mejor conexión`, 'info');

            // If we've circled back to the start, stop and throw
            if (currentBaseIndex === startBaseIndex) break;
        }
    }

    throw lastError || new Error('All Tidal mirrors failed');
}

function resolveUrl(baseUrl: string, maybeRelative: string): string {
    if (!maybeRelative) return baseUrl;
    if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
    if (!baseUrl) return maybeRelative;

    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    return `${normalizedBase}${maybeRelative.replace(/^\/+/, '')}`;
}

function extractSegmentCountFromTimeline(xml: string): number {
    const segmentNodes = Array.from(xml.matchAll(/<S\b([^>]*)\/?\s*>/gi));
    if (segmentNodes.length === 0) return 0;

    let count = 0;
    for (const node of segmentNodes) {
        const attrs = node[1] ?? '';
        const repeatMatch = attrs.match(/\br="(-?\d+)"/i);
        const repeat = repeatMatch ? Number.parseInt(repeatMatch[1], 10) : 0;
        count += repeat >= 0 ? repeat + 1 : 1;
    }

    return count;
}

function buildSegmentTemplateMedia(mediaTemplate: string, number: number): string {
    return mediaTemplate.replace(/\$Number(%0(\d+)d)?\$/g, (_full, _format, width) => {
        if (!width) return String(number);
        return String(number).padStart(Number.parseInt(width, 10), '0');
    });
}

function parseDashManifest(manifestXml: string): string[] {
    const baseUrlMatch = manifestXml.match(/<BaseURL>([^<]+)<\/BaseURL>/i);
    const baseUrl = baseUrlMatch?.[1]?.trim() ?? '';

    const segmentListInit = manifestXml.match(/<SegmentList[^>]*\binitialization="([^"]+)"/i)?.[1];
    const segmentListUrls = Array.from(manifestXml.matchAll(/<SegmentURL[^>]*\bmedia="([^"]+)"/gi));
    if (segmentListUrls.length > 0) {
        const urls = segmentListUrls.map(match => resolveUrl(baseUrl, match[1]));
        if (segmentListInit) {
            return [resolveUrl(baseUrl, segmentListInit), ...urls];
        }
        return urls;
    }

    const segmentTemplateMatch = manifestXml.match(/<SegmentTemplate[^>]*>/i)?.[0] ?? '';
    const initialization = segmentTemplateMatch.match(/\binitialization="([^"]+)"/i)?.[1];
    const media = segmentTemplateMatch.match(/\bmedia="([^"]+)"/i)?.[1];
    const startNumber = Number.parseInt(segmentTemplateMatch.match(/\bstartNumber="(\d+)"/i)?.[1] ?? '1', 10);
    const segmentCount = extractSegmentCountFromTimeline(manifestXml);

    if (media && segmentCount > 0) {
        const urls: string[] = [];
        if (initialization) {
            urls.push(resolveUrl(baseUrl, initialization));
        }

        for (let segmentNumber = startNumber; segmentNumber < startNumber + segmentCount; segmentNumber++) {
            urls.push(resolveUrl(baseUrl, buildSegmentTemplateMedia(media, segmentNumber)));
        }

        return urls;
    }

    const absoluteUrls = Array.from(manifestXml.matchAll(/https?:\/\/[^"'\s<]+/gi)).map(match => match[0]);
    return absoluteUrls;
}

function parseManifestPayload(
    manifestBase64: string,
    quality: string,
    extra?: { sampleRate?: number; bitDepth?: number },
): ParsedManifest {
    const decoded = decodeBase64(manifestBase64);
    const trimmed = decoded.trim();

    if (!trimmed) {
        throw new Error('Empty Tidal manifest payload');
    }

    if (trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed) as { urls?: string[]; mimeType?: string; codecs?: string };
        const urls = Array.isArray(parsed.urls) ? parsed.urls.filter(Boolean) : [];
        if (urls.length === 0) {
            throw new Error('Tidal manifest JSON does not contain URLs');
        }
        return {
            urls,
            quality,
            mimeType: parsed.mimeType,
            codecs: parsed.codecs,
            isSegmented: urls.length > 1,
            sampleRate: extra?.sampleRate,
            bitDepth: extra?.bitDepth,
        };
    }

    if (trimmed.startsWith('<')) {
        const urls = parseDashManifest(trimmed).filter(Boolean);
        if (urls.length === 0) {
            throw new Error('Tidal DASH manifest did not produce segment URLs');
        }
        const mimeType = trimmed.match(/\bmimeType="([^"]+)"/i)?.[1];
        const codecs = trimmed.match(/\bcodecs="([^"]+)"/i)?.[1];
        return {
            urls,
            quality,
            mimeType,
            codecs,
            isSegmented: urls.length > 1,
            sampleRate: extra?.sampleRate,
            bitDepth: extra?.bitDepth,
        };
    }

    throw new Error('Unsupported Tidal manifest format');
}

function normalizeSearchItem(item: TidalTrackApiResponse): TidalSearchResult {
    const quality = item.audioQuality ?? 'LOSSLESS';
    const tags = item.mediaMetadata?.tags ?? [];
    const isHiRes = tags.includes('HIRES_LOSSLESS') || quality === 'HI_RES_LOSSLESS';
    const primaryArtist = item.artist?.name ?? item.artists?.[0]?.name ?? 'Unknown Artist';
    const albumTitle = item.album?.title ?? 'Unknown Album';
    const coverUuid = item.album?.cover ?? null;

    return {
        id: item.id,
        title: item.title,
        artist: primaryArtist,
        album: albumTitle,
        durationMs: Math.max(0, Math.round((item.duration ?? 0) * 1000)),
        quality,
        isHiRes,
        coverUuid,
        artworkUrl: getArtworkUrl(coverUuid),
        trackNumber: item.trackNumber,
        explicit: item.explicit,
        popularity: item.popularity,
        artistId: item.artist?.id,
        albumId: item.album?.id,
    };
}

function parseYearFromReleaseDate(releaseDate?: string): number | undefined {
    if (!releaseDate) return undefined;
    const year = Number.parseInt(releaseDate.slice(0, 4), 10);
    return Number.isFinite(year) ? year : undefined;
}

function normalizeArtistItem(item: TidalArtistApiResponse): TidalArtist {
    return {
        id: item.id,
        name: item.name,
        picture: item.picture ?? undefined,
        artworkUrl: getArtworkUrl(item.picture ?? undefined),
        popularity: item.popularity,
    };
}

function normalizeAlbumItem(item: TidalAlbumApiResponse): TidalAlbum {
    return {
        id: item.id,
        title: item.title,
        artistId: item.artist?.id ?? item.artists?.[0]?.id,
        artistName: item.artist?.name ?? item.artists?.[0]?.name ?? 'Artista Desconocido',
        releaseDate: item.releaseDate,
        year: item.releaseDate ? new Date(item.releaseDate).getFullYear() : undefined,
        numberOfTracks: item.numberOfTracks,
        explicit: item.explicit,
        artworkUrl: getArtworkUrl(item.cover ?? undefined),
    };
}

function normalizePlaylistItem(item: TidalPlaylistApiResponse): TidalPlaylist {
    const rawImage = item.image || item.cover || item.picture || item.squareImage;
    let artworkUrl = undefined;

    if (rawImage) {
        if (rawImage.startsWith('http')) {
            artworkUrl = rawImage;
        } else {
            artworkUrl = getPlaylistArtworkUrl(rawImage);
        }
    }

    return {
        uuid: item.uuid,
        title: item.title,
        description: item.description,
        numberOfTracks: item.numberOfTracks,
        artworkUrl,
    };
}

function normalizeArtistTrack(track: TidalTrackApiResponse, fallbackArtist?: TidalArtist): TidalTrack {
    const normalized = normalizeSearchItem(track);
    return {
        ...normalized,
        artistId: normalized.artistId ?? fallbackArtist?.id,
        artist: normalized.artist || fallbackArtist?.name || 'Unknown Artist',
    };
}

async function ensureDirectoryExists(dirUri: string): Promise<void> {
    const info = await FileSystem.getInfoAsync(dirUri);
    if (!info.exists) {
        await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true });
    }
}

function getOutputUri(baseFilename: string, extension: string): string {
    return `${TIDAL_TEMP_DOWNLOADS_DIR}${baseFilename}.${extension}`;
}

function isFlacSource(url: string, manifest: ParsedManifest): boolean {
    if (/\.flac(\?|$)/i.test(url)) return true;
    if ((manifest.mimeType ?? '').toLowerCase().includes('flac')) return true;
    if ((manifest.codecs ?? '').toLowerCase().includes('flac')) return true;
    return false;
}

function getDirectUrl(manifest: ParsedManifest): string | null {
    const directUrls = manifest.urls.filter(url => /^https?:\/\//i.test(url));
    if (manifest.isSegmented || directUrls.length !== 1) {
        return null;
    }
    return directUrls[0];
}

async function downloadSegment(
    url: string,
    outputUri: string,
    onTask?: (task: FileSystem.DownloadResumable | null) => void,
    onProgress?: (progress: number) => void,
): Promise<FileSystem.FileSystemDownloadResult> {
    const task = FileSystem.createDownloadResumable(url, outputUri, {}, progress => {
        const expected = progress.totalBytesExpectedToWrite;
        if (!onProgress) return;
        if (expected > 0) {
            onProgress(progress.totalBytesWritten / expected);
            return;
        }
        // If server doesn't provide content-length, we can't show real progress
        onProgress(0.01);
    });

    onTask?.(task);
    const result = await task.downloadAsync();
    onTask?.(null);
    if (!result) throw new Error('Download failed: No result from task');
    return result;
}

function toLibraryTrack(tidalTrack: TidalTrack, uri: string): Track {
    const extension = uri.split('.').pop()?.toLowerCase() || 'flac';
    const formatMap: Record<string, string> = {
        flac: 'FLAC',
        m4a: 'AAC',
        mp3: 'MP3',
    };

    return {
        id: `tidal_${tidalTrack.id}`,
        uri,
        title: tidalTrack.title,
        artist: tidalTrack.artist,
        album: tidalTrack.album,
        duration: tidalTrack.durationMs,
        artwork: tidalTrack.artworkUrl,
        trackNumber: tidalTrack.trackNumber,
        year: tidalTrack.year,
        format: formatMap[extension] || 'FLAC',
        codec: tidalTrack.codec ?? extension,
        sampleRate: tidalTrack.sampleRate,
        bitDepth: tidalTrack.bitDepth,
        quality: tidalTrack.quality,
        source: 'tidal',
        tidalId: tidalTrack.id,
        tidalAlbumId: tidalTrack.albumId,
        dateAdded: Date.now(),
    };
}

export function getArtworkUrl(coverUuid?: string | null): string | undefined {
    if (!coverUuid) return undefined;
    const normalized = coverUuid.replace(/-/g, '/');
    return `${TIDAL_ARTWORK_BASE}/${normalized}/640x640.jpg`;
}

export function getPlaylistArtworkUrl(playlistImageId?: string | null): string | undefined {
    if (!playlistImageId) return undefined;

    // Some playlist images are direct square hashes, while others follow the UUID pattern
    // If it's a UUID style (with dashes), we normalize it
    const normalized = playlistImageId.includes('-')
        ? playlistImageId.replace(/-/g, '/')
        : playlistImageId;

    return `${TIDAL_ARTWORK_BASE}/${normalized}/640x640.jpg`;
}

export async function searchTidal(query: string): Promise<TidalSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const response = await fetchJson<TidalSearchApiResponse>(
        `/search/?s=${encodeURIComponent(trimmed)}`,
    );

    return (response.data?.items ?? []).map(normalizeSearchItem);
}

export async function searchTidalArtists(query: string): Promise<TidalArtist[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const response = await fetchJson<TidalArtistSearchApiResponse>(
        `/search/?a=${encodeURIComponent(trimmed)}`,
    );

    const artistItems = response.data?.artists?.items ?? response.data?.items ?? [];
    return artistItems.map(normalizeArtistItem);
}

export async function searchTidalPlaylists(query: string): Promise<TidalPlaylist[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const response = await fetchJson<TidalPlaylistSearchApiResponse>(
        `/search/?p=${encodeURIComponent(trimmed)}`,
    );

    const playlistItems = response.data?.playlists?.items ?? response.data?.items ?? [];
    return playlistItems.map(normalizePlaylistItem);
}

export function extractAlbumsFromTracks(tracks: TidalTrack[]): TidalAlbum[] {
    const albumsMap = new Map<number, TidalAlbum>();

    tracks.forEach(track => {
        if (!track.albumId) return;
        if (albumsMap.has(track.albumId)) return;

        albumsMap.set(track.albumId, {
            id: track.albumId,
            title: track.album,
            artistId: track.artistId,
            artistName: track.artist,
            coverUuid: track.coverUuid,
            artworkUrl: track.artworkUrl,
        });
    });

    return Array.from(albumsMap.values());
}
export async function getTidalAlbumDetail(albumId: number): Promise<TidalAlbumDetail> {
    const response = await fetchJson<TidalAlbumDetailApiResponse>(
        `/album/?id=${albumId}`,
    );

    const albumData = response.data;
    if (!albumData) {
        throw new Error('No se pudo cargar el album de Tidal');
    }

    const album = normalizeAlbumItem(albumData);
    const tracks = (albumData.items ?? [])
        .map(entry => entry.item)
        .filter((item): item is TidalTrackApiResponse => !!item)
        .map(item => normalizeArtistTrack(item, album.artistId ? { id: album.artistId, name: album.artistName } : undefined));

    return { album, tracks };
}

export async function getTidalPlaylistDetail(playlistUuid: string): Promise<TidalPlaylistDetail> {
    const response = await fetchJson<any>(
        `/playlist/?id=${playlistUuid}`,
    );

    // Try multiple possible paths for the playlist metadata
    const playlistData = response.data || response.playlist || (response.uuid ? response : null);

    if (!playlistData) {
        console.error('Tidal Playlist Error: No playlist data in response', response);
        throw new Error('No se pudo cargar la playlist de Tidal');
    }

    // Ensure the playlistData has the best image possible
    if (!playlistData.image && !playlistData.cover && !playlistData.picture && !playlistData.squareImage) {
        playlistData.image = response.image || response.cover || response.picture || response.squareImage;
    }

    // Convert tracks first so we can use their artwork as fallback
    const items = response.data?.items ?? response.items ?? playlistData.items ?? [];
    const tracks = items
        .map((entry: any) => entry.item || entry)
        .filter((item: any): item is TidalTrackApiResponse => !!item && !!item.id)
        .map((item: any) => normalizeArtistTrack(item));

    const playlist = normalizePlaylistItem(playlistData);

    // CRITICAL: If playlist still has no artwork, use the artwork from the first track
    if (!playlist.artworkUrl && tracks.length > 0 && tracks[0].artworkUrl) {
        playlist.artworkUrl = tracks[0].artworkUrl;
    }

    return { playlist, tracks };
}

export async function getTidalArtistInfo(artistId: number): Promise<TidalArtist> {
    const response = await fetchJson<TidalArtistDetailApiResponse>(
        `/artist/?id=${artistId}`,
    );

    const apiArtist = response.artist;
    if (!apiArtist) {
        throw new Error('Artista no encontrado');
    }

    return {
        ...normalizeArtistItem(apiArtist),
        artworkUrl: response.cover?.['750'] || getArtworkUrl(apiArtist.picture ?? undefined),
    };
}

export async function getTidalArtistDetail(artistId: number, artistNameHint?: string): Promise<TidalArtistDetail> {
    const artistResponse = await fetchJson<TidalArtistDetailApiResponse>(
        `/artist/?id=${artistId}`,
    );

    const apiArtist = artistResponse.artist;
    if (!apiArtist) {
        throw new Error('No se pudo cargar el artista de Tidal');
    }

    const artist: TidalArtist = {
        ...normalizeArtistItem(apiArtist),
        artworkUrl: artistResponse.cover?.['750'] ?? getArtworkUrl(apiArtist.picture ?? undefined),
    };

    const queryTerm = artistNameHint?.trim() || artist.name;
    const tracksByName = await searchTidal(queryTerm);

    const mergedTracksMap = new Map<number, TidalTrack>();
    tracksByName
        .filter(track => track.artistId === artistId || track.artist.toLowerCase() === artist.name.toLowerCase())
        .forEach(track => mergedTracksMap.set(track.id, track));

    const mergedTracks = Array.from(mergedTracksMap.values());
    mergedTracks.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));

    const albums = extractAlbumsFromTracks(mergedTracks);
    const topTracks = mergedTracks.slice(0, 25);

    return { artist, topTracks, albums };
}

export async function getTidalTrackManifest(
    tidalId: number,
    quality: TidalQuality = 'HI_RES_LOSSLESS',
): Promise<ParsedManifest> {
    const response = await fetchJson<TidalManifestApiResponse>(
        `/track/?id=${tidalId}&quality=${quality}`,
    );

    const manifestBase64 = response.data?.manifest;
    if (!manifestBase64) {
        throw new Error('Missing Tidal manifest payload');
    }

    return parseManifestPayload(manifestBase64, response.data?.audioQuality ?? quality, {
        sampleRate: response.data?.sampleRate,
        bitDepth: response.data?.bitDepth,
    });
}

export async function downloadTidalTrack(
    tidalTrack: TidalTrack,
    targetQuality: TidalQuality = 'LOSSLESS',
    options: DownloadOptions = {},
): Promise<Track> {
    const baseFilename = getTrackBaseFilename(tidalTrack);

    // 1. Get manifest for target quality
    let manifest: ParsedManifest;
    try {
        manifest = await getTidalTrackManifest(tidalTrack.id, targetQuality);
    } catch (error) {
        console.warn(`[TidalService] Quality ${targetQuality} failed, falling back to LOSSLESS/HIGH`, error);
        try {
            manifest = await getTidalTrackManifest(tidalTrack.id, 'LOSSLESS');
        } catch {
            manifest = await getTidalTrackManifest(tidalTrack.id, 'HIGH');
        }
    }

    const extension = getExtensionFromMime(manifest.mimeType, manifest.codecs);
    const filename = `${baseFilename}.${extension}`;

    if (Platform.OS === 'android') {
        const existingPublicUri = await findExistingPublicTrackUri(filename);
        if (existingPublicUri) {
            await persistMetadataInPublicDownloads(tidalTrack, baseFilename);
            if (tidalTrack.artworkUrl) {
                await persistArtworkInPublicDownloads(tidalTrack.artworkUrl, tidalTrack.artist, tidalTrack.album);
            }
            options.onProgress?.(1);
            return toLibraryTrack(tidalTrack, existingPublicUri);
        }
    }

    await ensureDirectoryExists(TIDAL_TEMP_DOWNLOADS_DIR);

    const outputUri = getOutputUri(baseFilename, extension);
    const outputExists = await FileSystem.getInfoAsync(outputUri);
    if (outputExists.exists) {
        // Redownloading/repairing if called (or if platform doesn't support easy re-use)
        await FileSystem.deleteAsync(outputUri, { idempotent: true });
    }

    let sourceUrl = getDirectUrl(manifest);
    if (!sourceUrl && manifest.quality !== 'HIGH' && manifest.quality !== 'LOW') {
        try {
            const fallbackManifest = await getTidalTrackManifest(tidalTrack.id, 'HIGH');
            sourceUrl = getDirectUrl(fallbackManifest);
            if (sourceUrl) manifest = fallbackManifest;
        } catch {
            // ignore
        }
    }

    if (!sourceUrl) {
        if (manifest.isSegmented) {
            throw new Error(`Este track utiliza segmentos (DASH) y no se puede descargar directamente como un solo archivo ${extension.toUpperCase()}.`);
        }
        throw new Error('No se encontró una URL de descarga directa para este track.');
    }

    const enrichedTrack: TidalTrack = {
        ...tidalTrack,
        quality: manifest.quality ?? tidalTrack.quality,
        codec: manifest.codecs ?? tidalTrack.codec,
        sampleRate: manifest.sampleRate ?? tidalTrack.sampleRate,
        bitDepth: manifest.bitDepth ?? tidalTrack.bitDepth,
    };

    await downloadSegment(sourceUrl, outputUri, options.onTask, options.onProgress);

    // Validate download result
    const fileInfo = await FileSystem.getInfoAsync(outputUri);
    if (!fileInfo.exists || fileInfo.size === 0) {
        throw new Error('Download failed: File is empty or does not exist');
    }

    if (!(await isValidAudioFile(outputUri, extension))) {
        throw new Error(`Download failed: The file received is not a valid ${extension.toUpperCase()}`);
    }

    let persistentUri = outputUri;

    if (Platform.OS === 'android') {
        try {
            persistentUri = await persistInPublicDownloads(outputUri, baseFilename, extension);
            await FileSystem.deleteAsync(outputUri, { idempotent: true });

            await persistMetadataInPublicDownloads(enrichedTrack, baseFilename);

            if (enrichedTrack.artworkUrl) {
                await persistArtworkInPublicDownloads(
                    enrichedTrack.artworkUrl,
                    enrichedTrack.artist,
                    enrichedTrack.album
                );
            }
        } catch (persistError) {
            console.error('[TidalService] Failed to persist in public folder:', persistError);
            throw new Error(`Failed to save track to public folder: ${persistError instanceof Error ? persistError.message : 'Unknown error'}`);
        }
    }

    options.onProgress?.(1);
    return toLibraryTrack(enrichedTrack, persistentUri);
}

export async function createTidalStreamTrack(tidalTrack: TidalTrack): Promise<Track> {
    let manifest: ParsedManifest;
    try {
        manifest = await getTidalTrackManifest(tidalTrack.id, 'HI_RES_LOSSLESS');
    } catch (error) {
        console.warn('[TidalService] Stream HI_RES_LOSSLESS failed, retrying LOSSLESS', error);
        manifest = await getTidalTrackManifest(tidalTrack.id, 'LOSSLESS');
    }

    let streamUrl = getDirectUrl(manifest);
    if (!streamUrl) {
        const fallbackManifest = await getTidalTrackManifest(tidalTrack.id, 'LOSSLESS');
        streamUrl = getDirectUrl(fallbackManifest);
        manifest = fallbackManifest;
    }

    if (!streamUrl) {
        throw new Error('No direct stream URL available for this track');
    }

    const enrichedTrack: TidalTrack = {
        ...tidalTrack,
        quality: manifest.quality ?? tidalTrack.quality,
        codec: manifest.codecs ?? tidalTrack.codec,
        sampleRate: manifest.sampleRate ?? tidalTrack.sampleRate,
        bitDepth: manifest.bitDepth ?? tidalTrack.bitDepth,
    };

    const extension = getExtensionFromMime(manifest.mimeType, manifest.codecs);
    const formatMap: Record<string, string> = {
        flac: 'FLAC',
        m4a: 'AAC',
        mp3: 'MP3',
    };

    return {
        id: `tidal_stream_${tidalTrack.id}`,
        uri: streamUrl,
        title: enrichedTrack.title,
        artist: enrichedTrack.artist,
        album: enrichedTrack.album,
        duration: enrichedTrack.durationMs,
        artwork: enrichedTrack.artworkUrl,
        trackNumber: enrichedTrack.trackNumber,
        year: enrichedTrack.year,
        format: formatMap[extension] || 'FLAC',
        codec: enrichedTrack.codec ?? extension,
        sampleRate: enrichedTrack.sampleRate,
        bitDepth: enrichedTrack.bitDepth,
        quality: enrichedTrack.quality,
        source: 'tidal_stream',
        tidalId: tidalTrack.id,
        tidalAlbumId: tidalTrack.albumId,
        dateAdded: Date.now(),
    };
}

export async function isValidAudioFile(uri: string, extension: string): Promise<boolean> {
    try {
        const base64Prefix = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
            position: 0,
            length: 12,
        } as never);

        const decodedPrefix = decodeBase64(base64Prefix);

        if (extension === 'flac') return decodedPrefix.startsWith('fLaC');
        if (extension === 'm4a') return decodedPrefix.includes('ftyp');
        if (extension === 'mp3') return decodedPrefix.startsWith('ID3') || decodedPrefix.includes('\xff\xfb') || decodedPrefix.includes('\xff\xf3');

        return true; // fallback
    } catch {
        return false;
    }
}




