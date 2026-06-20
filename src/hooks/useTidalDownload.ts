import * as FileSystem from 'expo-file-system/legacy';
import { useCallback, useMemo, useRef, useState } from 'react';
import { extractMetadata, withTimeout } from '../services/fileScanner';
import { enrichTrackFromUri, organizeIntoAlbums, organizeIntoArtists } from '../services/metadataService';
import { downloadSoulseekTrack, downloadSoulseekTrackFromMatch, SoulseekTrackMatch } from '../services/soulseekDownloadService';
import { downloadTidalTrack, isValidAudioFile } from '../services/tidalService';
import { useLibraryStore, useSettingsStore } from '../stores';
import { DownloadState, TidalTrack, Track } from '../types/audio';

const createIdleState = (): DownloadState => ({
    status: 'idle',
    progress: 0,
    updatedAt: Date.now(),
});

const SOULSEEK_FLOW_LOG = '[SoulseekFlow]';

function pickMetadataText(candidate: string | undefined, fallback: string): string {
    const trimmed = candidate?.trim();
    if (!trimmed) return fallback;

    const normalized = trimmed.toLowerCase();
    if (
        normalized === 'unknown'
        || normalized === 'unknown title'
        || normalized === 'unknown artist'
        || normalized === 'unknown album'
    ) {
        return fallback;
    }

    return trimmed;
}

export function useTidalDownload(
    config: { qobuzFallback?: boolean; qobuzOnly?: boolean } = {},
) {
    const tracks = useLibraryStore(s => s.tracks);
    const tidalDownloadQuality = useSettingsStore(s => s.tidalDownloadQuality);
    const activeTasksRef = useRef<Map<number, FileSystem.DownloadResumable>>(new Map());
    const activeSoulseekTasksRef = useRef<Map<number, AbortController>>(new Map());
    const [downloads, setDownloads] = useState<Map<number, DownloadState>>(new Map());

    const updateDownload = useCallback((tidalId: number, partial: Partial<DownloadState>) => {
        setDownloads(prev => {
            const next = new Map(prev);
            const current = next.get(tidalId) ?? createIdleState();
            next.set(tidalId, {
                ...current,
                ...partial,
                updatedAt: Date.now(),
            });
            return next;
        });
    }, []);

    const isDownloaded = useCallback((tidalId: number): boolean => {
        const existing = tracks.get(`tidal_${tidalId}`);
        return !!existing;
    }, [tracks]);

    const getDownloadedTrack = useCallback((tidalId: number) => {
        return tracks.get(`tidal_${tidalId}`) ?? null;
    }, [tracks]);

    const persistDownloadedTrack = useCallback((downloadedTrack: Track) => {
        const state = useLibraryStore.getState();
        const nextTracks = new Map(state.tracks);
        nextTracks.set(downloadedTrack.id, downloadedTrack);

        const allTracks = Array.from(nextTracks.values());
        const albums = organizeIntoAlbums(allTracks);
        const artists = organizeIntoArtists(allTracks, albums, state.artists);

        useLibraryStore.setState({
            tracks: nextTracks,
            albums,
            artists,
        });
    }, []);

    const enrichSoulseekDownloadedTrack = useCallback(async (downloadedTrack: Track): Promise<Track> => {
        const trackWithPathHints = enrichTrackFromUri(downloadedTrack, downloadedTrack.uri);
        try {
            const metadata = await withTimeout(extractMetadata(trackWithPathHints.uri), 4500);

            if (!metadata) {
                return trackWithPathHints;
            }

            return {
                ...trackWithPathHints,
                title: pickMetadataText(metadata.title, trackWithPathHints.title),
                artist: pickMetadataText(metadata.artist, trackWithPathHints.artist),
                album: pickMetadataText(metadata.album, trackWithPathHints.album),
                artwork: metadata.artwork || trackWithPathHints.artwork,
                trackNumber: metadata.trackNumber ?? trackWithPathHints.trackNumber,
                year: metadata.year ?? trackWithPathHints.year,
                genre: metadata.genre ?? trackWithPathHints.genre,
                format: metadata.format || trackWithPathHints.format,
                sampleRate: metadata.sampleRate ?? trackWithPathHints.sampleRate,
                bitDepth: metadata.bitDepth ?? trackWithPathHints.bitDepth,
            };
        } catch {
            return trackWithPathHints;
        }
    }, []);

    const download = useCallback(async (
        tidalTrack: TidalTrack,
        force = false,
        options: { throwOnError?: boolean } = {},
    ) => {
        const existing = tracks.get(`tidal_${tidalTrack.id}`);
        if (existing && !force) {
            const info = await FileSystem.getInfoAsync(existing.uri);
            const extension = existing.uri.split('.').pop()?.toLowerCase() || 'flac';
            if (info.exists && info.size > 0 && (await isValidAudioFile(existing.uri, extension))) {
                updateDownload(tidalTrack.id, { status: 'done', progress: 1, error: undefined });
                return;
            }
            // If it's 0B or invalid, we continue to download (effectively redownloading/repairing)
        }

        updateDownload(tidalTrack.id, { status: 'downloading', progress: 0, error: undefined });

        try {
            const downloadedTrack = await downloadTidalTrack(tidalTrack, tidalDownloadQuality, {
                onProgress: progress => {
                    updateDownload(tidalTrack.id, {
                        status: 'downloading',
                        progress,
                        error: undefined,
                    });
                },
                onTask: task => {
                    if (task) {
                        activeTasksRef.current.set(tidalTrack.id, task);
                        return;
                    }
                    activeTasksRef.current.delete(tidalTrack.id);
                },
                qobuzFallback: config.qobuzFallback,
                qobuzOnly: config.qobuzOnly,
            });

            persistDownloadedTrack(downloadedTrack);

            updateDownload(tidalTrack.id, { status: 'done', progress: 1, error: undefined });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Download failed';
            const cancelled = message.toLowerCase().includes('cancel');

            updateDownload(tidalTrack.id, {
                status: cancelled ? 'idle' : 'error',
                progress: 0,
                error: cancelled ? undefined : message,
            });
            if (options.throwOnError) {
                throw error;
            }
        } finally {
            activeTasksRef.current.delete(tidalTrack.id);
        }
    }, [persistDownloadedTrack, tracks, tidalDownloadQuality, updateDownload]);

    const downloadFromSoulseek = useCallback(async (
        tidalTrack: TidalTrack,
        options: { allowCompressedFallback?: boolean; force?: boolean } = {},
    ) => {
        console.log(`${SOULSEEK_FLOW_LOG} hook downloadFromSoulseek start`, {
            id: tidalTrack.id,
            title: tidalTrack.title,
            artist: tidalTrack.artist,
            quality: tidalDownloadQuality,
            allowCompressedFallback: Boolean(options.allowCompressedFallback),
            force: Boolean(options.force),
        });
        const existing = tracks.get(`tidal_${tidalTrack.id}`);
        if (existing && !options.force) {
            const info = await FileSystem.getInfoAsync(existing.uri);
            const extension = existing.uri.split('.').pop()?.toLowerCase() || 'flac';
            if (info.exists && info.size > 0 && (await isValidAudioFile(existing.uri, extension))) {
                console.log(`${SOULSEEK_FLOW_LOG} hook downloadFromSoulseek existing valid`, {
                    id: tidalTrack.id,
                    uri: existing.uri,
                    extension,
                    size: info.size,
                });
                updateDownload(tidalTrack.id, { status: 'done', progress: 1, error: undefined });
                return;
            }
        }

        const controller = new AbortController();
        activeSoulseekTasksRef.current.set(tidalTrack.id, controller);
        updateDownload(tidalTrack.id, { status: 'downloading', progress: 0.01, error: undefined });

        try {
            const downloadedTrack = await downloadSoulseekTrack(tidalTrack, tidalDownloadQuality, {
                allowCompressedFallback: options.allowCompressedFallback,
                signal: controller.signal,
                onProgress: progress => {
                    updateDownload(tidalTrack.id, {
                        status: 'downloading',
                        progress,
                        error: undefined,
                    });
                },
            });

            const enrichedTrack = await enrichSoulseekDownloadedTrack(downloadedTrack);
            persistDownloadedTrack(enrichedTrack);
            updateDownload(tidalTrack.id, { status: 'done', progress: 1, error: undefined });
            console.log(`${SOULSEEK_FLOW_LOG} hook downloadFromSoulseek done`, {
                id: tidalTrack.id,
                uri: enrichedTrack.uri,
                format: enrichedTrack.format,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Download failed';
            const cancelled = message.toLowerCase().includes('cancel');
            console.log(`${SOULSEEK_FLOW_LOG} hook downloadFromSoulseek error`, {
                id: tidalTrack.id,
                message,
            });

            updateDownload(tidalTrack.id, {
                status: cancelled ? 'idle' : 'error',
                progress: 0,
                error: cancelled ? undefined : message,
            });
            throw error;
        } finally {
            activeSoulseekTasksRef.current.delete(tidalTrack.id);
        }
    }, [enrichSoulseekDownloadedTrack, persistDownloadedTrack, tracks, tidalDownloadQuality, updateDownload]);

    const downloadFromSoulseekMatch = useCallback(async (
        tidalTrack: TidalTrack,
        match: SoulseekTrackMatch,
        options: { allowCompressedFallback?: boolean; force?: boolean } = {},
    ) => {
        const existing = tracks.get(`tidal_${tidalTrack.id}`);
        if (existing && !options.force) {
            const info = await FileSystem.getInfoAsync(existing.uri);
            const extension = existing.uri.split('.').pop()?.toLowerCase() || 'flac';
            if (info.exists && info.size > 0 && (await isValidAudioFile(existing.uri, extension))) {
                updateDownload(tidalTrack.id, { status: 'done', progress: 1, error: undefined });
                return;
            }
        }

        const controller = new AbortController();
        activeSoulseekTasksRef.current.set(tidalTrack.id, controller);
        updateDownload(tidalTrack.id, { status: 'downloading', progress: 0.01, error: undefined });

        try {
            const downloadedTrack = await downloadSoulseekTrackFromMatch(tidalTrack, tidalDownloadQuality, match, {
                allowCompressedFallback: options.allowCompressedFallback,
                signal: controller.signal,
                onProgress: progress => {
                    updateDownload(tidalTrack.id, {
                        status: 'downloading',
                        progress,
                        error: undefined,
                    });
                },
            });

            const enrichedTrack = await enrichSoulseekDownloadedTrack(downloadedTrack);
            persistDownloadedTrack(enrichedTrack);
            updateDownload(tidalTrack.id, { status: 'done', progress: 1, error: undefined });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Download failed';
            const cancelled = message.toLowerCase().includes('cancel');

            updateDownload(tidalTrack.id, {
                status: cancelled ? 'idle' : 'error',
                progress: 0,
                error: cancelled ? undefined : message,
            });
            throw error;
        } finally {
            activeSoulseekTasksRef.current.delete(tidalTrack.id);
        }
    }, [enrichSoulseekDownloadedTrack, persistDownloadedTrack, tracks, tidalDownloadQuality, updateDownload]);

    const cancelDownload = useCallback(async (tidalId: number) => {
        const soulseekTask = activeSoulseekTasksRef.current.get(tidalId);
        if (soulseekTask) {
            soulseekTask.abort();
            activeSoulseekTasksRef.current.delete(tidalId);
            updateDownload(tidalId, { status: 'idle', progress: 0, error: undefined });
            return;
        }

        const task = activeTasksRef.current.get(tidalId);
        if (!task) return;

        try {
            await task.cancelAsync();
        } catch {
            // no-op
        }

        activeTasksRef.current.delete(tidalId);
        updateDownload(tidalId, { status: 'idle', progress: 0, error: undefined });
    }, [updateDownload]);

    const forgetDownloadedTrack = useCallback(async (tidalId: number) => {
        const store = useLibraryStore.getState();
        const key = `tidal_${tidalId}`;
        const existing = store.tracks.get(key);

        if (existing?.uri) {
            try {
                await FileSystem.deleteAsync(existing.uri, { idempotent: true });
            } catch {
                // no-op
            }
        }

        if (!store.tracks.has(key)) return;

        const nextTracks = new Map(store.tracks);
        nextTracks.delete(key);
        const allTracks = Array.from(nextTracks.values());
        const albums = organizeIntoAlbums(allTracks);
        const artists = organizeIntoArtists(allTracks, albums, store.artists);

        useLibraryStore.setState({
            tracks: nextTracks,
            albums,
            artists,
        });
    }, []);

    const downloadsSnapshot = useMemo(() => downloads, [downloads]);

    return {
        downloads: downloadsSnapshot,
        download,
        downloadFromSoulseek,
        downloadFromSoulseekMatch,
        cancelDownload,
        isDownloaded,
        getDownloadedTrack,
        forgetDownloadedTrack,
    };
}
