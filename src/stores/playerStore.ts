/**
 * PlayerStore - Zustand store for playback state
 *
 * Manages player state synced with Track Player for background playback
 */

import { makeMutable, type SharedValue } from 'react-native-reanimated';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { AudioEngine } from '../services/audioEngine';
import { extractMetadata, findArtworkInFolder, withTimeout } from '../services/fileScanner';
import { isTrackPlayable } from '../services/trackPlayerService';
import { FileSystemStorage } from '../services/storage';
import { getPerformanceProfile } from '../theme/performanceProfile';
import { balancedShuffle } from '../services/shuffle';
import { RepeatMode, Track } from '../types/audio';
import { useLibraryStore } from './libraryStore';

const MAX_RECENT = 50;
const MAX_QUEUE_ITEMS = 500;
const LINEAR_CONTEXT_HISTORY_BUFFER = 50;
const ENGINE_TRACK_GUARD_MS = 5000; // Increased significantly for slow Android JNI

let expectedEngineTrackId: string | null = null;
let expectedEngineTrackUntil = 0;
let linearPlaybackContextQueue: Track[] = [];

function armExpectedEngineTrack(id: string) {
    expectedEngineTrackId = id;
    expectedEngineTrackUntil = Date.now() + ENGINE_TRACK_GUARD_MS;
}

function clearExpectedEngineTrack() {
    expectedEngineTrackId = null;
    expectedEngineTrackUntil = 0;
}

function getLinearContextLimit(): number {
    try {
        const { useSettingsStore } = require('./settingsStore');
        const settings = useSettingsStore.getState();
        return getPerformanceProfile(settings.lightweightMode, settings.dynamicColors).queueContextLimit;
    } catch {
        return 700;
    }
}


function shuffleQueueKeepingCurrent(
    tracks: Track[],
    currentIndex: number,
    recentIds?: readonly string[],
): { queue: Track[]; queueIndex: number } {
    if (tracks.length === 0) {
        return { queue: [], queueIndex: -1 };
    }

    const safeIndex = Math.max(0, Math.min(currentIndex, tracks.length - 1));
    const currentTrack = tracks[safeIndex];
    const remainingTracks = tracks.filter((_, index) => index !== safeIndex);

    // Professional balanced shuffle: disperses same-artist tracks and pushes
    // recently played songs toward the back so playback never feels like the
    // same handful of songs on repeat. See src/services/shuffle.ts.
    const shuffledRemaining = balancedShuffle(remainingTracks, { recentIds });

    const shuffledQueue = [currentTrack, ...shuffledRemaining];
    if (shuffledQueue.length <= MAX_QUEUE_ITEMS) {
        return { queue: shuffledQueue, queueIndex: 0 };
    }

    return { queue: shuffledQueue.slice(0, MAX_QUEUE_ITEMS), queueIndex: 0 };
}

function restoreLinearQueueKeepingCurrent(linearQueue: Track[], currentTrackId?: string): { queue: Track[]; queueIndex: number } {
    if (linearQueue.length === 0) {
        return { queue: [], queueIndex: -1 };
    }

    const safeCurrentTrackId = currentTrackId ?? linearQueue[0]?.id;
    const indexInLinear = Math.max(0, linearQueue.findIndex(track => track.id === safeCurrentTrackId));
    return normalizeQueueWindow(linearQueue, indexInLinear);
}

function mergeMissingTracks(baseQueue: Track[], currentQueue: Track[]): Track[] {
    const baseIds = new Set(baseQueue.map(track => track.id));
    const merged = [...baseQueue];

    for (const track of currentQueue) {
        if (!baseIds.has(track.id)) {
            merged.push(track);
            baseIds.add(track.id);
        }
    }

    return merged;
}

function normalizeQueueWindow(tracks: Track[], startIndex = 0): { queue: Track[]; queueIndex: number } {
    if (tracks.length === 0) {
        return { queue: [], queueIndex: -1 };
    }

    const safeIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));

    if (tracks.length <= MAX_QUEUE_ITEMS) {
        return { queue: [...tracks], queueIndex: safeIndex };
    }

    const preferredStart = Math.max(0, safeIndex - LINEAR_CONTEXT_HISTORY_BUFFER);
    const maxStart = Math.max(0, tracks.length - MAX_QUEUE_ITEMS);
    const start = Math.min(preferredStart, maxStart);
    const windowedQueue = tracks.slice(start, start + MAX_QUEUE_ITEMS);

    return {
        queue: windowedQueue,
        queueIndex: safeIndex - start,
    };
}

function createBoundedLinearPlaybackContext(tracks: Track[], focusIndex = 0): { queue: Track[]; focusIndex: number } {
    const maxLinearContextItems = getLinearContextLimit();

    if (tracks.length <= maxLinearContextItems) {
        const safeIndex = Math.max(0, Math.min(focusIndex, Math.max(0, tracks.length - 1)));
        return { queue: [...tracks], focusIndex: safeIndex };
    }

    const safeFocusIndex = Math.max(0, Math.min(focusIndex, tracks.length - 1));
    const preferredStart = Math.max(0, safeFocusIndex - LINEAR_CONTEXT_HISTORY_BUFFER);
    const maxStart = Math.max(0, tracks.length - maxLinearContextItems);
    const start = Math.min(preferredStart, maxStart);
    const boundedQueue = tracks.slice(start, start + maxLinearContextItems);

    return {
        queue: boundedQueue,
        focusIndex: safeFocusIndex - start,
    };
}

function sanitizePlayableQueue(tracks: Track[], preferredIndex = 0): {
    queue: Track[];
    queueIndex: number;
    filteredCount: number;
} {
    if (tracks.length === 0) {
        return { queue: [], queueIndex: -1, filteredCount: 0 };
    }

    const indexedTracks = tracks.map((track, index) => ({ track, index }));
    const playableEntries = indexedTracks.filter(({ track }) => isTrackPlayable(track));
    const filteredCount = indexedTracks.length - playableEntries.length;

    if (playableEntries.length === 0) {
        return { queue: [], queueIndex: -1, filteredCount };
    }

    const safePreferredIndex = Math.max(0, Math.min(preferredIndex, tracks.length - 1));
    let nextQueueIndex = playableEntries.findIndex(entry => entry.index === safePreferredIndex);

    if (nextQueueIndex < 0) {
        nextQueueIndex = playableEntries.findIndex(entry => entry.index > safePreferredIndex);
    }

    if (nextQueueIndex < 0) {
        nextQueueIndex = playableEntries.length - 1;
    }

    return {
        queue: playableEntries.map(({ track }) => track),
        queueIndex: nextQueueIndex,
        filteredCount,
    };
}

function moveQueueItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
    const nextItems = [...items];
    const [movedItem] = nextItems.splice(fromIndex, 1);

    if (movedItem === undefined) {
        return nextItems;
    }

    nextItems.splice(toIndex, 0, movedItem);
    return nextItems;
}

function shouldAcceptEngineTrackId(nextTrackId: string | undefined): boolean {
    if (!nextTrackId) return true;

    // If the reported track IS the currently playing track in the store, always accept.
    // (Same track = metadata update, not a track change)
    const storeTrackId = usePlayerStore.getState().currentTrack?.id;
    if (storeTrackId && nextTrackId === storeTrackId) {
        return true;
    }

    // During the active protection window: only accept the specific track we asked for.
    // This prevents a stale engine event from overriding our intentional track change.
    if (expectedEngineTrackId && Date.now() < expectedEngineTrackUntil) {
        return nextTrackId === expectedEngineTrackId;
    }

    // Outside the guard window: accept any track change from the engine.
    // This covers auto-advance (song ended naturally) and remote control events.
    return true;
}

const UNKNOWN_TRACK_VALUES = new Set([
    '',
    'unknown',
    'unknown title',
    'unknown artist',
    'unknown album',
]);

function normalizeTrackValue(value?: string | null): string {
    return (value ?? '').trim().toLowerCase();
}

function hasMeaningfulTrackValue(value?: string | null): boolean {
    const normalized = normalizeTrackValue(value);
    return !!normalized && !UNKNOWN_TRACK_VALUES.has(normalized);
}

function getTrackConfidenceScore(track: Track | null | undefined): number {
    if (!track) return 0;

    let score = 0;
    if (hasMeaningfulTrackValue(track.id)) score += 3;
    if (hasMeaningfulTrackValue(track.uri)) score += 3;
    if (hasMeaningfulTrackValue(track.title)) score += 2;
    if (hasMeaningfulTrackValue(track.artist)) score += 2;
    if (hasMeaningfulTrackValue(track.album)) score += 1;
    if (hasMeaningfulTrackValue(track.artwork)) score += 1;

    return score;
}

function shouldIgnoreEngineTrackDowngrade(
    currentTrack: Track | null,
    nextTrack: Track | null,
    isPlaying: boolean
): boolean {
    if (!isPlaying || !currentTrack || !nextTrack) return false;
    if (currentTrack.id && nextTrack.id && currentTrack.id === nextTrack.id) return false;

    const currentScore = getTrackConfidenceScore(currentTrack);
    const nextScore = getTrackConfidenceScore(nextTrack);
    if (nextScore >= currentScore) return false;

    const weakIdentity = !hasMeaningfulTrackValue(nextTrack.id)
        || !hasMeaningfulTrackValue(nextTrack.title)
        || !hasMeaningfulTrackValue(nextTrack.artist);

    if (!weakIdentity) return false;

    // Ignore transient/partial native payloads that would regress the UI.
    return true;
}

function findBestQueueMatchIndex(storeQueue: Track[], nextTrack: Track): number {
    if (storeQueue.length === 0) return -1;

    const byId = hasMeaningfulTrackValue(nextTrack.id)
        ? storeQueue
            .map((track, index) => ({ track, index }))
            .filter(entry => entry.track.id === nextTrack.id)
        : [];

    if (byId.length === 1) {
        return byId[0].index;
    }

    const normalizedNextUri = normalizeTrackValue(nextTrack.uri);
    const normalizedNextTitle = normalizeTrackValue(nextTrack.title);
    const normalizedNextArtist = normalizeTrackValue(nextTrack.artist);

    const pool = byId.length > 1 ? byId : storeQueue.map((track, index) => ({ track, index }));
    let bestIndex = -1;
    let bestScore = -1;

    for (const entry of pool) {
        let score = 0;

        if (normalizedNextUri && normalizeTrackValue(entry.track.uri) === normalizedNextUri) score += 6;
        if (normalizedNextTitle && normalizeTrackValue(entry.track.title) === normalizedNextTitle) score += 4;
        if (normalizedNextArtist && normalizeTrackValue(entry.track.artist) === normalizedNextArtist) score += 4;

        if (score > bestScore) {
            bestScore = score;
            bestIndex = entry.index;
        }
    }

    return bestScore > 0 ? bestIndex : -1;
}

function normalizeComparableUri(uri?: string | null): string {
    const value = (uri ?? '').trim().toLowerCase();
    if (!value) return '';

    if (value.startsWith('file://')) {
        return value.replace(/^file:\/+/, '/');
    }

    return value;
}

function isLikelyLocalTrack(track: Track | null | undefined): boolean {
    if (!track) return false;
    if (track.source === 'local') return true;

    const normalizedUri = normalizeComparableUri(track.uri);
    return normalizedUri.startsWith('content://')
        || normalizedUri.startsWith('/data/')
        || normalizedUri.startsWith('/storage/')
        || normalizedUri.startsWith('/mnt/')
        || normalizedUri.startsWith('/');
}

function hasStableLocalTrackIdentity(track: Track | null | undefined): boolean {
    if (!track) return false;
    if (!isLikelyLocalTrack(track)) return true;

    const normalizedUri = normalizeComparableUri(track.uri);
    const hasStableUri = normalizedUri.startsWith('content://')
        || normalizedUri.startsWith('/storage/')
        || normalizedUri.startsWith('/mnt/')
        || normalizedUri.startsWith('/data/')
        || normalizedUri.startsWith('/');

    const normalizedId = normalizeTrackValue(track.id);
    const hasStableId = /^ms_\d+$/.test(normalizedId)
        || /^track_[a-f0-9]+$/.test(normalizedId)
        || /^tidal_/.test(normalizedId);

    return hasStableUri || hasStableId;
}

function findBestLibraryTrackMatch(track: Track): Track | null {
    const libraryTracks = useLibraryStore.getState().tracks;
    if (libraryTracks.size === 0) return null;
    if (!hasStableLocalTrackIdentity(track)) return null;

    const idMatch = hasMeaningfulTrackValue(track.id) ? libraryTracks.get(track.id) : undefined;
    if (idMatch) return idMatch;

    const normalizedUri = normalizeComparableUri(track.uri);
    if (normalizedUri) {
        for (const candidate of libraryTracks.values()) {
            if (normalizeComparableUri(candidate.uri) === normalizedUri) {
                return candidate;
            }
        }
    }

    return null;
}

function preferMeaningfulString(primary?: string | null, fallback?: string | null): string {
    return hasMeaningfulTrackValue(primary) ? String(primary) : String(fallback ?? '');
}

function mergeTrackWithCatalog(track: Track): Track {
    const shouldResolveCatalog = isLikelyLocalTrack(track);
    const catalogTrack = shouldResolveCatalog ? findBestLibraryTrackMatch(track) : null;
    if (!catalogTrack) return track;

    return {
        ...track,
        ...catalogTrack,
        id: track.id || catalogTrack.id,
        uri: track.uri || catalogTrack.uri,
        title: preferMeaningfulString(track.title, catalogTrack.title),
        artist: preferMeaningfulString(track.artist, catalogTrack.artist),
        album: preferMeaningfulString(track.album, catalogTrack.album),
        artwork: catalogTrack.artwork || track.artwork,
        artworkThumb: catalogTrack.artworkThumb || track.artworkThumb,
        duration: track.duration || catalogTrack.duration,
    };
}

const artworkHydrationByAlbum = new Map<string, Promise<void>>();

function getAlbumKey(track: Track): string {
    return `${(track.album || 'unknown').toLowerCase()}::${(track.artist || 'unknown').toLowerCase()}`;
}

function isSameAlbumTrack(a: Track, b: Track): boolean {
    return a.album === b.album && a.artist === b.artist;
}

function mergeWithLibraryTrack(track: Track): Track {
    return mergeTrackWithCatalog(track);
}

// URI index for batch merges -- built once per call to avoid O(n^2) iteration.
// For single-track lookups, findBestLibraryTrackMatch() is used directly (O(1) ID hit or O(n) URI scan).
let _libraryUriIndex: Map<string, Track> | null = null;
let _libraryUriIndexRevision = -1;

function getOrBuildLibraryUriIndex(): Map<string, Track> {
    const libraryState = useLibraryStore.getState();
    const revision = (libraryState as any).catalogRevision ?? 0;
    if (_libraryUriIndex && _libraryUriIndexRevision === revision) {
        return _libraryUriIndex;
    }
    const index = new Map<string, Track>();
    for (const t of libraryState.tracks.values()) {
        const normalized = normalizeComparableUri(t.uri);
        if (normalized) index.set(normalized, t);
    }
    _libraryUriIndex = index;
    _libraryUriIndexRevision = revision;
    return index;
}

function mergeQueueWithLibraryTracks(queue: Track[]): Track[] {
    // Fast path: library is empty, nothing to merge
    const libraryTracks = useLibraryStore.getState().tracks;
    if (libraryTracks.size === 0) return queue;

    // Pre-build URI index once for the entire batch (O(n) instead of O(n^2))
    const uriIndex = getOrBuildLibraryUriIndex();

    return queue.map(track => {
        if (!isLikelyLocalTrack(track)) return track;

        // 1. Fast ID lookup (O(1))
        if (hasMeaningfulTrackValue(track.id)) {
            const idMatch = libraryTracks.get(track.id);
            if (idMatch) {
                return {
                    ...track,
                    ...idMatch,
                    id: track.id || idMatch.id,
                    uri: track.uri || idMatch.uri,
                    title: preferMeaningfulString(track.title, idMatch.title),
                    artist: preferMeaningfulString(track.artist, idMatch.artist),
                    album: preferMeaningfulString(track.album, idMatch.album),
                    artwork: idMatch.artwork || track.artwork,
                    artworkThumb: idMatch.artworkThumb || track.artworkThumb,
                    duration: track.duration || idMatch.duration,
                };
            }
        }

        // 2. URI index lookup (O(1) with pre-built index)
        if (!hasStableLocalTrackIdentity(track)) return track;
        const normalizedUri = normalizeComparableUri(track.uri);
        if (!normalizedUri) return track;

        const uriMatch = uriIndex.get(normalizedUri);
        if (!uriMatch) return track;

        return {
            ...track,
            ...uriMatch,
            id: track.id || uriMatch.id,
            uri: track.uri || uriMatch.uri,
            title: preferMeaningfulString(track.title, uriMatch.title),
            artist: preferMeaningfulString(track.artist, uriMatch.artist),
            album: preferMeaningfulString(track.album, uriMatch.album),
            artwork: uriMatch.artwork || track.artwork,
            artworkThumb: uriMatch.artworkThumb || track.artworkThumb,
            duration: track.duration || uriMatch.duration,
        };
    });
}

function resolvePreferredArtworkForEngineMerge(nextTrack: Track, currentStoreTrack: Track): string | undefined {
    const nextArtwork = nextTrack.artwork?.trim();
    const currentArtwork = currentStoreTrack.artwork?.trim();
    const currentArtworkThumb = currentStoreTrack.artworkThumb?.trim();

    if (!nextArtwork) {
        return currentArtwork || undefined;
    }

    // Prevent visual quality regressions: if the engine reports the thumbnail URI
    // as artwork for the same track, keep the already-known full-res artwork.
    if (currentArtwork && currentArtworkThumb && nextArtwork === currentArtworkThumb) {
        return currentArtwork;
    }

    return nextArtwork;
}

async function hydrateAlbumArtworkOnDemand(track: Track): Promise<void> {
    if (!track || track.artwork) return;

    const libraryState = useLibraryStore.getState();
    const existingTrack = libraryState.tracks.get(track.id) || track;
    if (existingTrack.artwork) return;

    const albumKey = getAlbumKey(existingTrack);
    if (artworkHydrationByAlbum.has(albumKey)) {
        await artworkHydrationByAlbum.get(albumKey);
        return;
    }

    const task = (async () => {
        try {
            let artwork: string | undefined;

            // 1) Reuse artwork already present in library for this album
            for (const t of useLibraryStore.getState().tracks.values()) {
                if (isSameAlbumTrack(t, existingTrack) && t.artwork) {
                    artwork = t.artwork;
                    break;
                }
            }

            // 2) Read embedded tag artwork only for this selected track
            if (!artwork) {
                type MetaResult = { artwork?: string };
                const metadata = await withTimeout(extractMetadata(existingTrack.uri), 3500) as MetaResult | null;
                artwork = metadata?.artwork;
            }

            // 3) Folder fallback (cover.jpg, folder.jpg, etc.)
            if (!artwork) {
                artwork = await withTimeout(findArtworkInFolder(existingTrack.uri, existingTrack.artist, existingTrack.album), 1500) ?? undefined;
            }

            if (!artwork) return;

            useLibraryStore.getState().applyAlbumArtwork(existingTrack.album, existingTrack.artist, artwork);

            usePlayerStore.setState(state => {
                const nextCurrentTrack = state.currentTrack && isSameAlbumTrack(state.currentTrack, existingTrack) && !state.currentTrack.artwork
                    ? { ...state.currentTrack, artwork }
                    : state.currentTrack;

                const nextQueue = state.queue.map(q =>
                    isSameAlbumTrack(q, existingTrack) && !q.artwork
                        ? { ...q, artwork }
                        : q
                );

                return {
                    currentTrack: nextCurrentTrack,
                    queue: nextQueue,
                };
            });
        } catch {
            // Ignore one-off artwork failures
        }
    })();

    artworkHydrationByAlbum.set(albumKey, task);
    try {
        await task;
    } finally {
        artworkHydrationByAlbum.delete(albumKey);
    }
}

interface PlayerActions {
    // Playback control
    play: (track: Track, queue?: Track[]) => Promise<void>;
    adoptNativeLibraryPlayback: (snapshot: import('../services/nativeLibraryPlayback').NativeLibraryPlaybackSnapshot) => void;
    pause: () => Promise<void>;
    resume: () => Promise<void>;
    togglePlayPause: () => Promise<void>;
    stop: () => Promise<void>;
    seek: (positionMs: number) => Promise<void>;

    // Queue management
    setQueue: (tracks: Track[], startIndex?: number) => void;
    addToQueue: (track: Track) => void;
    removeFromQueue: (index: number) => void;
    clearQueue: () => void;
    replaceQueue: (tracks: Track[], startIndex?: number) => Promise<void>;
    reorderQueue: (fromIndex: number, toIndex: number) => Promise<void>;
    next: () => Promise<void>;
    previous: () => Promise<void>;
    skipTo: (index: number) => Promise<void>;

    // Playback modes
    toggleShuffle: () => void;
    cycleRepeatMode: () => Promise<void>;

    // UI State
    playerVisible: boolean;
    setPlayerVisible: (visible: boolean) => void;
    expansion: SharedValue<number>;
    setExpansion: (val: SharedValue<number>) => void;
    setPlayerVariant: (variant: 'immersive') => void;

    // Recently played history
    recentlyPlayed: Track[];
    addToRecentlyPlayed: (track: Track) => void;
    getRecentlyPlayed: () => Track[];

    // State updates (called from AudioEngine callbacks)
    updateFromEngine: (state: {
        isPlaying?: boolean;
        isLoading?: boolean;
        position?: number;
        duration?: number;
        currentTrack?: Track | null;
        queueIndex?: number;
    }) => void;
    setPosition: (ms: number) => void;
    positionShared: SharedValue<number>;
    setVolume: (volume: number) => Promise<void>;
    setLoading: (loading: boolean) => void;
    setPendingTrackPreview: (track: {
        id: string;
        title: string;
        artist: string;
        artwork?: string;
        tidalId?: number;
    } | null) => void;
}

type PendingTrackPreview = {
    id: string;
    title: string;
    artist: string;
    artwork?: string;
    tidalId?: number;
} | null;

interface PlayerStoreState {
    currentTrack: Track | null;
    pendingTrackPreview: PendingTrackPreview;
    queue: Track[];
    queueIndex: number;
    isPlaying: boolean;
    isLoading: boolean;
    position: number;
    duration: number;
    repeatMode: RepeatMode;
    shuffleEnabled: boolean;
    volume: number;
    playerVariant: 'immersive';
}

type PlayerStore = PlayerStoreState & PlayerActions;

const initialState: PlayerStoreState = {
    currentTrack: null,
    pendingTrackPreview: null,
    queue: [],
    queueIndex: -1,
    isPlaying: false,
    isLoading: false,
    position: 0,
    duration: 0,
    repeatMode: 'off',
    shuffleEnabled: false,
    volume: 1,
    playerVariant: 'immersive',
};

export const usePlayerStore = create<PlayerStore>()(persist((set, get) => ({
    ...initialState,

    // Kotlin has already selected and started audio. Adopt its exact order without
    // calling playQueue again or doing file/metadata work in the tap path.
    adoptNativeLibraryPlayback: (snapshot) => {
        const library = useLibraryStore.getState().tracks;
        const resolve = (ids: string[]) => ids.map(id => library.get(id)).filter((track): track is Track => !!track);
        const queue = resolve(snapshot.queueIds);
        const track = library.get(snapshot.trackId);
        if (!track) return;
        linearPlaybackContextQueue = resolve(snapshot.linearIds);
        armExpectedEngineTrack(track.id);
        get().positionShared.value = 0;
        set(state => ({
            currentTrack: track, queue, queueIndex: queue.findIndex(item => item.id === track.id),
            position: 0, duration: track.duration, pendingTrackPreview: null,
            isPlaying: true, isLoading: true,
            recentlyPlayed: [track, ...state.recentlyPlayed.filter(item => item.id !== track.id)].slice(0, MAX_RECENT),
        }));
    },

    play: async (track, queue) => {
        const effectiveTrack = mergeWithLibraryTrack(track);
        const rawSourceQueue = queue && queue.length > 0
            ? mergeQueueWithLibraryTracks(queue)
            : [effectiveTrack];
        const playableQueue = sanitizePlayableQueue(
            rawSourceQueue,
            Math.max(0, rawSourceQueue.findIndex(t => t.id === effectiveTrack.id))
        );

        if (playableQueue.filteredCount > 0) {
            console.warn('[PlayerStore] Filtered non-playable tracks from playback queue:', playableQueue.filteredCount);
        }

        if (playableQueue.queue.length === 0) {
            console.warn('[PlayerStore] Refusing to play: queue does not contain native-playable tracks');
            set({ isPlaying: false, isLoading: false, pendingTrackPreview: null });
            return;
        }

        const sourceQueue = playableQueue.queue;
        const effectivePlayableTrack = sourceQueue[playableQueue.queueIndex] ?? sourceQueue[0];

        armExpectedEngineTrack(effectivePlayableTrack.id);
        void hydrateAlbumArtworkOnDemand(effectivePlayableTrack);
        get().positionShared.value = 0;

        const selectedIndex = Math.max(0, playableQueue.queueIndex);
        const boundedLinearContext = createBoundedLinearPlaybackContext(sourceQueue, selectedIndex);
        linearPlaybackContextQueue = boundedLinearContext.queue;
        console.log('[PlayerStore] Playback context prepared:', {
            sourceQueueSize: sourceQueue.length,
            boundedQueueSize: linearPlaybackContextQueue.length,
            queueWindowSize: Math.min(linearPlaybackContextQueue.length, MAX_QUEUE_ITEMS),
        });

        const linearWindow = normalizeQueueWindow(linearPlaybackContextQueue, boundedLinearContext.focusIndex);
        const shouldShuffleQueue = get().shuffleEnabled && linearPlaybackContextQueue.length > 1;
        const { queue: nextQueue, queueIndex } = shouldShuffleQueue
            ? shuffleQueueKeepingCurrent(
                linearPlaybackContextQueue,
                boundedLinearContext.focusIndex,
                get().recentlyPlayed.map(t => t.id),
            )
            : linearWindow;

        // Single atomic update to avoid multiple subscription flushes.
        set(state => {
            const filteredRecent = state.recentlyPlayed.filter(t => t.id !== effectivePlayableTrack.id);
            const nextRecent = [effectivePlayableTrack, ...filteredRecent].slice(0, MAX_RECENT);

            return {
                currentTrack: effectivePlayableTrack,
                pendingTrackPreview: null,
                isPlaying: true,
                isLoading: true,
                duration: effectivePlayableTrack.duration,
                position: 0,
                queue: nextQueue,
                queueIndex,
                recentlyPlayed: nextRecent,
            };
        });

        // 2. Sync with native engine
        // If we have a queue, we must tell the engine about it so "Next" works
        if (sourceQueue.length > 0) {
            AudioEngine.playQueue(nextQueue, queueIndex).catch(error => {
                console.error('[PlayerStore] playQueue error:', error);
                set({ isPlaying: false, isLoading: false, pendingTrackPreview: null });
            });
        } else {
            AudioEngine.play(effectivePlayableTrack).catch(error => {
                console.error('[PlayerStore] play error:', error);
                set({ isPlaying: false, isLoading: false, pendingTrackPreview: null });
            });
        }
    },

    pause: async () => {
        await AudioEngine.pause();
        set({ isPlaying: false });
    },

    resume: async () => {
        await AudioEngine.resume();
        set({ isPlaying: true });
    },

    togglePlayPause: async () => {
        const { isPlaying } = get();
        if (isPlaying) {
            await get().pause();
        } else {
            await get().resume();
        }
    },

    stop: async () => {
        clearExpectedEngineTrack();
        linearPlaybackContextQueue = [];
        get().positionShared.value = 0;
        await AudioEngine.stop();
        set({
            isPlaying: false,
            isLoading: false,
            pendingTrackPreview: null,
            currentTrack: null,
            position: 0,
            queueIndex: -1,
        });
    },

    seek: async (positionMs) => {
        await AudioEngine.seek(positionMs);
        set({ position: positionMs });
    },

    setQueue: (tracks, startIndex = 0) => {
        const sanitized = sanitizePlayableQueue(tracks, startIndex);
        if (sanitized.filteredCount > 0) {
            console.warn('[PlayerStore] Filtered non-playable tracks from queue state:', sanitized.filteredCount);
        }
        const boundedLinearContext = createBoundedLinearPlaybackContext(sanitized.queue, sanitized.queueIndex);
        linearPlaybackContextQueue = boundedLinearContext.queue;
        const { queue, queueIndex } = normalizeQueueWindow(linearPlaybackContextQueue, boundedLinearContext.focusIndex);
        set({ queue, queueIndex });
    },

    addToQueue: (track) => {
        if (!isTrackPlayable(track)) {
            console.warn('[PlayerStore] Ignored non-playable track added to queue:', {
                id: track.id,
                uri: track.uri,
                source: track.source,
                cloudOnly: track.cloudOnly,
            });
            return;
        }

        const { queue, queueIndex } = get();
        const maxLinearContextItems = getLinearContextLimit();
        linearPlaybackContextQueue = [...linearPlaybackContextQueue, track];
        if (linearPlaybackContextQueue.length > maxLinearContextItems) {
            linearPlaybackContextQueue = linearPlaybackContextQueue.slice(linearPlaybackContextQueue.length - maxLinearContextItems);
        }

        if (queue.length < MAX_QUEUE_ITEMS) {
            set({ queue: [...queue, track] });
            return;
        }

        // Keep queue bounded to reduce rendering/processing cost.
        const dropIndex = queueIndex === queue.length - 1 ? 0 : queue.length - 1;
        const nextQueue = queue.filter((_, i) => i !== dropIndex);
        const nextQueueIndex = dropIndex < queueIndex ? queueIndex - 1 : queueIndex;

        set({
            queue: [...nextQueue, track],
            queueIndex: nextQueueIndex,
        });
    },

    removeFromQueue: (index) => {
        const { queue, queueIndex } = get();
        if (index < 0 || index >= queue.length) {
            return;
        }

        const removedTrack = queue[index];

        if (removedTrack?.id) {
            const removeIndex = linearPlaybackContextQueue.findIndex(track => track.id === removedTrack.id);
            if (removeIndex >= 0) {
                linearPlaybackContextQueue = linearPlaybackContextQueue.filter((_, i) => i !== removeIndex);
            }
        }

        const newQueue = queue.filter((_, i) => i !== index);
        if (newQueue.length === 0) {
            linearPlaybackContextQueue = [];
            set({ queue: [], queueIndex: -1, currentTrack: null, isPlaying: false, position: 0 });
            void AudioEngine.stop();
            return;
        }

        // Adjust current index if needed
        let newIndex = queueIndex;
        if (index < queueIndex) {
            newIndex--;
        } else if (index === queueIndex) {
            newIndex = Math.min(newIndex, newQueue.length - 1);
        }

        // Keep native queue and visual queue in sync by fully replacing the queue.
        // Native index-based remove can desync when native order diverges from store order.
        void get().replaceQueue(newQueue, Math.max(0, newIndex));
    },

    clearQueue: () => {
        linearPlaybackContextQueue = [];
        set({ queue: [], queueIndex: -1 });
    },

    replaceQueue: async (tracks, startIndex = 0) => {
        const sanitized = sanitizePlayableQueue(tracks, startIndex);

        if (sanitized.filteredCount > 0) {
            console.warn('[PlayerStore] Filtered non-playable tracks while replacing queue:', sanitized.filteredCount);
        }

        if (sanitized.queue.length === 0) {
            linearPlaybackContextQueue = [];
            set({ queue: [], queueIndex: -1 });
            return;
        }

        const wasPlaying = get().isPlaying;
        const previousPosition = get().position;
        const boundedLinearContext = createBoundedLinearPlaybackContext(sanitized.queue, sanitized.queueIndex);
        linearPlaybackContextQueue = boundedLinearContext.queue;
        const { queue: normalizedQueue, queueIndex: safeIndex } = normalizeQueueWindow(linearPlaybackContextQueue, boundedLinearContext.focusIndex);
        const targetTrack = normalizedQueue[safeIndex];

        if (targetTrack?.id) {
            armExpectedEngineTrack(targetTrack.id);
        }

        set({
            queue: normalizedQueue,
            queueIndex: safeIndex,
            currentTrack: targetTrack,
            isPlaying: wasPlaying,
            position: previousPosition,
        });

        await AudioEngine.playQueue(normalizedQueue, safeIndex);

        if (previousPosition > 0) {
            await AudioEngine.seek(previousPosition);
        }

        if (!wasPlaying) {
            await AudioEngine.pause();
        }
    },

    reorderQueue: async (fromIndex, toIndex) => {
        const { queue, queueIndex } = get();
        if (queue.length === 0 || queueIndex < 0) {
            return;
        }

        const safeFromIndex = Math.max(0, Math.min(fromIndex, queue.length - 1));
        const safeToIndex = Math.max(0, Math.min(toIndex, queue.length - 1));

        if (safeFromIndex === safeToIndex) {
            return;
        }

        if (safeFromIndex <= queueIndex || safeToIndex <= queueIndex) {
            return;
        }

        const reorderedQueue = moveQueueItem(queue, safeFromIndex, safeToIndex);
        await get().replaceQueue(reorderedQueue, queueIndex);
    },

    next: async () => {
        const { queue, queueIndex, repeatMode } = get();

        if (queue.length === 0) return;

        let nextIndex: number;

        nextIndex = queueIndex + 1;

        // Handle end of queue
        if (nextIndex >= queue.length) {
            if (repeatMode === 'all' || repeatMode === 'one') {
                nextIndex = 0;
            } else {
                // End of queue in manual next: keep current playback state.
                return;
            }
        }

        const targetTrack = queue[nextIndex];
        if (targetTrack?.id) {
            armExpectedEngineTrack(targetTrack.id);
            void hydrateAlbumArtworkOnDemand(targetTrack);
        }
        get().positionShared.value = 0;

        // Optimistic update BEFORE async engine call to prevent race conditions
        // with PlaybackActiveTrackChanged events resetting queueIndex
        set({
            queueIndex: nextIndex,
            currentTrack: targetTrack || get().currentTrack,
            position: 0,
        });

        // Navigate using track ID so the engine finds the correct position even
        // when the store queue order differs from the native engine order (shuffle).
        if (targetTrack?.id) {
            const found = await AudioEngine.skipToTrackById(targetTrack.id);
            if (!found) {
                // Engine is out of sync (e.g. tracks missing after shuffle/window change).
                // Force a full queue reload to restore correct playback.
                console.warn('[PlayerStore] skipToTrackById failed in next(), forcing playQueue sync');
                await AudioEngine.playQueue(queue, nextIndex);
            }
        } else {
            await AudioEngine.skipTo(nextIndex);
        }
    },

    previous: async () => {
        const { queue, queueIndex, position, repeatMode } = get();

        if (queue.length === 0) return;

        // If more than 3 seconds in, restart current track
        if (position > 3000) {
            await get().seek(0);
            return;
        }

        // Go to previous
        let prevIndex = queueIndex - 1;
        if (prevIndex < 0) {
            if (repeatMode === 'all' && queue.length > 1) {
                prevIndex = queue.length - 1;
            } else {
                await get().seek(0);
                return;
            }
        }

        const targetTrack = queue[prevIndex];
        if (targetTrack?.id) {
            armExpectedEngineTrack(targetTrack.id);
            void hydrateAlbumArtworkOnDemand(targetTrack);
        }
        get().positionShared.value = 0;

        // Optimistic update BEFORE async engine call
        set({
            queueIndex: prevIndex,
            currentTrack: targetTrack || get().currentTrack,
            position: 0,
        });

        // Navigate using track ID so the engine finds the correct position even
        // when the store queue order differs from the native engine order (shuffle).
        if (targetTrack?.id) {
            const found = await AudioEngine.skipToTrackById(targetTrack.id);
            if (!found) {
                console.warn('[PlayerStore] skipToTrackById failed in previous(), forcing playQueue sync');
                await AudioEngine.playQueue(queue, prevIndex);
            }
        } else {
            await AudioEngine.skipTo(prevIndex);
        }
    },

    skipTo: async (index) => {
        const { queue } = get();
        if (index >= 0 && index < queue.length) {
            const targetTrack = queue[index];
            if (targetTrack?.id) {
                armExpectedEngineTrack(targetTrack.id);
                void hydrateAlbumArtworkOnDemand(targetTrack);
            }
            get().positionShared.value = 0;

            // Optimistic update BEFORE async engine call
            set({
                queueIndex: index,
                currentTrack: targetTrack || get().currentTrack,
                position: 0,
            });

            // Navigate using track ID so the engine finds the correct position even
            // when the store queue order differs from the native engine order (shuffle).
            if (targetTrack?.id) {
                const found = await AudioEngine.skipToTrackById(targetTrack.id);
                if (!found) {
                    console.warn('[PlayerStore] skipToTrackById failed in skipTo(), forcing playQueue sync');
                    await AudioEngine.playQueue(queue, index);
                }
            } else {
                await AudioEngine.skipTo(index);
            }
        }
    },

    toggleShuffle: () => {
        const state = get();
        const nextShuffleEnabled = !state.shuffleEnabled;

        if (state.queue.length <= 1) {
            set({ shuffleEnabled: nextShuffleEnabled });
            return;
        }

        const currentIndex = state.queueIndex >= 0 ? state.queueIndex : 0;
        const currentTrackId = state.queue[currentIndex]?.id ?? state.currentTrack?.id;
        const linearBaseQueue = mergeMissingTracks(
            linearPlaybackContextQueue.length > 0 ? linearPlaybackContextQueue : state.queue,
            state.queue,
        );

        linearPlaybackContextQueue = [...linearBaseQueue];

        const { queue: nextQueue, queueIndex: nextQueueIndex } = nextShuffleEnabled
            ? shuffleQueueKeepingCurrent(
                linearPlaybackContextQueue,
                Math.max(0, linearPlaybackContextQueue.findIndex(track => track.id === currentTrackId)),
                state.recentlyPlayed.map(t => t.id),
            )
            : restoreLinearQueueKeepingCurrent(linearPlaybackContextQueue, currentTrackId);

        const targetTrack = nextQueue[nextQueueIndex];
        if (targetTrack?.id) {
            armExpectedEngineTrack(targetTrack.id);
        }

        set({
            shuffleEnabled: nextShuffleEnabled,
            queue: nextQueue,
            queueIndex: nextQueueIndex,
            currentTrack: targetTrack || state.currentTrack,
        });

        // We intentionally do NOT reorder the native engine queue here.
        // The native engine keeps its original queue order.
        // All navigation (skipTo/next/previous) uses skipToTrackById to find the correct
        // track by ID, making it work regardless of native queue order.
        // Using move() to reorder the native queue causes state corruption in the engine.
    },

    playerVisible: false,
    setPlayerVisible: (visible) => set({ playerVisible: visible }),
    expansion: makeMutable(0),
    setExpansion: (val) => set({ expansion: val }),
    positionShared: makeMutable(0),
    setPlayerVariant: (variant) => set({ playerVariant: variant }),

    // Recently played history
    recentlyPlayed: [],
    addToRecentlyPlayed: (track) => {
        const { recentlyPlayed } = get();
        // Remove duplicate if exists, add to front
        const filtered = recentlyPlayed.filter(t => t.id !== track.id);
        const updated = [track, ...filtered].slice(0, MAX_RECENT);
        set({ recentlyPlayed: updated });
    },
    getRecentlyPlayed: () => get().recentlyPlayed,

    cycleRepeatMode: async () => {
        const modes: RepeatMode[] = ['off', 'all', 'one'];
        const { repeatMode } = get();
        const currentIndex = modes.indexOf(repeatMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        const newMode = modes[nextIndex];

        // Sync repeat mode with Track Player
        await AudioEngine.setRepeatMode(newMode);
        set({ repeatMode: newMode });
    },

    updateFromEngine: (engineState) => {
        const nextState: Partial<PlayerStoreState> = {};
        const currentState = get();

        if (engineState.isPlaying !== undefined && engineState.isPlaying !== currentState.isPlaying) {
            nextState.isPlaying = engineState.isPlaying;
        }
        if (engineState.isLoading !== undefined && engineState.isLoading !== currentState.isLoading) {
            nextState.isLoading = engineState.isLoading;
        }
        if (engineState.position !== undefined && engineState.position !== currentState.position) {
            nextState.position = engineState.position;
        }
        if (engineState.duration !== undefined && engineState.duration !== currentState.duration) {
            nextState.duration = engineState.duration;
        }
        if (engineState.currentTrack !== undefined) {
            const currentStoreTrack = currentState.currentTrack;
            const nextTrack = engineState.currentTrack;

            // CRITICAL BUG FIX: Never let the engine "downgrade" our current track
            // if we already have one and the engine reports null or the same ID (avoid unnecessary re-renders).
            // Passing the current queue to help validate the incoming track.
            if (shouldAcceptEngineTrackId(nextTrack?.id)) {
                // If we have a track in store, but engine says null, ignore it unless we are not playing.
                if (currentStoreTrack && !nextTrack && currentState.isPlaying) {
                    // Ignore empty track report while playing (likely a brief transition state in native)
                } else {
                    if (nextTrack && isLikelyLocalTrack(nextTrack) && !hasStableLocalTrackIdentity(nextTrack) && currentState.isPlaying) {
                        // Ignore local payloads without stable identity; they often carry stale/default metadata.
                        return;
                    }

                    // Preserve enriched metadata (like lazily loaded artwork) when
                    // native engine reports the same track id without those fields.
                    if (currentStoreTrack && nextTrack && currentStoreTrack.id === nextTrack.id) {
                        const catalogResolvedTrack = mergeTrackWithCatalog(nextTrack);
                        const mergedTrack = {
                            ...catalogResolvedTrack,
                            id: preferMeaningfulString(catalogResolvedTrack.id, currentStoreTrack.id),
                            uri: preferMeaningfulString(catalogResolvedTrack.uri, currentStoreTrack.uri),
                            title: preferMeaningfulString(catalogResolvedTrack.title, currentStoreTrack.title),
                            artist: preferMeaningfulString(catalogResolvedTrack.artist, currentStoreTrack.artist),
                            album: preferMeaningfulString(catalogResolvedTrack.album, currentStoreTrack.album),
                            artwork: resolvePreferredArtworkForEngineMerge(catalogResolvedTrack, currentStoreTrack),
                            duration: catalogResolvedTrack.duration || currentStoreTrack.duration,
                            format: catalogResolvedTrack.format || currentStoreTrack.format,
                            sampleRate: catalogResolvedTrack.sampleRate || currentStoreTrack.sampleRate,
                            bitDepth: catalogResolvedTrack.bitDepth || currentStoreTrack.bitDepth,
                            quality: catalogResolvedTrack.quality || currentStoreTrack.quality,
                        };

                        const hasChanges = Object.keys(mergedTrack).some(
                            (key) => (mergedTrack as any)[key] !== (currentStoreTrack as any)[key]
                        );

                        if (hasChanges) {
                            nextState.currentTrack = mergedTrack;
                        }
                        nextState.pendingTrackPreview = null;
                    } else if (nextTrack && (!currentStoreTrack || currentStoreTrack.id !== nextTrack.id)) {
                        const catalogResolvedTrack = mergeTrackWithCatalog(nextTrack);
                        if (shouldIgnoreEngineTrackDowngrade(currentStoreTrack, catalogResolvedTrack, currentState.isPlaying)) {
                            return;
                        }
                        // Engine auto-advanced to a different track (end of song, auto-next, or
                        // the user's manual skip was acknowledged by the engine).
                        // Always accept this Ã¢â‚¬â€ we've already validated it via shouldAcceptEngineTrackId.
                        // Clear the guard so the next auto-advance isn't blocked.
                        clearExpectedEngineTrack();
                        get().positionShared.value = 0;

                        nextState.pendingTrackPreview = null;
                        // Prefer the richer track object from our store queue (has artwork, metadata, etc.)
                        const storeQueue = currentState.queue;
                        const storeQueueIndex = findBestQueueMatchIndex(storeQueue, catalogResolvedTrack);
                        if (storeQueueIndex >= 0) {
                            // Track found in our visual queue - use store's richer version.
                            // CRITICAL FIX: storeQueue[storeQueueIndex] is spread LAST so its
                            // rich metadata (title, artist, album, artwork) wins over the engine's
                            // sparse payload. On low-end devices the PlaybackActiveTrackChanged
                            // event fires with partial data AFTER the store already has the correct
                            // track set -- never regress rich metadata with engine's sparse data.
                            const richTrack = {
                                ...catalogResolvedTrack,
                                ...storeQueue[storeQueueIndex],
                                uri: storeQueue[storeQueueIndex].uri || catalogResolvedTrack.uri,
                                id: storeQueue[storeQueueIndex].id || catalogResolvedTrack.id,
                            };
                            nextState.currentTrack = richTrack;
                            nextState.queueIndex = storeQueueIndex;
                        } else {
                            const localUnresolvedMismatch =
                                !!currentStoreTrack
                                && currentState.isPlaying
                                && isLikelyLocalTrack(currentStoreTrack)
                                && isLikelyLocalTrack(catalogResolvedTrack)
                                && !hasStableLocalTrackIdentity(catalogResolvedTrack);

                            if (localUnresolvedMismatch) {
                                // Ignore transient local payloads that cannot be mapped to queue/catalog safely.
                                return;
                            }

                            // Track NOT in visual queue (auto-advance from native order after reorder).
                            // Accept the engine's track as-is; next manual navigation will re-sync.
                            nextState.currentTrack = catalogResolvedTrack;
                        }
                    } else if (nextTrack) {
                        nextState.currentTrack = mergeTrackWithCatalog(nextTrack);
                    }
                }
            }
        }
        // NOTE: queueIndex is only synced from the engine when the engine auto-advances
        // to a different track (handled above). For manual navigation (next/previous/skipTo),
        // the store sets queueIndex proactively before the async engine call.

        if (Object.keys(nextState).length > 0) {
            set(nextState as Partial<PlayerStore>);
        }
    },

    setPosition: (ms) => {
        if (get().position === ms) {
            return;
        }
        set({ position: ms });
    },

    setVolume: async (volume) => {
        await AudioEngine.setVolume(volume);
        set({ volume });
    },

    setLoading: (loading) => {
        set({ isLoading: loading });
    },
    setPendingTrackPreview: (track) => {
        set({ pendingTrackPreview: track, isLoading: Boolean(track) });
    },
}), {
    name: 'staysound-player',
    storage: createJSONStorage(() => FileSystemStorage),
    partialize: (state) => ({
        recentlyPlayed: state.recentlyPlayed,
        playerVariant: state.playerVariant,
        volume: state.volume,
        repeatMode: state.repeatMode,
        shuffleEnabled: state.shuffleEnabled,
    }),
}));
