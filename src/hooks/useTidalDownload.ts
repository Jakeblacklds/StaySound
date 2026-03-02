import * as FileSystem from 'expo-file-system/legacy';
import { useCallback, useMemo, useRef, useState } from 'react';
import { organizeIntoAlbums, organizeIntoArtists } from '../services/metadataService';
import { downloadTidalTrack, isValidAudioFile } from '../services/tidalService';
import { useLibraryStore, useSettingsStore } from '../stores';
import { DownloadState, TidalTrack } from '../types/audio';

const createIdleState = (): DownloadState => ({
    status: 'idle',
    progress: 0,
    updatedAt: Date.now(),
});

export function useTidalDownload() {
    const tracks = useLibraryStore(s => s.tracks);
    const tidalDownloadQuality = useSettingsStore(s => s.tidalDownloadQuality);
    const activeTasksRef = useRef<Map<number, FileSystem.DownloadResumable>>(new Map());
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

    const download = useCallback(async (tidalTrack: TidalTrack, force = false) => {
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
            });

            const state = useLibraryStore.getState();
            const nextTracks = new Map(state.tracks);
            nextTracks.set(downloadedTrack.id, downloadedTrack);

            const allTracks = Array.from(nextTracks.values());
            const albums = organizeIntoAlbums(allTracks);
            const artists = organizeIntoArtists(allTracks, albums);

            useLibraryStore.setState({
                tracks: nextTracks,
                albums,
                artists,
            });

            updateDownload(tidalTrack.id, { status: 'done', progress: 1, error: undefined });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Download failed';
            const cancelled = message.toLowerCase().includes('cancel');

            updateDownload(tidalTrack.id, {
                status: cancelled ? 'idle' : 'error',
                progress: 0,
                error: cancelled ? undefined : message,
            });
        } finally {
            activeTasksRef.current.delete(tidalTrack.id);
        }
    }, [isDownloaded, updateDownload]);

    const cancelDownload = useCallback(async (tidalId: number) => {
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
        const artists = organizeIntoArtists(allTracks, albums);

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
        cancelDownload,
        isDownloaded,
        getDownloadedTrack,
        forgetDownloadedTrack,
    };
}
