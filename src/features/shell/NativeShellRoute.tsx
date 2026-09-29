import { NativeShellScreen } from '@/modules/android-shell/src';
import { LyricsRepository } from '@/src/services/lyricsRepository';
import { useSettingsStore } from '@/src/stores/settingsStore';
import { usePlayerStore } from '@/src/stores/playerStore';
import { useTheme } from '@/src/theme';
import type { KaraokeLyricsJSON } from '@/src/types';
import { useIsFocused } from '@/src/navigation/navigation';
import { router } from '@/src/navigation/navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAnimatedProps } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function NativeShellRoute({ kind }: { kind: 'lyrics' | 'modal' }) {
    const track = usePlayerStore(s => s.currentTrack);
    const playing = usePlayerStore(s => s.isPlaying);
    const position = usePlayerStore(s => s.positionShared);
    const lyricsSources = useSettingsStore(s => s.lyricsSources);
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const focused = useIsFocused();
    const [karaoke, setKaraoke] = useState(true);
    const identity = JSON.stringify([track?.id, track?.title, track?.artist]);
    const [result, setResult] = useState<{ identity: string; payload: KaraokeLyricsJSON | null; error?: boolean } | null>(null);
    const closing = useRef(false);
    useEffect(() => { if (focused) closing.current = false; }, [focused]);
    useEffect(() => {
        if (kind !== 'lyrics' || !track?.title || !track.artist) {
            setResult(null);
            return;
        }
        let cancelled = false;
        const loadLyrics = async () => {
            const title = track.title.trim();
            const artist = track.artist.trim();
            const album = track.album?.trim();
            const durationSec = track.duration ? track.duration / 1000 : undefined;
            const trackId = track.id;
            const isrc = (track as { isrc?: string }).isrc;

            try {
                // Keep this native route on the same providers as the Android player and
                // Tauri: Apple TTML/KPoe are the only paths that carry word timestamps.
                const options = await LyricsRepository.getAppleWordLyricsOptions(
                    title, artist, album, durationSec, trackId, isrc, lyricsSources,
                );
                if (cancelled) return;

                const wordTimed = options.find(option => option.isExactMatch)?.payload ?? null;
                if (wordTimed?.lyrics?.length) {
                    setResult({ identity, payload: wordTimed });
                    return;
                }

                // The legacy native repository is cache-only (its remote data source is
                // intentionally a no-op), but retain it for entries created by older APKs.
                const legacy = await LyricsRepository.getLyrics(title, artist);
                if (cancelled) return;
                if (legacy?.lyrics?.length) {
                    setResult({ identity, payload: legacy });
                    return;
                }

                // LRCLIB remains the line-level fallback and is only queried when the
                // user has enabled it in Settings.
                const fallback = lyricsSources.includes('lrclib')
                    ? await LyricsRepository.getLrcLibLyrics(title, artist, durationSec, trackId)
                    : null;
                if (!cancelled) setResult({ identity, payload: fallback });
            } catch {
                if (!cancelled) setResult({ identity, payload: null, error: true });
            }
        };
        void loadLyrics();
        return () => { cancelled = true; };
    }, [kind, identity, lyricsSources, track?.album, track?.artist, track?.duration, track?.id, track?.title]);
    const resolved = result?.identity === identity;
    const payload = resolved ? result.payload : null;
    const loading = kind === 'lyrics' && !!track?.title && !!track.artist && !resolved;
    const id = kind === 'lyrics' ? identity : 'modal';
    const model = useMemo(() => JSON.stringify({
        kind, id, title: kind === 'lyrics' ? track?.title || 'Lyrics' : 'StaySound',
        artist: track?.artist || 'Unknown Artist', playing, karaoke, loading,
        hasLyrics: !!payload?.lyrics.length, offset: payload?.meta.offset || 0,
        message: resolved && result?.error ? 'No se pudieron cargar las letras.' : 'No hay lyrics para esta cancion',
        colors: theme.colors,
    }), [kind, id, track?.title, track?.artist, playing, karaoke, loading, payload, resolved, result?.error, theme.colors]);
    const lyrics = useMemo(() => JSON.stringify(payload?.lyrics || []), [payload]);
    const animatedProps = useAnimatedProps(() => ({ positionMs: position.value }));
    return NativeShellScreen ? <NativeShellScreen style={{ flex: 1 }} model={model} lyrics={lyrics}
        active={focused} topInset={insets.top} bottomInset={insets.bottom} animatedProps={animatedProps}
        onAction={({ nativeEvent: event }) => {
            if (!focused || closing.current || event.id !== id || event.kind !== kind) return;
            if (event.action === 'back') {
                closing.current = true;
                if (router.canGoBack()) router.back(); else router.replace('/');
            } else if (event.action === 'mode') setKaraoke(value => !value);
            else if (event.action === 'seek' && Number.isFinite(event.position)
                && JSON.stringify([usePlayerStore.getState().currentTrack?.id, usePlayerStore.getState().currentTrack?.title,
                    usePlayerStore.getState().currentTrack?.artist]) === identity) {
                void usePlayerStore.getState().seek(Math.max(0, event.position! - (payload?.meta.offset || 0)));
            }
        }} /> : null;
}
