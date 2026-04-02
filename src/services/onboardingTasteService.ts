import { useLibraryStore } from '../stores/libraryStore';
import { OnboardingTasteArtist, useOnboardingStore } from '../stores/onboardingStore';
import { Playlist, TidalTrack, Track } from '../types/audio';
import { getTidalArtistDetail } from './tidalService';

export const ONBOARDING_MIRROR_PLAYLIST_ID = 'playlist_onboarding_mirrors_v1';
export const ONBOARDING_TASTE_PROFILE_VERSION = 1;

const DEFAULT_SELECTED_TRACKS = 12;
const MAX_SELECTED_TRACKS = 24;
const ARTIST_FETCH_CONCURRENCY = 3;

type ArtistDetailLoadResult = {
    artistId: number;
    tracks: TidalTrack[];
    failed: boolean;
};

export type BuildOnboardingMirrorPlaylistInput = {
    artists: OnboardingTasteArtist[];
    selectedTrackIds?: number[];
};

export type BuildOnboardingMirrorPlaylistResult = {
    playlist: Playlist;
    cloudTracks: Map<string, Track>;
    tracks: TidalTrack[];
};

export type LoadTopTracksResult = {
    tracksByArtist: Map<number, TidalTrack[]>;
    failedArtistIds: number[];
};

let ensureInFlight: Promise<void> | null = null;

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<R>,
): Promise<R[]> {
    if (items.length === 0) return [];

    const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
    const results: R[] = new Array(items.length);
    let cursor = 0;

    const runners = Array.from({ length: safeConcurrency }, async () => {
        while (true) {
            const index = cursor++;
            if (index >= items.length) break;
            results[index] = await worker(items[index]);
        }
    });

    await Promise.all(runners);
    return results;
}

function toCloudTidalTrack(track: TidalTrack): Track {
    return {
        id: `tidal_${track.id}`,
        uri: `cloud://tidal/${track.id}`,
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.durationMs,
        artwork: track.artworkUrl,
        trackNumber: track.trackNumber,
        year: track.year,
        quality: track.quality,
        sampleRate: track.sampleRate,
        bitDepth: track.bitDepth,
        codec: track.codec,
        source: 'tidal',
        tidalId: track.id,
        tidalAlbumId: track.albumId,
        dateAdded: Date.now(),
        cloudOnly: true,
    };
}

function interleaveTracksByArtist(tracksByArtist: Map<number, TidalTrack[]>): TidalTrack[] {
    const buckets = Array.from(tracksByArtist.values()).map(tracks =>
        [...tracks].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    );
    const indexes = buckets.map(() => 0);
    const seen = new Set<number>();
    const merged: TidalTrack[] = [];

    let didAdvance = true;
    while (didAdvance) {
        didAdvance = false;
        for (let i = 0; i < buckets.length; i++) {
            const bucket = buckets[i];
            const pointer = indexes[i];
            if (pointer >= bucket.length) continue;

            const candidate = bucket[pointer];
            indexes[i] = pointer + 1;
            didAdvance = true;

            if (seen.has(candidate.id)) continue;
            seen.add(candidate.id);
            merged.push(candidate);
        }
    }

    return merged;
}

function pickFinalTrackSelection(
    allTracks: TidalTrack[],
    selectedTrackIds: number[] | undefined,
): TidalTrack[] {
    const cappedAllTracks = allTracks.slice(0, MAX_SELECTED_TRACKS * 2);
    const byId = new Map<number, TidalTrack>(cappedAllTracks.map(track => [track.id, track]));
    const selectedSet = new Set((selectedTrackIds ?? []).filter(trackId => byId.has(trackId)));

    const selectedTracks = Array.from(selectedSet)
        .map(trackId => byId.get(trackId))
        .filter((track): track is TidalTrack => !!track);

    if (selectedTracks.length > 0) {
        return selectedTracks.slice(0, MAX_SELECTED_TRACKS);
    }

    return cappedAllTracks.slice(0, DEFAULT_SELECTED_TRACKS);
}

export async function loadTopTracksForArtists(artists: OnboardingTasteArtist[]): Promise<LoadTopTracksResult> {
    const details = await mapWithConcurrency<OnboardingTasteArtist, ArtistDetailLoadResult>(
        artists,
        ARTIST_FETCH_CONCURRENCY,
        async artist => {
            try {
                const detail = await getTidalArtistDetail(artist.id, artist.name);
                return {
                    artistId: artist.id,
                    tracks: detail.topTracks,
                    failed: false,
                };
            } catch (error) {
                console.warn('[OnboardingTaste] Failed to load artist detail:', artist.id, error);
                return {
                    artistId: artist.id,
                    tracks: [],
                    failed: true,
                };
            }
        },
    );

    const tracksByArtist = new Map<number, TidalTrack[]>();
    const failedArtistIds: number[] = [];

    details.forEach(detail => {
        if (detail.failed) {
            failedArtistIds.push(detail.artistId);
            return;
        }

        tracksByArtist.set(detail.artistId, detail.tracks);
    });

    return {
        tracksByArtist,
        failedArtistIds,
    };
}

export async function buildOnboardingMirrorPlaylist(
    input: BuildOnboardingMirrorPlaylistInput,
): Promise<BuildOnboardingMirrorPlaylistResult> {
    const { artists, selectedTrackIds } = input;
    if (artists.length === 0) {
        throw new Error('No artists selected for onboarding playlist generation.');
    }

    const { tracksByArtist } = await loadTopTracksForArtists(artists);
    const mergedTracks = interleaveTracksByArtist(tracksByArtist);
    const finalTracks = pickFinalTrackSelection(mergedTracks, selectedTrackIds);

    if (finalTracks.length === 0) {
        throw new Error('No tracks available to generate onboarding playlist.');
    }

    const cloudTracks = new Map<string, Track>();
    const playlistTrackIds: string[] = [];

    finalTracks.forEach(track => {
        const cloudTrack = toCloudTidalTrack(track);
        cloudTracks.set(cloudTrack.id, cloudTrack);
        playlistTrackIds.push(cloudTrack.id);
    });

    const now = Date.now();
    const playlist: Playlist = {
        id: ONBOARDING_MIRROR_PLAYLIST_ID,
        name: 'Mirror Mix Inicial',
        description: 'Top tracks de tus artistas elegidos',
        artwork: finalTracks[0]?.artworkUrl,
        trackIds: playlistTrackIds,
        createdAt: now,
        updatedAt: now,
        readonly: true,
    };

    return {
        playlist,
        cloudTracks,
        tracks: finalTracks,
    };
}

export function applyOnboardingMirrorPlaylist(result: BuildOnboardingMirrorPlaylistResult): void {
    const state = useLibraryStore.getState();
    const existing = state.playlists.get(ONBOARDING_MIRROR_PLAYLIST_ID);

    const nextPlaylists = new Map(state.playlists);
    nextPlaylists.set(ONBOARDING_MIRROR_PLAYLIST_ID, {
        ...existing,
        ...result.playlist,
        readonly: true,
        createdAt: existing?.createdAt ?? result.playlist.createdAt,
        updatedAt: Date.now(),
    });

    const nextCloudTracks = new Map(state.cloudPlaylistTracks);
    nextCloudTracks.set(ONBOARDING_MIRROR_PLAYLIST_ID, result.cloudTracks);

    useLibraryStore.setState(prev => ({
        playlists: nextPlaylists,
        cloudPlaylistTracks: nextCloudTracks,
        catalogRevision: prev.catalogRevision + 1,
    }));
}

export function hasOnboardingMirrorPlaylist(): boolean {
    const state = useLibraryStore.getState();
    const playlist = state.playlists.get(ONBOARDING_MIRROR_PLAYLIST_ID);
    return !!playlist && playlist.trackIds.length > 0;
}

async function runEnsureOnboardingMirrorPlaylist(): Promise<void> {
    const onboardingState = useOnboardingStore.getState();
    if (!onboardingState.hasCompletedOnboarding) return;
    if (onboardingState.tasteArtists.length === 0) return;

    if (hasOnboardingMirrorPlaylist()) {
        if (onboardingState.tastePlaylistStatus !== 'ready') {
            onboardingState.markTastePlaylistGenerated(onboardingState.tastePlaylistGeneratedAt ?? Date.now());
        }
        return;
    }

    onboardingState.setTastePlaylistStatus('pending');

    try {
        const built = await buildOnboardingMirrorPlaylist({
            artists: onboardingState.tasteArtists,
            selectedTrackIds: onboardingState.tasteTrackIds.length > 0 ? onboardingState.tasteTrackIds : undefined,
        });
        applyOnboardingMirrorPlaylist(built);
        onboardingState.markTastePlaylistGenerated(Date.now());
    } catch (error) {
        console.warn('[OnboardingTaste] ensure failed:', error);
        onboardingState.setTastePlaylistStatus('failed');
    }
}

export async function ensureOnboardingMirrorPlaylist(): Promise<void> {
    if (!ensureInFlight) {
        ensureInFlight = runEnsureOnboardingMirrorPlaylist()
            .catch(error => {
                console.warn('[OnboardingTaste] ensure crashed:', error);
            })
            .finally(() => {
                ensureInFlight = null;
            });
    }

    await ensureInFlight;
}
