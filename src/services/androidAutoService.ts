import type { RemotePlaySearchEvent } from 'react-native-track-player';
import { useLibraryStore } from '../stores/libraryStore';
import { usePlayerStore } from '../stores/playerStore';
import type { Album, Playlist, Track } from '../types/audio';

const HYDRATION_TIMEOUT_MS = 5000;
const HYDRATION_POLL_MS = 120;

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function normalize(value?: string | null): string {
    return (value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function hasText(value?: string | null): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function compareTracks(a: Track, b: Track): number {
    const artist = normalize(a.artist).localeCompare(normalize(b.artist));
    if (artist !== 0) return artist;

    const album = normalize(a.album).localeCompare(normalize(b.album));
    if (album !== 0) return album;

    const trackNumber = (a.trackNumber ?? Number.MAX_SAFE_INTEGER) - (b.trackNumber ?? Number.MAX_SAFE_INTEGER);
    if (trackNumber !== 0) return trackNumber;

    const title = normalize(a.title).localeCompare(normalize(b.title));
    if (title !== 0) return title;

    return (b.dateAdded ?? 0) - (a.dateAdded ?? 0);
}

function dedupeTracks(tracks: Track[]): Track[] {
    const seen = new Set<string>();
    const unique: Track[] = [];

    for (const track of tracks) {
        if (!track?.id || seen.has(track.id)) continue;
        seen.add(track.id);
        unique.push(track);
    }

    return unique;
}

async function ensureStoresReady() {
    const libraryStore = useLibraryStore as typeof useLibraryStore & {
        persist?: {
            rehydrate?: () => Promise<void> | void;
        };
    };
    const playerStore = usePlayerStore as typeof usePlayerStore & {
        persist?: {
            rehydrate?: () => Promise<void> | void;
        };
    };

    try {
        await Promise.all([
            libraryStore.persist?.rehydrate?.(),
            playerStore.persist?.rehydrate?.(),
        ]);
    } catch {
        // Fall back to the current in-memory state if rehydration fails.
    }

    const start = Date.now();
    while (!useLibraryStore.getState()._hasHydrated && Date.now() - start < HYDRATION_TIMEOUT_MS) {
        await sleep(HYDRATION_POLL_MS);
    }

    return useLibraryStore.getState();
}

function getPlaylistTracks(state: ReturnType<typeof useLibraryStore.getState>, playlist: Playlist): Track[] {
    return playlist.trackIds
        .map(trackId => state.tracks.get(trackId))
        .filter((track): track is Track => !!track);
}

function getAlbumTracks(state: ReturnType<typeof useLibraryStore.getState>, album: Album): Track[] {
    return album.tracks
        .map(trackId => state.tracks.get(trackId))
        .filter((track): track is Track => !!track)
        .sort(compareTracks);
}

function getArtistTracks(state: ReturnType<typeof useLibraryStore.getState>, artistName: string): Track[] {
    const target = normalize(artistName);

    return Array.from(state.tracks.values())
        .filter(track => normalize(track.artist) === target)
        .sort(compareTracks);
}

function findPlaylist(state: ReturnType<typeof useLibraryStore.getState>, playlistName?: string | null): Playlist | null {
    if (!hasText(playlistName)) return null;

    const target = normalize(playlistName);
    return Array.from(state.playlists.values()).find(playlist => normalize(playlist.name) === target) ?? null;
}

function findAlbum(state: ReturnType<typeof useLibraryStore.getState>, albumName?: string | null, artistName?: string | null): Album | null {
    if (!hasText(albumName)) return null;

    const targetAlbum = normalize(albumName);
    const targetArtist = normalize(artistName);

    return Array.from(state.albums.values()).find(album => {
        if (normalize(album.name) !== targetAlbum) return false;
        if (targetArtist && normalize(album.artist) !== targetArtist) return false;
        return true;
    }) ?? null;
}

function scoreTrack(track: Track, request: RemotePlaySearchEvent): number {
    let score = 0;
    const normalizedTitle = normalize(track.title);
    const normalizedArtist = normalize(track.artist);
    const normalizedAlbum = normalize(track.album);
    const normalizedQuery = normalize(request.query);
    const normalizedRequestTitle = normalize(request.title);
    const normalizedRequestArtist = normalize(request.artist);
    const normalizedRequestAlbum = normalize(request.album);

    if (normalizedRequestTitle) {
        if (normalizedTitle === normalizedRequestTitle) score += 180;
        else if (normalizedTitle.includes(normalizedRequestTitle)) score += 90;
    }

    if (normalizedRequestArtist) {
        if (normalizedArtist === normalizedRequestArtist) score += 120;
        else if (normalizedArtist.includes(normalizedRequestArtist)) score += 60;
    }

    if (normalizedRequestAlbum) {
        if (normalizedAlbum === normalizedRequestAlbum) score += 90;
        else if (normalizedAlbum.includes(normalizedRequestAlbum)) score += 45;
    }

    if (normalizedQuery) {
        if (normalizedTitle === normalizedQuery) score += 140;
        if (`${normalizedArtist} ${normalizedTitle}`.includes(normalizedQuery)) score += 90;
        if (`${normalizedTitle} ${normalizedArtist}`.includes(normalizedQuery)) score += 90;
        if (normalizedArtist === normalizedQuery) score += 80;
        if (normalizedAlbum === normalizedQuery) score += 60;
        if (normalizedTitle.includes(normalizedQuery)) score += 50;
        if (normalizedArtist.includes(normalizedQuery)) score += 40;
        if (normalizedAlbum.includes(normalizedQuery)) score += 30;
    }

    return score;
}

function findBestTrack(state: ReturnType<typeof useLibraryStore.getState>, request: RemotePlaySearchEvent): Track | null {
    const tracks = Array.from(state.tracks.values());
    if (tracks.length === 0) return null;

    const ranked = tracks
        .map(track => ({ track, score: scoreTrack(track, request) }))
        .filter(entry => entry.score > 0)
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return compareTracks(a.track, b.track);
        });

    return ranked[0]?.track ?? null;
}

async function playSelection(selectedTrack: Track, queue: Track[]): Promise<boolean> {
    if (!selectedTrack?.id) return false;

    const cleanQueue = dedupeTracks(queue);
    const queueContainsSelection = cleanQueue.some(track => track.id === selectedTrack.id);
    const finalQueue = queueContainsSelection ? cleanQueue : [selectedTrack, ...cleanQueue];

    await usePlayerStore.getState().play(selectedTrack, finalQueue);
    return true;
}

export async function playFromMediaId(mediaId: string): Promise<boolean> {
    const state = await ensureStoresReady();
    if (!state.tracks.size) return false;

    const track = state.tracks.get(mediaId);
    if (!track) return false;

    const albumMatch = findAlbum(state, track.album, track.artist);
    const queue = albumMatch ? getAlbumTracks(state, albumMatch) : [track];

    return playSelection(track, queue);
}

export async function playFromSearch(request: RemotePlaySearchEvent): Promise<boolean> {
    const state = await ensureStoresReady();
    if (!state.tracks.size) return false;

    if (!hasText(request.query) && !hasText(request.title) && !hasText(request.artist) && !hasText(request.album) && !hasText(request.playlist)) {
        const currentTrack = usePlayerStore.getState().currentTrack;
        if (!currentTrack) return false;
        await usePlayerStore.getState().resume();
        return true;
    }

    const focus = normalize(request.focus);

    if (focus === 'playlist' || hasText(request.playlist)) {
        const playlist = findPlaylist(state, request.playlist || request.query);
        if (playlist) {
            const playlistTracks = getPlaylistTracks(state, playlist);
            const selectedTrack = playlistTracks[0];
            if (selectedTrack) {
                return playSelection(selectedTrack, playlistTracks);
            }
        }
    }

    if (focus === 'album' || hasText(request.album)) {
        const album = findAlbum(state, request.album || request.query, request.artist);
        if (album) {
            const albumTracks = getAlbumTracks(state, album);
            const selectedTrack = hasText(request.title)
                ? albumTracks.find(track => normalize(track.title) === normalize(request.title))
                : albumTracks[0];

            if (selectedTrack) {
                return playSelection(selectedTrack, albumTracks);
            }
        }
    }

    if (focus === 'artist' || hasText(request.artist)) {
        const artistTracks = getArtistTracks(state, request.artist || request.query || '');
        if (artistTracks.length > 0) {
            const selectedTrack = hasText(request.title)
                ? artistTracks.find(track => normalize(track.title) === normalize(request.title))
                : artistTracks[0];

            if (selectedTrack) {
                return playSelection(selectedTrack, artistTracks);
            }
        }
    }

    const bestTrack = findBestTrack(state, request);
    if (!bestTrack) return false;

    const albumQueue = findAlbum(state, bestTrack.album, bestTrack.artist);
    const queue = albumQueue ? getAlbumTracks(state, albumQueue) : [bestTrack];

    return playSelection(bestTrack, queue);
}
