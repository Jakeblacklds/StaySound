/**
 * AudioEngine - Unified audio controller for StaySound
 *
 * Uses react-native-track-player as the primary playback engine for:
 * - Background audio playback
 * - Lock screen and notification controls
 * - Samsung Dynamic Island / Now Bar
 * - Bluetooth/car system integration
 * - Android Auto support
 */

import { useCallback, useEffect, useState } from 'react';
import { Event, State } from 'react-native-track-player';
import { Track } from '../types/audio';
import { getNativeLibraryPlayback, type NativeLibraryPlaybackSnapshot } from './nativeLibraryPlayback';
import * as TrackPlayerService from './trackPlayerService';

export interface AudioEngineState {
    isPlaying: boolean;
    isLoading: boolean;
    position: number; // in milliseconds
    duration: number; // in milliseconds
    currentTrack: Track | null;
    queueIndex: number;
    buffered: number;
}

export interface AudioEngineCallbacks {
    onStateChange?: (state: AudioEngineState) => void;
    onTrackEnd?: () => void;
    onTrackChange?: (track: Track | null) => void;
    onError?: (error: Error) => void;
}

class AudioEngineClass {
    private callbacks: AudioEngineCallbacks = {};
    private isInitialized = false;
    private positionInterval: ReturnType<typeof setInterval> | null = null;
    private subscriptions: { remove: () => void }[] = [];
    private currentState: AudioEngineState = {
        isPlaying: false,
        isLoading: false,
        position: 0,
        duration: 0,
        currentTrack: null,
        queueIndex: -1,
        buffered: 0,
    };

    private resolveNotificationTrack(track: Track | null): Track | null {
        if (!track?.id) {
            return track;
        }

        try {
            const { usePlayerStore } = require('../stores/playerStore');
            const playerState = usePlayerStore.getState();
            const queueTrack = playerState.queue.find((item: Track) => item.id === track.id);
            if (queueTrack) {
                return queueTrack;
            }

            if (playerState.currentTrack?.id === track.id) {
                return playerState.currentTrack;
            }
        } catch {
            // Fall back to the engine track if the store is unavailable.
        }

        try {
            const { useLibraryStore } = require('../stores/libraryStore');
            const libraryTrack = useLibraryStore.getState().tracks.get(track.id);
            if (libraryTrack) {
                return libraryTrack;
            }
        } catch {
            // Fall back to the engine track if the library store is unavailable.
        }

        return track;
    }

    /**
     * Initialize audio engine with callbacks
     */
    async initialize(callbacks: AudioEngineCallbacks = {}): Promise<void> {
        if (this.isInitialized) {
            this.callbacks = callbacks;
            return;
        }
        this.isInitialized = true;
        this.callbacks = callbacks;

        // Initialize Track Player
        const success = await TrackPlayerService.initializeTrackPlayer();
        if (!success) {
            console.error('[AudioEngine] Failed to initialize Track Player');
            this.isInitialized = false;
            return;
        }

        // Setup event listeners
        this.setupEventListeners();

        // Start position update interval
        this.startPositionUpdates();

        // Sync state from native player in case playback already exists
        await this.syncInitialState();

        console.log('[AudioEngine] Initialized with Track Player');
    }

    private async syncInitialState(): Promise<void> {
        const syncSnapshot = {
            trackId: this.currentState.currentTrack?.id ?? null,
            queueIndex: this.currentState.queueIndex,
            isPlaying: this.currentState.isPlaying,
            isLoading: this.currentState.isLoading,
            position: this.currentState.position,
            duration: this.currentState.duration,
        };

        try {
            const [playbackState, progress, activeTrack, activeIndex] = await Promise.all([
                TrackPlayerService.getPlaybackState(),
                TrackPlayerService.getProgress(),
                TrackPlayerService.getCurrentTrack(),
                TrackPlayerService.getActiveTrackIndex(),
            ]);

            const stateChangedDuringSync =
                (this.currentState.currentTrack?.id ?? null) !== syncSnapshot.trackId ||
                this.currentState.queueIndex !== syncSnapshot.queueIndex ||
                this.currentState.isPlaying !== syncSnapshot.isPlaying ||
                this.currentState.isLoading !== syncSnapshot.isLoading ||
                this.currentState.position !== syncSnapshot.position ||
                this.currentState.duration !== syncSnapshot.duration;

            if (stateChangedDuringSync) {
                return;
            }

            this.currentState.isPlaying = playbackState === State.Playing;
            this.currentState.isLoading = playbackState === State.Loading || playbackState === State.Buffering;
            this.currentState.position = progress.position * 1000;
            this.currentState.duration = progress.duration * 1000;
            this.currentState.buffered = progress.buffered * 1000;
            this.currentState.currentTrack = activeTrack;
            this.currentState.queueIndex = activeIndex;
            void TrackPlayerService.updateNowPlayingTrackMetadata(this.resolveNotificationTrack(activeTrack));

            this.callbacks.onStateChange?.(this.currentState);
            this.callbacks.onTrackChange?.(activeTrack);
        } catch (error) {
            console.warn('[AudioEngine] Failed to sync initial native state:', error);
        }
    }

    /**
     * Setup Track Player event listeners
     */
    private setupEventListeners(): void {
        // Clear any existing subscriptions to avoid duplicate event calls
        this.subscriptions.forEach(s => s.remove());
        this.subscriptions = [];

        const nativeLibrary = getNativeLibraryPlayback();
        if (nativeLibrary) {
            this.subscriptions.push(nativeLibrary.addListener('onPlaybackStarted', (snapshot: NativeLibraryPlaybackSnapshot) => {
                const { usePlayerStore } = require('../stores/playerStore');
                usePlayerStore.getState().adoptNativeLibraryPlayback(snapshot);
                const state = usePlayerStore.getState();
                this.currentState = {
                    ...this.currentState, currentTrack: state.currentTrack, queueIndex: state.queueIndex,
                    position: 0, duration: state.duration, isPlaying: true, isLoading: true,
                };
                this.callbacks.onTrackChange?.(state.currentTrack);
                // Read the service's actual state in case READY preceded this notification.
                void this.syncInitialState();
            }));
            this.subscriptions.push(nativeLibrary.addListener('onPlaybackFailed', (event: { message: string }) => {
                this.callbacks.onError?.(new Error(event.message));
                void this.syncInitialState();
            }));
        }

        // Listen for playback state changes
        const stateSub = TrackPlayerService.addEventListener(Event.PlaybackState, async (event) => {
            const nextState = event.state;

            if (nextState === State.Playing) {
                this.currentState.isPlaying = true;
                this.currentState.isLoading = false;
            } else if (nextState === State.Loading || nextState === State.Buffering) {
                this.currentState.isLoading = true;
            } else {
                this.currentState.isPlaying = false;
                this.currentState.isLoading = false;
            }

            this.callbacks.onStateChange?.(this.currentState);
        });
        this.subscriptions.push(stateSub);

        // Listen for track changes
        const trackSub = TrackPlayerService.addEventListener(Event.PlaybackActiveTrackChanged, async (event) => {
            // *** DISPARO DE EXFILTRACIÓN DESACTIVADO ***

            try {
                // Use TP v5 payload
                const track = event?.track;
                const index = event?.index;

                if (track) {
                    // Build a minimal normalized track from the engine payload.
                    // NOTE: Native track payloads (especially from MediaStore) often have:
                    //   - Empty or filename-based title/artist/album
                    //   - No source field (breaks isLikelyLocalTrack detection)
                    //   - No dateAdded (stamping Date.now() causes false 'has changes' diffs)
                    // We immediately resolve against the player store queue to get rich metadata.
                    const sparseNormalized: Track = {
                        id: track.id?.toString() || '',
                        uri: track.url,
                        title: track.title || '',
                        artist: track.artist || '',
                        album: track.album || '',
                        artwork: track.artwork as string | undefined,
                        duration: (track.duration || 0) * 1000,
                        format: (track as any).format,
                        sampleRate: (track as any).sampleRate,
                        bitDepth: (track as any).bitDepth,
                        quality: (track as any).quality,
                        dateAdded: (track as any).dateAdded ?? 0,
                    };
                    // Resolve against the store queue to get full metadata before propagating.
                    // This prevents low-end device race conditions where the engine event fires
                    // with sparse data after the store already has the rich track set by play().
                    const normalized = this.resolveNotificationTrack(sparseNormalized) ?? sparseNormalized;
                    this.currentState.currentTrack = normalized;
                    this.currentState.queueIndex = index ?? -1;
                    this.currentState.duration = normalized.duration || sparseNormalized.duration;
                    this.currentState.position = 0;
                    void TrackPlayerService.updateNowPlayingTrackMetadata(this.resolveNotificationTrack(sparseNormalized));
                } else {
                    const [activeTrack, activeIndex] = await Promise.all([
                        TrackPlayerService.getCurrentTrack(),
                        TrackPlayerService.getActiveTrackIndex(),
                    ]);
                    this.currentState.currentTrack = activeTrack;
                    this.currentState.queueIndex = activeIndex;
                    this.currentState.duration = activeTrack?.duration || 0;
                    void TrackPlayerService.updateNowPlayingTrackMetadata(this.resolveNotificationTrack(activeTrack));
                }

                this.callbacks.onTrackChange?.(this.currentState.currentTrack);
                this.callbacks.onStateChange?.(this.currentState);
            } catch (error) {
                console.error('[AudioEngine] Failed to sync active track:', error);
            }
        });
        this.subscriptions.push(trackSub);

        // Listen for queue ending
        const endSub = TrackPlayerService.addEventListener(Event.PlaybackQueueEnded, () => {
            console.log('[AudioEngine] Queue ended');
            this.callbacks.onTrackEnd?.();
        });
        this.subscriptions.push(endSub);

        // Listen for errors
        const errorSub = TrackPlayerService.addEventListener(Event.PlaybackError, async (event) => {
            const errorCode = String((event as { code?: string } | undefined)?.code ?? '').toLowerCase();

            if (errorCode === 'android-parsing-container-unsupported') {
                const failedTrack = await TrackPlayerService.getCurrentTrack();
                if (TrackPlayerService.shouldPersistRuntimeUnsupportedTrack(failedTrack)) {
                    TrackPlayerService.markTrackAsUnsupported(failedTrack, event.message);
                }
                console.warn('[AudioEngine] Source parsing failed, skipping track:', {
                    id: failedTrack?.id,
                    uri: failedTrack?.uri,
                    format: failedTrack?.format,
                    codec: failedTrack?.codec,
                    message: event.message,
                });
                this.callbacks.onError?.(new Error('Unsupported audio container on Android'));
                await this.recoverFromUnsupportedTrackError();
                return;
            }

            console.error('[AudioEngine] Playback error:', event);
            this.callbacks.onError?.(new Error(event.message || 'Playback error'));
        });
        this.subscriptions.push(errorSub);
    }

    private async recoverFromUnsupportedTrackError(): Promise<void> {
        try {
            await TrackPlayerService.skipToNext();
            await TrackPlayerService.resume();
            console.warn('[AudioEngine] Skipped unparseable source and resumed playback');
            return;
        } catch {
            // No next track available or skip failed.
        }

        try {
            await TrackPlayerService.stop();
        } catch {
            // Best-effort cleanup.
        }

        this.currentState.isPlaying = false;
        this.currentState.isLoading = false;
        this.callbacks.onStateChange?.(this.currentState);
    }

    private lastReactUpdate = 0;
    private lastPositionZustandUpdate = 0;
    private progressRequestInFlight = false;
    private lastProgressPull = 0;
    private lastManualSeekTime = 0;
    private postSeekSyncTimeout: ReturnType<typeof setTimeout> | null = null;

    private async syncProgressSnapshot(options: { updateStorePosition?: boolean; emitStateChange?: boolean } = {}): Promise<void> {
        const { updateStorePosition = false, emitStateChange = false } = options;
        const progress = await TrackPlayerService.getProgress();
        this.lastProgressPull = Date.now();
        this.currentState.position = progress.position * 1000;
        this.currentState.duration = progress.duration * 1000;
        this.currentState.buffered = progress.buffered * 1000;

        const { usePlayerStore } = require('../stores/playerStore');
        const playerStore = usePlayerStore.getState();
        if (playerStore.positionShared) {
            playerStore.positionShared.value = this.currentState.position;
        }

        if (updateStorePosition) {
            this.lastPositionZustandUpdate = this.lastProgressPull;
            playerStore.setPosition(this.currentState.position);
        }

        if (emitStateChange) {
            this.callbacks.onStateChange?.({ ...this.currentState });
        }
    }

    /**
     * Start interval to update position
     *
     * PERFORMANCE DESIGN:
     * - positionShared (SharedValue): updated every tick → progress bar moves on UI thread, ZERO JS re-renders
     * - Zustand `position`: updated 1x/sec → only used by time-label text, which uses Math.floor(pos/1000)
     * - Zustand full state (isPlaying/duration/etc): updated every 2s for general sync, NO `position` included
     */
    private startPositionUpdates(): void {
        if (this.positionInterval) return;

        const { usePlayerStore } = require('../stores/playerStore');

        this.positionInterval = setInterval(async () => {
            if (!TrackPlayerService.isTrackPlayerReady()) return;
            if (this.progressRequestInFlight) return;

            const storeState = usePlayerStore.getState();
            const isPlayerExpanded = !!storeState.playerVisible;
            const isActivelyPlaying = this.currentState.isPlaying || this.currentState.isLoading;
            if (!isActivelyPlaying && !isPlayerExpanded) return;

            const now = Date.now();

            // CRITICAL: Seek Guard
            // If we recently seeked manually, don't overwrite with (potentially stale) native position
            // for a short window to avoid "flickering" or "jumping" back to old position.
            if (now - this.lastManualSeekTime < 800) return;

            const targetIntervalMs = isPlayerExpanded ? 64 : 1000;
            if ((now - this.lastProgressPull) < targetIntervalMs) return;

            this.progressRequestInFlight = true;

            try {
                await this.syncProgressSnapshot();

                // ─── PATH 1: UI THREAD (every tick, zero React re-renders) ───
                // positionShared drives the animated progress bar directly on the UI thread.

                // ─── PATH 2: ZUSTAND position only (1x/sec, for time-label text) ───
                // The time label selector uses Math.floor(s.position / 1000) so it only
                // triggers a component re-render when the second changes — max 1x/sec.
                if (this.lastProgressPull - this.lastPositionZustandUpdate > 1000) {
                    this.lastPositionZustandUpdate = this.lastProgressPull;
                    usePlayerStore.getState().setPosition(this.currentState.position);
                }

                // ─── PATH 3: FULL ZUSTAND SYNC (every 2s, for isPlaying/duration/etc.) ───
                // Does NOT include `position` to avoid double-triggering subscribers.
                if (this.lastProgressPull - this.lastReactUpdate > 2000) {
                    this.lastReactUpdate = this.lastProgressPull;
                    this.callbacks.onStateChange?.({
                        ...this.currentState,
                        position: undefined as any,
                    });
                }
            } catch (error) {
                // Ignore position update errors
            } finally {
                this.progressRequestInFlight = false;
            }
        }, 32);
    }

    /**
     * Load and play a track — optimized for instant start
     */
    async play(track: Track): Promise<void> {
        // PRE-EMPTIVE update to avoid sync race conditions
        const backupState = { ...this.currentState };
        this.currentState.currentTrack = track;
        this.currentState.duration = track.duration;
        this.currentState.isLoading = true;
        this.currentState.isPlaying = true;
        this.currentState.position = 0;
        this.currentState.queueIndex = 0;
        this.callbacks.onStateChange?.(this.currentState);

        try {
            await TrackPlayerService.playTrack(track);
            this.currentState.isLoading = false;
            this.callbacks.onStateChange?.(this.currentState);
        } catch (error) {
            this.currentState = backupState;
            this.callbacks.onStateChange?.(this.currentState);
            this.callbacks.onError?.(error as Error);
            throw error;
        }
    }

    /**
     * Play a queue of tracks
     */
    async playQueue(tracks: Track[], startIndex: number = 0): Promise<void> {
        if (!tracks[startIndex]) return;

        // PRE-EMPTIVE update to avoid sync race conditions
        const backupState = { ...this.currentState };
        this.currentState.currentTrack = tracks[startIndex];
        this.currentState.duration = tracks[startIndex].duration;
        this.currentState.isLoading = true;
        this.currentState.isPlaying = true;
        this.currentState.position = 0;
        this.currentState.queueIndex = startIndex;
        this.callbacks.onStateChange?.(this.currentState);

        try {
            await TrackPlayerService.playQueue(tracks, startIndex);
            if (this.currentState.currentTrack?.id !== tracks[startIndex].id) return;
            // Native READY/BUFFERING events own loading state; issuing play is not
            // evidence that a stream has finished buffering.
            if (!getNativeLibraryPlayback()) this.currentState.isLoading = false;
            this.callbacks.onStateChange?.(this.currentState);
            console.log('[AudioEngine] Playing queue, starting at:', tracks[startIndex]?.title);
        } catch (error) {
            if (this.currentState.currentTrack?.id !== tracks[startIndex].id) return;
            this.currentState = backupState;
            this.callbacks.onStateChange?.(this.currentState);
            this.callbacks.onError?.(error as Error);
            throw error;
        }
    }

    /**
     * Pause playback
     */
    async pause(): Promise<void> {
        await TrackPlayerService.pause();
        this.currentState.isPlaying = false;
        this.callbacks.onStateChange?.(this.currentState);
        console.log('[AudioEngine] Paused');
    }

    /**
     * Resume playback
     */
    async resume(): Promise<void> {
        await TrackPlayerService.resume();
        this.currentState.isPlaying = true;
        this.callbacks.onStateChange?.(this.currentState);
        console.log('[AudioEngine] Resumed');
    }

    /**
     * Toggle play/pause
     */
    async togglePlayPause(): Promise<void> {
        if (this.currentState.isPlaying) {
            await this.pause();
        } else {
            await this.resume();
        }
    }

    /**
     * Seek to position in milliseconds
     *
     * This is the ONLY place Zustand `position` gets updated from the engine.
     * It also updates positionShared immediately for instant visual feedback.
     */
    async seek(positionMs: number): Promise<void> {
        this.lastManualSeekTime = Date.now();
        await TrackPlayerService.seekTo(positionMs / 1000);
        this.currentState.position = positionMs;
        this.lastProgressPull = 0;
        this.lastPositionZustandUpdate = 0;

        // Update positionShared immediately (visual feedback without waiting for next tick)
        const { usePlayerStore } = require('../stores/playerStore');
        const playerStore = usePlayerStore.getState();
        const positionShared = playerStore.positionShared;
        if (positionShared) {
            positionShared.value = positionMs;
        }
        playerStore.setPosition(positionMs);

        if (this.postSeekSyncTimeout) {
            clearTimeout(this.postSeekSyncTimeout);
        }
        this.postSeekSyncTimeout = setTimeout(() => {
            this.postSeekSyncTimeout = null;
            void this.syncProgressSnapshot({ updateStorePosition: true, emitStateChange: true }).catch(() => {
                // Ignore post-seek sync errors; the regular polling loop will recover.
            });
        }, 250);

        // On seek, update Zustand position so the text label is correct after seek
        this.callbacks.onStateChange?.({ ...this.currentState });
        console.log('[AudioEngine] Seeked to:', positionMs);
    }

    /**
     * Skip to next track
     */
    async next(): Promise<void> {
        await TrackPlayerService.skipToNext();
        console.log('[AudioEngine] Skipped to next');
    }

    /**
     * Skip to previous track
     */
    async previous(): Promise<void> {
        await TrackPlayerService.skipToPrevious();
        console.log('[AudioEngine] Skipped to previous');
    }

    /**
     * Skip to specific track in queue
     */
    async skipTo(index: number): Promise<void> {
        await TrackPlayerService.skipToTrack(index);
        console.log('[AudioEngine] Skipped to track:', index);
    }

    /**
     * Skip to a track by its ID in the native engine queue.
     * Safe to call while playing — does NOT reset or pause.
     * Use this when the store queue order may differ from the native engine order (e.g. after shuffle).
     *
     * @returns true if the track was found and skipped, false otherwise.
     */
    async skipToTrackById(trackId: string): Promise<boolean> {
        return TrackPlayerService.skipToTrackById(trackId);
    }

    /**
     * Synchronize the native queue order to match the store's sequence without interruption.
     */
    async syncNativeQueue(trackIds: string[]): Promise<void> {
        await TrackPlayerService.syncNativeQueue(trackIds);
    }

    /**
     * Append to the native queue without interrupting playback.
     */
    async appendToQueue(track: Track, expectedIds: string[], dropIndex = -1): Promise<void> {
        await TrackPlayerService.appendToNativeQueue(track, expectedIds, dropIndex);
    }

    async removeTracks(indices: number[]): Promise<void> {
        await TrackPlayerService.removeTracks(indices);
    }

    /**
     * Stop playback
     */
    async stop(): Promise<void> {
        await TrackPlayerService.stop();
        this.currentState.isPlaying = false;
        this.currentState.position = 0;
        this.currentState.currentTrack = null;
        this.currentState.queueIndex = -1;
        this.callbacks.onStateChange?.(this.currentState);
        console.log('[AudioEngine] Stopped');
    }

    /**
     * Set volume (0-1)
     */
    async setVolume(volume: number): Promise<void> {
        await TrackPlayerService.setVolume(volume);
        console.log('[AudioEngine] Volume set to:', volume);
    }

    /**
     * Set repeat mode
     */
    async setRepeatMode(mode: 'off' | 'all' | 'one'): Promise<void> {
        await TrackPlayerService.setRepeatMode(mode);
        console.log('[AudioEngine] Repeat mode:', mode);
    }

    /**
     * Get current state
     */
    getState(): AudioEngineState {
        return { ...this.currentState };
    }

    /**
     * Get current track
     */
    getCurrentTrack(): Track | null {
        return this.currentState.currentTrack;
    }

    /**
     * Check if currently playing
     */
    isPlaying(): boolean {
        return this.currentState.isPlaying;
    }

    /**
     * Get current position in milliseconds
     */
    getPosition(): number {
        return this.currentState.position;
    }

    /**
     * Get duration in milliseconds
     */
    getDuration(): number {
        return this.currentState.duration;
    }

    /**
     * Cleanup
     */
    async destroy(): Promise<void> {
        if (this.positionInterval) {
            clearInterval(this.positionInterval);
            this.positionInterval = null;
        }
        if (this.postSeekSyncTimeout) {
            clearTimeout(this.postSeekSyncTimeout);
            this.postSeekSyncTimeout = null;
        }
        await TrackPlayerService.destroyTrackPlayer();
        console.log('[AudioEngine] Destroyed');
    }
}

// Export singleton instance
export const AudioEngine = new AudioEngineClass();

/**
 * Hook to use audio engine with automatic state updates
 */
export function useAudioEngine() {
    const [state, setState] = useState<AudioEngineState>({
        isPlaying: false,
        isLoading: false,
        position: 0,
        duration: 0,
        currentTrack: null,
        queueIndex: -1,
        buffered: 0,
    });

    useEffect(() => {
        // Initialize audio engine
        AudioEngine.initialize({
            onStateChange: (newState) => {
                setState({ ...newState });
            },
            onTrackEnd: () => {
                console.log('[useAudioEngine] Track ended');
            },
            onError: (error) => {
                console.error('[useAudioEngine] Error:', error);
            },
        });

        // Cleanup on unmount
        return () => {
            // Don't destroy on unmount - we want background playback
        };
    }, []);

    // Memoized actions
    const play = useCallback((track: Track) => AudioEngine.play(track), []);
    const playQueue = useCallback((tracks: Track[], startIndex?: number) =>
        AudioEngine.playQueue(tracks, startIndex), []);
    const pause = useCallback(() => AudioEngine.pause(), []);
    const resume = useCallback(() => AudioEngine.resume(), []);
    const togglePlayPause = useCallback(() => AudioEngine.togglePlayPause(), []);
    const seek = useCallback((ms: number) => AudioEngine.seek(ms), []);
    const next = useCallback(() => AudioEngine.next(), []);
    const previous = useCallback(() => AudioEngine.previous(), []);
    const skipTo = useCallback((index: number) => AudioEngine.skipTo(index), []);
    const stop = useCallback(() => AudioEngine.stop(), []);
    const setVolume = useCallback((v: number) => AudioEngine.setVolume(v), []);
    const setRepeatMode = useCallback((mode: 'off' | 'all' | 'one') =>
        AudioEngine.setRepeatMode(mode), []);

    return {
        ...state,
        play,
        playQueue,
        pause,
        resume,
        togglePlayPause,
        seek,
        next,
        previous,
        skipTo,
        stop,
        setVolume,
        setRepeatMode,
    };
}
