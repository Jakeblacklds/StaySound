// Usamos require para evitar problemas de exportación en el servicio de fondo
const { syncInternalCacheHeaders } = require('./cacheHeadersProvider');

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

        // Cambio de canción automático o por UI
        TrackPlayer.default.addEventListener(Event.PlaybackActiveTrackChanged, (event) => {
            if (event.track) {
                console.log('[TrackPlayerEvents] Track Changed Trigger');
                syncInternalCacheHeaders();
            }
        });

        // Eventos estándar
        TrackPlayer.default.addEventListener(Event.RemotePlay, () => TrackPlayer.default.play());
        TrackPlayer.default.addEventListener(Event.RemotePause, () => TrackPlayer.default.pause());
        TrackPlayer.default.addEventListener(Event.RemoteStop, () => TrackPlayer.default.stop());

    } catch (e) {
        console.log('[TrackPlayerEvents] Error:', e);
    }
};

