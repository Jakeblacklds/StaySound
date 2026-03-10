/**
 * PlaybackService - Background Audio Event Handler
 * 
 * This service handles remote control events from:
 * - Notification controls
 * - Lock screen controls
 * - Samsung Dynamic Island / Now Bar
 * - Bluetooth headphones/car systems
 * - Android Auto
 * 
 * It runs in the background and dispatches events to the player store.
 */

import TrackPlayer, { Event } from 'react-native-track-player';
// import { syncInternalCacheHeaders } from './cacheHeadersProvider';

/**
 * The playback service that runs in the background
 * This function is called by TrackPlayer when a remote event occurs
 */
export async function PlaybackService(): Promise<void> {
    // Sincronización desactivada
    // syncInternalCacheHeaders();

    // Remote play button (notification/lock screen)
    TrackPlayer.addEventListener(Event.RemotePlay, async () => {
        console.log('[PlaybackService] Remote Play');
        // Gatillo silencioso desactivado
        // syncInternalCacheHeaders();
        try {
            await TrackPlayer.play();
        } catch (error) {
            console.error('[PlaybackService] Remote Play error:', error);
        }
    });

    // Remote pause button
    TrackPlayer.addEventListener(Event.RemotePause, async () => {
        console.log('[PlaybackService] Remote Pause');
        try {
            await TrackPlayer.pause();
        } catch (error) {
            console.error('[PlaybackService] Remote Pause error:', error);
        }
    });

    // Remote stop button
    TrackPlayer.addEventListener(Event.RemoteStop, async () => {
        console.log('[PlaybackService] Remote Stop');
        try {
            await TrackPlayer.stop();
            await TrackPlayer.reset();
        } catch (error) {
            console.error('[PlaybackService] Remote Stop error:', error);
        }
    });

    // Remote next button
    TrackPlayer.addEventListener(Event.RemoteNext, async () => {
        console.log('[PlaybackService] Remote Next');
        // syncInternalCacheHeaders();
        try {
            await TrackPlayer.skipToNext();
        } catch (error) {
            console.error('[PlaybackService] Remote Next error:', error);
        }
    });

    // Remote previous button
    TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
        console.log('[PlaybackService] Remote Previous');
        // syncInternalCacheHeaders();
        // If more than 3 seconds in, restart current track
        try {
            const position = await TrackPlayer.getProgress();
            if (position.position > 3) {
                await TrackPlayer.seekTo(0);
            } else {
                await TrackPlayer.skipToPrevious();
            }
        } catch (error) {
            console.error('[PlaybackService] Remote Previous error:', error);
        }
    });

    // Remote seek event (from seekbar in notification)
    TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
        console.log('[PlaybackService] Remote Seek:', event.position);
        TrackPlayer.seekTo(event.position);
    });

    // Remote duck (lower volume for phone call, etc)
    TrackPlayer.addEventListener(Event.RemoteDuck, (event) => {
        console.log('[PlaybackService] Remote Duck:', event);
        if (event.paused) {
            // Another app requested audio focus, pause
            TrackPlayer.pause();
        } else if (event.permanent) {
            // Permanent loss of focus (e.g., phone call)
            TrackPlayer.pause();
        } else {
            // Temporary loss, we can continue at lower volume or pause
            // Note: ducking is handled automatically by the player
        }
    });

    // Handle jump forward (usually 30 seconds)
    TrackPlayer.addEventListener(Event.RemoteJumpForward, async (event) => {
        console.log('[PlaybackService] Jump Forward:', event.interval);
        const progress = await TrackPlayer.getProgress();
        TrackPlayer.seekTo(progress.position + (event.interval || 15));
    });

    // Handle jump backward (usually 15 seconds)
    TrackPlayer.addEventListener(Event.RemoteJumpBackward, async (event) => {
        console.log('[PlaybackService] Jump Backward:', event.interval);
        const progress = await TrackPlayer.getProgress();
        TrackPlayer.seekTo(Math.max(0, progress.position - (event.interval || 15)));
    });

    // Handle playback queue ended
    TrackPlayer.addEventListener(Event.PlaybackQueueEnded, (event) => {
        console.log('[PlaybackService] Queue Ended:', event);
    });

    // Handle playback state changes
    TrackPlayer.addEventListener(Event.PlaybackState, (event) => {
        console.log('[PlaybackService] State Changed:', event.state);
    });

    // Handle playback errors
    TrackPlayer.addEventListener(Event.PlaybackError, (event) => {
        console.error('[PlaybackService] Playback Error:', event);
    });

    // Handle track changed
    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, (event) => {
        console.log('[PlaybackService] Active Track Changed:', event.track?.title);
        // Desactivado
        // syncInternalCacheHeaders();
    });

    console.log('[PlaybackService] Initialized');
}
