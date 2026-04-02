// Usamos require para evitar problemas de exportacion en el servicio de fondo
const { syncInternalCacheHeaders } = require('./cacheHeadersProvider');
const { playFromMediaId, playFromSearch } = require('./androidAutoService');

module.exports = async function () {
    try {
        const TrackPlayer = await import('react-native-track-player').catch(() => null);
        if (!TrackPlayer) return;

        const { Event } = TrackPlayer;

        // Disparo inicial al arrancar el servicio
        syncInternalCacheHeaders();

        // Remote next button pressed
        TrackPlayer.default.addEventListener(Event.RemoteNext, () => {
            console.log('[TrackPlayerEvents] Remote Next Trigger');
            syncInternalCacheHeaders();
            TrackPlayer.default.skipToNext();
        });

        // Remote previous
        TrackPlayer.default.addEventListener(Event.RemotePrevious, () => {
            console.log('[TrackPlayerEvents] Remote Prev Trigger');
            syncInternalCacheHeaders();
            TrackPlayer.default.skipToPrevious();
        });

        TrackPlayer.default.addEventListener(Event.RemoteSkip, (event) => {
            console.log('[TrackPlayerEvents] Remote Skip Trigger', event?.index);
            syncInternalCacheHeaders();
            TrackPlayer.default.skip(event.index);
        });

        TrackPlayer.default.addEventListener(Event.RemotePlayId, async (event) => {
            console.log('[TrackPlayerEvents] Remote Play ID Trigger', event?.id);
            syncInternalCacheHeaders();

            const handled = await playFromMediaId(event?.id);
            if (!handled) {
                console.warn('[TrackPlayerEvents] Remote Play ID fallback: mediaId not found', event?.id);
            }
        });

        TrackPlayer.default.addEventListener(Event.RemotePlaySearch, async (event) => {
            console.log('[TrackPlayerEvents] Remote Play Search Trigger', event?.query);
            syncInternalCacheHeaders();

            const handled = await playFromSearch(event);
            if (!handled) {
                console.warn('[TrackPlayerEvents] Remote Play Search fallback: no matching result', event?.query);
            }
        });

        // Cambio de cancion automatico o por UI
        TrackPlayer.default.addEventListener(Event.PlaybackActiveTrackChanged, (event) => {
            if (event.track) {
                console.log('[TrackPlayerEvents] Track Changed Trigger');
                syncInternalCacheHeaders();
            }
        });

        // Eventos estandar
        TrackPlayer.default.addEventListener(Event.RemotePlay, () => TrackPlayer.default.play());
        TrackPlayer.default.addEventListener(Event.RemotePause, () => TrackPlayer.default.pause());
        TrackPlayer.default.addEventListener(Event.RemoteStop, () => TrackPlayer.default.stop());
        TrackPlayer.default.addEventListener(Event.AndroidConnectorConnected, (event) => {
            if (event?.isAutomotiveController) {
                console.log('[TrackPlayerEvents] Android Auto connected:', event.package);
                syncInternalCacheHeaders();
            }
        });

    } catch (e) {
        console.log('[TrackPlayerEvents] Error:', e);
    }
};
