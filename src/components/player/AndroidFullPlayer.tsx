import { NativeFullPlayerView, type FullPlayerAction } from '@/modules/player-chrome/src';
import { useDynamicColorsWithOptions, usePlayerColors } from '@/src/hooks';
import { usePlayerLyrics } from '@/src/hooks/usePlayerLyrics';
import { searchTidalArtists } from '@/src/services/tidalService';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useSettingsStore, type SpectrumTheme } from '@/src/stores/settingsStore';
import { useUIStore } from '@/src/stores/uiStore';
import { useTheme, usePerformanceProfile } from '@/src/theme';
import { ensureColorContrast, mixHexColors, pickReadableColor } from '@/src/utils/colorContrast';
import type { LyricsSourceId } from '@/src/services/lyricsSources';
import { StatusBar } from 'expo-status-bar';
import { useContentPathname, useRouter } from '@/src/navigation/navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Share, StyleSheet, useWindowDimensions, type NativeSyntheticEvent } from 'react-native';
import Animated, { Easing, Extrapolation, interpolate, useAnimatedProps, useAnimatedStyle, useEvent, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildPhraseLyricsLines } from './parts/PlayerLyricsLayer';
import { LYRICS_FONT_OPTIONS } from './lyricsFonts';
import { LYRICS_MOTION_OPTIONS } from './lyricsMotionProfiles';
import { getQualityBadge, getTrackTechLabel } from './playerUtils';
import { ANDROID_DOCK_INSET, ANDROID_MINI_OFFSET, ANDROID_MINI_RADIUS, DETAIL_HEIGHT, MINI_HEIGHT, TAB_BAR_HEIGHT, isPlayerDetailRoute } from './playerLayout';

/** Data/service adapter only. The complete Android player scene is rendered by Kotlin. */
export function AndroidFullPlayer() {
    const { theme, config, isDark } = useTheme();
    const profile = usePerformanceProfile();
    const insets = useSafeAreaInsets();
    const window = useWindowDimensions();
    const router = useRouter();
    const pathname = useContentPathname();
    const track = usePlayerStore(s => s.currentTrack);
    const pending = usePlayerStore(s => s.pendingTrackPreview);
    const visible = usePlayerStore(s => s.playerVisible);
    const isPlaying = usePlayerStore(s => s.isPlaying);
    const isLoading = usePlayerStore(s => s.isLoading);
    const shuffle = usePlayerStore(s => s.shuffleEnabled);
    const repeat = usePlayerStore(s => s.repeatMode);
    const queue = usePlayerStore(s => s.queue);
    const queueIndex = usePlayerStore(s => s.queueIndex);
    const position = usePlayerStore(s => s.positionShared);
    const favorite = useLibraryStore(s => track ? !!s.tracks.get(track.id)?.favorite : false);
    const playlists = useLibraryStore(s => s.playlists);
    const spectrumTheme = useSettingsStore(s => s.spectrumTheme);
    const spectrumDelay = useSettingsStore(s => s.spectrumDelayMs);
    const sources = useSettingsStore(s => s.lyricsSources);
    const lyricsFont = useSettingsStore(s => s.lyricsFont);
    const blocked = useUIStore(s => s.actionSheetVisible || s.confirmModalVisible);
    const [lyricsVisible, setLyricsVisible] = useState(false);
    const [refreshNonce, setRefreshNonce] = useState(0);
    const backRequest = 0; // Back is handled by the Kotlin navigation container.
    const artistNavigation = useRef(false);
    const expansion = useSharedValue(0);
    const routeProgress = useSharedValue(isPlayerDetailRoute(pathname) ? 1 : 0);
    useEffect(() => { usePlayerStore.getState().setExpansion(expansion); }, [expansion]);
    useEffect(() => {
        routeProgress.value = withTiming(isPlayerDetailRoute(pathname) ? 1 : 0, {
            duration: 360, easing: Easing.bezier(0.05, 0.7, 0.1, 1),
        });
    }, [pathname, routeProgress]);
    useEffect(() => { if (!visible) setLyricsVisible(false); }, [visible]);

    const artwork = track?.artwork || track?.artworkThumb;
    const { colors: albumColors } = useDynamicColorsWithOptions(artwork, {
        enabled: profile.enableDynamicColors, deepenDarkBackground: true,
    });
    const useThemeColors = !profile.enableDynamicColors;
    const colors = useMemo(() => useThemeColors ? {
        primary: theme.colors.primary, secondary: theme.colors.secondary, background: theme.colors.background,
        text: theme.colors.onSurface, onPrimary: theme.colors.onPrimary, onSurface: theme.colors.onSurface,
        accent: theme.colors.primary, isDark,
    } : albumColors, [useThemeColors, theme.colors, isDark, albumColors]);
    const protectedColors = usePlayerColors({
        themeBackground: theme.colors.background, themePrimary: theme.colors.primary, isDark,
        shouldUseThemePlayerColors: useThemeColors, playerColors: colors, accentColor: colors.primary, textColor: colors.text,
    });
    const onPrimary = pickReadableColor(colors.primary, [colors.onPrimary, theme.colors.onPrimary, '#05070D', '#FFFFFF']);
    const lyricsState = usePlayerLyrics({ visible, currentTrack: track, refreshNonce, nativeTimeline: true });
    const previewLines = useMemo(() => buildPhraseLyricsLines(lyricsState.displayLyrics),
        [lyricsState.displayLyrics]);
    const lyricsDocument = useMemo(() => JSON.stringify({
        lines: lyricsState.displayLyrics?.lyrics ?? [], previewLines,
    }), [lyricsState.displayLyrics, previewLines]);
    const lyricsConfig = useMemo(() => ({
        loading: lyricsState.isLyricsLoading || lyricsState.isDownloadingLrc,
        resolved: lyricsState.hasResolvedLyricsAttempt, hasLyrics: !!lyricsState.displayLyrics?.lyrics.length,
        controlsExpanded: lyricsState.lyricsControlsExpanded, offset: lyricsState.lyricsTimingOffsetMs,
        profile: lyricsState.appliedMotionProfile, motionId: lyricsState.selectedMotionOptionId,
        motionIcon: lyricsState.activeMotionOption?.icon ?? 'water',
        font: lyricsFont, fontLabel: LYRICS_FONT_OPTIONS.find(f => f.id === lyricsFont)?.label ?? 'Clásica',
        choiceIndex: lyricsState.selectedTrackLyricsOptionIndex,
        choiceCount: lyricsState.hasMultipleSyncedLyricsOptions ? lyricsState.trackLyricsOptions.length : 1,
        choiceLabel: lyricsState.activeSyncedLyricsOption?.label ?? '',
        suggestionsVisible: lyricsState.isLyricsSuggestionModalVisible,
        suggestions: lyricsState.suggestedLyricsOptions.map(option => ({
            id: option.id, title: option.trackName ?? option.label, artist: option.artistName ?? track?.artist ?? '', album: option.albumName,
            duration: option.durationSec, provider: option.providerLabel, wordLevel: option.wordLevel,
        })),
    }), [lyricsState.isLyricsLoading, lyricsState.isDownloadingLrc, lyricsState.hasResolvedLyricsAttempt,
        lyricsState.displayLyrics, lyricsState.lyricsControlsExpanded, lyricsState.lyricsTimingOffsetMs,
        lyricsState.appliedMotionProfile, lyricsState.selectedMotionOptionId, lyricsState.activeMotionOption,
        lyricsFont, lyricsState.selectedTrackLyricsOptionIndex, lyricsState.hasMultipleSyncedLyricsOptions,
        lyricsState.trackLyricsOptions.length, lyricsState.activeSyncedLyricsOption,
        lyricsState.isLyricsSuggestionModalVisible, lyricsState.suggestedLyricsOptions, track?.artist]);
    const miniCanPreview = !!pending && (!track || track.id === pending.id ||
        track.source === 'tidal' || track.source === 'tidal_stream' || track.source === 'spotify' || !!track.cloudOnly);
    const miniTrack = miniCanPreview ? pending : track;
    const model = useMemo(() => JSON.stringify({
        track: track ? { id: track.id, title: track.title, artist: track.artist, artwork: artwork ?? '',
            duration: track.duration, tech: getTrackTechLabel(track), quality: getQualityBadge(track).label } : null,
        miniTrack: miniTrack ? { id: miniTrack.id, title: miniTrack.title, artist: miniTrack.artist, artwork: pending?.artwork || artwork || '' } : null,
        miniLoading: miniCanPreview || (isLoading && (track?.source === 'tidal' || track?.source === 'tidal_stream')),
        playing: isPlaying, loading: isLoading, shuffle, repeat, favorite, dark: isDark,
        lite: config.lightweightMode || profile.mode === 'lite',
        effects: !config.lightweightMode && profile.enableAnimatedBackgrounds && profile.mode !== 'lite',
        spectrumTheme, spectrumDelay, sources, lyricsState: lyricsConfig,
        playlists: Array.from(playlists.values()).map(p => ({ id: p.id, name: p.name })),
    }), [track, artwork, pending?.artwork, miniTrack, miniCanPreview, isLoading, isPlaying, shuffle, repeat, favorite, isDark,
        config.lightweightMode, profile.mode, profile.enableAnimatedBackgrounds, spectrumTheme, spectrumDelay, sources, lyricsConfig, playlists]);
    const palette = useMemo(() => ({
        accent: colors.primary, meshAccent: colors.accent, secondary: colors.secondary, text: colors.text, background: colors.background,
        surface: theme.colors.surface, onPrimary, spectrum: protectedColors.protectedSpectrumGlowColor,
        miniFill: theme.colors.primaryContainer,
        miniInk: pickReadableColor(theme.colors.primaryContainer, [theme.colors.onPrimaryContainer, theme.colors.onSurface]),
        miniControl: ensureColorContrast(mixHexColors(theme.colors.onSurface, theme.colors.primary, 0.45), theme.colors.surface, {
            minRatio: 4.5, targetColor: theme.colors.onSurface, fallbackColor: theme.colors.onSurface,
        }),
        lyricsSurface: protectedColors.lyricsBaseSurface, lyricsText: protectedColors.lyricsTextColor,
        lyricsAccent: protectedColors.protectedAccentColor, lyricsHighlight: protectedColors.lyricsHighlightColor,
        lyricsGlow: protectedColors.protectedGlowColor, lyricsSpectrum: protectedColors.protectedSpectrumGlowColor,
        lyricsInactive: protectedColors.protectedInactiveColor, lyricsSecondary: protectedColors.secondaryLyricsTextColor,
        lyricsRail: protectedColors.motionRailBackground, lyricsBorder: protectedColors.motionRailBorder,
        lyricsChrome: protectedColors.chromeSurfaceColor,
    }), [colors, theme.colors, onPrimary, protectedColors]);
    const queueSnapshot = useMemo(() => {
        const index = queueIndex >= 0 && queueIndex < queue.length ? queueIndex : Math.max(0, queue.findIndex(t => t.id === track?.id));
        const revision = JSON.stringify([queueIndex, queue.map(t => t.id)]);
        const item = (i: number) => ({ index: i, id: queue[i].id, title: queue[i].title, artist: queue[i].artist,
            artwork: queue[i].artworkThumb || (queue[i].artwork?.startsWith('data:') ? '' : queue[i].artwork) || '' });
        return { revision, base: index + 1, current: queue[index] ? item(index) : null,
            upcoming: queue.slice(index + 1).map((_, offset) => item(index + offset + 1)) };
    }, [queue, queueIndex, track?.id]);
    const queueJson = useMemo(() => JSON.stringify(queueSnapshot), [queueSnapshot]);
    const detail = isPlayerDetailRoute(pathname);
    const miniBottom = detail ? insets.bottom : TAB_BAR_HEIGHT + insets.bottom + ANDROID_MINI_OFFSET;
    const geometry = useMemo(() => ({ width: window.width, height: window.height, top: insets.top, bottom: insets.bottom,
        miniHeight: detail ? DETAIL_HEIGHT : MINI_HEIGHT, miniBottom, miniRadius: detail ? 0 : ANDROID_MINI_RADIUS,
    }), [window.width, window.height, insets.top, insets.bottom, detail, miniBottom]);
    const onTransition = useEvent<NativeSyntheticEvent<{ progress: number }>>(event => {
        'worklet'; expansion.value = event.progress;
    }, ['onTransition']);
    const animatedProps = useAnimatedProps(() => ({ positionMs: position.value }));
    const frame = useAnimatedStyle(() => {
        const p = expansion.value; const r = routeProgress.value;
        const left = Math.max(ANDROID_DOCK_INSET, insets.left + 8) * (1 - r);
        const right = Math.max(ANDROID_DOCK_INSET, insets.right + 8) * (1 - r);
        const bottom = interpolate(r, [0, 1], [TAB_BAR_HEIGHT + insets.bottom + ANDROID_MINI_OFFSET, insets.bottom]);
        return {
            left: left * (1 - p), width: interpolate(p, [0, 1], [window.width - left - right, window.width]),
            height: interpolate(p, [0, 1], [interpolate(r, [0, 1], [MINI_HEIGHT, DETAIL_HEIGHT]), window.height]),
            bottom: interpolate(p, [0, 0.32, 1], [bottom, 0, 0], Extrapolation.CLAMP),
        };
    }, [window.width, window.height, insets.left, insets.right, insets.bottom]);

    const openArtist = useCallback(async () => {
        const current = usePlayerStore.getState().currentTrack;
        if (!current?.artist?.trim() || artistNavigation.current) return;
        artistNavigation.current = true;
        usePlayerStore.getState().setPlayerVisible(false);
        try {
            let id = current.artistId?.trim() ?? '';
            if (!/^\d+$/.test(id)) {
                const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
                const matches = await searchTidalArtists(current.artist);
                const match = matches.find(a => normalize(a.name) === normalize(current.artist)) ?? matches[0];
                id = match ? String(match.id) : '';
            }
            if (id && pathname !== `/tidal-artist/${id}`) router.navigate({ pathname: '/tidal-artist/[id]', params: { id, name: current.artist } });
        } finally { artistNavigation.current = false; }
    }, [pathname, router]);
    const onAction = useCallback(({ nativeEvent: event }: NativeSyntheticEvent<FullPlayerAction>) => {
        const player = usePlayerStore.getState(); const library = useLibraryStore.getState(); const settings = useSettingsStore.getState();
        const current = player.currentTrack;
        // A queued native action must never operate on a replacement track or stale queue position.
        const trackAction = ['seek', 'favorite', 'artist', 'album', 'share', 'playlistAdd'];
        if (trackAction.includes(event.action) && current?.id !== event.trackId) return;
        const run = async () => {
            switch (event.action) {
                case 'open': player.setPlayerVisible(true); break;
                case 'close': player.setPlayerVisible(false); break;
                case 'toggle': await player.togglePlayPause(); break;
                case 'next': await player.next(); break;
                case 'previous': await player.previous(); break;
                case 'seek': if (Number.isFinite(event.position)) await player.seek(event.position!); break;
                case 'shuffle': player.toggleShuffle(); break;
                case 'repeat': player.cycleRepeatMode(); break;
                case 'favorite': if (current) library.toggleFavorite(current.id); break;
                case 'artist': await openArtist(); break;
                case 'album': if (current?.albumId && current.album) { player.setPlayerVisible(false); router.navigate({ pathname: '/tidal-album/[id]', params: { id: current.albumId, name: current.album } }); } break;
                case 'equalizer': player.setPlayerVisible(false); router.push('/equalizer'); break;
                case 'share': if (current) await Share.share({ message: `Check out ${current.title} by ${current.artist} on StaySound!`, title: 'StaySound Shared Track' }); break;
                case 'playlistAdd': if (current && event.id && library.playlists.has(event.id)) library.addToPlaylist(event.id, current.id); break;
                case 'lyricsState': setLyricsVisible(!!event.visible); break;
                case 'refreshLyrics': setRefreshNonce(n => n + 1); break;
                case 'lyricsOffset': lyricsState.applyLyricsOffsetStep(event.step ?? 0); break;
                case 'lyricsReset': lyricsState.setLyricsTimingOffsetMs(0); break;
                case 'lyricsControls': lyricsState.setLyricsControlsExpanded(previous => !previous); break;
                case 'lyricsVersion': lyricsState.handleCycleSyncedLyricsOption(); break;
                case 'lyricsMotion': if (LYRICS_MOTION_OPTIONS.some(o => o.id === event.id)) lyricsState.setSelectedMotionOptionId(event.id as typeof lyricsState.selectedMotionOptionId); break;
                case 'lyricsFont': { const i = LYRICS_FONT_OPTIONS.findIndex(f => f.id === settings.lyricsFont); settings.setLyricsFont(LYRICS_FONT_OPTIONS[(i + 1) % LYRICS_FONT_OPTIONS.length].id); break; }
                case 'suggestion': if (event.id) lyricsState.handleSelectSuggestedLyrics(event.id); break;
                case 'suggestionClose': lyricsState.dismissLyricsSuggestionModal(); break;
                case 'spectrumTheme': if (['aurora', 'columns', 'caustics', 'refractionVeil'].includes(String(event.value))) settings.setSpectrumTheme(event.value as SpectrumTheme); break;
                case 'spectrumDelay': if (typeof event.value === 'number') settings.setSpectrumDelayMs(event.value); break;
                case 'source': if (event.id) settings.setLyricsSourceEnabled(event.id as LyricsSourceId, !!event.enabled); break;
                case 'queuePlay': case 'queueRemove': case 'queueReorder': {
                    if (event.revision !== JSON.stringify([player.queueIndex, player.queue.map(t => t.id)])) return;
                    if (event.action === 'queueReorder') {
                        if (event.from != null && event.to != null && event.from >= 0 && event.to >= 0 && event.from < queueSnapshot.upcoming.length && event.to < queueSnapshot.upcoming.length)
                            await player.reorderQueue(queueSnapshot.base + event.from, queueSnapshot.base + event.to);
                    } else if (event.index != null && player.queue[event.index]?.id === event.id) {
                        if (event.action === 'queuePlay') await player.skipTo(event.index); else player.removeFromQueue(event.index);
                    }
                    break;
                }
            }
        };
        void run().catch(error => { console.error('[NativeFullPlayer]', error); Alert.alert('StaySound', 'No se pudo completar la acción. Inténtalo de nuevo.'); });
    }, [openArtist, router, lyricsState, queueSnapshot]);
    if (!NativeFullPlayerView || !track) return null;
    return <>
        <StatusBar hidden={visible} animated style="light" />
        <Animated.View style={[styles.root, frame]}>
            <NativeFullPlayerView style={styles.fill} model={model} visible={visible} blocked={blocked}
                layoutConfig={geometry} palette={palette} queue={queueJson} lyrics={lyricsDocument}
                backRequest={backRequest} onAction={onAction} onTransition={onTransition} animatedProps={animatedProps} />
        </Animated.View>
    </>;
}
const styles = StyleSheet.create({ root: { position: 'absolute', zIndex: 10001, overflow: 'hidden' }, fill: { flex: 1 } });
