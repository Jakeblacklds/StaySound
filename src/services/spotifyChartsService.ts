import { Playlist, Track } from '../types/audio';
import { useLibraryStore } from '../stores/libraryStore';
import { getSpotifyConfig } from './spotifyConfig';
import { getSupabaseConfig } from './supabaseConfig';

const SPOTIFY_TOP50_PLAYLIST_ID = 'spotify_top50_global';
const PLAYLIST_CACHE_TTL_MS = 10 * 60 * 1000;
const SPOTIFY_TOP50_PLAYLIST_URL = 'https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2tF';

let playlistCache: { expiresAt: number; playlist: Playlist; tracks: Track[] } | null = null;
let seededTop50 = false;
const importedPlaylistCache = new Map<string, { expiresAt: number; playlist: Playlist; tracks: Track[] }>();

type PublicTrackMeta = {
    title: string;
    artist: string;
    album: string;
    artwork?: string;
    spotifyUrl: string;
};

type SupabaseSpotifyChartRow = {
    chart_key: string;
    name: string;
    description?: string | null;
    artwork?: string | null;
    external_url?: string | null;
    payload?: {
        tracks?: Track[];
        trackIds?: string[];
        source?: string;
    } | null;
    fetched_at?: string | null;
    updated_at?: string | null;
};

function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function htmlToPlainText(input?: string | null): string | undefined {
    if (!input) return undefined;
    const normalized = decodeHtmlEntities(input)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized || undefined;
}

async function fetchPublicSpotifyTrack(trackId: string): Promise<PublicTrackMeta | null> {
    const response = await fetch(`https://open.spotify.com/track/${trackId}`);
    if (!response.ok) {
        return null;
    }

    const html = await response.text();
    const title = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1];
    const description = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1];
    const artwork = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
    const spotifyUrl = html.match(/<meta property="og:url" content="([^"]+)"/)?.[1] ?? `https://open.spotify.com/track/${trackId}`;
    const normalizedDescription = htmlToPlainText(description) ?? '';
    const [artist = 'Unknown Artist', album = 'Unknown Album'] = normalizedDescription
        .split(' · ')
        .slice(0, 2);

    if (!title) {
        return null;
    }

    return {
        title: decodeHtmlEntities(title),
        artist,
        album,
        artwork,
        spotifyUrl,
    };
}

function parseSpotifyPlaylistId(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const uriMatch = trimmed.match(/^spotify:playlist:([a-zA-Z0-9]+)$/i);
    if (uriMatch) {
        return uriMatch[1];
    }

    try {
        const url = new URL(trimmed);
        if (!url.hostname.includes('spotify.com')) return null;
        const match = url.pathname.match(/\/playlist\/([a-zA-Z0-9]+)/i);
        return match?.[1] ?? null;
    } catch {
        const directMatch = trimmed.match(/playlist\/([a-zA-Z0-9]+)/i);
        return directMatch?.[1] ?? null;
    }
}

function buildImportedSpotifyPlaylistId(spotifyPlaylistId: string): string {
    return `spotify_playlist_${spotifyPlaylistId}`;
}

async function fetchTop50GlobalFromSupabaseCache(): Promise<{ playlist: Playlist; tracks: Track[] } | null> {
    const supabase = getSupabaseConfig();
    if (!supabase.url || !supabase.anonKey) {
        return null;
    }

    const query = `${supabase.url}/rest/v1/app_spotify_chart_cache?select=chart_key,name,description,artwork,external_url,payload,fetched_at,updated_at&chart_key=eq.top50_global&limit=1`;
    const response = await fetch(query, {
        headers: {
            apikey: supabase.anonKey,
            Authorization: `Bearer ${supabase.anonKey}`,
        },
    });

    if (!response.ok) {
        throw new Error(await response.text());
    }

    const rows = await response.json() as SupabaseSpotifyChartRow[];
    const row = rows[0];
    const tracks = row?.payload?.tracks;
    if (!row || !Array.isArray(tracks) || tracks.length === 0) {
        return null;
    }

    const normalizedTracks = tracks.map((track, index) => ({
        ...track,
        id: track.id || `spotify_unknown_${index}`,
        uri: track.uri || `spotify://track/${track.spotifyId ?? index}`,
        source: 'spotify' as const,
        cloudOnly: true,
        dateAdded: track.dateAdded ?? Date.now(),
    }));

    return {
        playlist: {
            id: SPOTIFY_TOP50_PLAYLIST_ID,
            name: row.name || 'Top 50 - Global',
            description: row.description ?? undefined,
            artwork: row.artwork ?? undefined,
            trackIds: row.payload?.trackIds?.length ? row.payload.trackIds : normalizedTracks.map(track => track.id),
            createdAt: Date.now(),
            updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
            source: 'spotify',
            readonly: true,
            externalUrl: row.external_url ?? SPOTIFY_TOP50_PLAYLIST_URL,
        },
        tracks: normalizedTracks,
    };
}

async function fetchSpotifyPlaylistFromPublicPage(
    playlistPageUrl: string,
    options: { localPlaylistId?: string; fallbackName?: string } = {},
): Promise<{ playlist: Playlist; tracks: Track[] }> {
    const response = await fetch(playlistPageUrl);
    if (!response.ok) {
        throw new Error(`Spotify public page error: ${response.status}`);
    }

    const html = await response.text();
    const spotifyPlaylistId = parseSpotifyPlaylistId(playlistPageUrl) ?? `${Date.now()}`;
    const name = decodeHtmlEntities(html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? options.fallbackName ?? 'Spotify Playlist');
    const description = htmlToPlainText(html.match(/<meta property="og:description" content="([^"]+)"/)?.[1]) ?? 'Playlist publica de Spotify';
    const artwork = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1]
        ?? html.match(/"thumbnail_url":"([^"]+)"/)?.[1];
    const trackIds = [...html.matchAll(/<meta name="music:song" content="https:\/\/open\.spotify\.com\/track\/([^"]+)"/g)]
        .map(match => match[1])
        .slice(0, 50);

    const fetchedTracks = await Promise.all(trackIds.map(async (trackId, index) => {
        const meta = await fetchPublicSpotifyTrack(trackId);
        if (!meta) {
            return null;
        }

        const track: Track = {
            id: `spotify_${trackId}`,
            uri: `spotify://track/${trackId}`,
            title: meta.title,
            artist: meta.artist,
            album: meta.album || name,
            duration: 0,
            artwork: meta.artwork,
            spotifyId: trackId,
            spotifyUri: `spotify:track:${trackId}`,
            spotifyUrl: meta.spotifyUrl,
            trackNumber: index + 1,
            source: 'spotify',
            cloudOnly: true,
            dateAdded: Date.now(),
        };

        return track;
    }));
    const tracks = fetchedTracks.filter((track): track is Track => track !== null);

    const playlist: Playlist = {
        id: options.localPlaylistId ?? buildImportedSpotifyPlaylistId(spotifyPlaylistId),
        name,
        description,
        artwork,
        trackIds: tracks.map(track => track.id),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: 'spotify',
        readonly: true,
        externalUrl: playlistPageUrl,
    };

    return { playlist, tracks };
}

async function fetchTop50GlobalFromPublicPage(): Promise<{ playlist: Playlist; tracks: Track[] }> {
    const config = getSpotifyConfig();
    return await fetchSpotifyPlaylistFromPublicPage(
        `https://open.spotify.com/playlist/${config.top50GlobalPlaylistId}`,
        {
            localPlaylistId: SPOTIFY_TOP50_PLAYLIST_ID,
            fallbackName: 'Top 50 - Global',
        },
    );
}

async function fetchTop50Global(): Promise<{ playlist: Playlist; tracks: Track[] }> {
    if (playlistCache && playlistCache.expiresAt > Date.now()) {
        return {
            playlist: playlistCache.playlist,
            tracks: playlistCache.tracks,
        };
    }

    let playlist: Playlist;
    let tracks: Track[];

    try {
        const cached = await fetchTop50GlobalFromSupabaseCache();
        if (cached) {
            ({ playlist, tracks } = cached);
        } else {
            ({ playlist, tracks } = await fetchTop50GlobalFromPublicPage());
        }
    } catch (error) {
        console.warn('[SpotifyCharts] cache read failed, using public page fallback:', error);
        ({ playlist, tracks } = await fetchTop50GlobalFromPublicPage());
    }

    playlistCache = {
        expiresAt: Date.now() + PLAYLIST_CACHE_TTL_MS,
        playlist,
        tracks,
    };

    return { playlist, tracks };
}

function upsertSpotifyTop50(playlist: Playlist, tracks: Track[]) {
    const state = useLibraryStore.getState();
    const existing = state.playlists.get(playlist.id);
    const nextPlaylists = new Map(state.playlists);
    nextPlaylists.set(playlist.id, {
        ...existing,
        ...playlist,
        createdAt: existing?.createdAt ?? playlist.createdAt,
    });

    const nextCloudTracks = new Map(state.cloudPlaylistTracks);
    nextCloudTracks.set(playlist.id, new Map(tracks.map(track => [track.id, track])));

    useLibraryStore.setState({
        playlists: nextPlaylists,
        cloudPlaylistTracks: nextCloudTracks,
    });
}

function upsertImportedSpotifyPlaylist(playlist: Playlist, tracks: Track[]) {
    const state = useLibraryStore.getState();
    const existing = state.playlists.get(playlist.id);
    const nextPlaylists = new Map(state.playlists);
    nextPlaylists.set(playlist.id, {
        ...existing,
        ...playlist,
        createdAt: existing?.createdAt ?? playlist.createdAt,
    });

    const nextCloudTracks = new Map(state.cloudPlaylistTracks);
    nextCloudTracks.set(playlist.id, new Map(tracks.map(track => [track.id, track])));

    useLibraryStore.setState({
        playlists: nextPlaylists,
        cloudPlaylistTracks: nextCloudTracks,
    });
}

export function commitImportedSpotifyPlaylist(playlist: Playlist, tracks: Track[]) {
    upsertImportedSpotifyPlaylist(playlist, tracks);
}

function createSeedPlaylist(): Playlist {
    return {
        id: SPOTIFY_TOP50_PLAYLIST_ID,
        name: 'Top 50 - Global',
        description: 'Spotify Top 50 Global',
        artwork: 'https://charts-images.scdn.co/assets/locale_en/regional/daily/region_global_default.jpg',
        trackIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: 'spotify',
        readonly: true,
        externalUrl: SPOTIFY_TOP50_PLAYLIST_URL,
    };
}

export function ensureSeededSpotifyTop50Playlist() {
    if (seededTop50) return;

    const state = useLibraryStore.getState();
    if (state.playlists.has(SPOTIFY_TOP50_PLAYLIST_ID)) {
        seededTop50 = true;
        return;
    }

    const nextPlaylists = new Map(state.playlists);
    nextPlaylists.set(SPOTIFY_TOP50_PLAYLIST_ID, createSeedPlaylist());
    useLibraryStore.setState({ playlists: nextPlaylists });
    seededTop50 = true;
}

export function getSpotifyTop50PlaylistId() {
    return SPOTIFY_TOP50_PLAYLIST_ID;
}

export async function hydrateSpotifyTop50GlobalPlaylist(options: { force?: boolean } = {}) {
    ensureSeededSpotifyTop50Playlist();

    if (options.force) {
        playlistCache = null;
    }

    try {
        const { playlist, tracks } = await fetchTop50Global();
        upsertSpotifyTop50(playlist, tracks);
    } catch (error) {
        console.warn('[SpotifyCharts] hydrate failed:', error);
    }
}

export function isSpotifyRemoteTrack(track: Track): boolean {
    return track.source === 'spotify' || track.id.startsWith('spotify_');
}

export async function previewSpotifyPlaylistFromUrl(
    url: string
): Promise<{ playlist: Playlist; tracks: Track[] }> {
    const spotifyPlaylistId = parseSpotifyPlaylistId(url);
    if (!spotifyPlaylistId) {
        throw new Error('Pega un link valido de playlist publica de Spotify.');
    }

    const cacheKey = spotifyPlaylistId;
    const cached = importedPlaylistCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return {
            playlist: cached.playlist,
            tracks: cached.tracks,
        };
    }

    const playlistUrl = `https://open.spotify.com/playlist/${spotifyPlaylistId}`;
    const { playlist, tracks } = await fetchSpotifyPlaylistFromPublicPage(playlistUrl);
    importedPlaylistCache.set(cacheKey, {
        expiresAt: Date.now() + PLAYLIST_CACHE_TTL_MS,
        playlist,
        tracks,
    });
    return { playlist, tracks };
}

export async function importSpotifyPlaylistFromUrl(url: string): Promise<Playlist> {
    const { playlist, tracks } = await previewSpotifyPlaylistFromUrl(url);
    upsertImportedSpotifyPlaylist(playlist, tracks);
    return playlist;
}
