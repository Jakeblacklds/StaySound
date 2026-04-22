/**
 * FullPlayer - Material 3 Expressive Container Transform Player
 *
 * Optimized & Scalable Version
 */

import { useDynamicColorsWithOptions, usePlayerColors } from '@/src/hooks';
import { searchTidalArtists } from '@/src/services/tidalService';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useAnimatedColors, usePerformanceProfile, useTheme } from '@/src/theme';
import { Image } from 'expo-image';
import { usePathname, useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { BackHandler, Dimensions, Share, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useUIStore } from '@/src/stores/uiStore';
import Animated, {
    Easing,
    Extrapolation,
    interpolate,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconName } from '../ui';
import { ThemeBackground } from './backgrounds/ThemeBackground';
import { PlayerLyricsLayer } from './parts/PlayerLyricsLayer';
import { PlayerQueueOverlayLayer } from './parts/PlayerQueueOverlayLayer';
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




const M3_SNAP_SPRING = {
    damping: 26,
    stiffness: 340,
    mass: 0.5,
    restDisplacementThreshold: 0.01,
    restSpeedThreshold: 2,
};

const EXPAND_DURATION = 400;
const COLLAPSE_DURATION = 320;

function normalizeArtistSearchValue(value?: string | null) {
    return (value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}


export function FullPlayer() {
    const { theme, config, isDark } = useTheme();
    const performanceProfile = usePerformanceProfile();
    const themeAnimatedColors = useAnimatedColors();
    const pathname = usePathname();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const isVisible = usePlayerStore(state => state.playerVisible);
    const setPlayerVisible = usePlayerStore(state => state.setPlayerVisible);
    const setExpansion = usePlayerStore(state => state.setExpansion);
    const artistNavigationInFlightRef = useRef(false);
    const lastArtistRouteRef = useRef<string | null>(null);

    const playerVariant = usePlayerStore(state => state.playerVariant);
    const currentTrack = usePlayerStore(state => state.currentTrack);
    const isPlaying = usePlayerStore(state => state.isPlaying);
    const isLoading = usePlayerStore(state => state.isLoading);
    const pendingTrackPreview = usePlayerStore(state => state.pendingTrackPreview);
    const shuffleEnabled = usePlayerStore(state => state.shuffleEnabled);
    const repeatMode = usePlayerStore(state => state.repeatMode);

    // Track-switching & seek debounce: prevents icon flicker during track changes or seeking.
    // When the track ID changes we hold isPlayingVisual=true for 800ms.
    // We also hold it true if isLoading=true (e.g. buffering after a seek).
    const [isTrackSwitching, setIsTrackSwitching] = useState(false);
    const lastTrackIdRef = useRef<string | null>(null);
    const isPlayingVisual = isPlaying || isTrackSwitching || isLoading;

    React.useEffect(() => {
        const newId = currentTrack?.id ?? null;
        if (newId && newId !== lastTrackIdRef.current) {
            lastTrackIdRef.current = newId;
            setIsTrackSwitching(true);
            const timer = setTimeout(() => setIsTrackSwitching(false), 800);
            return () => clearTimeout(timer);
        }
    }, [currentTrack?.id]);

    // Animated glow progress (0 = paused, 1 = playing) — drives smooth opacity/scale
    const playGlowProgress = useSharedValue(0);

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
    const { playerSurfaceColor } = usePlayerColors({
        themeBackground: theme.colors.background,
        themePrimary: theme.colors.primary,
        isDark,
        shouldUseThemePlayerColors,
        playerColors,
        accentColor,
        textColor,
    });

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
        lyricsExpansion.value = val
            ? withSpring(1, { damping: 18, stiffness: 120, mass: 1 })
            : withTiming(0, {
                duration: lightweightMode ? 160 : 200,
                easing: M3_EMPHASIZED_ACCEL,
            });
    };

    React.useEffect(() => {
        if (showLyrics) toggleLyricsFull(true);
        else toggleLyricsFull(false);
    }, [showLyrics]);

    React.useEffect(() => {
        // On track change: do NOT close the lyrics — let the crossfade handle the transition.
        // Only reset the artwork scale animation.
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

    const handleAlbumPress = useCallback(async () => {
        const albumName = currentTrack?.album?.trim();
        const albumId = currentTrack?.albumId?.trim();
        if (!albumName || !albumId) return;

        setPlayerVisible(false);
        router.navigate({
            pathname: '/tidal-album/[id]',
            params: { id: albumId, name: albumName },
        });
    }, [currentTrack?.album, currentTrack?.albumId, router, setPlayerVisible]);

    const handleShareSong = useCallback(async () => {
        if (!currentTrack) return;
        try {
            await Share.share({
                message: `Check out ${currentTrack.title} by ${currentTrack.artist} on StaySound!`,
                title: 'StaySound Shared Track',
            });
        } catch (error) {
            console.error('[FullPlayer] Error sharing:', error);
        }
    }, [currentTrack]);

    const openActionSheet = useUIStore(s => s.openActionSheet);

    function handleOpenMoreOptions() {
        if (!currentTrack) return;

        openActionSheet({
            title: currentTrack.title,
            subtitle: currentTrack.artist,
            track: currentTrack,
            actions: [
                {
                    label: 'Ir al Artista',
                    icon: 'account-music',
                    onPress: handleArtistPress,
                },
                {
                    label: 'Ir al Álbum',
                    icon: 'album',
                    onPress: handleAlbumPress,
                },
                {
                    label: 'Añadir a Playlist',
                    icon: 'playlist-plus',
                    onPress: () => {
                        // TODO: Implement Playlist Selector Modal
                    },
                },
                {
                    label: 'Ecualizador',
                    icon: 'equalizer',
                    onPress: () => {
                        setPlayerVisible(false);
                        // @ts-ignore
                        router.push('/equalizer');
                    },
                },
                {
                    label: 'Compartir canción',
                    icon: 'share-variant',
                    onPress: handleShareSong,
                },
            ],
        });
    }

    const handleArtistPress = useCallback(async () => {
        const artistName = currentTrack?.artist?.trim();
        if (!artistName || artistNavigationInFlightRef.current) return;

        artistNavigationInFlightRef.current = true;
        setPlayerVisible(false);

        try {
            let artistId = currentTrack?.artistId?.trim() || '';

            if (!/^\d+$/.test(artistId)) {
                const matches = await searchTidalArtists(artistName);
                const normalizedArtistName = normalizeArtistSearchValue(artistName);
                const bestMatch = matches.find(candidate =>
                    normalizeArtistSearchValue(candidate.name) === normalizedArtistName
                ) ?? matches[0];

                artistId = bestMatch ? String(bestMatch.id) : '';
            }

            if (!artistId) return;

            const targetRoute = `/tidal-artist/${artistId}`;
            if (pathname === targetRoute || lastArtistRouteRef.current === targetRoute) {
                return;
            }

            lastArtistRouteRef.current = targetRoute;
            router.navigate({
                pathname: '/tidal-artist/[id]',
                params: { id: artistId, name: artistName },
            });
        } finally {
            setTimeout(() => {
                artistNavigationInFlightRef.current = false;
                lastArtistRouteRef.current = null;
            }, 500);
        }
    }, [currentTrack?.artist, currentTrack?.artistId, pathname, router, setPlayerVisible]);

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
            elevation: interpolate(p, [0, 1], [0, 20], Extrapolation.CLAMP),
            shadowColor: playerAnimColors.primary.value,
            shadowOffset: { width: 0, height: interpolate(p, [0, 1], [0, 16], Extrapolation.CLAMP) },
            shadowOpacity: interpolate(p, [0, 1], [0, 0.55], Extrapolation.CLAMP),
            shadowRadius: interpolate(p, [0, 1], [0, 24], Extrapolation.CLAMP),
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
        // Use animated colors in both modes for smooth transitions.
        // In light mode, blend album background with theme surface (25%) via playerSurfaceColor.
        backgroundColor: playerAnimColors?.background?.value || (isDark ? playerColors.background : playerSurfaceColor) || theme.colors.background,
    }));
    const themeBackgroundFadeStyle = useAnimatedStyle(() => ({
        // Light mode: show at 80% so dynamic blobs are clearly visible.
        opacity: interpolate(expansion.value, [0, 0.12, 0.42], [0, isDark ? 0.04 : 0.03, isDark ? 1 : 0.80], Extrapolation.CLAMP)
    }));
    const lyricsBgOverlayStyle = useAnimatedStyle(() => ({ opacity: interpolate(lyricsExpansion.value, [0, 1], [0, 0.6]) }));
    const lyricsContentAnimStyle = useAnimatedStyle(() => ({
        opacity: lyricsExpansion.value,
        transform: [
            { translateY: interpolate(lyricsExpansion.value, [0, 1], [32, 0], Extrapolation.CLAMP) },
            { scale: interpolate(lyricsExpansion.value, [0, 1], [0.94, 1], Extrapolation.CLAMP) }
        ]
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
        track, isPlaying: isPlayingVisual, shuffleEnabled, repeatMode, isFavorite, accentColor, textColor, onPrimaryColor,
        qualityBadge, qualityBadgeInk, trackTechLabel, shuffleIcon, repeatIcon, playIcon, pauseIcon, nextIcon, previousIcon,
        onClose: () => setPlayerVisible(false), onToggleLyrics: () => setShowLyrics(!showLyrics),
        onArtistPress: handleArtistPress,
        onOpenQueue: handleOpenQueue, onToggleFavorite: () => toggleFavorite(track.id),
        onToggleShuffle: toggleShuffle, onCycleRepeatMode: cycleRepeatMode,
        onPlayPause: togglePlayPause, onNext: next, onPrevious: previous, onSeek: seek,
        onOpenMoreOptions: handleOpenMoreOptions,
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
                                    isVisible={isVisible}
                                    expansion={expansion}
                                    lightweight={lightweightMode}
                                    isDark={isDark}
                                />
                            </Animated.View>
                        )}

                        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, lyricsBgOverlayStyle]} pointerEvents="none" />

                        {!isLyricsExpanded && !showQueue && (
                            <Animated.View style={[artworkShadowStyle, { zIndex: 10 }]}>
                                <Animated.View style={artworkContainerStyle}>
                                    <Image
                                        source={{ uri: track.artwork || track.artworkThumb }}
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

            {isVisible ? (
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

