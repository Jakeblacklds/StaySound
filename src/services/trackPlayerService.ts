/**
 * TrackPlayerService - Android Auto / Media Notifications bridge
 * 
 * Uses react-native-track-player to expose media controls to:
 * - Android Auto
 * - Lock screen
 * - Bluetooth devices
 * - Notification controls
 * 
 * Note: This is a stub that will be enabled once track-player is properly configured.
 * For now, we're using expo-audio as the primary audio engine.
 */

import { Track } from '../types/audio';

// Flag to track if TrackPlayer is available
let trackPlayerAvailable = false;
let isInitialized = false;

/**
 * Initialize Track Player for media session
 */
export async function initializeTrackPlayer(): Promise<void> {
    if (isInitialized) return;

    try {
        // Dynamically import to avoid build issues
        const TrackPlayer = await import('react-native-track-player').catch(() => null);

        if (!TrackPlayer) {
            console.log('[TrackPlayer] Not available - using expo-audio only');
            return;
        }

        await TrackPlayer.default.setupPlayer({
            autoHandleInterruptions: true,
        });

        await TrackPlayer.default.updateOptions({
            capabilities: [
                TrackPlayer.Capability.Play,
                TrackPlayer.Capability.Pause,
                TrackPlayer.Capability.SkipToNext,
                TrackPlayer.Capability.SkipToPrevious,
                TrackPlayer.Capability.SeekTo,
                TrackPlayer.Capability.Stop,
            ],
            compactCapabilities: [
                TrackPlayer.Capability.Play,
                TrackPlayer.Capability.Pause,
                TrackPlayer.Capability.SkipToNext,
            ],
            progressUpdateEventInterval: 1,
        });

        trackPlayerAvailable = true;
        isInitialized = true;
        console.log('[TrackPlayer] Initialized successfully');
    } catch (error) {
        console.log('[TrackPlayer] Setup failed, using expo-audio only:', error);
        trackPlayerAvailable = false;
    }
}

/**
 * Sync current track metadata to Track Player (for notifications/Android Auto)
 */
export async function syncNowPlaying(track: Track): Promise<void> {
    if (!trackPlayerAvailable) return;

    try {
        const TrackPlayer = await import('react-native-track-player');
        await TrackPlayer.default.reset();
        await TrackPlayer.default.add({
            id: track.id,
            url: track.uri,
            title: track.title,
            artist: track.artist,
            album: track.album,
            artwork: track.artwork,
            duration: track.duration / 1000,
        });
        console.log('[TrackPlayer] Synced now playing:', track.title);
    } catch (error) {
        console.log('[TrackPlayer] Sync failed:', error);
    }
}

/**
 * Sync playback state
 */
export async function syncPlaybackState(isPlaying: boolean): Promise<void> {
    if (!trackPlayerAvailable) return;

    try {
        const TrackPlayer = await import('react-native-track-player');
        if (isPlaying) {
            await TrackPlayer.default.play();
        } else {
            await TrackPlayer.default.pause();
        }
    } catch (error) {
        console.log('[TrackPlayer] State sync failed:', error);
    }
}

/**
 * Sync position
 */
export async function syncPosition(positionMs: number): Promise<void> {
    if (!trackPlayerAvailable) return;

    try {
        const TrackPlayer = await import('react-native-track-player');
        await TrackPlayer.default.seekTo(positionMs / 1000);
    } catch (error) {
        console.log('[TrackPlayer] Position sync failed:', error);
    }
}

/**
 * Cleanup
 */
export async function destroyTrackPlayer(): Promise<void> {
    if (!trackPlayerAvailable) return;

    try {
        const TrackPlayer = await import('react-native-track-player');
        await TrackPlayer.default.reset();
        isInitialized = false;
        console.log('[TrackPlayer] Destroyed');
    } catch (error) {
        console.log('[TrackPlayer] Destroy failed:', error);
    }
}
