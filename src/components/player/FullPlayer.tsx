/**
 * FullPlayer - Material 3 Expressive Container Transform Player
 *
 * Optimized & Scalable Version
 */

import { useDynamicColorsWithOptions } from '@/src/hooks';
import type { AlbumColors } from '@/src/services/colorExtractor';
import { LyricsRepository } from '@/src/services';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useAnimatedColors, usePerformanceProfile, useTheme } from '@/src/theme';
import { ensureColorContrast, mixHexColors, withAlpha } from '@/src/utils/colorContrast';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { usePathname } from 'expo-router';
import { KaraokeView } from 'karaoke-view';
import React, { useCallback, useState } from 'react';
import { BackHandler, Dimensions, Pressable, StyleSheet, View, processColor } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Button, IconButton, Text } from 'react-native-paper';
import Animated, {
    Easing,
    Extrapolation,
    interpolate,
    runOnJS,
    useAnimatedReaction,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KaraokeLyricsJSON } from '@/src/types/karaokeTypes';
import { Track } from '@/src/types/audio';
import { IconName, LyricsSkeleton } from '../ui';
import { ThemeBackground } from './backgrounds/ThemeBackground';
import { QueueOverlay } from './parts/QueueOverlay';
import { SharedPlayerShell } from './SharedPlayerShell';
import {
    DETAIL_EXTRA_BOTTOM,
    DETAIL_HEIGHT,
    MINI_ARTWORK_LEFT,
    MINI_ARTWORK_SIZE,
    MINI_GAP_FROM_TAB,
    MINI_HEIGHT,
    MINI_MARGIN,
    TAB_BAR_FLOAT_OFFSET,
    TAB_BAR_HEIGHT,
    isPlayerDetailRoute,
} from './playerLayout';
import { playerStyles as styles } from './playerStyles';
import { getContrastingInk, getQualityBadge, getTrackTechLabel } from './playerUtils';
import { ImmersiveVariant } from './variants/ImmersiveVariant';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const M3_EMPHASIZED = Easing.bezier(0.2, 0.0, 0, 1.0);
const M3_EMPHASIZED_ACCEL = Easing.bezier(0.3, 0.0, 0.8, 0.15);
const M3_EMPHASIZED_DECEL = Easing.bezier(0.05, 0.7, 0.1, 1.0);

const M3_SNAP_SPRING = {
    damping: 26,
    stiffness: 340,
    mass: 0.5,
    restDisplacementThreshold: 0.01,
    restSpeedThreshold: 2,
};

const EXPAND_DURATION = 400;
const COLLAPSE_DURATION = 320;

function parsePlayerHexColor(value?: string) {
    if (!value) return null;
    const hex = value.trim().replace('#', '');
    if (hex.length < 6) return null;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b };
}

function mixPlayerHexColors(from: string, to: string, amount: number) {
    const source = parsePlayerHexColor(from);
    const target = parsePlayerHexColor(to);
    if (!source || !target) return from;
    const t = Math.max(0, Math.min(1, amount));
    const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
    return `#${channel(source.r + (target.r - source.r) * t)}${channel(source.g + (target.g - source.g) * t)}${channel(source.b + (target.b - source.b) * t)}`;
}

function getPlayerChannelSpread(color?: string) {
    const parsed = parsePlayerHexColor(color);
    if (!parsed) return 255;
    return Math.max(parsed.r, parsed.g, parsed.b) - Math.min(parsed.r, parsed.g, parsed.b);
}

function getProtectedDynamicAccent(accentColor: string, fallbackColor: string) {
    const spread = getPlayerChannelSpread(accentColor);
    if (spread >= 28) {
        return accentColor;
    }

    return mixPlayerHexColors(accentColor, fallbackColor, 0.42);
}

type PlayerQueueOverlayLayerProps = {
    visible: boolean;
    currentTrackId: string;
    accentColor: string;
    textColor: string;
    backgroundColor: string;
    animStyle: any;
    onClose: () => void;
};

type PlayerLyricsLayerProps = {
    visible: boolean;
    expanded: boolean;
    currentTrack: Track | null;
    accentColor: string;
    textColor: string;
    colors: AlbumColors;
    animColors?: any;
    isPlaying: boolean;
    animStyle: any;
    onClose: () => void;
    seek: (positionMs: number) => Promise<void>;
};

const PlayerQueueOverlayLayer = React.memo(function PlayerQueueOverlayLayer({
    visible,
    currentTrackId,
    accentColor,
    textColor,
    backgroundColor,
    animStyle,
    onClose,
}: PlayerQueueOverlayLayerProps) {
    const queue = usePlayerStore(state => state.queue);
    const skipTo = usePlayerStore(state => state.skipTo);
    const removeFromQueue = usePlayerStore(state => state.removeFromQueue);
    const [queueDraft, setQueueDraft] = useState(queue);
    const [visibleCount, setVisibleCount] = useState(25);

    React.useEffect(() => {
        if (visible) {
            setQueueDraft(queue);
            setVisibleCount(25);
        }
    }, [queue, visible]);

    const paginatedQueue = React.useMemo(() => queueDraft.slice(0, visibleCount), [queueDraft, visibleCount]);
    const loadMoreQueue = useCallback(() => {
        if (visibleCount < queueDraft.length) {
            setVisibleCount(prev => Math.min(prev + 25, queueDraft.length));
        }
    }, [queueDraft.length, visibleCount]);

    const handleQueueDragEnd = useCallback(({ data }: { data: Track[] }) => {
        const fullQueue = [...queueDraft];
        fullQueue.splice(0, data.length, ...data);
        const newIndex = fullQueue.findIndex(track => track.id === currentTrackId);
        if (newIndex < 0) return;
        setQueueDraft(fullQueue);
        usePlayerStore.setState({ queue: fullQueue, queueIndex: newIndex });
    }, [currentTrackId, queueDraft]);

    const handleTrackPress = useCallback((idx: number) => {
        void skipTo(idx);
        onClose();
    }, [onClose, skipTo]);

    if (!visible) {
        return null;
    }

    return (
        <QueueOverlay
            queue={paginatedQueue}
            currentTrackId={currentTrackId}
            accentColor={accentColor}
            textColor={textColor}
            backgroundColor={backgroundColor}
            animStyle={animStyle}
            onClose={onClose}
            onTrackPress={handleTrackPress}
            onRemove={removeFromQueue}
            onDragEnd={handleQueueDragEnd}
            loadMore={loadMoreQueue}
        />
    );
});

const PlayerLyricsLayer = React.memo(function PlayerLyricsLayer({
    visible,
    expanded,
    currentTrack,
    accentColor,
    textColor,
    colors,
    animColors,
    isPlaying,
    animStyle,
    onClose,
    seek,
}: PlayerLyricsLayerProps) {
    const { isDark, theme } = useTheme();
    const performanceProfile = usePerformanceProfile();
    const currentTrackId = currentTrack?.id ?? null;
    const positionShared = usePlayerStore(state => state.positionShared);
    const libraryLyricsTrack = useLibraryStore(state =>
        currentTrackId ? state.tracks.get(currentTrackId) ?? null : null
    );
    const [lyricsMode, setLyricsMode] = useState<'synced' | 'lrc'>('synced');
    const [trackLyrics, setTrackLyrics] = useState<KaraokeLyricsJSON | null>(null);
    const [lrcLyrics, setLrcLyrics] = useState<KaraokeLyricsJSON | null>(null);
    const [isLyricsLoading, setIsLyricsLoading] = useState(false);
    const [isDownloadingLrc, setIsDownloadingLrc] = useState(false);
    const [lrcError, setLrcError] = useState<string | null>(null);
    const [hasResolvedLyricsAttempt, setHasResolvedLyricsAttempt] = useState(false);
    const [nativePositionMs, setNativePositionMs] = useState(0);
    const lyricsRequestIdRef = React.useRef(0);
    const resetLyricsState = useCallback(() => {
        setTrackLyrics(null);
        setLrcLyrics(null);
        setLyricsMode('synced');
        setIsLyricsLoading(false);
        setIsDownloadingLrc(false);
        setLrcError(null);
        setHasResolvedLyricsAttempt(false);
        setNativePositionMs(0);
    }, []);

    const hasMeaningfulLyricsValue = useCallback((value?: string | null) => {
        const normalized = value?.trim().toLowerCase();
        return !!normalized && normalized !== 'unknown' && normalized !== 'unknown title' && normalized !== 'unknown artist';
    }, []);

    const lyricsLookupTrack = React.useMemo(() => {
        if (!currentTrack && !libraryLyricsTrack) return null;

        const baseTrack = currentTrack ?? libraryLyricsTrack;
        if (!baseTrack) return null;

        return {
            ...baseTrack,
            title: hasMeaningfulLyricsValue(libraryLyricsTrack?.title) ? libraryLyricsTrack!.title : (baseTrack.title ?? ''),
            artist: hasMeaningfulLyricsValue(libraryLyricsTrack?.artist) ? libraryLyricsTrack!.artist : (baseTrack.artist ?? ''),
            album: hasMeaningfulLyricsValue(libraryLyricsTrack?.album) ? libraryLyricsTrack!.album : (baseTrack.album ?? ''),
            duration: libraryLyricsTrack?.duration || baseTrack.duration,
        };
    }, [currentTrack, hasMeaningfulLyricsValue, libraryLyricsTrack]);

    const updateNativePosition = useCallback((value: number) => {
        setNativePositionMs(value);
    }, []);

    useAnimatedReaction(
        () => {
            if (!visible) return -1;
            return Math.floor(positionShared.value / 16) * 16;
        },
        (current, previous) => {
            if (current >= 0 && current !== previous) {
                runOnJS(updateNativePosition)(positionShared.value);
            }
        },
        [positionShared, visible]
    );

    const handleDownloadLrc = useCallback(async () => {
        const songTitle = lyricsLookupTrack?.title?.trim();
        const artist = lyricsLookupTrack?.artist?.trim();
        const album = lyricsLookupTrack?.album?.trim();
        const durationSec = lyricsLookupTrack?.duration ? lyricsLookupTrack.duration / 1000 : undefined;
        const trackId = lyricsLookupTrack?.id;
        const isrc = lyricsLookupTrack?.isrc;

        if (!songTitle || !artist) return;

        setIsDownloadingLrc(true);
        setLrcError(null);
        try {
            const payload = await LyricsRepository.getLrcLibLyrics(songTitle, artist, durationSec, trackId);
            if (payload && Array.isArray(payload.lyrics) && payload.lyrics.length > 0) {
                setLrcLyrics(payload as KaraokeLyricsJSON);
                setLyricsMode('lrc');
            } else {
                setLrcError('No se encontraron letras en LRCLib.');
            }
        } catch {
            setLrcError('Error al descargar las letras.');
        } finally {
            setIsDownloadingLrc(false);
        }
    }, [lyricsLookupTrack]);

    React.useEffect(() => {
        resetLyricsState();
    }, [currentTrack?.id, resetLyricsState]);

    React.useEffect(() => {
        if (!visible && performanceProfile.releaseLyricsStateWhenHidden) {
            lyricsRequestIdRef.current += 1;
            resetLyricsState();
        }
    }, [performanceProfile.releaseLyricsStateWhenHidden, resetLyricsState, visible]);

    React.useEffect(() => {
        const requestId = ++lyricsRequestIdRef.current;
        const songTitle = lyricsLookupTrack?.title?.trim();
        const artist = lyricsLookupTrack?.artist?.trim();
        const album = lyricsLookupTrack?.album?.trim();
        const durationSec = lyricsLookupTrack?.duration ? lyricsLookupTrack.duration / 1000 : undefined;
        const trackId = lyricsLookupTrack?.id;
        const isrc = lyricsLookupTrack?.isrc;

        if (!visible) {
            setIsLyricsLoading(false);
            setIsDownloadingLrc(false);
            return;
        }

        if (!songTitle || !artist) {
            setTrackLyrics(null);
            setLrcLyrics(null);
            setIsLyricsLoading(false);
            setIsDownloadingLrc(false);
            setHasResolvedLyricsAttempt(true);
            return;
        }

        setIsLyricsLoading(true);
        setIsDownloadingLrc(false);
        setLrcError(null);
        setHasResolvedLyricsAttempt(false);

        (async () => {
            let cachedLrcFound = false;

            try {
                const cached = await LyricsRepository.getCachedLrcLibLyrics(songTitle, artist, trackId);
                if (lyricsRequestIdRef.current !== requestId) return;

                if (cached?.lyrics?.length) {
                    cachedLrcFound = true;
                    setLrcLyrics(cached as KaraokeLyricsJSON);
                    setLyricsMode(prev => prev === 'synced' ? 'lrc' : prev);
                }

                const applePayload = await LyricsRepository.getAppleWordLyrics(songTitle, artist, album, durationSec, trackId, isrc);
                if (lyricsRequestIdRef.current !== requestId) return;

                const hasAppleWords = !!applePayload?.lyrics?.length;
                console.log(
                    `[LyricsDebug] apple result title="${songTitle}" artist="${artist}" hasWords=${hasAppleWords} count=${applePayload?.lyrics?.length ?? 0}`
                );

                let payload = applePayload;
                let hasWords = hasAppleWords;

                if (!hasAppleWords) {
                    payload = await LyricsRepository.getLyrics(songTitle, artist);
                    if (lyricsRequestIdRef.current !== requestId) return;
                    hasWords = !!payload?.lyrics?.length;
                }

                console.log(
                    `[LyricsDebug] synced result title="${songTitle}" artist="${artist}" hasWords=${hasWords} count=${payload?.lyrics?.length ?? 0}`
                );
                setTrackLyrics(hasWords ? (payload as KaraokeLyricsJSON) : null);

                if (hasWords) {
                    setLyricsMode('synced');
                    setLrcError(null);
                }

                if (!cachedLrcFound) {
                    setIsDownloadingLrc(true);
                    if (!hasWords) {
                        setLrcError(null);
                    }

                    try {
                        const fallback = await LyricsRepository.getLrcLibLyrics(songTitle, artist, durationSec, trackId);
                        if (lyricsRequestIdRef.current !== requestId) return;

                        console.log(
                            `[LyricsDebug] lrc result title="${songTitle}" artist="${artist}" hasWords=${!!fallback?.lyrics?.length} count=${fallback?.lyrics?.length ?? 0}`
                        );
                        if (fallback?.lyrics?.length) {
                            setLrcLyrics(fallback as KaraokeLyricsJSON);
                            if (!hasWords) {
                                setLyricsMode('lrc');
                                setLrcError(null);
                            }
                        } else if (!hasWords) {
                            setLrcError('No se encontraron letras disponibles.');
                        }
                    } catch {
                        if (lyricsRequestIdRef.current === requestId && !hasWords) {
                            setLrcError('No se pudieron cargar las letras.');
                        }
                    } finally {
                        if (lyricsRequestIdRef.current === requestId) {
                            setIsDownloadingLrc(false);
                        }
                    }
                } else if (hasWords) {
                    setLrcError(null);
                }
            } finally {
                if (lyricsRequestIdRef.current === requestId) {
                    setIsLyricsLoading(false);
                    setHasResolvedLyricsAttempt(true);
                }
            }
        })();

        return () => {
            if (lyricsRequestIdRef.current === requestId) {
                setIsLyricsLoading(false);
                setIsDownloadingLrc(false);
            }
        };
    }, [lyricsLookupTrack?.album, lyricsLookupTrack?.artist, lyricsLookupTrack?.duration, lyricsLookupTrack?.id, lyricsLookupTrack?.isrc, lyricsLookupTrack?.title, visible]);

    const hasSyncedLyrics = !!trackLyrics?.lyrics?.length;
    const hasLrcLyrics = !!lrcLyrics?.lyrics?.length;
    const activeLyrics = lyricsMode === 'synced'
        ? (trackLyrics ?? lrcLyrics)
        : (lrcLyrics ?? trackLyrics);
    const shouldShowDownloadLrc =
        hasResolvedLyricsAttempt &&
        !isLyricsLoading &&
        !isDownloadingLrc &&
        !hasSyncedLyrics &&
        !hasLrcLyrics;
    const lyricsBackdropUri = currentTrack?.artworkThumb || currentTrack?.artwork;
    const lyricsBaseSurface = React.useMemo(
        () => mixHexColors(colors.background, '#05070D', colors.isDark ? 0.52 : 0.7),
        [colors.background, colors.isDark]
    );
    const lyricsTextColor = React.useMemo(
        () => ensureColorContrast(colors.text || textColor, lyricsBaseSurface, { minRatio: 7 }),
        [colors.text, lyricsBaseSurface, textColor]
    );
    const protectedAccentColor = React.useMemo(
        () => ensureColorContrast(
            getProtectedDynamicAccent(accentColor, theme.colors.primary),
            lyricsBaseSurface,
            { minRatio: 4.8, targetColor: lyricsTextColor }
        ),
        [accentColor, lyricsBaseSurface, lyricsTextColor, theme.colors.primary]
    );
    const protectedGlowColor = React.useMemo(
        () => ensureColorContrast(
            mixHexColors(protectedAccentColor, lyricsTextColor, 0.22),
            lyricsBaseSurface,
            { minRatio: 5.4, targetColor: lyricsTextColor }
        ),
        [lyricsBaseSurface, lyricsTextColor, protectedAccentColor]
    );
    const protectedInactiveColor = React.useMemo(
        () => ensureColorContrast(
            mixHexColors(lyricsTextColor, lyricsBaseSurface, 0.44),
            lyricsBaseSurface,
            { minRatio: 3.1, targetColor: lyricsTextColor }
        ),
        [lyricsBaseSurface, lyricsTextColor]
    );
    const secondaryLyricsTextColor = React.useMemo(
        () => withAlpha(lyricsTextColor, 0.74),
        [lyricsTextColor]
    );
    const modeSwitcherBackground = React.useMemo(
        () => withAlpha(colors.background, colors.isDark ? 0.34 : 0.18),
        [colors.background, colors.isDark]
    );
    const modeTabActiveBackground = React.useMemo(
        () => withAlpha(lyricsTextColor, colors.isDark ? 0.14 : 0.08),
        [colors.isDark, lyricsTextColor]
    );

    React.useEffect(() => {
        console.log(
            `[LyricsDebug] mode state mode=${lyricsMode} synced=${trackLyrics?.lyrics?.length ?? 0} lrc=${lrcLyrics?.lyrics?.length ?? 0}`
        );
        if (lyricsMode === 'synced' && !hasSyncedLyrics && hasLrcLyrics) {
            setLyricsMode('lrc');
            return;
        }

        if (lyricsMode === 'lrc' && !hasLrcLyrics && hasSyncedLyrics) {
            setLyricsMode('synced');
        }
    }, [hasLrcLyrics, hasSyncedLyrics, lyricsMode]);

    if (!expanded) {
        return null;
    }

    return (
        <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 10020 }, animStyle]} pointerEvents="box-none">
            <View style={StyleSheet.absoluteFill}>
                <View style={[StyleSheet.absoluteFill, { backgroundColor: lyricsBaseSurface }]} />
                <ThemeBackground
                    colors={colors}
                    animColors={animColors}
                    isVisible={visible}
                />
                {lyricsBackdropUri ? (
                    <View style={StyleSheet.absoluteFill}>
                        <Image
                            source={{ uri: lyricsBackdropUri }}
                            style={[
                                StyleSheet.absoluteFill,
                                {
                                    transform: [{ scale: 2.75 }],
                                    opacity: colors.isDark ? 0.4 : 0.28,
                                },
                            ]}
                            blurRadius={64}
                            contentFit="cover"
                            transition={0}
                            cachePolicy={performanceProfile.imageCachePolicyOverlay}
                        />
                        <BlurView
                            intensity={colors.isDark ? 90 : 110}
                            tint={colors.isDark ? 'dark' : 'light'}
                            style={StyleSheet.absoluteFill}
                        />
                        <View
                            style={[
                                StyleSheet.absoluteFill,
                                {
                                    backgroundColor: withAlpha(lyricsBaseSurface, colors.isDark ? 0.58 : 0.38),
                                },
                            ]}
                        />
                    </View>
                ) : (
                    <View
                        style={[
                            StyleSheet.absoluteFill,
                            { backgroundColor: lyricsBaseSurface },
                        ]}
                    />
                )}
                <View
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFill,
                        {
                            backgroundColor: withAlpha(mixHexColors(colors.primary, lyricsBaseSurface, 0.7), colors.isDark ? 0.18 : 0.08),
                        },
                    ]}
                />
                <View
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFill,
                        {
                            backgroundColor: withAlpha('#000000', colors.isDark ? 0.24 : 0.08),
                        },
                    ]}
                />
                <View style={styles.fullScreenLyricsHeader}>
                    <IconButton icon="close-circle" size={36} iconColor={lyricsTextColor} onPress={onClose} />
                    <View style={styles.lyricsModeContainer}>
                        {trackLyrics && lrcLyrics && (
                            <View style={[styles.lyricsModeSwitcher, { backgroundColor: modeSwitcherBackground }]}>
                                <Pressable
                                    onPress={() => setLyricsMode('synced')}
                                    style={[styles.modeTab, lyricsMode === 'synced' && styles.modeTabActive, lyricsMode === 'synced' && { backgroundColor: modeTabActiveBackground }]}
                                >
                                    <Text style={[styles.modeTabText, { color: lyricsMode === 'synced' ? protectedAccentColor : secondaryLyricsTextColor }]}>SINCRONIZADAS</Text>
                                </Pressable>
                                <Pressable
                                    onPress={() => setLyricsMode('lrc')}
                                    style={[styles.modeTab, lyricsMode === 'lrc' && styles.modeTabActive, lyricsMode === 'lrc' && { backgroundColor: modeTabActiveBackground }]}
                                >
                                    <Text style={[styles.modeTabText, { color: lyricsMode === 'lrc' ? protectedAccentColor : secondaryLyricsTextColor }]}>LRC</Text>
                                </Pressable>
                            </View>
                        )}
                    </View>
                </View>
                {activeLyrics ? (
                    <KaraokeView
                        style={{ flex: 1 }}
                        lyrics={activeLyrics.lyrics}
                        currentTimeMs={nativePositionMs}
                        isPlaying={isPlaying}
                        fontSize={29}
                        isLineByLine={lyricsMode === 'lrc'}
                        activeColor={processColor(protectedAccentColor)}
                        inactiveColor={processColor(protectedInactiveColor)}
                        glowColor={processColor(protectedGlowColor)}
                        enableSpectralParticles={colors.isDark}
                        onSeek={({ nativeEvent }) => seek(nativeEvent.timeMs)}
                    />
                ) : (
                    <View style={styles.lyricsFallbackState}>
                        {(isLyricsLoading || isDownloadingLrc) ? (
                            <LyricsSkeleton isDownloading={isDownloadingLrc} />
                        ) : (
                            <View style={{ alignItems: 'center' }}>
                                <Text style={[styles.lyricsFallbackTitle, { color: lyricsTextColor }]}>No se encontraron letras</Text>
                                {shouldShowDownloadLrc && (
                                    <Button
                                        mode="contained"
                                        onPress={handleDownloadLrc}
                                        icon="cloud-download"
                                        style={[styles.downloadBtn, { backgroundColor: lrcError ? '#CC4444' : protectedAccentColor }]}
                                    >
                                        {lrcError ? 'Reintentar' : 'Descargar Letras'}
                                    </Button>
                                )}
                                {lrcError && (
                                    <Text style={[styles.lyricsFallbackSubtitle, { color: secondaryLyricsTextColor }]}>{lrcError}</Text>
                                )}
                            </View>
                        )}
                    </View>
                )}
            </View>
        </Animated.View>
    );
});

export function FullPlayer() {
    const { theme, config, isDark } = useTheme();
    const performanceProfile = usePerformanceProfile();
    const themeAnimatedColors = useAnimatedColors();
    const pathname = usePathname();
    const insets = useSafeAreaInsets();
    const isVisible = usePlayerStore(state => state.playerVisible);
    const setPlayerVisible = usePlayerStore(state => state.setPlayerVisible);
    const setExpansion = usePlayerStore(state => state.setExpansion);

    const playerVariant = usePlayerStore(state => state.playerVariant);
    const currentTrack = usePlayerStore(state => state.currentTrack);
    const isPlaying = usePlayerStore(state => state.isPlaying);
    const isLoading = usePlayerStore(state => state.isLoading);
    const pendingTrackPreview = usePlayerStore(state => state.pendingTrackPreview);
    const shuffleEnabled = usePlayerStore(state => state.shuffleEnabled);
    const repeatMode = usePlayerStore(state => state.repeatMode);

    // Actions
    const togglePlayPause = usePlayerStore(state => state.togglePlayPause);
    const next = usePlayerStore(state => state.next);
    const previous = usePlayerStore(state => state.previous);
    const seek = usePlayerStore(state => state.seek);
    const toggleShuffle = usePlayerStore(state => state.toggleShuffle);
    const cycleRepeatMode = usePlayerStore(state => state.cycleRepeatMode);

    const toggleFavorite = useLibraryStore(state => state.toggleFavorite);
    const currentTrackId = currentTrack?.id ?? null;
    const isFavorite = useLibraryStore(state =>
        currentTrackId ? !!state.tracks.get(currentTrackId)?.favorite : false
    );

    const activeVariant = (theme.components?.player?.variant as any) || playerVariant;
    const lightweightMode = config.lightweightMode;
    const shouldResolveDynamicColors = isVisible;
    const playerArtworkUri = currentTrack?.artworkThumb || currentTrack?.artwork;
    const { colors: albumColors, animated: animColors } = useDynamicColorsWithOptions(playerArtworkUri, {
        enabled: shouldResolveDynamicColors && performanceProfile.enableDynamicColors,
    });
    const shouldUseThemePlayerColors = !performanceProfile.enableDynamicColors;
    const playerColors = shouldUseThemePlayerColors
        ? {
            primary: theme.colors.primary,
            secondary: theme.colors.secondary,
            background: theme.colors.background,
            text: theme.colors.onSurface,
            onPrimary: theme.colors.onPrimary,
            onSurface: theme.colors.onSurface,
            accent: theme.colors.primary,
            isDark,
        }
        : albumColors;
    const playerAnimColors = shouldUseThemePlayerColors
        ? {
            primary: themeAnimatedColors.primary,
            secondary: themeAnimatedColors.surfaceVariant,
            background: themeAnimatedColors.background,
            accent: themeAnimatedColors.primary,
            text: themeAnimatedColors.onSurface,
        }
        : animColors;
    const textColor = playerColors.text;
    const accentColor = playerColors.primary;
    const onPrimaryColor = playerColors.onPrimary;
    const shouldShowTidalLoading = Boolean(pendingTrackPreview)
        || (isLoading && (currentTrack?.source === 'tidal' || currentTrack?.source === 'tidal_stream'));
    const playerSurfaceColor = React.useMemo(() => {
        if (shouldUseThemePlayerColors) {
            return theme.colors.background;
        }

        if (isDark) {
            return playerColors.background || theme.colors.background;
        }

        return mixPlayerHexColors(theme.colors.background, playerColors.background || theme.colors.surface, 0.1);
    }, [isDark, playerColors.background, shouldUseThemePlayerColors, theme.colors.background, theme.colors.surface]);

    const playerIcons = theme.components?.player?.icons;
    const playIcon: IconName = 'Play';
    const pauseIcon: IconName = 'Pause';
    const nextIcon: IconName = 'Next';
    const previousIcon: IconName = 'Previous';
    const shuffleIcon: IconName = 'Shuffle';
    const repeatIcon: IconName = repeatMode === 'one'
        ? 'Repetir 1'
        : 'Repetir 0';

    const [showLyrics, setShowLyrics] = useState(false);

    // Queue state
    const [showQueue, setShowQueue] = useState(false);
    const [queueVisible, setQueueVisible] = useState(false);
    const queueAnimation = useSharedValue(0);

    const isDetailRoute = isPlayerDetailRoute(pathname);

    const tabReservedSpace = config.style === 'material3'
        ? TAB_BAR_HEIGHT + TAB_BAR_FLOAT_OFFSET
        : 85;
    const miniCollapsedBottom = Math.max(insets.bottom + tabReservedSpace + MINI_GAP_FROM_TAB, 88);

    const miniLeft = isDetailRoute ? 0 : MINI_MARGIN;
    const miniBottom = isDetailRoute ? Math.max(insets.bottom + DETAIL_EXTRA_BOTTOM, DETAIL_EXTRA_BOTTOM) : miniCollapsedBottom;
    const miniHeight = isDetailRoute ? DETAIL_HEIGHT : MINI_HEIGHT;
    const miniWidth = SCREEN_WIDTH - (miniLeft * 2);
    const miniRadius = 24;

    // Expansion & Breathing
    const expansion = useSharedValue(0);
    const lyricsExpansion = useSharedValue(0);
    const trackChangeScale = useSharedValue(1);
    const [animationsActive, setAnimationsActive] = useState(false);
    const [isLyricsExpanded, setIsLyricsExpanded] = useState(false);

    const toggleLyricsFull = (val: boolean) => {
        setIsLyricsExpanded(val);
        lyricsExpansion.value = withTiming(val ? 1 : 0, {
            duration: lightweightMode ? (val ? 240 : 160) : (val ? 350 : 200),
            easing: val ? M3_EMPHASIZED_DECEL : M3_EMPHASIZED_ACCEL,
        });
    };

    React.useEffect(() => {
        if (showLyrics) toggleLyricsFull(true);
        else toggleLyricsFull(false);
    }, [showLyrics]);

    React.useEffect(() => {
        // Reset lyrics state only when the track changes.
        setShowLyrics(false);
        setIsLyricsExpanded(false);
        lyricsExpansion.value = 0;
        trackChangeScale.value = isVisible ? 0.94 : 1;
        if (isVisible && !lightweightMode) {
            trackChangeScale.value = withSpring(1, { damping: 12, stiffness: 100, mass: 0.5 });
        }
    }, [currentTrack?.id, lightweightMode]);

    React.useEffect(() => {
        if (!currentTrack?.id) {
            trackChangeScale.value = 1;
            return;
        }

        if (isVisible && !lightweightMode) {
            trackChangeScale.value = 0.94;
            trackChangeScale.value = withSpring(1, { damping: 12, stiffness: 100, mass: 0.5 });
        } else {
            trackChangeScale.value = 1;
        }
    }, [isVisible, currentTrack?.id, lightweightMode]);

    React.useEffect(() => {
        if (!isVisible) {
            setShowQueue(false);
            setQueueVisible(false);
            queueAnimation.value = 0;
        }
    }, [isVisible]);

    const handleOpenQueue = useCallback(() => {
        if (!showLyrics) {
            setQueueVisible(true);
            setShowQueue(true);
            requestAnimationFrame(() => {
                queueAnimation.value = lightweightMode
                    ? withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) })
                    : withSpring(1, { damping: 22, stiffness: 200, mass: 0.6 });
            });
        }
    }, [lightweightMode, showLyrics]);

    const handleCloseQueue = useCallback(() => {
        setShowQueue(false);
        queueAnimation.value = withTiming(0, { duration: 220, easing: M3_EMPHASIZED_ACCEL }, (finished) => {
            if (finished) runOnJS(setQueueVisible)(false);
        });
    }, []);

    // Gestures
    const panGesture = Gesture.Pan()
        .enabled(!isLyricsExpanded)
        .minDistance(10)
        .failOffsetX([-20, 20])
        .onUpdate((e) => {
            if (e.translationY > 0 && lyricsExpansion.value === 0) {
                const newVal = 1 - (e.translationY / (SCREEN_HEIGHT - miniBottom));
                expansion.value = Math.max(0, Math.min(1, newVal));
            }
        })
        .onEnd((e) => {
            if (e.translationY > 180 || e.velocityY > 1200) {
                expansion.value = withTiming(0, { duration: COLLAPSE_DURATION, easing: M3_EMPHASIZED });
                runOnJS(setPlayerVisible)(false);
            } else {
                expansion.value = withSpring(1, M3_SNAP_SPRING);
            }
        });

    const tapGesture = Gesture.Tap()
        .enabled(!isLyricsExpanded)
        .onEnd(() => {
            if (showLyrics && lyricsExpansion.value === 0) {
                runOnJS(toggleLyricsFull)(true);
            }
        });

    // Animated Styles
    const rootAnimatedStyle = useAnimatedStyle(() => {
        const p = expansion.value;
        const radius = interpolate(p, [0, 0.55, 1], [miniRadius, isDetailRoute ? 0 : miniRadius * 0.86, 0], Extrapolation.CLAMP);
        return {
            width: interpolate(p, [0, 1], [miniWidth, SCREEN_WIDTH], Extrapolation.CLAMP),
            height: interpolate(p, [0, 1], [miniHeight, SCREEN_HEIGHT], Extrapolation.CLAMP),
            bottom: interpolate(p, [0, 1], [miniBottom, 0], Extrapolation.CLAMP),
            left: interpolate(p, [0, 1], [miniLeft, 0], Extrapolation.CLAMP),
            borderRadius: radius,
            opacity: isVisible ? 1 : interpolate(p, [0, 0.06], [0, 1], Extrapolation.CLAMP),
            pointerEvents: p > 0.18 ? 'auto' : 'none',
            elevation: p > 0.1 ? 24 : 8,
            zIndex: 9999,
        };
    });

    const ARTWORK_SIZE = SCREEN_WIDTH - 64;
    const BRUTAL_ARTWORK_SIZE = ARTWORK_SIZE * 0.78;

    const artworkShadowStyle = useAnimatedStyle(() => {
        const p = expansion.value;
        const artworkProgress = interpolate(p, [0, 0.22, 0.72, 1], [0, 0.18, 0.82, 1], Extrapolation.CLAMP);
        const miniArtworkTop = (miniHeight - MINI_ARTWORK_SIZE) / 2;
        const targetSize = ARTWORK_SIZE;
        const targetLeft = (SCREEN_WIDTH - targetSize) / 2;
        const targetTop = 120;
        const settleScale = interpolate(p, [0, 0.9, 0.97, 1], [1, 1, 1.018, 1], Extrapolation.CLAMP);
        const scale = p > 0.9 ? settleScale * trackChangeScale.value : settleScale;

        return {
            width: interpolate(artworkProgress, [0, 1], [MINI_ARTWORK_SIZE, targetSize], Extrapolation.CLAMP),
            height: interpolate(artworkProgress, [0, 1], [MINI_ARTWORK_SIZE, targetSize], Extrapolation.CLAMP),
            position: 'absolute',
            left: interpolate(artworkProgress, [0, 1], [MINI_ARTWORK_LEFT, targetLeft], Extrapolation.CLAMP),
            top: interpolate(artworkProgress, [0, 1], [miniArtworkTop, targetTop], Extrapolation.CLAMP),
            transform: [{ scale }],
            opacity: interpolate(p, [0, 0.18, 0.32, 1], [0, 0, 1, 1], Extrapolation.CLAMP),
            // Shadow Properties (No overflow hidden here)
            elevation: interpolate(artworkProgress, [0, 1], [0, 24], Extrapolation.CLAMP),
            shadowColor: '#000',
            shadowOffset: { width: 0, height: interpolate(artworkProgress, [0, 1], [0, 12], Extrapolation.CLAMP) },
            shadowOpacity: interpolate(artworkProgress, [0, 1], [0, 0.4], Extrapolation.CLAMP),
            shadowRadius: interpolate(artworkProgress, [0, 1], [0, 24], Extrapolation.CLAMP),
        };
    });

    const artworkContainerStyle = useAnimatedStyle(() => {
        const p = expansion.value;
        const radius = interpolate(p, [0, 0.35, 1], [12, 18, 24], Extrapolation.CLAMP);
        return {
            flex: 1,
            borderRadius: radius,
            overflow: 'hidden',
        };
    });

    const contentAnimatedStyle = useAnimatedStyle(() => ({
        opacity: interpolate(expansion.value, [0.34, 0.64], [0, 1], Extrapolation.CLAMP) * (1 - lyricsExpansion.value),
        transform: [{ translateY: interpolate(expansion.value, [0.34, 0.7], [18, 0], Extrapolation.CLAMP) }]
    }));

    const queueOverlayAnimStyle = useAnimatedStyle(() => ({
        opacity: interpolate(queueAnimation.value, [0, 0.4], [0, 1], Extrapolation.CLAMP),
        transform: [{ translateY: interpolate(queueAnimation.value, [0, 1], [30, 0], Extrapolation.CLAMP) }],
    }));

    const mainContainerStyle = useAnimatedStyle(() => ({
        backgroundColor: isDark
            ? (playerAnimColors?.background?.value || playerColors.background || theme.colors.background)
            : playerSurfaceColor
    }));
    const themeBackgroundFadeStyle = useAnimatedStyle(() => ({
        opacity: interpolate(expansion.value, [0, 0.12, 0.42], [0, isDark ? 0.04 : 0.02, isDark ? 1 : 0.62], Extrapolation.CLAMP)
    }));
    const lyricsBgOverlayStyle = useAnimatedStyle(() => ({ opacity: interpolate(lyricsExpansion.value, [0, 1], [0, 0.6]) }));
    const lyricsContentAnimStyle = useAnimatedStyle(() => ({
        opacity: lyricsExpansion.value,
        transform: [{ translateY: interpolate(lyricsExpansion.value, [0, 1], [40, 0], Extrapolation.CLAMP) }]
    }));

    const textStyle = useAnimatedStyle(() => ({ color: playerAnimColors.text.value }));
    const accentTextStyle = useAnimatedStyle(() => ({ color: playerAnimColors.primary.value }));
    const accentBgStyle = useAnimatedStyle(() => ({ backgroundColor: playerAnimColors.primary.value }));
    const shouldRenderThemeBackground = isVisible && !showLyrics && !queueVisible;
    // Safe animated style for mini-shell orb Ã¢â‚¬â€ avoids reading .value during JSX render

    React.useEffect(() => { setExpansion(expansion); }, []);

    React.useEffect(() => {
        if (isVisible && !queueVisible) {
            const timer = setTimeout(() => {
                setAnimationsActive(true);
            }, EXPAND_DURATION + 50);
            return () => clearTimeout(timer);
        } else {
            setAnimationsActive(false);
        }
    }, [isVisible, queueVisible]);

    React.useEffect(() => {
        if (!isVisible) return;
        const onBackPress = () => {
            if (isLyricsExpanded) { setShowLyrics(false); toggleLyricsFull(false); return true; }
            if (queueVisible) { handleCloseQueue(); return true; }
            expansion.value = withTiming(0, { duration: COLLAPSE_DURATION, easing: M3_EMPHASIZED });
            runOnJS(setPlayerVisible)(false);
            return true;
        };
        const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
        return () => sub.remove();
    }, [isVisible, isLyricsExpanded, queueVisible]);

    React.useEffect(() => {
        expansion.value = withTiming(isVisible ? 1 : 0, { duration: isVisible ? EXPAND_DURATION : COLLAPSE_DURATION, easing: M3_EMPHASIZED });
    }, [isVisible]);

    if (!currentTrack) return null;
    const track = currentTrack;
    const trackTechLabel = getTrackTechLabel(track);
    const qualityBadge = getQualityBadge(track);
    const qualityBadgeInk = getContrastingInk(qualityBadge.tone);

    const commonProps = {
        track, isPlaying, shuffleEnabled, repeatMode, isFavorite, accentColor, textColor, onPrimaryColor,
        qualityBadge, qualityBadgeInk, trackTechLabel, shuffleIcon, repeatIcon, playIcon, pauseIcon, nextIcon, previousIcon,
        onClose: () => setPlayerVisible(false), onToggleLyrics: () => setShowLyrics(!showLyrics),
        onOpenQueue: handleOpenQueue, onToggleFavorite: () => toggleFavorite(track.id),
        onToggleShuffle: toggleShuffle, onCycleRepeatMode: cycleRepeatMode,
        onPlayPause: togglePlayPause, onNext: next, onPrevious: previous, onSeek: seek,
        textStyle, accentTextStyle, accentBgStyle, ARTWORK_SIZE,
        showLyrics, isLyricsExpanded, topInset: Math.max(insets.top + 12, 28)
    };

    return (
        <>
            <SharedPlayerShell />
            <Animated.View style={[styles.root, rootAnimatedStyle]}>
            <GestureDetector gesture={Gesture.Exclusive(panGesture, tapGesture)}>
                <Animated.View style={[styles.mainContainer, mainContainerStyle]}>
                    {shouldRenderThemeBackground && performanceProfile.enableAnimatedBackgrounds && (
                        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, themeBackgroundFadeStyle]}>
                            <ThemeBackground
                                colors={playerColors}
                                animColors={playerAnimColors}
                                artwork={track.artwork}
                                isVisible={animationsActive}
                                expansion={expansion}
                                lightweight={lightweightMode}
                            />
                        </Animated.View>
                    )}

                    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, lyricsBgOverlayStyle]} pointerEvents="none" />

                    {!isLyricsExpanded && !showQueue && (
                        <Animated.View style={[artworkShadowStyle, { zIndex: 10 }]}>
                            <Animated.View style={artworkContainerStyle}>
                                <Image
                                    source={{ uri: track.artworkThumb || track.artwork }}
                                    style={styles.fullImage}
                                    contentFit="cover"
                                    cachePolicy={performanceProfile.imageCachePolicyPrimary}
                                    transition={0}
                                    recyclingKey={track.id}
                                />
                            </Animated.View>
                        </Animated.View>
                    )}

                    <Animated.View style={[{ flex: 1 }, contentAnimatedStyle]}>
                        {!isLyricsExpanded && (
                            <ImmersiveVariant {...commonProps} />
                        )}
                    </Animated.View>

                    <PlayerQueueOverlayLayer
                        visible={queueVisible && !isLyricsExpanded}
                        currentTrackId={track.id}
                        accentColor={accentColor}
                        textColor={textColor}
                        backgroundColor={playerColors.background + 'F0'}
                        animStyle={queueOverlayAnimStyle}
                        onClose={handleCloseQueue}
                    />
                </Animated.View>
            </GestureDetector>
            </Animated.View>

            {showLyrics && isVisible ? (
                <PlayerLyricsLayer
                    visible={showLyrics && isVisible}
                    expanded={isLyricsExpanded}
                    currentTrack={track}
                    accentColor={accentColor}
                    textColor={textColor}
                    colors={playerColors}
                    animColors={playerAnimColors}
                    isPlaying={isPlaying}
                    animStyle={lyricsContentAnimStyle}
                    onClose={() => {
                        setShowLyrics(false);
                        toggleLyricsFull(false);
                    }}
                    seek={seek}
                />
            ) : null}
        </>
    );
}
