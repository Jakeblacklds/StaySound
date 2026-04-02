import { createTidalStreamTrack, searchTidal } from './tidalService';
import { TidalTrack, Track } from '../types/audio';
import { usePlayerStore } from '../stores/playerStore';
import { isSpotifyRemoteTrack } from './spotifyChartsService';

const DURATION_TOLERANCE_MS = 4_000;

function normalizeText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function scoreCandidate(remoteTrack: Track, candidate: TidalTrack): number {
    let score = 0;

    if (remoteTrack.isrc && candidate.id && remoteTrack.isrc === (candidate as any).isrc) {
        score += 100;
    }

    const remoteTitle = normalizeText(remoteTrack.title);
    const remoteArtist = normalizeText(remoteTrack.artist);
    const remoteAlbum = normalizeText(remoteTrack.album);
    const candidateTitle = normalizeText(candidate.title);
    const candidateArtist = normalizeText(candidate.artist);
    const candidateAlbum = normalizeText(candidate.album);

    if (remoteTitle === candidateTitle) score += 50;
    else if (candidateTitle.includes(remoteTitle) || remoteTitle.includes(candidateTitle)) score += 25;

    if (remoteArtist === candidateArtist) score += 40;
    else if (candidateArtist.includes(remoteArtist) || remoteArtist.includes(candidateArtist)) score += 20;

    if (remoteAlbum && candidateAlbum === remoteAlbum) score += 12;

    if (remoteTrack.duration > 0 && candidate.durationMs > 0) {
        const delta = Math.abs(remoteTrack.duration - candidate.durationMs);
        if (delta <= 1200) score += 24;
        else if (delta <= DURATION_TOLERANCE_MS) score += 12;
    }

    return score;
}

async function resolveSpotifyTrackMatch(remoteTrack: Track): Promise<TidalTrack> {
    const searchTerms = [
        `${remoteTrack.artist} ${remoteTrack.title}`,
        `${remoteTrack.title} ${remoteTrack.artist}`,
        remoteTrack.title,
    ];

    let candidates: TidalTrack[] = [];
    for (const term of searchTerms) {
        const result = await searchTidal(term);
        if (result.length > 0) {
            candidates = result;
            break;
        }
    }

    if (candidates.length === 0) {
        throw new Error('No encontramos una fuente reproducible para este track en el mirror actual.');
    }

    const bestMatch = [...candidates]
        .map(candidate => ({ candidate, score: scoreCandidate(remoteTrack, candidate) }))
        .sort((a, b) => b.score - a.score)[0];

    if (!bestMatch || bestMatch.score < 45) {
        throw new Error('No hubo un match confiable para reproducir este track desde el mirror actual.');
    }

    return bestMatch.candidate;
}

async function resolveSpotifyTrack(remoteTrack: Track): Promise<Track> {
    const matchedTrack = await resolveSpotifyTrackMatch(remoteTrack);
    const streamTrack = await createTidalStreamTrack(matchedTrack);
    return {
        ...streamTrack,
        title: remoteTrack.title,
        artist: remoteTrack.artist,
        album: remoteTrack.album,
        artwork: remoteTrack.artwork || streamTrack.artwork,
        spotifyId: remoteTrack.spotifyId,
        spotifyUri: remoteTrack.spotifyUri,
        spotifyUrl: remoteTrack.spotifyUrl,
        isrc: remoteTrack.isrc,
    };
}

function toTidalTrackPayload(track: Track): TidalTrack | null {
    if (!track.tidalId) return null;
    return {
        id: track.tidalId,
        title: track.title,
        artist: track.artist,
        album: track.album,
        durationMs: track.duration,
        quality: track.quality || 'LOSSLESS',
        isHiRes: (track.quality || '').toUpperCase().includes('HI_RES'),
        artworkUrl: track.artwork,
        trackNumber: track.trackNumber,
        year: track.year,
        sampleRate: track.sampleRate,
        bitDepth: track.bitDepth,
        codec: track.codec,
        albumId: track.tidalAlbumId,
    };
}

export async function resolveRemoteTrackForPlayback(track: Track): Promise<Track> {
    if (!track.cloudOnly) {
        return track;
    }

    if (isSpotifyRemoteTrack(track)) {
        return await resolveSpotifyTrack(track);
    }

    if (track.source === 'tidal_stream' && /^https?:\/\//i.test(track.uri)) {
        return track;
    }

    const tidalPayload = toTidalTrackPayload(track);
    if (tidalPayload) {
        return await createTidalStreamTrack(tidalPayload);
    }

    return track;
}

export async function resolveRemoteTrackForDownload(track: Track): Promise<TidalTrack> {
    if (isSpotifyRemoteTrack(track)) {
        return await resolveSpotifyTrackMatch(track);
    }

    if (track.tidalId) {
        return {
            id: track.tidalId,
            title: track.title,
            artist: track.artist,
            album: track.album,
            durationMs: track.duration,
            quality: track.quality || 'LOSSLESS',
            isHiRes: (track.quality || '').toUpperCase().includes('HI_RES'),
            artworkUrl: track.artwork,
            trackNumber: track.trackNumber,
            year: track.year,
            sampleRate: track.sampleRate,
            bitDepth: track.bitDepth,
            codec: track.codec,
            albumId: track.tidalAlbumId,
        };
    }

    throw new Error('No se pudo resolver una descarga para este track.');
}

export async function playResolvedRemoteTrack(track: Track, queue?: Track[]) {
    const setPendingTrackPreview = usePlayerStore.getState().setPendingTrackPreview;
    const play = usePlayerStore.getState().play;

    setPendingTrackPreview({
        id: track.id,
        title: track.title,
        artist: track.artist,
        artwork: track.artwork,
    });

    try {
        if (!queue || queue.length === 0) {
            const resolved = await resolveRemoteTrackForPlayback(track);
            await play(resolved, [resolved]);
            return;
        }

        const resolvedQueue: Track[] = [];
        let resolvedCurrentTrack: Track | null = null;
        for (const item of queue) {
            try {
                const resolved = await resolveRemoteTrackForPlayback(item);
                resolvedQueue.push(resolved);
                if (item.id === track.id) {
                    resolvedCurrentTrack = resolved;
                }
            } catch (error) {
                if (item.id === track.id) {
                    throw error;
                }
            }
        }

        if (!resolvedCurrentTrack || resolvedQueue.length === 0) {
            throw new Error('No se pudo preparar una cola reproducible desde el mirror actual.');
        }

        const startIndex = Math.max(0, resolvedQueue.findIndex(item => item.id === resolvedCurrentTrack?.id));
        await play(resolvedQueue[startIndex] ?? resolvedCurrentTrack, resolvedQueue);
    } finally {
        setPendingTrackPreview(null);
    }
}
