/**
 * Track Player Events Handler
 * 
 * Handles remote control events from Android Auto, lock screen, etc.
 * This file is required by react-native-track-player's playback service.
 */

// We use a dynamic approach to avoid build errors when module is uninstalled
module.exports = async function () {
    try {
        const TrackPlayer = await import('react-native-track-player').catch(() => null);
        if (!TrackPlayer) return;

        const { Event } = TrackPlayer;

        // Remote play button pressed
        TrackPlayer.default.addEventListener(Event.RemotePlay, () => {
            console.log('[TrackPlayerEvents] Remote Play');
            TrackPlayer.default.play();
        });

        // Remote pause button pressed
        TrackPlayer.default.addEventListener(Event.RemotePause, () => {
            console.log('[TrackPlayerEvents] Remote Pause');
            TrackPlayer.default.pause();
        });

        // Remote next button pressed
        TrackPlayer.default.addEventListener(Event.RemoteNext, () => {
            console.log('[TrackPlayerEvents] Remote Next');
        });

        // Remote previous button pressed
        TrackPlayer.default.addEventListener(Event.RemotePrevious, () => {
            console.log('[TrackPlayerEvents] Remote Previous');
        });

        // Remote seek
        TrackPlayer.default.addEventListener(Event.RemoteSeek, (event: any) => {
            console.log('[TrackPlayerEvents] Remote Seek to:', event.position);
            TrackPlayer.default.seekTo(event.position);
        });

        // Remote stop
        TrackPlayer.default.addEventListener(Event.RemoteStop, () => {
            console.log('[TrackPlayerEvents] Remote Stop');
            TrackPlayer.default.stop();
        });
    } catch (e) {
        console.log('[TrackPlayerEvents] Error or module not found');
    }
};

