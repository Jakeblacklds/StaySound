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
            try {
                // Use TP v5 payload
                const track = event?.track;
                const index = event?.index;

                if (track) {
                    const normalized: Track = {
                        id: track.id?.toString() || '',
                        uri: track.url,
                        title: track.title || 'Unknown',
                        artist: track.artist || 'Unknown',
                        album: track.album || 'Unknown',
                        artwork: track.artwork as string | undefined,
                        duration: (track.duration || 0) * 1000,
                        format: (track as any).format,
                        sampleRate: (track as any).sampleRate,
                        bitDepth: (track as any).bitDepth,
                        quality: (track as any).quality,
                        dateAdded: Date.now(),
                    };
                    this.currentState.currentTrack = normalized;
                    this.currentState.queueIndex = index ?? -1;
                    this.currentState.duration = normalized.duration;
                    this.currentState.position = 0;
                } else {
                    const [activeTrack, activeIndex] = await Promise.all([
                        TrackPlayerService.getCurrentTrack(),
                        TrackPlayerService.getActiveTrackIndex(),
                    ]);
                    this.currentState.currentTrack = activeTrack;
                    this.currentState.queueIndex = activeIndex;
                    this.currentState.duration = activeTrack?.duration || 0;
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
        const errorSub = TrackPlayerService.addEventListener(Event.PlaybackError, (event) => {
            console.error('[AudioEngine] Playback error:', event);
            this.callbacks.onError?.(new Error(event.message || 'Playback error'));
        });
        this.subscriptions.push(errorSub);
    }

    private lastReactUpdate = 0;
    private lastPositionZustandUpdate = 0;
    private progressRequestInFlight = false;
    private lastProgressPull = 0;
    private lastManualSeekTime = 0;

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
                const progress = await TrackPlayerService.getProgress();
                this.lastProgressPull = Date.now();
                this.currentState.position = progress.position * 1000;
                this.currentState.duration = progress.duration * 1000;
                this.currentState.buffered = progress.buffered * 1000;

                // ─── PATH 1: UI THREAD (every tick, zero React re-renders) ───
                // positionShared drives the animated progress bar directly on the UI thread.
                const positionShared = usePlayerStore.getState().positionShared;
                if (positionShared) {
                    positionShared.value = this.currentState.position;
                }

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
            this.currentState.isLoading = false;
            this.callbacks.onStateChange?.(this.currentState);
            console.log('[AudioEngine] Playing queue, starting at:', tracks[startIndex]?.title);
        } catch (error) {
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

        // Update positionShared immediately (visual feedback without waiting for next tick)
        const { usePlayerStore } = require('../stores/playerStore');
        const positionShared = usePlayerStore.getState().positionShared;
        if (positionShared) {
            positionShared.value = positionMs;
        }

        // On seek, update Zustand position so the text label is correct after seek
        this.callbacks.onStateChange?.(this.currentState);
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
