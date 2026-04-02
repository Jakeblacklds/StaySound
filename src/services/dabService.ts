import { TidalAlbum, TidalAlbumDetail, TidalArtist, TidalArtistDetail, TidalQuality, TidalSearchResult, TidalTrack } from '../types/audio';
import { getDabCandidateBaseUrls } from './dabAuthService';
import { getArtistInfo } from './artistApi';
import { useDabAuthStore } from '../stores/dabAuthStore';

const MP3_QUALITY_CODE = '5';
const LOSSLESS_QUALITY_CODE = '27';
const SEARCH_CACHE_TTL_MS = 15_000;
const DETAIL_CACHE_TTL_MS = 60_000;
const RATE_LIMIT_RETRY_FALLBACK_MS = 1_500;
const SEARCH_ARTIST_ARTWORK_LIMIT = 8;

type DabBetaTrackApiResponse = {
    id: number | string;
    title: string;
    artist: string;
    artistId?: number;
    albumTitle?: string;
    albumCover?: string;
    albumId?: string;
    releaseDate?: string;
    genre?: string;
    duration?: number;
    audioQuality?: {
        maximumBitDepth?: number;
        maximumSamplingRate?: number;
        isHiRes?: boolean;
    };
    images?: {
        small?: string;
        thumbnail?: string;
        large?: string;
    };
};

type DabBetaAlbumApiResponse = {
    id: string;
    title: string;
    artist: string;
    artistId?: number;
    cover?: string;
    releaseDate?: string;
    genre?: string;
    trackCount?: number;
    audioQuality?: {
        maximumBitDepth?: number;
        maximumSamplingRate?: number;
        isHiRes?: boolean;
    };
    images?: {
        small?: string;
        thumbnail?: string;
        large?: string;
    };
};

type DabBetaArtistApiResponse = {
    id: number;
    name: string;
    image?: string | null;
    biography?: string | null;
};

type DabBetaSearchTracksResponse = {
    tracks?: DabBetaTrackApiResponse[];
    pagination?: {
        offset?: number;
        limit?: number;
        total?: number;
        hasMore?: boolean;
    };
    requiresAuth?: boolean;
    error?: string;
};

type DabBetaFeaturedAlbumsResponse = {
    albums?: DabBetaAlbumApiResponse[];
    total?: number;
    hasMore?: boolean;
    requiresAuth?: boolean;
    error?: string;
};

type DabBetaAlbumDetailResponse = {
    album?: {
        id: string;
        title: string;
        artist: string;
        cover?: string;
        releaseDate?: string;
        genre?: string;
        trackCount?: number;
        duration?: number;
        audioQuality?: {
            maximumBitDepth?: number;
            maximumSamplingRate?: number;
            isHiRes?: boolean;
        };
        tracks?: DabBetaTrackApiResponse[];
    };
    requiresAuth?: boolean;
    error?: string;
};

type DabBetaDiscographyResponse = {
    artist?: DabBetaArtistApiResponse;
    albums?: DabBetaAlbumApiResponse[];
    requiresAuth?: boolean;
    error?: string;
};

type DabBetaStreamResponse = {
    url?: string;
    requiresAuth?: boolean;
    error?: string;
};

const externalAlbumIdByInternalId = new Map<number, string>();
const trackSearchCache = new Map<string, { expiresAt: number; data: TidalSearchResult[] }>();
const inflightTrackSearches = new Map<string, Promise<TidalSearchResult[]>>();
const artistInfoCache = new Map<string, { expiresAt: number; data: TidalArtist }>();
const artistDetailCache = new Map<string, { expiresAt: number; data: TidalArtistDetail }>();
const albumDetailCache = new Map<number, { expiresAt: number; data: TidalAlbumDetail }>();

async function resolveArtistArtworkFallback(artistName?: string, currentArtwork?: string): Promise<string | undefined> {
    if (currentArtwork?.trim()) return currentArtwork.trim();
    if (!artistName?.trim()) return undefined;

    try {
        const artistInfo = await getArtistInfo(artistName, { includeBiography: false });
        return artistInfo?.photo_url ?? undefined;
    } catch {
        return undefined;
    }
}

function getCachedValue<T>(cache: Map<string | number, { expiresAt: number; data: T }>, key: string | number): T | null {
    const cached = cache.get(key);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
        cache.delete(key);
        return null;
    }

    return cached.data;
}

function setCachedValue<T>(cache: Map<string | number, { expiresAt: number; data: T }>, key: string | number, data: T, ttlMs: number) {
    cache.set(key, {
        expiresAt: Date.now() + ttlMs,
        data,
    });
}

export function isDabConfigured(): boolean {
    return Boolean(useDabAuthStore.getState().session?.sessionCookie);
}

function getYearFromDate(date?: string): number | undefined {
    if (!date) return undefined;
    const parsed = Number.parseInt(date.slice(0, 4), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function hashStringToNumber(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
        hash = ((hash << 5) - hash) + input.charCodeAt(i);
        hash |= 0;
    }

    return Math.abs(hash) || 1;
}

function registerAlbumId(externalId: string): number {
    const internalId = hashStringToNumber(`dab-beta:${externalId}`);
    externalAlbumIdByInternalId.set(internalId, externalId);
    return internalId;
}

export function resolveDabBetaAlbumId(albumId: number): string | null {
    return externalAlbumIdByInternalId.get(albumId) ?? null;
}

function normalizeTrack(item: DabBetaTrackApiResponse): TidalTrack {
    const albumExternalId = item.albumId || item.albumTitle || `album:${item.artist}:${item.title}`;
    const albumId = registerAlbumId(albumExternalId);
    const samplingRateKhz = item.audioQuality?.maximumSamplingRate;
    const sampleRate = typeof samplingRateKhz === 'number' ? Math.round(samplingRateKhz * 1000) : undefined;
    const artworkUrl = item.albumCover || item.images?.large || item.images?.small || item.images?.thumbnail;
    const isHiRes = !!item.audioQuality?.isHiRes;

    return {
        id: Number(item.id),
        title: item.title || 'Unknown Track',
        artist: item.artist || 'Unknown Artist',
        artistId: item.artistId,
        album: item.albumTitle || 'Unknown Album',
        albumId,
        durationMs: Math.max(0, Math.round((item.duration ?? 0) * 1000)),
        quality: isHiRes ? 'HI_RES_LOSSLESS' : 'LOSSLESS',
        isHiRes,
        artworkUrl,
        coverUuid: albumExternalId,
        year: getYearFromDate(item.releaseDate),
        sampleRate,
        bitDepth: item.audioQuality?.maximumBitDepth,
        codec: 'flac',
        explicit: false,
    };
}

function normalizeAlbum(item: DabBetaAlbumApiResponse): TidalAlbum {
    const artworkUrl = item.cover || item.images?.large || item.images?.small || item.images?.thumbnail;

    return {
        id: registerAlbumId(item.id),
        title: item.title || 'Unknown Album',
        artistId: item.artistId,
        artistName: item.artist || 'Unknown Artist',
        coverUuid: item.id,
        artworkUrl,
        releaseDate: item.releaseDate,
        year: getYearFromDate(item.releaseDate),
        numberOfTracks: item.trackCount,
        explicit: false,
    };
}

function normalizeArtist(item: DabBetaArtistApiResponse): TidalArtist {
    return {
        id: item.id,
        name: item.name || 'Unknown Artist',
        artworkUrl: item.image ?? undefined,
        picture: item.image ?? undefined,
    };
}

async function parseError(response: Response) {
    if (response.status === 429) {
        return 'DAB esta recibiendo demasiadas peticiones. Espera un momento e intenta de nuevo.';
    }

    if (response.status === 401 || response.status === 403) {
        return 'La sesion de DAB expiro o fue rechazada. Intenta nuevamente en unos segundos.';
    }

    try {
        const data = await response.json() as { error?: string; message?: string };
        return data.error || data.message || `HTTP ${response.status}`;
    } catch {
        return `HTTP ${response.status}`;
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRetryAfterMs(response: Response): number {
    const retryAfterHeader = response.headers.get('retry-after');
    if (!retryAfterHeader) return RATE_LIMIT_RETRY_FALLBACK_MS;

    const asSeconds = Number.parseInt(retryAfterHeader, 10);
    if (Number.isFinite(asSeconds) && asSeconds >= 0) {
        return asSeconds * 1000;
    }

    const asDate = Date.parse(retryAfterHeader);
    if (Number.isFinite(asDate)) {
        return Math.max(0, asDate - Date.now());
    }

    return RATE_LIMIT_RETRY_FALLBACK_MS;
}

async function ensureAuthorizedSession(forceFreshLogin = false): Promise<void> {
    if (forceFreshLogin) {
        throw new Error('La sesion de DAB expiro. Vuelve a iniciar sesion desde Ajustes.');
    }

    const sessionCookie = useDabAuthStore.getState().session?.sessionCookie?.trim();
    if (!sessionCookie) {
        throw new Error('Conecta tu cuenta de DAB desde Ajustes para usar esta fuente.');
    }
}

function isUnexpectedHtmlApiResponse(response: Response, body: string): boolean {
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    const trimmed = body.trimStart().toLowerCase();
    return contentType.includes('text/html')
        || trimmed.startsWith('<!doctype html')
        || trimmed.startsWith('<html');
}

async function betaFetch(
    path: string,
    init?: RequestInit,
    retryOnAuth = true,
    retryOnRateLimit = true,
): Promise<Response> {
    await ensureAuthorizedSession();
    const sessionCookie = useDabAuthStore.getState().session?.sessionCookie?.trim();
    const headers = new Headers(init?.headers ?? {});
    const candidateBaseUrls = getDabCandidateBaseUrls();
    let lastResponse: Response | null = null;
    let lastNetworkError: Error | null = null;

    if (sessionCookie) {
        headers.set('Cookie', `session=${sessionCookie}`);
    }

    if (init?.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    for (let index = 0; index < candidateBaseUrls.length; index += 1) {
        const baseUrl = candidateBaseUrls[index];

        try {
            const response = await fetch(`${baseUrl}${path}`, {
                ...init,
                credentials: 'include',
                headers,
            });
            const clonedResponse = response.clone();
            const responseBody = await clonedResponse.text().catch(() => '');

            if (response.status === 429 && retryOnRateLimit) {
                await delay(getRetryAfterMs(response));
                return await betaFetch(path, init, retryOnAuth, false);
            }

            if ((response.status === 401 || response.status === 403) && retryOnAuth) {
                await ensureAuthorizedSession(true);
                return await betaFetch(path, init, false, retryOnRateLimit);
            }

            if (response.ok && isUnexpectedHtmlApiResponse(response, responseBody) && index < candidateBaseUrls.length - 1) {
                lastResponse = response;
                continue;
            }

            if (response.status >= 500 && index < candidateBaseUrls.length - 1) {
                lastResponse = response;
                continue;
            }

            return response;
        } catch (error) {
            lastNetworkError = error instanceof Error
                ? error
                : new Error('No se pudo contactar el servidor de DAB.');

            if (index === candidateBaseUrls.length - 1) {
                break;
            }
        }
    }

    if (lastResponse) {
        return lastResponse;
    }

    throw lastNetworkError || new Error('No se pudo contactar el servidor de DAB.');
}

async function betaJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await betaFetch(path, init);
    if (!response.ok) {
        throw new Error(await parseError(response));
    }

    const rawBody = await response.text();
    if (isUnexpectedHtmlApiResponse(response, rawBody)) {
        throw new Error('El servidor de DAB devolvio una pagina web en lugar de JSON. Intenta otro mirror o vuelve a probar en unos minutos.');
    }

    let payload: T & { requiresAuth?: boolean; error?: string };
    try {
        payload = JSON.parse(rawBody) as T & { requiresAuth?: boolean; error?: string };
    } catch {
        throw new Error('El servidor de DAB devolvio una respuesta invalida.');
    }

    if ((payload as any)?.requiresAuth) {
        throw new Error((payload as any)?.error || 'DAB requiere autenticacion.');
    }

    return payload;
}

export async function searchDabBetaTracks(query: string): Promise<TidalSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const cacheKey = trimmed.toLowerCase();
    const cached = trackSearchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.data;
    }

    const inflight = inflightTrackSearches.get(cacheKey);
    if (inflight) {
        return await inflight;
    }

    const searchPromise = (async () => {
        const response = await betaJson<DabBetaSearchTracksResponse>(
            `/api/search?q=${encodeURIComponent(trimmed)}&type=track&offset=0`,
        );

        const results = (response.tracks ?? [])
            .filter(track => Number.isFinite(Number(track.id)))
            .map(normalizeTrack);

        trackSearchCache.set(cacheKey, {
            expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
            data: results,
        });

        return results;
    })();

    inflightTrackSearches.set(cacheKey, searchPromise);

    try {
        return await searchPromise;
    } finally {
        inflightTrackSearches.delete(cacheKey);
    }
}

export async function searchDabBetaArtists(query: string): Promise<TidalArtist[]> {
    const tracks = await searchDabBetaTracks(query);
    const artists = new Map<number, TidalArtist>();
    let enrichedArtistCount = 0;

    for (const track of tracks) {
        if (!track.artistId) continue;
        if (artists.has(track.artistId)) continue;
        const shouldResolveArtwork = enrichedArtistCount < SEARCH_ARTIST_ARTWORK_LIMIT;
        const artworkUrl = shouldResolveArtwork
            ? await resolveArtistArtworkFallback(track.artist)
            : undefined;

        if (shouldResolveArtwork) {
            enrichedArtistCount++;
        }

        artists.set(track.artistId, {
            id: track.artistId,
            name: track.artist,
            artworkUrl,
            picture: artworkUrl,
        });
    }

    return Array.from(artists.values());
}

export async function searchDabBetaPlaylists(): Promise<never[]> {
    return [];
}

export async function getDabBetaFeaturedAlbums(type: string = 'new-releases'): Promise<TidalAlbum[]> {
    const response = await betaJson<DabBetaFeaturedAlbumsResponse>(
        `/api/featured-albums?type=${encodeURIComponent(type)}&offset=0&limit=25`,
    );

    return (response.albums ?? []).map(normalizeAlbum);
}

export async function getDabBetaAlbumDetail(albumId: number): Promise<TidalAlbumDetail> {
    const cached = getCachedValue(albumDetailCache, albumId);
    if (cached) {
        return cached;
    }

    const externalAlbumId = resolveDabBetaAlbumId(albumId);
    if (!externalAlbumId) {
        throw new Error('No se encontro el album de DAB.');
    }

    const response = await betaJson<DabBetaAlbumDetailResponse>(
        `/api/album?albumId=${encodeURIComponent(externalAlbumId)}`,
    );

    const albumData = response.album;
    if (!albumData) {
        throw new Error(response.error || 'No se pudo cargar el album de DAB.');
    }

    const album = normalizeAlbum({
        id: albumData.id,
        title: albumData.title,
        artist: albumData.artist,
        cover: albumData.cover,
        releaseDate: albumData.releaseDate,
        genre: albumData.genre,
        trackCount: albumData.trackCount,
        audioQuality: albumData.audioQuality,
    });

    const tracks = (albumData.tracks ?? []).map(normalizeTrack);
    const result = { album, tracks };
    setCachedValue(albumDetailCache, albumId, result, DETAIL_CACHE_TTL_MS);
    return result;
}

export async function getDabBetaArtistInfo(artistId: number, artistNameHint?: string): Promise<TidalArtist> {
    const artistCacheKey = `${artistId}:${(artistNameHint ?? '').trim().toLowerCase()}`;
    const cached = getCachedValue(artistInfoCache, artistCacheKey);
    if (cached) {
        return cached;
    }

    try {
        const response = await betaJson<DabBetaDiscographyResponse>(
            `/api/discography?artistId=${artistId}`,
        );

        if (response.artist) {
            const normalizedArtist = normalizeArtist(response.artist);
            const artistArtwork = await resolveArtistArtworkFallback(normalizedArtist.name);
            const artist = {
                ...normalizedArtist,
                artworkUrl: artistArtwork,
                picture: artistArtwork,
            };
            setCachedValue(artistInfoCache, artistCacheKey, artist, DETAIL_CACHE_TTL_MS);
            return artist;
        }
    } catch {
        // Fall back to search-derived artist below.
    }

    const fallbackTracks = artistNameHint ? await searchDabBetaTracks(artistNameHint) : [];
    const matched = fallbackTracks.find(track => track.artistId === artistId || track.artist.toLowerCase() === (artistNameHint ?? '').toLowerCase());
    const fallbackArtwork = await resolveArtistArtworkFallback(artistNameHint || matched?.artist);
    const artist = {
        id: artistId,
        name: artistNameHint || matched?.artist || 'Unknown Artist',
        artworkUrl: fallbackArtwork,
        picture: fallbackArtwork,
    };
    setCachedValue(artistInfoCache, artistCacheKey, artist, DETAIL_CACHE_TTL_MS);
    return artist;
}

export async function getDabBetaArtistDetail(artistId: number, artistNameHint?: string): Promise<TidalArtistDetail> {
    const detailCacheKey = `${artistId}:${(artistNameHint ?? '').trim().toLowerCase()}`;
    const cached = getCachedValue(artistDetailCache, detailCacheKey);
    if (cached) {
        return cached;
    }

    let artist = await getDabBetaArtistInfo(artistId, artistNameHint);
    let albums: TidalAlbum[] = [];

    try {
        const response = await betaJson<DabBetaDiscographyResponse>(
            `/api/discography?artistId=${artistId}`,
        );

        if (response.artist) {
            const normalizedArtist = normalizeArtist(response.artist);
            const artistArtwork = await resolveArtistArtworkFallback(normalizedArtist.name);
            artist = {
                ...normalizedArtist,
                artworkUrl: artistArtwork,
                picture: artistArtwork,
            };
        }

        albums = (response.albums ?? []).map(normalizeAlbum);
    } catch {
        // Search fallback handled below.
    }

    const searchTerm = artistNameHint?.trim() || artist.name;
    const tracks = await searchDabBetaTracks(searchTerm);
    const topTracks = tracks.filter(track => track.artistId === artistId || track.artist.toLowerCase() === artist.name.toLowerCase());

    if (albums.length === 0) {
        const uniqueAlbums = new Map<number, TidalAlbum>();
        for (const track of topTracks) {
            if (!track.albumId || uniqueAlbums.has(track.albumId)) continue;
            uniqueAlbums.set(track.albumId, {
                id: track.albumId,
                title: track.album,
                artistId: track.artistId,
                artistName: track.artist,
                artworkUrl: track.artworkUrl,
                coverUuid: resolveDabBetaAlbumId(track.albumId) ?? undefined,
                year: track.year,
            });
        }
        albums = Array.from(uniqueAlbums.values());
    }

    const result = {
        artist,
        topTracks,
        albums,
    };
    setCachedValue(artistDetailCache, detailCacheKey, result, DETAIL_CACHE_TTL_MS);
    return result;
}

function getBetaQualityCode(quality: TidalQuality): string {
    switch (quality) {
        case 'LOW':
        case 'HIGH':
        case 'MP3':
            return MP3_QUALITY_CODE;
        case 'LOSSLESS':
        case 'HI_RES_LOSSLESS':
        default:
            return LOSSLESS_QUALITY_CODE;
    }
}

export async function getDabBetaStreamInfo(track: TidalTrack, quality: TidalQuality): Promise<{
    url: string;
    extension: 'flac' | 'mp3';
    codec: string;
    quality: string;
    sampleRate?: number;
    bitDepth?: number;
}> {
    const qualityCode = getBetaQualityCode(quality);
    const response = await betaJson<DabBetaStreamResponse>(
        `/api/stream?trackId=${track.id}&quality=${qualityCode}`,
    );

    if (!response.url) {
        throw new Error(response.error || 'No se pudo obtener el stream de DAB.');
    }

    const extension = qualityCode === MP3_QUALITY_CODE ? 'mp3' : 'flac';
    return {
        url: response.url,
        extension,
        codec: extension,
        quality: quality === 'MP3'
            ? 'MP3'
            : (qualityCode === MP3_QUALITY_CODE ? 'HIGH' : (track.quality || 'LOSSLESS')),
        sampleRate: track.sampleRate,
        bitDepth: track.bitDepth,
    };
}
