import { useTidalDownload } from '@/src/hooks';
import type { DownloadSource, TidalSourceTab } from '@/src/features/tidal/model/tidalScreenTypes';
import { scoreDownloadCandidate } from '@/src/features/tidal/model/tidalScreenUtils';
import {
    SoulseekCompressedFallbackError,
    type SoulseekSearchResult,
} from '@/src/services/soulseekDownloadService';
import {
    createTidalStreamTrack,
    getTidalAlbumDetail,
    isValidAudioFile,
    searchTidal,
    TIDAL_MIRROR_NAMES,
} from '@/src/services/tidalService';
import { useLibraryStore, useNotificationStore, usePlayerStore, useSettingsStore } from '@/src/stores';
import type { TidalTrack } from '@/src/types/audio';
import { useCallback, useMemo, type MutableRefObject } from 'react';
import { Alert } from 'react-native';

const SOULSEEK_FLOW_LOG = '[SoulseekFlow]';

type UseTidalPlaybackActionsOptions = {
    activeSourceTab: TidalSourceTab;
    activeSourceTabRef: MutableRefObject<TidalSourceTab>;
    hasSoulseekCredentials: boolean;
    onRequireSoulseekCredentials: () => void;
};

export function useTidalPlaybackActions({
    activeSourceTab,
    activeSourceTabRef,
    hasSoulseekCredentials,
    onRequireSoulseekCredentials,
}: UseTidalPlaybackActionsOptions) {
    const {
        downloads,
        download,
        downloadFromSoulseek,
        downloadFromSoulseekMatch,
        cancelDownload,
        isDownloaded,
        getDownloadedTrack,
        forgetDownloadedTrack,
    } = useTidalDownload({ qobuzOnly: true });

    const play = usePlayerStore(state => state.play);
    const currentPlayerTrack = usePlayerStore(state => state.currentTrack);
    const pendingTrackPreview = usePlayerStore(state => state.pendingTrackPreview);
    const isPlayerPlaying = usePlayerStore(state => state.isPlaying);
    const setPendingTrackPreview = usePlayerStore(state => state.setPendingTrackPreview);
    const showNotification = useNotificationStore(state => state.showNotification);

    const activeTidalTrackId = useMemo(() => {
        const sourceTrack = pendingTrackPreview ?? currentPlayerTrack;
        if (!sourceTrack) return null;
        if (typeof sourceTrack.tidalId === 'number') return sourceTrack.tidalId;

        const match = sourceTrack.id?.match(/tidal(?:_stream)?_(\d+)/);
        return match ? Number(match[1]) : null;
    }, [currentPlayerTrack, pendingTrackPreview]);

    const handleSoulseekMatchDownload = useCallback(async (
        result: SoulseekSearchResult,
        allowCompressedFallback = false,
    ) => {
        const track = result.track;
        try {
            const state = downloads.get(track.id);
            if (state?.status === 'downloading') {
                await cancelDownload(track.id);
                return;
            }

            await downloadFromSoulseekMatch(track, result.match, { allowCompressedFallback });
            showNotification(`Descarga lista: ${track.title}`, 'success');
        } catch (downloadError) {
            if (downloadError instanceof SoulseekCompressedFallbackError) {
                Alert.alert(
                    'No hay FLAC disponible',
                    'Descargar en calidad comprimida.',
                    [
                        { text: 'Cancelar', style: 'cancel' },
                        {
                            text: 'Descargar',
                            onPress: () => {
                                void handleSoulseekMatchDownload(result, true);
                            },
                        },
                    ],
                );
                return;
            }

            const message = downloadError instanceof Error ? downloadError.message : 'Error en descarga';
            showNotification(message, 'error');
        }
    }, [cancelDownload, downloadFromSoulseekMatch, downloads, showNotification]);

    const handleSoulseekMatchPlay = useCallback(async (result: SoulseekSearchResult) => {
        const track = result.track;

        try {
            const existing = getDownloadedTrack(track.id);
            if (existing) {
                await play(existing, [existing]);
                return;
            }

            await handleSoulseekMatchDownload(result);
            const downloadedTrack = getDownloadedTrack(track.id);
            if (downloadedTrack) {
                await play(downloadedTrack, [downloadedTrack]);
            }
        } catch (playError) {
            const message = playError instanceof Error ? playError.message : 'No se pudo reproducir esta pista';
            showNotification(message, 'error');
        }
    }, [getDownloadedTrack, handleSoulseekMatchDownload, play, showNotification]);

    const handleTidalPlay = useCallback(async (track: TidalTrack) => {
        if (activeSourceTabRef.current === 'soulseek') {
            console.log(`${SOULSEEK_FLOW_LOG} blocked tidal play in soulseek tab`, {
                id: track.id,
                title: track.title,
                artist: track.artist,
            });
            return;
        }

        console.log(`${SOULSEEK_FLOW_LOG} tidal play start`, {
            id: track.id,
            title: track.title,
            artist: track.artist,
            activeSourceRef: activeSourceTabRef.current,
        });
        setPendingTrackPreview({
            id: `tidal_pending_${track.id}`,
            title: track.title,
            artist: track.artist,
            artwork: track.artworkUrl,
            tidalId: track.id,
        });

        try {
            const downloadedTrack = getDownloadedTrack(track.id);
            if (downloadedTrack) {
                const extension = downloadedTrack.uri.split('.').pop()?.toLowerCase() || 'flac';
                const validLocal = await isValidAudioFile(downloadedTrack.uri, extension);
                if (!validLocal) {
                    await forgetDownloadedTrack(track.id);
                    await download(track);

                    const repairedTrack = useLibraryStore.getState().tracks.get(`tidal_${track.id}`);
                    if (!repairedTrack) {
                        throw new Error('Se detecto archivo invalido y no se pudo reparar');
                    }

                    await play(repairedTrack, [repairedTrack]);
                    return;
                }

                await play(downloadedTrack, [downloadedTrack]);
                return;
            }

            try {
                const streamTrack = await createTidalStreamTrack(track, { qobuzOnly: true });
                await play(streamTrack, [streamTrack]);
            } catch (streamError) {
                const message = streamError instanceof Error ? streamError.message : '';
                const requiresPreparation = message.includes('Segmented manifest') || message.includes('not a direct audio file');

                if (!requiresPreparation) {
                    throw streamError;
                }

                Alert.alert('Preparando reproduccion', 'Este track requiere descarga local para reproducirse.');
                await download(track);

                const localTrack = useLibraryStore.getState().tracks.get(`tidal_${track.id}`);
                if (!localTrack) {
                    throw new Error('No se pudo preparar el archivo local');
                }

                await play(localTrack, [localTrack]);
            }
        } catch (playError) {
            setPendingTrackPreview(null);
            const message = playError instanceof Error ? playError.message : 'No se pudo reproducir esta pista';
            showNotification(message, 'error');
        }
    }, [download, forgetDownloadedTrack, getDownloadedTrack, play, setPendingTrackPreview, showNotification]);

    const handleTidalDownload = useCallback(async (track: TidalTrack, source: DownloadSource = 'tidal') => {
        try {
            console.log(`${SOULSEEK_FLOW_LOG} download pressed`, {
                source,
                activeSourceTab,
                activeSourceRef: activeSourceTabRef.current,
                id: track.id,
                title: track.title,
                artist: track.artist,
            });
            const state = downloads.get(track.id);
            if (state?.status === 'downloading') {
                await cancelDownload(track.id);
                return;
            }

            const isSoulseekDownloadSource = source === 'soulseek';
            let resolvedTrack = track;
            if (!isSoulseekDownloadSource) {
                try {
                    let candidates: TidalTrack[] = [];

                    if (track.albumId) {
                        const albumDetail = await getTidalAlbumDetail(track.albumId);
                        candidates = albumDetail.tracks;
                    }

                    if (candidates.length === 0) {
                        candidates = await searchTidal(`${track.artist} ${track.title}`.trim());
                    }

                    if (candidates.length > 0) {
                        const bestMatch = [...candidates]
                            .map(candidate => ({ candidate, score: scoreDownloadCandidate(track, candidate) }))
                            .sort((a, b) => b.score - a.score)[0];

                        if (bestMatch && bestMatch.score >= 55) {
                            resolvedTrack = {
                                ...bestMatch.candidate,
                                artworkUrl: bestMatch.candidate.artworkUrl ?? track.artworkUrl,
                                albumId: bestMatch.candidate.albumId ?? track.albumId,
                                artistId: bestMatch.candidate.artistId ?? track.artistId,
                            };
                        }
                    }
                } catch {
                    resolvedTrack = track;
                }
            }

            const downloadTargetTrack = isSoulseekDownloadSource
                ? {
                    ...resolvedTrack,
                    id: track.id,
                    title: track.title,
                    artist: track.artist,
                    album: track.album || resolvedTrack.album,
                    durationMs: track.durationMs || resolvedTrack.durationMs,
                    artworkUrl: track.artworkUrl ?? resolvedTrack.artworkUrl,
                    artistId: track.artistId ?? resolvedTrack.artistId,
                    albumId: track.albumId ?? resolvedTrack.albumId,
                }
                : resolvedTrack;
            const currentMirror = useSettingsStore.getState().tidalMirror;
            if (isSoulseekDownloadSource) {
                showNotification(`Buscando fuente Soulseek para "${downloadTargetTrack.title}"`, 'info');
            } else if (currentMirror !== 'auto') {
                showNotification(`Bajando desde: ${TIDAL_MIRROR_NAMES[currentMirror] || 'Servidor Manual'}`, 'info');
            } else {
                showNotification(`Iniciando descarga de "${downloadTargetTrack.title}"`, 'info');
            }

            if (isSoulseekDownloadSource) {
                console.log('[TidalScreen] Soulseek download route', {
                    id: downloadTargetTrack.id,
                    title: downloadTargetTrack.title,
                    artist: downloadTargetTrack.artist,
                });
                try {
                    await downloadFromSoulseek(downloadTargetTrack);
                } catch (soulseekError) {
                    if (soulseekError instanceof SoulseekCompressedFallbackError) {
                        Alert.alert(
                            'No hay FLAC',
                            'Soulseek encontro MP3 para esta cancion.',
                            [
                                { text: 'Cancelar', style: 'cancel' },
                                {
                                    text: 'Descargar MP3',
                                    onPress: () => {
                                        void downloadFromSoulseek(downloadTargetTrack, { allowCompressedFallback: true });
                                    },
                                },
                            ],
                        );
                        return;
                    }
                    throw soulseekError;
                }
                return;
            }

            await download(downloadTargetTrack, false, { throwOnError: true });
        } catch (downloadError) {
            const message = downloadError instanceof Error ? downloadError.message : 'Error en descarga';
            showNotification(message, 'error');
        }
    }, [cancelDownload, download, downloadFromSoulseek, downloads, showNotification]);

    const handleSoulseekOnlyDownload = useCallback(async (track: TidalTrack) => {
        if (!hasSoulseekCredentials) {
            onRequireSoulseekCredentials();
            return;
        }

        try {
            console.log(`${SOULSEEK_FLOW_LOG} soulseek-only button pressed`, {
                activeSourceTab,
                activeSourceRef: activeSourceTabRef.current,
                id: track.id,
                title: track.title,
                artist: track.artist,
            });

            const state = downloads.get(track.id);
            if (state?.status === 'downloading') {
                await cancelDownload(track.id);
                return;
            }

            const soulseekTrack = {
                ...track,
                id: track.id,
                title: track.title,
                artist: track.artist,
                album: track.album,
                durationMs: track.durationMs,
                artworkUrl: track.artworkUrl,
                artistId: track.artistId,
                albumId: track.albumId,
            };

            showNotification(`Buscando fuente Soulseek para "${soulseekTrack.title}"`, 'info');
            console.log(`${SOULSEEK_FLOW_LOG} soulseek-only route`, {
                id: soulseekTrack.id,
                title: soulseekTrack.title,
                artist: soulseekTrack.artist,
            });

            try {
                await downloadFromSoulseek(soulseekTrack);
            } catch (soulseekError) {
                if (soulseekError instanceof SoulseekCompressedFallbackError) {
                    Alert.alert(
                        'No hay FLAC',
                        'Soulseek encontro MP3 para esta cancion.',
                        [
                            { text: 'Cancelar', style: 'cancel' },
                            {
                                text: 'Descargar MP3',
                                onPress: () => {
                                    void downloadFromSoulseek(soulseekTrack, { allowCompressedFallback: true });
                                },
                            },
                        ],
                    );
                    return;
                }
                throw soulseekError;
            }
        } catch (downloadError) {
            const message = downloadError instanceof Error ? downloadError.message : 'Error en descarga';
            showNotification(message, 'error');
        }
    }, [activeSourceTab, cancelDownload, downloadFromSoulseek, downloads, hasSoulseekCredentials, onRequireSoulseekCredentials, showNotification]);

    return {
        downloads,
        isDownloaded,
        pendingTrackPreview,
        isPlayerPlaying,
        activeTidalTrackId,
        handleSoulseekMatchDownload,
        handleSoulseekMatchPlay,
        handleTidalPlay,
        handleTidalDownload,
        handleSoulseekOnlyDownload,
    };
}
