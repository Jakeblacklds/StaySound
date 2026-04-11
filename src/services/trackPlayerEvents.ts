const { playFromMediaId, playFromSearch } = require('./androidAutoService');

module.exports = async function () {
    try {
        const TrackPlayer = await import('react-native-track-player').catch(() => null);
        if (!TrackPlayer) return;

        const { Event } = TrackPlayer;

        TrackPlayer.default.addEventListener(Event.RemoteNext, () => {
            console.log('[TrackPlayerEvents] Remote Next Trigger');
            TrackPlayer.default.skipToNext();
        });

        TrackPlayer.default.addEventListener(Event.RemotePrevious, () => {
            console.log('[TrackPlayerEvents] Remote Prev Trigger');
            TrackPlayer.default.skipToPrevious();
        });

        TrackPlayer.default.addEventListener(Event.RemoteSkip, (event) => {
            console.log('[TrackPlayerEvents] Remote Skip Trigger', event?.index);
            TrackPlayer.default.skip(event.index);
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

        TrackPlayer.default.addEventListener(Event.RemotePlay, () => TrackPlayer.default.play());
        TrackPlayer.default.addEventListener(Event.RemotePause, () => TrackPlayer.default.pause());
        TrackPlayer.default.addEventListener(Event.RemoteStop, () => TrackPlayer.default.stop());
        TrackPlayer.default.addEventListener(Event.AndroidConnectorConnected, (event) => {
            if (event?.isAutomotiveController) {
                console.log('[TrackPlayerEvents] Android Auto connected:', event.package);
            }
        });
    } catch (e) {
        console.log('[TrackPlayerEvents] Error:', e);
    }
};
