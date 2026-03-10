/**
 * FullPlayer - Material 3 Expressive Container Transform Player
 * 
 * Optimized & Scalable Version
 */

import { useDynamicColors } from '@/src/hooks';
import { LyricsRepository } from '@/src/services';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { Image } from 'expo-image';
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
import { IconName, LyricsSkeleton } from '../ui';
import { ThemeBackground } from './backgrounds/ThemeBackground';
import { QueueOverlay } from './parts/QueueOverlay';
import { playerStyles as styles } from './playerStyles';
import { getContrastingInk, getQualityBadge, getTrackTechLabel } from './playerUtils';
import { ImmersiveVariant } from './variants/ImmersiveVariant';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// MiniPlayer placement constants (Synced with MiniPlayer)
const MINI_HEIGHT = 66;
const MINI_MARGIN = 12;
const TAB_BAR_HEIGHT = 72;
const TAB_BAR_FLOAT_OFFSET = 12;
const MINI_GAP_FROM_TAB = 6;
const DETAIL_HEIGHT = 78;
const DETAIL_EXTRA_BOTTOM = 0;

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

export function FullPlayer() {
    const { theme, config } = useTheme();
    const pathname = usePathname();
    const insets = useSafeAreaInsets();
    const isVisible = usePlayerStore(state => state.playerVisible);
    const setPlayerVisible = usePlayerStore(state => state.setPlayerVisible);
    const setExpansion = usePlayerStore(state => state.setExpansion);

    const playerVariant = usePlayerStore(state => state.playerVariant);
    const currentTrack = usePlayerStore(state => state.currentTrack);
    const isPlaying = usePlayerStore(state => state.isPlaying);
    const shuffleEnabled = usePlayerStore(state => state.shuffleEnabled);
    const repeatMode = usePlayerStore(state => state.repeatMode);
    const queue = usePlayerStore(state => state.queue);

    // Actions
    const togglePlayPause = usePlayerStore(state => state.togglePlayPause);
    const next = usePlayerStore(state => state.next);
    const previous = usePlayerStore(state => state.previous);
    const seek = usePlayerStore(state => state.seek);
    const toggleShuffle = usePlayerStore(state => state.toggleShuffle);
    const cycleRepeatMode = usePlayerStore(state => state.cycleRepeatMode);
    const skipTo = usePlayerStore(state => state.skipTo);
    const removeFromQueue = usePlayerStore(state => state.removeFromQueue);

    const toggleFavorite = useLibraryStore(state => state.toggleFavorite);
    const isFavorite = useLibraryStore(state =>
        currentTrack ? !!state.tracks.get(currentTrack.id)?.favorite : false
    );

    const activeVariant = (theme.components?.player?.variant as any) || playerVariant;
    const { colors: albumColors, animated: animColors } = useDynamicColors(currentTrack?.artwork);
    const textColor = albumColors.text;
    const accentColor = albumColors.primary;
    const onPrimaryColor = albumColors.onPrimary;

    const playerIcons = theme.components?.player?.icons;
    const playIcon: IconName = 'Play';
    const pauseIcon: IconName = 'Pause';
    const nextIcon: IconName = 'Next';
    const previousIcon: IconName = 'Previous';
    const shuffleIcon: IconName = 'Shuffle';
    const repeatIcon: IconName = repeatMode === 'one'
        ? 'Repetir 1'
        : 'Repetir 0';

    // Lyrics state
    const [showLyrics, setShowLyrics] = useState(false);
    const [lyricsMode, setLyricsMode] = useState<'synced' | 'lrc'>('synced');
    const [trackLyrics, setTrackLyrics] = useState<KaraokeLyricsJSON | null>(null);
    const [lrcLyrics, setLrcLyrics] = useState<KaraokeLyricsJSON | null>(null);
    const [isLyricsLoading, setIsLyricsLoading] = useState(false);
    const [isDownloadingLrc, setIsDownloadingLrc] = useState(false);
    const [lrcError, setLrcError] = useState<string | null>(null);

    // Queue state
    const [showQueue, setShowQueue] = useState(false);
    const [queueVisible, setQueueVisible] = useState(false);
    const [queueDraft, setQueueDraft] = useState(queue);
    const [visibleCount, setVisibleCount] = useState(25);
    const queueAnimation = useSharedValue(0);

    const isDetailRoute =
        pathname.startsWith('/album/') ||
        pathname.startsWith('/artist/') ||
        pathname.startsWith('/playlist/') ||
        pathname.startsWith('/tidal-album/') ||
        pathname.startsWith('/tidal-artist/');

    const tabReservedSpace = config.style === 'material3'
        ? TAB_BAR_HEIGHT + TAB_BAR_FLOAT_OFFSET
        : 85;
    const miniCollapsedBottom = Math.max(insets.bottom + tabReservedSpace + MINI_GAP_FROM_TAB, 88);

    const miniLeft = isDetailRoute ? 0 : MINI_MARGIN;
    const miniBottom = isDetailRoute ? Math.max(insets.bottom + DETAIL_EXTRA_BOTTOM, DETAIL_EXTRA_BOTTOM) : miniCollapsedBottom;
    const miniHeight = isDetailRoute ? DETAIL_HEIGHT : MINI_HEIGHT;
    const miniWidth = SCREEN_WIDTH - (miniLeft * 2);
    const miniRadius = 24;

    const positionShared = usePlayerStore(state => state.positionShared);
    const [nativePositionMs, setNativePositionMs] = useState(0);

    const updateNativePosition = useCallback((value: number) => {
        setNativePositionMs(value);
    }, []);

    const lyricsActive = showLyrics && isVisible;

    useAnimatedReaction(
        () => {
            if (!lyricsActive) return -1;
            return Math.floor(positionShared.value / 16) * 16;
        },
        (current, previous) => {
            if (current >= 0 && current !== previous) {
                runOnJS(updateNativePosition)(positionShared.value);
            }
        },
        [positionShared, lyricsActive]
    );

    // Expansion & Breathing
    const expansion = useSharedValue(0);
    const lyricsExpansion = useSharedValue(0);
    const trackChangeScale = useSharedValue(1);
    const [animationsActive, setAnimationsActive] = useState(false);
    const [isLyricsExpanded, setIsLyricsExpanded] = useState(false);

    const toggleLyricsFull = (val: boolean) => {
        setIsLyricsExpanded(val);
        lyricsExpansion.value = withTiming(val ? 1 : 0, {
            duration: val ? 350 : 200,
            easing: val ? M3_EMPHASIZED_DECEL : M3_EMPHASIZED_ACCEL,
        });
    };

    React.useEffect(() => {
        if (showLyrics) toggleLyricsFull(true);
        else toggleLyricsFull(false);
    }, [showLyrics]);

    const handleDownloadLrc = useCallback(async () => {
        const songTitle = currentTrack?.title?.trim();
        const artist = currentTrack?.artist?.trim();
        const durationSec = currentTrack?.duration ? currentTrack.duration / 1000 : undefined;

        if (!songTitle || !artist) return;

        setIsDownloadingLrc(true);
        setLrcError(null);
        try {
            const payload = await LyricsRepository.getLrcLibLyrics(songTitle, artist, durationSec);
            if (payload && Array.isArray(payload.lyrics) && payload.lyrics.length > 0) {
                setLrcLyrics(payload as KaraokeLyricsJSON);
                setLyricsMode('lrc');
            } else {
                setLrcError('No se encontraron letras en LRCLib.');
            }
        } catch (error) {
            setLrcError('Error al descargar las letras.');
        } finally {
            setIsDownloadingLrc(false);
        }
    }, [currentTrack]);

    React.useEffect(() => {
        // Always reset lyrics state when track changes, regardless of current visibility
        setShowLyrics(false);
        setIsLyricsExpanded(false);
        lyricsExpansion.value = 0;
        setTrackLyrics(null);
        setLrcLyrics(null);
        setLyricsMode('synced');
        setLrcError(null);

        // Fun track change animation
        trackChangeScale.value = 0.94;
        trackChangeScale.value = withSpring(1, { damping: 12, stiffness: 100, mass: 0.5 });
    }, [currentTrack?.id]);

    React.useEffect(() => {
        const songTitle = currentTrack?.title?.trim();
        const artist = currentTrack?.artist?.trim();
        if (!songTitle || !artist) {
            setTrackLyrics(null);
            setLrcLyrics(null);
            return;
        }

        let cancelled = false;
        setIsLyricsLoading(true);

        LyricsRepository.getCachedLrcLibLyrics(songTitle, artist).then(cached => {
            if (cancelled) return;
            if (cached?.lyrics?.length) {
                setLrcLyrics(cached as KaraokeLyricsJSON);
                setLyricsMode(prev => prev === 'synced' ? 'lrc' : prev);
            }
        });

        LyricsRepository.getLyrics(songTitle, artist).then(payload => {
            if (cancelled) return;
            const hasWords = !!payload?.lyrics?.length;
            setTrackLyrics(hasWords ? (payload as KaraokeLyricsJSON) : null);
            if (hasWords) setLyricsMode('synced');
        }).finally(() => {
            if (!cancelled) setIsLyricsLoading(false);
        });

        return () => { cancelled = true; };
    }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist]);

    React.useEffect(() => {
        if (!isVisible) {
            setShowQueue(false);
            setQueueVisible(false);
            queueAnimation.value = 0;
            setVisibleCount(25);
        }
    }, [isVisible]);

    React.useEffect(() => {
        if (showQueue) {
            setQueueDraft(queue);
            setVisibleCount(25);
        }
    }, [showQueue]);

    const paginatedQueue = React.useMemo(() => queueDraft.slice(0, visibleCount), [queueDraft, visibleCount]);
    const loadMoreQueue = useCallback(() => {
        if (visibleCount < queueDraft.length) setVisibleCount(p => Math.min(p + 25, queueDraft.length));
    }, [visibleCount, queueDraft.length]);

    const handleOpenQueue = useCallback(() => {
        if (!showLyrics) {
            setQueueVisible(true);
            setShowQueue(true);
            requestAnimationFrame(() => {
                queueAnimation.value = withSpring(1, { damping: 22, stiffness: 200, mass: 0.6 });
            });
        }
    }, [showLyrics]);

    const handleCloseQueue = useCallback(() => {
        setShowQueue(false);
        queueAnimation.value = withTiming(0, { duration: 220, easing: M3_EMPHASIZED_ACCEL }, (finished) => {
            if (finished) runOnJS(setQueueVisible)(false);
        });
    }, []);

    const handleQueueDragEnd = useCallback(({ data }: { data: any[] }) => {
        const currentTrackId = currentTrack?.id;
        if (!currentTrackId) return;
        const fullQueue = [...queueDraft];
        fullQueue.splice(0, data.length, ...data);
        const newIndex = fullQueue.findIndex(t => t.id === currentTrackId);
        if (newIndex < 0) return;
        setQueueDraft(fullQueue);
        usePlayerStore.setState({ queue: fullQueue, queueIndex: newIndex });
    }, [currentTrack?.id, queueDraft]);

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
            if (showLyrics && lyricsExpansion.value === 0) toggleLyricsFull(true);
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
            opacity: p > 0.001 ? 1 : 0,
            pointerEvents: p > 0.5 ? 'auto' : 'none',
            elevation: p > 0.1 ? 24 : 8,
            zIndex: 9999,
        };
    });

    const ARTWORK_SIZE = SCREEN_WIDTH - 64;
    const BRUTAL_ARTWORK_SIZE = ARTWORK_SIZE * 0.78;
    const miniArtworkSize = 48;
    const miniArtworkPadding = 10;

    const artworkShadowStyle = useAnimatedStyle(() => {
        const p = expansion.value;
        const targetSize = ARTWORK_SIZE;
        const size = interpolate(p, [0, 1], [miniArtworkSize, targetSize], Extrapolation.CLAMP);
        const scale = interpolate(p, [0, 1], [1, trackChangeScale.value], Extrapolation.CLAMP);

        return {
            width: size,
            height: size,
            position: 'absolute',
            left: interpolate(p, [0, 1], [miniArtworkPadding, (SCREEN_WIDTH - targetSize) / 2], Extrapolation.CLAMP),
            top: interpolate(p, [0, 1], [(miniHeight - miniArtworkSize) / 2, 120], Extrapolation.CLAMP),
            transform: [{ scale }],
            // Shadow Properties (No overflow hidden here)
            elevation: interpolate(p, [0, 0.5, 1], [0, 16, 24], Extrapolation.CLAMP),
            shadowColor: '#000',
            shadowOffset: { width: 0, height: interpolate(p, [0, 1], [0, 12], Extrapolation.CLAMP) },
            shadowOpacity: interpolate(p, [0, 0.5, 1], [0, 0.3, 0.4], Extrapolation.CLAMP),
            shadowRadius: interpolate(p, [0, 1], [0, 24], Extrapolation.CLAMP),
        };
    });

    const artworkContainerStyle = useAnimatedStyle(() => {
        const p = expansion.value;
        const radius = interpolate(p, [0, 0.35], [16, 24], Extrapolation.CLAMP);
        return {
            flex: 1,
            borderRadius: radius,
            overflow: 'hidden',
        };
    });

    const contentAnimatedStyle = useAnimatedStyle(() => ({
        opacity: interpolate(expansion.value, [0.25, 0.6], [0, 1], Extrapolation.CLAMP) * (1 - lyricsExpansion.value),
        transform: [{ translateY: interpolate(expansion.value, [0.25, 0.7], [16, 0], Extrapolation.CLAMP) }]
    }));

    const queueOverlayAnimStyle = useAnimatedStyle(() => ({
        opacity: interpolate(queueAnimation.value, [0, 0.4], [0, 1], Extrapolation.CLAMP),
        transform: [{ translateY: interpolate(queueAnimation.value, [0, 1], [30, 0], Extrapolation.CLAMP) }],
    }));

    const mainContainerStyle = useAnimatedStyle(() => ({ backgroundColor: animColors?.background?.value || theme.colors.background }));
    const themeBackgroundFadeStyle = useAnimatedStyle(() => ({ opacity: interpolate(expansion.value, [0, 0.22, 0.55], [0, 0.2, 1], Extrapolation.CLAMP) }));
    const miniShellStyle = useAnimatedStyle(() => ({ opacity: interpolate(expansion.value, [0, 0.35, 0.82], [1, 0.94, 0], Extrapolation.CLAMP) }));
    const lyricsBgOverlayStyle = useAnimatedStyle(() => ({ opacity: interpolate(lyricsExpansion.value, [0, 1], [0, 0.6]) }));
    const lyricsContentAnimStyle = useAnimatedStyle(() => ({
        opacity: lyricsExpansion.value,
        transform: [{ translateY: interpolate(lyricsExpansion.value, [0, 1], [40, 0], Extrapolation.CLAMP) }]
    }));

    const textStyle = useAnimatedStyle(() => ({ color: animColors.text.value }));
    const accentTextStyle = useAnimatedStyle(() => ({ color: animColors.primary.value }));
    const accentBgStyle = useAnimatedStyle(() => ({ backgroundColor: animColors.primary.value }));
    // Safe animated style for mini-shell orb — avoids reading .value during JSX render
    const miniOrbStyle = useAnimatedStyle(() => ({ backgroundColor: animColors.primary.value + '2A' }));

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
        showLyrics, isLyricsExpanded
    };

    return (
        <Animated.View style={[styles.root, rootAnimatedStyle]}>
            <GestureDetector gesture={Gesture.Exclusive(panGesture, tapGesture)}>
                <Animated.View style={[styles.mainContainer, mainContainerStyle]}>
                    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, miniShellStyle, { zIndex: 2 }]}>
                        <View style={styles.miniShellAuraLayer}>
                            <Animated.View style={[styles.miniShellAuraOrbPrimary, miniOrbStyle]} />
                        </View>
                        <Animated.View style={styles.miniShellMetaRow}>
                            <View style={styles.miniShellMetaTextWrap}>
                                <Text numberOfLines={1} style={[styles.miniShellTitle, { color: textColor }]}>{track.title}</Text>
                                <Text numberOfLines={1} style={[styles.miniShellArtist, { color: textColor + 'B3' }]}>{track.artist}</Text>
                            </View>
                        </Animated.View>
                    </Animated.View>

                    {isVisible && (
                        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, themeBackgroundFadeStyle]}>
                            <ThemeBackground colors={albumColors} animColors={animColors} artwork={track.artwork} isVisible={animationsActive} expansion={expansion} />
                        </Animated.View>
                    )}

                    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, lyricsBgOverlayStyle]} pointerEvents="none" />

                    {!isLyricsExpanded && !showQueue && (
                        <Animated.View style={[artworkShadowStyle, { zIndex: 10 }]}>
                            <Animated.View style={artworkContainerStyle}>
                                <Image
                                    source={{ uri: track.artwork }}
                                    style={styles.fullImage}
                                    contentFit="cover"
                                    transition={600}
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

                    {queueVisible && !isLyricsExpanded && (
                        <QueueOverlay
                            queue={paginatedQueue}
                            currentTrackId={track.id}
                            accentColor={accentColor}
                            textColor={textColor}
                            backgroundColor={albumColors.background + 'F0'}
                            animStyle={queueOverlayAnimStyle}
                            onClose={handleCloseQueue}
                            onTrackPress={(idx) => { skipTo(idx); handleCloseQueue(); }}
                            onRemove={removeFromQueue}
                            onDragEnd={handleQueueDragEnd}
                            loadMore={loadMoreQueue}
                        />
                    )}
                </Animated.View>
            </GestureDetector>

            {isLyricsExpanded && (
                <Animated.View style={[StyleSheet.absoluteFill, lyricsContentAnimStyle]} pointerEvents="box-none">
                    <View style={StyleSheet.absoluteFill}>
                        <View style={styles.fullScreenLyricsHeader}>
                            <IconButton icon="close-circle" size={36} iconColor="#FFFFFF" onPress={() => { setShowLyrics(false); toggleLyricsFull(false); }} />
                            <View style={styles.lyricsModeContainer}>
                                {trackLyrics && lrcLyrics && (
                                    <View style={styles.lyricsModeSwitcher}>
                                        <Pressable onPress={() => setLyricsMode('synced')} style={[styles.modeTab, lyricsMode === 'synced' && styles.modeTabActive]}>
                                            <Text style={[styles.modeTabText, lyricsMode === 'synced' && { color: accentColor }]}>SINCRONIZADAS</Text>
                                        </Pressable>
                                        <Pressable onPress={() => setLyricsMode('lrc')} style={[styles.modeTab, lyricsMode === 'lrc' && styles.modeTabActive]}>
                                            <Text style={[styles.modeTabText, lyricsMode === 'lrc' && { color: accentColor }]}>LRC</Text>
                                        </Pressable>
                                    </View>
                                )}
                            </View>
                        </View>
                        {(lyricsMode === 'synced' ? trackLyrics : lrcLyrics) ? (
                            <KaraokeView
                                style={{ flex: 1 }}
                                lyrics={(lyricsMode === 'synced' ? trackLyrics : lrcLyrics)!.lyrics}
                                currentTimeMs={nativePositionMs}
                                isPlaying={isPlaying}
                                fontSize={26}
                                isLineByLine={lyricsMode === 'lrc'}
                                activeColor={processColor(accentColor || '#FFFFFF')}
                                inactiveColor={processColor((textColor || '#FFFFFF') + '33')}
                                glowColor={processColor(accentColor || '#FFFFFF')}
                                onSeek={({ nativeEvent }) => seek(nativeEvent.timeMs / 1000)}
                            />
                        ) : (
                            <View style={styles.lyricsFallbackState}>
                                {(isLyricsLoading || isDownloadingLrc) ? (
                                    <LyricsSkeleton isDownloading={isDownloadingLrc} />
                                ) : (
                                    <View style={{ alignItems: 'center' }}>
                                        <Text style={styles.lyricsFallbackTitle}>No se encontraron letras</Text>
                                        <Button
                                            mode="contained"
                                            onPress={handleDownloadLrc}
                                            icon="cloud-download"
                                            style={[styles.downloadBtn, { backgroundColor: lrcError ? '#CC4444' : accentColor }]}
                                        >
                                            {lrcError ? 'Reintentar' : 'Descargar Letras'}
                                        </Button>
                                        {lrcError && (
                                            <Text style={styles.lyricsFallbackSubtitle}>{lrcError}</Text>
                                        )}
                                    </View>
                                )}
                            </View>
                        )}
                    </View>
                </Animated.View>
            )}
        </Animated.View>
    );
}
