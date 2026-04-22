const { playFromMediaId, playFromSearch } = require('./androidAutoService');

module.exports = async function () {
    try {
        const TrackPlayer = await import('react-native-track-player').catch(() => null);
        if (!TrackPlayer) return;

        const { Event, State } = TrackPlayer;
        let pausedByFocusLoss = false;

        TrackPlayer.default.addEventListener(Event.RemoteNext, async () => {
            console.log('[TrackPlayerEvents] Remote Next Trigger');
            try {
                await TrackPlayer.default.skipToNext();
            } catch (error) {
                console.warn('[TrackPlayerEvents] Remote Next failed:', error);
            }
        });

        TrackPlayer.default.addEventListener(Event.RemotePrevious, async () => {
            console.log('[TrackPlayerEvents] Remote Prev Trigger');
            try {
                await TrackPlayer.default.skipToPrevious();
            } catch (error) {
                console.warn('[TrackPlayerEvents] Remote Prev failed:', error);
            }
        });

        TrackPlayer.default.addEventListener(Event.RemoteSkip, async (event) => {
            console.log('[TrackPlayerEvents] Remote Skip Trigger', event?.index);
            try {
                await TrackPlayer.default.skip(event.index);
            } catch (error) {
                console.warn('[TrackPlayerEvents] Remote Skip failed:', error);
            }
        });

        TrackPlayer.default.addEventListener(Event.RemotePlayId, async (event) => {
            console.log('[TrackPlayerEvents] Remote Play ID Trigger', event?.id);

            const handled = await playFromMediaId(event?.id);
            if (!handled) {
                console.warn('[TrackPlayerEvents] Remote Play ID fallback: mediaId not found', event?.id);
            }
        });

        TrackPlayer.default.addEventListener(Event.RemotePlaySearch, async (event) => {
            console.log('[TrackPlayerEvents] Remote Play Search Trigger', event?.query);

            const handled = await playFromSearch(event);
            if (!handled) {
                console.warn('[TrackPlayerEvents] Remote Play Search fallback: no matching result', event?.query);
            }
        });

        TrackPlayer.default.addEventListener(Event.PlaybackActiveTrackChanged, (event) => {
            if (event.track) {
                console.log('[TrackPlayerEvents] Track Changed Trigger');
            }
        });

        TrackPlayer.default.addEventListener(Event.RemotePlay, async () => {
            try {
                pausedByFocusLoss = false;
                await TrackPlayer.default.play();
            } catch (error) {
                console.warn('[TrackPlayerEvents] Remote Play failed:', error);
            }
        });

        TrackPlayer.default.addEventListener(Event.RemotePause, async () => {
            try {
                pausedByFocusLoss = false;
                await TrackPlayer.default.pause();
            } catch (error) {
                console.warn('[TrackPlayerEvents] Remote Pause failed:', error);
            }
        });

        TrackPlayer.default.addEventListener(Event.RemoteStop, async () => {
            try {
                // Some Bluetooth/automotive controllers emit STOP on route changes.
                // Treat it as pause to avoid dropping queue/playback session unexpectedly.
                pausedByFocusLoss = false;
                await TrackPlayer.default.pause();
            } catch (error) {
                console.warn('[TrackPlayerEvents] Remote Stop failed:', error);
            }
        });

        TrackPlayer.default.addEventListener(Event.RemoteDuck, async (event) => {
            try {
                const state = await TrackPlayer.default.getPlaybackState();
                const isPlaying = state?.state === State.Playing;

                if (event?.paused || event?.permanent) {
                    if (isPlaying) {
                        pausedByFocusLoss = true;
                    }
                    await TrackPlayer.default.pause();
                    return;
                }

                if (pausedByFocusLoss) {
                    pausedByFocusLoss = false;
                    await TrackPlayer.default.play();
                }
            } catch (error) {
                console.warn('[TrackPlayerEvents] Remote Duck handling failed:', error);
            }
        });

        TrackPlayer.default.addEventListener(Event.AndroidConnectorConnected, (event) => {
            if (event?.isAutomotiveController) {
                console.log('[TrackPlayerEvents] Android Auto connected:', event.package);
            }
        });
    } catch (e) {
        console.log('[TrackPlayerEvents] Error:', e);
    }
};
