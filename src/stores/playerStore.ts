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
import { FileSystemStorage } from '../services/storage';
import { getPerformanceProfile } from '../theme/performanceProfile';
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


function shuffleQueueKeepingCurrent(tracks: Track[], currentIndex: number): { queue: Track[]; queueIndex: number } {
    if (tracks.length === 0) {
        return { queue: [], queueIndex: -1 };
    }

    const safeIndex = Math.max(0, Math.min(currentIndex, tracks.length - 1));
    const currentTrack = tracks[safeIndex];
    const remainingTracks = tracks.filter((_, index) => index !== safeIndex);

    for (let i = remainingTracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [remainingTracks[i], remainingTracks[j]] = [remainingTracks[j], remainingTracks[i]];
    }

    const shuffledQueue = [currentTrack, ...remainingTracks];
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
        return { queue: tracks, queueIndex: safeIndex };
    }

    const rotated = [...tracks.slice(safeIndex), ...tracks.slice(0, safeIndex)];
    return { queue: rotated.slice(0, MAX_QUEUE_ITEMS), queueIndex: 0 };
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

function shouldAcceptEngineTrackId(nextTrackId: string | undefined, currentQueue: Track[]): boolean {
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

const artworkHydrationByAlbum = new Map<string, Promise<void>>();

function getAlbumKey(track: Track): string {
    return `${(track.album || 'unknown').toLowerCase()}::${(track.artist || 'unknown').toLowerCase()}`;
}

function isSameAlbumTrack(a: Track, b: Track): boolean {
    return a.album === b.album && a.artist === b.artist;
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

    play: async (track, queue) => {
        armExpectedEngineTrack(track.id);
        void hydrateAlbumArtworkOnDemand(track);
        get().positionShared.value = 0;

        const selectedIndex = queue && queue.length > 0
            ? Math.max(0, queue.findIndex(t => t.id === track.id))
            : 0;
        const sourceQueue = queue && queue.length > 0 ? queue : [track];
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
            ? shuffleQueueKeepingCurrent(linearPlaybackContextQueue, boundedLinearContext.focusIndex)
            : linearWindow;

        // Single atomic update to avoid multiple subscription flushes.
        set(state => {
            const filteredRecent = state.recentlyPlayed.filter(t => t.id !== track.id);
            const nextRecent = [track, ...filteredRecent].slice(0, MAX_RECENT);

            return {
                currentTrack: track,
                pendingTrackPreview: null,
                isPlaying: true,
                isLoading: true,
                duration: track.duration,
                position: 0,
                queue: nextQueue,
                queueIndex,
                recentlyPlayed: nextRecent,
            };
        });

        // 2. Sync with native engine
        // If we have a queue, we must tell the engine about it so "Next" works
        if (queue && queue.length > 0) {
            AudioEngine.playQueue(nextQueue, queueIndex).catch(error => {
                console.error('[PlayerStore] playQueue error:', error);
                set({ isPlaying: false, isLoading: false, pendingTrackPreview: null });
            });
        } else {
            AudioEngine.play(track).catch(error => {
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
        const boundedLinearContext = createBoundedLinearPlaybackContext(tracks, startIndex);
        linearPlaybackContextQueue = boundedLinearContext.queue;
        const { queue, queueIndex } = normalizeQueueWindow(linearPlaybackContextQueue, boundedLinearContext.focusIndex);
        set({ queue, queueIndex });
    },

    addToQueue: (track) => {
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
        const removedTrack = queue[index];

        if (removedTrack?.id) {
            const removeIndex = linearPlaybackContextQueue.findIndex(track => track.id === removedTrack.id);
            if (removeIndex >= 0) {
                linearPlaybackContextQueue = linearPlaybackContextQueue.filter((_, i) => i !== removeIndex);
            }
        }

        const newQueue = queue.filter((_, i) => i !== index);

        // Adjust current index if needed
        let newIndex = queueIndex;
        if (index < queueIndex) {
            newIndex--;
        } else if (index === queueIndex) {
            newIndex = Math.min(newIndex, newQueue.length - 1);
        }

        set({ queue: newQueue, queueIndex: newIndex });
        AudioEngine.removeTracks([index]).catch(() => { });
    },

    clearQueue: () => {
        linearPlaybackContextQueue = [];
        set({ queue: [], queueIndex: -1 });
    },

    replaceQueue: async (tracks, startIndex = 0) => {
        if (tracks.length === 0) {
            linearPlaybackContextQueue = [];
            set({ queue: [], queueIndex: -1 });
            return;
        }

        const wasPlaying = get().isPlaying;
        const previousPosition = get().position;
        const boundedLinearContext = createBoundedLinearPlaybackContext(tracks, startIndex);
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
        const { queue, queueIndex, position } = get();

        if (queue.length === 0) return;

        // If more than 3 seconds in, restart current track
        if (position > 3000) {
            await get().seek(0);
            return;
        }

        // Go to previous
        let prevIndex = queueIndex - 1;
        if (prevIndex < 0) {
            prevIndex = queue.length - 1; // Wrap to end
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
            ? shuffleQueueKeepingCurrent(linearPlaybackContextQueue, Math.max(0, linearPlaybackContextQueue.findIndex(track => track.id === currentTrackId)))
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
            if (shouldAcceptEngineTrackId(nextTrack?.id, currentState.queue)) {
                // If we have a track in store, but engine says null, ignore it unless we are not playing.
                if (currentStoreTrack && !nextTrack && currentState.isPlaying) {
                    // Ignore empty track report while playing (likely a brief transition state in native)
                } else {
                    // Preserve enriched metadata (like lazily loaded artwork) when
                    // native engine reports the same track id without those fields.
                    if (currentStoreTrack && nextTrack && currentStoreTrack.id === nextTrack.id) {
                        const mergedTrack = {
                            ...nextTrack,
                            title: nextTrack.title || currentStoreTrack.title,
                            artist: nextTrack.artist || currentStoreTrack.artist,
                            album: nextTrack.album || currentStoreTrack.album,
                            artwork: nextTrack.artwork || currentStoreTrack.artwork,
                            duration: nextTrack.duration || currentStoreTrack.duration,
                            format: nextTrack.format || currentStoreTrack.format,
                            sampleRate: nextTrack.sampleRate || currentStoreTrack.sampleRate,
                            bitDepth: nextTrack.bitDepth || currentStoreTrack.bitDepth,
                            quality: nextTrack.quality || currentStoreTrack.quality,
                        };

                        const hasChanges = Object.keys(mergedTrack).some(
                            (key) => (mergedTrack as any)[key] !== (currentStoreTrack as any)[key]
                        );

                        if (hasChanges) {
                            nextState.currentTrack = mergedTrack;
                        }
                        nextState.pendingTrackPreview = null;
                    } else if (nextTrack && (!currentStoreTrack || currentStoreTrack.id !== nextTrack.id)) {
                        // Engine auto-advanced to a different track (end of song, auto-next, or
                        // the user's manual skip was acknowledged by the engine).
                        // Always accept this Ã¢â‚¬â€ we've already validated it via shouldAcceptEngineTrackId.
                        // Clear the guard so the next auto-advance isn't blocked.
                        clearExpectedEngineTrack();
                        get().positionShared.value = 0;

                        nextState.pendingTrackPreview = null;
                        // Prefer the richer track object from our store queue (has artwork, metadata, etc.)
                        const storeQueue = currentState.queue;
                        const storeQueueIndex = storeQueue.findIndex(t => t.id === nextTrack.id);
                        if (storeQueueIndex >= 0) {
                            // Track found in our visual queue Ã¢â‚¬â€ use store's richer version
                            const richTrack = {
                                ...nextTrack,
                                ...storeQueue[storeQueueIndex],
                            };
                            nextState.currentTrack = richTrack;
                            nextState.queueIndex = storeQueueIndex;
                        } else {
                            // Track NOT in visual queue (auto-advance from native order after reorder).
                            // Accept the engine's track as-is; next manual navigation will re-sync.
                            nextState.currentTrack = nextTrack;
                        }
                    } else if (nextTrack) {
                        nextState.currentTrack = nextTrack;
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
