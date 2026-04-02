import { Playlist, Track } from '../types/audio';
import { useAuthStore } from '../stores/authStore';
import { useLibraryStore } from '../stores/libraryStore';
import { ONBOARDING_MIRROR_PLAYLIST_ID } from './onboardingTasteService';
import { assertAuthSupabaseConfig } from './supabaseConfig';

const PLAYLIST_SYNC_DEBOUNCE_MS = 900;
const EXCLUDED_SYNC_PLAYLIST_IDS = new Set<string>([
    'spotify_top50_global',
    ONBOARDING_MIRROR_PLAYLIST_ID,
]);
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncInFlight = false;

type CloudPlaylistRow = {
    id: string;
    owner_user_id?: string;
    name: string;
    description: string | null;
    artwork: string | null;
    track_ids: string[];
    tracks: Track[];
    created_at: string;
    updated_at: string;
};

function createCloudPlaylistId(ownerUserId: string, playlistId: string): string {
    return `${ownerUserId}::${playlistId}`;
}

function getLocalPlaylistId(cloudId: string, ownerUserId?: string): string {
    if (ownerUserId) {
        const prefix = `${ownerUserId}::`;
        if (cloudId.startsWith(prefix)) {
            return cloudId.slice(prefix.length);
        }
    }

    const separatorIndex = cloudId.indexOf('::');
    if (separatorIndex > 0) {
        return cloudId.slice(separatorIndex + 2);
    }

    return cloudId;
}

function createHeaders(accessToken: string): HeadersInit {
    const { anonKey } = assertAuthSupabaseConfig();
    return {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
    };
}

function buildRestUrl(path: string): string {
    const { url } = assertAuthSupabaseConfig();
    return `${url}${path}`;
}

function normalizePlaylistRow(row: CloudPlaylistRow): Playlist {
    return {
        id: getLocalPlaylistId(row.id, row.owner_user_id),
        name: row.name,
        description: row.description ?? undefined,
        artwork: row.artwork ?? undefined,
        trackIds: Array.isArray(row.track_ids) ? row.track_ids : [],
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
    };
}

function createCloudPlaceholder(track: Track): Track {
    if (!track.tidalId) {
        return {
            ...track,
            uri: track.uri || `cloud://track/${track.id}`,
            cloudOnly: true,
        };
    }

    return {
        ...track,
        id: `tidal_${track.tidalId}`,
        uri: `cloud://tidal/${track.tidalId}`,
        source: 'tidal',
        cloudOnly: true,
    };
}

function getSerializablePlaylistTracks(playlist: Playlist): Track[] {
    const state = useLibraryStore.getState();
    const cloudTracksById = state.cloudPlaylistTracks.get(playlist.id) ?? new Map<string, Track>();

    return playlist.trackIds.map(trackId => {
        const localTrack = state.tracks.get(trackId);
        const sourceTrack: Track | undefined = localTrack ?? cloudTracksById.get(trackId);
        if (!sourceTrack) {
            return {
                id: trackId,
                uri: `cloud://track/${trackId}`,
                title: 'Track unavailable',
                artist: 'StaySound',
                album: playlist.name,
                duration: 0,
                dateAdded: Date.now(),
                cloudOnly: true,
            };
        }

        return createCloudPlaceholder(sourceTrack);
    });
}

async function uploadPlaylistsSnapshot() {
    const authState = useAuthStore.getState();
    const session = authState.session;

    if (!session || authState.status !== 'authenticated' || !authState.hasSessionLock) {
        return;
    }

    const libraryState = useLibraryStore.getState();
    const playlists = Array.from(libraryState.playlists.values()).filter(
        playlist => !EXCLUDED_SYNC_PLAYLIST_IDS.has(playlist.id) && playlist.source !== 'spotify',
    );
    const rows = playlists.map(playlist => ({
        id: createCloudPlaylistId(session.userId, playlist.id),
        owner_user_id: session.userId,
        name: playlist.name,
        description: playlist.description ?? null,
        artwork: playlist.artwork ?? null,
        track_ids: playlist.trackIds,
        tracks: getSerializablePlaylistTracks(playlist),
        created_at: new Date(playlist.createdAt).toISOString(),
        updated_at: new Date(playlist.updatedAt).toISOString(),
    }));

    syncInFlight = true;
    try {
        const upsertResponse = await fetch(buildRestUrl('/rest/v1/app_playlists?on_conflict=id'), {
            method: 'POST',
            headers: {
                ...createHeaders(session.accessToken),
                Prefer: 'resolution=merge-duplicates',
            },
            body: JSON.stringify(rows),
        });

        if (!upsertResponse.ok) {
            throw new Error(await upsertResponse.text());
        }

        const deletePath = playlists.length > 0
            ? `/rest/v1/app_playlists?owner_user_id=eq.${session.userId}&id=not.in.(${playlists.map(playlist => `"${createCloudPlaylistId(session.userId, playlist.id)}"`).join(',')})`
            : `/rest/v1/app_playlists?owner_user_id=eq.${session.userId}`;

        const deleteResponse = await fetch(buildRestUrl(deletePath), {
            method: 'DELETE',
            headers: createHeaders(session.accessToken),
        });

        if (!deleteResponse.ok) {
            throw new Error(await deleteResponse.text());
        }
    } catch (error) {
        console.warn('[PlaylistSync] upload failed:', error);
    } finally {
        syncInFlight = false;
    }
}

export function queuePlaylistCloudSync() {
    if (syncTimer) {
        clearTimeout(syncTimer);
    }

    syncTimer = setTimeout(() => {
        syncTimer = null;
        if (!syncInFlight) {
            void uploadPlaylistsSnapshot();
        }
    }, PLAYLIST_SYNC_DEBOUNCE_MS);
}

export async function syncPlaylistsNow() {
    if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = null;
    }
    await uploadPlaylistsSnapshot();
}

export async function hydrateCloudPlaylists() {
    const authState = useAuthStore.getState();
    const session = authState.session;
    if (!session || authState.status !== 'authenticated') {
        return;
    }

    try {
        const response = await fetch(
            buildRestUrl('/rest/v1/app_playlists?select=id,name,description,artwork,track_ids,tracks,created_at,updated_at&order=updated_at.desc'),
            {
                method: 'GET',
                headers: createHeaders(session.accessToken),
            }
        );

        if (!response.ok) {
            throw new Error(await response.text());
        }

        const rows = await response.json() as CloudPlaylistRow[];
        const localState = useLibraryStore.getState();
        const nextPlaylists = new Map(localState.playlists);
        const nextCloudTracks = new Map(localState.cloudPlaylistTracks);

        for (const row of rows) {
            const remotePlaylist = normalizePlaylistRow(row);
            const existing = nextPlaylists.get(remotePlaylist.id);
            if (!existing || remotePlaylist.updatedAt >= existing.updatedAt) {
                nextPlaylists.set(remotePlaylist.id, remotePlaylist);
            }

            const trackMap = new Map<string, Track>();
            for (const track of row.tracks ?? []) {
                const placeholder = createCloudPlaceholder(track);
                trackMap.set(placeholder.id, placeholder);
            }
            nextCloudTracks.set(remotePlaylist.id, trackMap);
        }

        useLibraryStore.setState(state => ({
            playlists: nextPlaylists,
            cloudPlaylistTracks: nextCloudTracks,
            catalogRevision: state.catalogRevision + 1,
        }));
    } catch (error) {
        console.warn('[PlaylistSync] hydrate failed:', error);
    }
}
