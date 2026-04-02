/**
 * TrackPlayerService - Audio Playback with Background Support
 * 
 * Uses react-native-track-player as the primary audio engine for:
 * - Background playback (music plays when app is in background)
 * - Lock screen controls
 * - Notification controls (with artwork)
 * - Samsung Dynamic Island / Now Bar integration
 * - Bluetooth/headphone controls
 * - Android Auto support
 */

import TrackPlayer, {
    AppKilledPlaybackBehavior,
    Capability,
    Event,
    RepeatMode,
    State,
} from 'react-native-track-player';
import { Track } from '../types/audio';

let isInitialized = false;
let initializationPromise: Promise<boolean> | null = null;

/**
 * Initialize Track Player with full configuration
 */
export async function initializeTrackPlayer(): Promise<boolean> {
    if (isInitialized) return true;
    if (initializationPromise) return initializationPromise;

    initializationPromise = (async () => {
        try {
            // Setup the player â€” optimized for local file playback
            await TrackPlayer.setupPlayer({
                // Buffer settings tuned for LOCAL files (not streaming)
                // Local files read from disk instantly, so minimal buffering needed
                minBuffer: 5,
                maxBuffer: 15,
                // CRITICAL: Start playing almost immediately
                playBuffer: 0.1,
                maxCacheSize: 1024 * 100,
                autoHandleInterruptions: true,
            });

            // Configure capabilities (what buttons to show)
            await TrackPlayer.updateOptions({
                capabilities: [
                    Capability.Play,
                    Capability.PlayFromId,
                    Capability.PlayFromSearch,
                    Capability.Pause,
                    Capability.SkipToNext,
                    Capability.SkipToPrevious,
                    Capability.SeekTo,
                    Capability.Skip,
                    Capability.Stop,
                ],
                // Android specific options
                android: {
                    // Stop playback and remove notification when the app is swiped away
                    appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
                },
                notificationCapabilities: [
                    Capability.Play,
                    Capability.Pause,
                    Capability.SkipToNext,
                    Capability.SkipToPrevious,
                    Capability.SeekTo,
                    Capability.Skip,
                    Capability.Stop,
                ],
                // Progress bar update interval in seconds
                progressUpdateEventInterval: 1,
            });

            isInitialized = true;
            console.log('[TrackPlayer] Initialized successfully');
            return true;
        } catch (error) {
            console.error('[TrackPlayer] Setup failed:', error);
            return false;
        } finally {
            initializationPromise = null;
        }
    })();

    return initializationPromise;
}

/**
 * Check if Track Player is ready
 */
export function isTrackPlayerReady(): boolean {
    return isInitialized;
}

/**
 * Play a single track â€” optimized for near-instant start.
 * BUG FIX: Uses reset()+add() instead of load() for absolute queue reliability.
 */
export async function playTrack(track: Track): Promise<void> {
    if (!isInitialized) {
        const initialized = await initializeTrackPlayer();
        if (!initialized) {
            throw new Error('Track Player initialization failed');
        }
    }

    try {
        // CRITICAL BUG FIX: reset() ensures the native queue is completely empty.
        // load() can sometimes preserve metadata from previous sessions on buggy Android versions.
        await TrackPlayer.reset();

        const trackData: any = {
            id: track.id,
            mediaId: track.id,
            url: track.uri,
            title: track.title || 'Unknown Title',
            artist: track.artist || 'Unknown Artist',
            album: track.album || 'Unknown Album',
            artwork: track.artwork || undefined,
            duration: track.duration ? track.duration / 1000 : undefined,
            genre: track.genre,
            // Technical metadata preserved for UI
            format: track.format,
            sampleRate: track.sampleRate,
            bitDepth: track.bitDepth,
            quality: track.quality,
        };

        await TrackPlayer.add([trackData]);
        await TrackPlayer.play();
    } catch (error) {
        console.error('[TrackPlayer] Play error:', error);
        throw error;
    }
}

/**
 * Play a queue of tracks starting at a specific index
 */
export async function playQueue(tracks: Track[], startIndex: number = 0): Promise<void> {
    if (!isInitialized) {
        const initialized = await initializeTrackPlayer();
        if (!initialized) {
            throw new Error('Track Player initialization failed');
        }
    }

    try {
        if (tracks.length === 0) return;

        await TrackPlayer.reset();

        const trackPlayerTracks = tracks.map(track => ({
            id: track.id,
            mediaId: track.id,
            url: track.uri,
            title: track.title || 'Unknown Title',
            artist: track.artist || 'Unknown Artist',
            album: track.album || 'Unknown Album',
            artwork: track.artwork || undefined,
            duration: track.duration ? track.duration / 1000 : undefined,
            genre: track.genre,
            // Technical metadata preserved for UI
            format: track.format,
            sampleRate: track.sampleRate,
            bitDepth: track.bitDepth,
            quality: track.quality,
        }));

        const safeIndex = Math.max(0, Math.min(startIndex, trackPlayerTracks.length - 1));

        await TrackPlayer.add(trackPlayerTracks);
        if (safeIndex > 0) {
            await TrackPlayer.skip(safeIndex);
        }
        await TrackPlayer.play();

        console.log('[TrackPlayer] Playing queue, starting at:', tracks[safeIndex]?.title);
    } catch (error) {
        console.error('[TrackPlayer] Play queue error:', error);
        throw error;
    }
}

/**
 * Pause playback
 */
export async function pause(): Promise<void> {
    if (!isInitialized) return;
    await TrackPlayer.pause();
    console.log('[TrackPlayer] Paused');
}

/**
 * Resume playback
 */
export async function resume(): Promise<void> {
    if (!isInitialized) return;
    await TrackPlayer.play();
    console.log('[TrackPlayer] Resumed');
}

/**
 * Toggle play/pause
 */
export async function togglePlayPause(): Promise<void> {
    if (!isInitialized) return;

    const state = await TrackPlayer.getPlaybackState();
    if (state.state === State.Playing) {
        await pause();
    } else {
        await resume();
    }
}

/**
 * Stop playback
 */
export async function stop(): Promise<void> {
    if (!isInitialized) return;
    await TrackPlayer.stop();
    await TrackPlayer.reset();
    console.log('[TrackPlayer] Stopped');
}

/**
 * Seek to position in seconds
 */
export async function seekTo(positionSeconds: number): Promise<void> {
    if (!isInitialized) return;
    await TrackPlayer.seekTo(positionSeconds);
    console.log('[TrackPlayer] Seeked to:', positionSeconds);
}

/**
 * Skip to next track
 */
export async function skipToNext(): Promise<void> {
    if (!isInitialized) return;
    await TrackPlayer.skipToNext();
    console.log('[TrackPlayer] Skipped to next');
}

/**
 * Skip to previous track (or restart if more than 3 seconds in)
 */
export async function skipToPrevious(): Promise<void> {
    if (!isInitialized) return;

    const progress = await TrackPlayer.getProgress();
    if (progress.position > 3) {
        await TrackPlayer.seekTo(0);
    } else {
        await TrackPlayer.skipToPrevious();
    }
    console.log('[TrackPlayer] Skipped to previous');
}

/**
 * Skip to specific track in queue
 */
export async function skipToTrack(index: number): Promise<void> {
    if (!isInitialized) return;
    await TrackPlayer.skip(index);
    console.log('[TrackPlayer] Skipped to track:', index);
}

/**
 * Skip to a track by its ID in the native engine queue.
 * This is the safe way to navigate when the store's queue order differs from the
 * native engine's queue order (e.g. after shuffle).
 *
 * @param trackId The ID of the track to skip to.
 * @returns Whether the skip was successful.
 */
export async function skipToTrackById(trackId: string): Promise<boolean> {
    if (!isInitialized) return false;

    try {
        const queue = await TrackPlayer.getQueue() as any[];
        const nativeIds = queue.map(t => (t.id?.toString() ?? ''));
        const nativeIndex = nativeIds.indexOf(trackId);

        if (nativeIndex < 0) {
            console.warn('[TrackPlayer] skipToTrackById: track NOT FOUND in native queue:', trackId);
            console.log('[TrackPlayer] Native Queue Track IDs:', nativeIds);
            return false;
        }
        await TrackPlayer.skip(nativeIndex);
        console.log('[TrackPlayer] skipToTrackById: skipped to index', nativeIndex, 'for id', trackId);
        return true;
    } catch (error) {
        console.error('[TrackPlayer] skipToTrackById error:', error);
        return false;
    }
}

/**
 * Synchronize the native engine queue order to match a target list of track IDs.
 * Uses TrackPlayer.move() to reorder without interrupting playback.
 * This ensures the engine's "Next" track is correctly aligned with the store's queue.
 */
export async function syncNativeQueue(targetTrackIds: string[]): Promise<void> {
    if (!isInitialized) return;
    if (targetTrackIds.length === 0) return;

    try {
        const nativeQueue = await TrackPlayer.getQueue();

        // Match only what's currently in the native queue
        const nativeIds = nativeQueue.map((t: any) => t.id?.toString() ?? '');

        // Local state tracking to update indices after each move
        let currentNativeQueueIds = [...nativeIds];

        for (let targetIdx = 0; targetIdx < targetTrackIds.length; targetIdx++) {
            const targetId = targetTrackIds[targetIdx];
            const currentIdx = currentNativeQueueIds.indexOf(targetId);

            if (currentIdx !== -1 && currentIdx !== targetIdx) {
                // Perform movement in native engine
                await TrackPlayer.move(currentIdx, targetIdx);

                // Locally track the move for the next iteration's index calculations
                const item = currentNativeQueueIds.splice(currentIdx, 1)[0];
                currentNativeQueueIds.splice(targetIdx, 0, item);
            }
        }

        console.log('[TrackPlayer] Native queue synced via moves');
    } catch (error) {
        console.error('[TrackPlayer] syncNativeQueue error:', error);
    }
}

/**
 * Remove tracks from native queue by index
 */
export async function removeTracks(indices: number[]): Promise<void> {
    if (!isInitialized) return;
    await TrackPlayer.remove(indices);
    console.log('[TrackPlayer] Removed tracks at indices:', indices);
}

/**
 * Set volume (0-1)
 */
export async function setVolume(volume: number): Promise<void> {
    if (!isInitialized) return;
    await TrackPlayer.setVolume(Math.max(0, Math.min(1, volume)));
    console.log('[TrackPlayer] Volume set to:', volume);
}

/**
 * Set repeat mode
 */
export async function setRepeatMode(mode: 'off' | 'all' | 'one'): Promise<void> {
    if (!isInitialized) return;

    const repeatModes = {
        'off': RepeatMode.Off,
        'all': RepeatMode.Queue,
        'one': RepeatMode.Track,
    };

    await TrackPlayer.setRepeatMode(repeatModes[mode]);
    console.log('[TrackPlayer] Repeat mode:', mode);
}

/**
 * Get current playback state
 */
export async function getPlaybackState(): Promise<State | null> {
    if (!isInitialized) return null;
    const state = await TrackPlayer.getPlaybackState();
    return state.state;
}

/**
 * Get current progress (position, duration, buffered)
 */
export async function getProgress(): Promise<{ position: number; duration: number; buffered: number }> {
    if (!isInitialized) return { position: 0, duration: 0, buffered: 0 };
    return TrackPlayer.getProgress();
}

/**
 * Get current track
 * BUG FIX: Use getActiveTrack() exclusively for better metadata reliability.
 */
export async function getCurrentTrack(): Promise<Track | null> {
    if (!isInitialized) return null;

    try {
        const track = await TrackPlayer.getActiveTrack();
        if (!track) return null;

        return {
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
    } catch (error) {
        console.error('[TrackPlayer] Error getting current track:', error);
        return null;
    }
}

/**
 * Get current active track index
 */
export async function getActiveTrackIndex(): Promise<number> {
    if (!isInitialized) return -1;
    const index = await TrackPlayer.getActiveTrackIndex();
    return index ?? -1;
}

/**
 * Check if currently playing
 */
export async function isPlaying(): Promise<boolean> {
    if (!isInitialized) return false;
    const state = await TrackPlayer.getPlaybackState();
    return state.state === State.Playing;
}

/**
 * Add event listener for playback events
 */
export function addEventListener(event: Event, callback: (data: any) => void) {
    return TrackPlayer.addEventListener(event, callback);
}

/**
 * Destroy Track Player
 */
export async function destroyTrackPlayer(): Promise<void> {
    if (!isInitialized) return;

    try {
        await TrackPlayer.reset();
        isInitialized = false;
        console.log('[TrackPlayer] Destroyed');
    } catch (error) {
        console.error('[TrackPlayer] Destroy failed:', error);
    }
}

// Re-export types and enums for convenience
export { Event, RepeatMode, State };



