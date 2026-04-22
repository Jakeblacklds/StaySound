import { useDynamicColors } from '@/src/hooks';
import { getMiniPlayerButtonColors } from '@/src/hooks/usePlayerColors';
import { usePlayerStore } from '@/src/stores';
import { useUIStore } from '@/src/stores/uiStore';
import { useAnimatedColors, usePerformanceProfile, useTheme } from '@/src/theme';
import { mixHexColors } from '@/src/utils/colorContrast';
import { usePathname } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Pressable, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    Easing,
    Extrapolation,
    interpolate,
    runOnJS,
    useAnimatedReaction,
    useAnimatedStyle,
    useSharedValue,
    withTiming
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MiniPlayerShell } from './parts/MiniPlayerShell';
import {
    DETAIL_EXTRA_BOTTOM,
    DETAIL_HEIGHT,
    MINI_HEIGHT,
    TAB_BAR_FLOAT_OFFSET,
    TAB_BAR_HEIGHT,
    isPlayerDetailRoute,
} from './playerLayout';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

const M3_EMPHASIZED = Easing.bezier(0.2, 0.0, 0, 1.0);
const M3_EMPHASIZED_DECEL = Easing.bezier(0.05, 0.7, 0.1, 1.0);
const EXPAND_DURATION = 400;
const COLLAPSE_DURATION = 320;
const TRACK_SWITCH_HOLD_MS = 700;

function SharedPlayerShellInner() {
    const { theme, config, isDark } = useTheme();
    const performanceProfile = usePerformanceProfile();
    const themeAnimatedColors = useAnimatedColors();
    const pathname = usePathname();
    const insets = useSafeAreaInsets();

    const currentTrack = usePlayerStore(s => s.currentTrack);
    const pendingTrackPreview = usePlayerStore(s => s.pendingTrackPreview);
    const isPlaying = usePlayerStore(s => s.isPlaying);
    const isLoading = usePlayerStore(s => s.isLoading);
    const togglePlayPause = usePlayerStore(s => s.togglePlayPause);
    const setPlayerVisible = usePlayerStore(s => s.setPlayerVisible);
    const stop = usePlayerStore(s => s.stop);
    const expansion = usePlayerStore(s => s.expansion);
    const playerVisible = usePlayerStore(s => s.playerVisible);
    const actionSheetVisible = useUIStore(s => s.actionSheetVisible);
    const confirmModalVisible = useUIStore(s => s.confirmModalVisible);

    const canUsePendingPreview = Boolean(pendingTrackPreview) && (
        !currentTrack
        || currentTrack.id === pendingTrackPreview?.id
        || currentTrack.source === 'tidal'
        || currentTrack.source === 'tidal_stream'
        || currentTrack.source === 'spotify'
        || Boolean(currentTrack.cloudOnly)
    );
    const displayTrack = canUsePendingPreview ? pendingTrackPreview : currentTrack;
    const hasBlockingOverlay = actionSheetVisible || confirmModalVisible;
    const shouldShowTidalLoading = canUsePendingPreview
        || (isLoading && (currentTrack?.source === 'tidal' || currentTrack?.source === 'tidal_stream'));
    const [isTrackSwitching, setIsTrackSwitching] = useState(false);
    const [shellInteractive, setShellInteractive] = useState(true);
    const lastTrackIdRef = useRef<string | null>(null);
    const shouldHoldPauseAffordance = !shouldShowTidalLoading && (isPlaying || isLoading || isTrackSwitching);
    const shellArtworkUri = currentTrack?.artworkThumb || displayTrack?.artwork;
    const { colors: albumColors, animated: animColors } = useDynamicColors(shellArtworkUri, {
        enabled: performanceProfile.enableDynamicColors,
    });
    const shouldUseThemePlayerColors = !performanceProfile.enableDynamicColors;
    const playerColors = shouldUseThemePlayerColors
        ? {
            primary: theme.colors.primary,
            secondary: theme.colors.secondary,
            background: theme.colors.surface,
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
            background: themeAnimatedColors.surface,
            accent: themeAnimatedColors.primary,
            text: themeAnimatedColors.onSurface,
        }
        : animColors;
    const playButtonBaseColor = playerColors.primary || theme.colors.primary;
    const playButtonIconColor = playerColors.text || theme.colors.onSurface;
    const playButtonColors = getMiniPlayerButtonColors(playButtonBaseColor, playButtonIconColor);
    const miniPlayerSurfaceColor = React.useMemo(() => {
        if (shouldUseThemePlayerColors) {
            return theme.colors.surface;
        }

        // In light mode, blend more aggressively (22%) so the album palette is visible.
        return mixHexColors(
            theme.colors.surface,
            playerColors.background || theme.colors.surface,
            isDark ? 1.0 : 0.22
        );
    }, [isDark, playerColors.background, shouldUseThemePlayerColors, theme.colors.surface]);

    const routeProgress = useSharedValue(0);
    const translateX = useSharedValue(0);
    const isHorizontal = useSharedValue(false);
    const isVertical = useSharedValue(false);
    const playPress = useSharedValue(0);
    const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.35;
    const tabReservedSpace = config.style === 'material3'
        ? TAB_BAR_HEIGHT + TAB_BAR_FLOAT_OFFSET
        : 85;
    const collapsedBottom = Math.max(insets.bottom + TAB_BAR_HEIGHT, 78);
    const isDetailRoute = isPlayerDetailRoute(pathname);

    useEffect(() => {
        routeProgress.value = withTiming(isDetailRoute ? 1 : 0, {
            duration: 360,
            easing: M3_EMPHASIZED_DECEL,
        });
    }, [isDetailRoute, routeProgress]);

    useEffect(() => {
        translateX.value = 0;
    }, [displayTrack?.id, translateX]);

    useEffect(() => {
        const nextTrackId = displayTrack?.id ?? null;
        const prevTrackId = lastTrackIdRef.current;

        if (!nextTrackId) {
            lastTrackIdRef.current = null;
            setIsTrackSwitching(false);
            return;
        }

        if (prevTrackId && prevTrackId !== nextTrackId) {
            setIsTrackSwitching(true);
            const timeout = setTimeout(() => {
                setIsTrackSwitching(false);
            }, TRACK_SWITCH_HOLD_MS);

            lastTrackIdRef.current = nextTrackId;
            return () => clearTimeout(timeout);
        }

        lastTrackIdRef.current = nextTrackId;
    }, [displayTrack?.id]);

    useEffect(() => {
        if (isPlaying || shouldShowTidalLoading) {
            setIsTrackSwitching(false);
        }
    }, [isPlaying, shouldShowTidalLoading]);

    useAnimatedReaction(
        () => (expansion?.value ?? 0) < 0.42,
        (next, prev) => {
            if (next !== prev) {
                runOnJS(setShellInteractive)(next);
            }
        },
        [expansion]
    );

    const shellContainerStyle = useAnimatedStyle(() => {
        const routeP = routeProgress.value;
        const p = expansion?.value ?? 0;
        const detailBottom = Math.max(insets.bottom + DETAIL_EXTRA_BOTTOM, DETAIL_EXTRA_BOTTOM);
        const collapseBtm = Math.max(insets.bottom + TAB_BAR_HEIGHT, 78);

        // Use animated background in both modes for smooth palette transitions.
        const animBg = playerAnimColors?.background?.value;
        const staticBg = isDark
            ? (playerColors.background || theme.colors.surface)
            : miniPlayerSurfaceColor;

        return {
            backgroundColor: animBg || staticBg,
            bottom: interpolate(routeP, [0, 1], [collapseBtm, detailBottom], Extrapolation.CLAMP),
            left: interpolate(routeP, [0, 1], [0, 0], Extrapolation.CLAMP),
            right: interpolate(routeP, [0, 1], [0, 0], Extrapolation.CLAMP),
            height: interpolate(routeP, [0, 1], [MINI_HEIGHT, DETAIL_HEIGHT], Extrapolation.CLAMP),
            borderTopLeftRadius: interpolate(routeP, [0, 1], [26, 0], Extrapolation.CLAMP),
            borderTopRightRadius: interpolate(routeP, [0, 1], [26, 0], Extrapolation.CLAMP),
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            transform: [
                { scale: interpolate(p, [0, 0.22, 0.45], [1, 1.015, 1.035], Extrapolation.CLAMP) },
                { translateY: interpolate(p, [0, 0.45], [0, -14], Extrapolation.CLAMP) },
                { translateX: translateX.value },
                { rotate: `${interpolate(translateX.value, [-SCREEN_WIDTH, 0, SCREEN_WIDTH], [-10, 0, 10], Extrapolation.CLAMP)}deg` },
            ],
            opacity: interpolate(p, [0, 0.36, 0.48], [1, 1, 0], Extrapolation.CLAMP)
                * interpolate(Math.abs(translateX.value), [0, SCREEN_WIDTH * 0.8], [1, 0], Extrapolation.CLAMP),
        };
    });

    const shellContentStyle = useAnimatedStyle(() => {
        const p = expansion?.value ?? 0;
        return {
            opacity: interpolate(p, [0, 0.22, 0.38], [1, 1, 0], Extrapolation.CLAMP),
            transform: [
                { scale: interpolate(p, [0, 0.3], [1, 0.985], Extrapolation.CLAMP) },
                { translateY: interpolate(p, [0, 0.3], [0, -2], Extrapolation.CLAMP) },
            ],
        };
    });

    const metaFadeStyle = useAnimatedStyle(() => {
        const p = expansion?.value ?? 0;
        return {
            opacity: interpolate(p, [0, 0.18, 0.34], [1, 1, 0], Extrapolation.CLAMP),
            transform: [{ translateY: interpolate(p, [0, 0.34], [0, -1], Extrapolation.CLAMP) }],
        };
    });

    const playFadeStyle = useAnimatedStyle(() => {
        const p = expansion?.value ?? 0;
        return {
            opacity: interpolate(p, [0, 0.18, 0.34], [1, 1, 0], Extrapolation.CLAMP),
            transform: [
                { scale: interpolate(p, [0, 0.34], [1, 0.96], Extrapolation.CLAMP) },
                { translateY: interpolate(p, [0, 0.34], [0, -1], Extrapolation.CLAMP) },
                { scale: interpolate(playPress.value, [0, 1], [1, 0.94], Extrapolation.CLAMP) },
            ],
        };
    });

    const titleAnimatedStyle = useAnimatedStyle(() => ({
        color: playerAnimColors?.primary?.value || playerColors.primary || theme.colors.primary,
    }));
    const artistAnimatedStyle = useAnimatedStyle(() => ({
        color: playerAnimColors?.text?.value || playerColors.text || theme.colors.onSurface,
        opacity: 0.72,
    }));

    const panGesture = useMemo(() => Gesture.Pan()
        .enabled(shellInteractive)
        .onStart(() => {
            isHorizontal.value = false;
            isVertical.value = false;
        })
        .onUpdate((e) => {
            if (!isHorizontal.value && !isVertical.value) {
                if (Math.abs(e.translationX) > 5 || Math.abs(e.translationY) > 5) {
                    if (Math.abs(e.translationX) > Math.abs(e.translationY)) {
                        if (!expansion || expansion.value < 0.05) {
                            isHorizontal.value = true;
                        } else {
                            isVertical.value = true;
                        }
                    } else {
                        isVertical.value = true;
                    }
                }
            }

            if (isHorizontal.value) {
                translateX.value = e.translationX;
            } else if (isVertical.value) {
                if (expansion) {
                    const travelRange = Math.max(240, SCREEN_HEIGHT - (collapsedBottom + MINI_HEIGHT));
                    const newVal = (-e.translationY / travelRange);
                    expansion.value = Math.max(0, Math.min(1, newVal));
                }
            }
        })
        .onEnd((e) => {
            if (isHorizontal.value) {
                isHorizontal.value = false;
                if (Math.abs(e.translationX) > SWIPE_THRESHOLD || Math.abs(e.velocityX) > 1000) {
                    const targetX = e.translationX > 0 ? SCREEN_WIDTH : -SCREEN_WIDTH;
                    translateX.value = withTiming(targetX, {
                        duration: 300,
                        easing: Easing.out(Easing.cubic)
                    }, (finished) => {
                        if (finished) {
                            runOnJS(stop)();
                        }
                    });
                } else {
                    translateX.value = withTiming(0, {
                        duration: 250,
                        easing: M3_EMPHASIZED_DECEL
                    });
                }
            } else if (isVertical.value) {
                isVertical.value = false;
                if (e.translationY < -120 || e.velocityY < -800) {
                    if (expansion) expansion.value = withTiming(1, {
                        duration: EXPAND_DURATION,
                        easing: M3_EMPHASIZED,
                    });
                    runOnJS(setPlayerVisible)(true);
                } else {
                    if (expansion) expansion.value = withTiming(0, {
                        duration: COLLAPSE_DURATION,
                        easing: M3_EMPHASIZED_DECEL,
                    });
                    runOnJS(setPlayerVisible)(false);
                }
            } else {
                translateX.value = withTiming(0, {
                    duration: 250,
                    easing: M3_EMPHASIZED_DECEL
                });
                if (expansion) expansion.value = withTiming(0, {
                    duration: COLLAPSE_DURATION,
                    easing: M3_EMPHASIZED_DECEL,
                });
            }
        }), [collapsedBottom, expansion, setPlayerVisible, stop, SWIPE_THRESHOLD, isHorizontal, isVertical, shellInteractive]);

    const handleTap = useCallback(() => {
        setPlayerVisible(true);
    }, [setPlayerVisible]);

    const handleToggle = useCallback(() => {
        if (shouldShowTidalLoading) return;
        togglePlayPause();
    }, [shouldShowTidalLoading, togglePlayPause]);

    const handlePlayPressIn = useCallback(() => {
        playPress.value = withTiming(1, {
            duration: 90,
            easing: Easing.out(Easing.quad),
        });
    }, [playPress]);

    const handlePlayPressOut = useCallback(() => {
        playPress.value = withTiming(0, {
            duration: 140,
            easing: Easing.out(Easing.cubic),
        });
    }, [playPress]);

    if (!displayTrack || hasBlockingOverlay) return null;

    return (
        <GestureDetector gesture={panGesture}>
            <Animated.View
                pointerEvents={shellInteractive || !playerVisible ? 'auto' : 'none'}
                style={[styles.container, shellContainerStyle]}
            >
                <MiniPlayerShell
                    variant="row"
                    track={displayTrack}
                    textColor={playButtonIconColor}
                    buttonFillColor={playButtonColors.fill}
                    buttonBorderColor={playButtonColors.border}
                    showLoading={shouldShowTidalLoading}
                    showPause={shouldHoldPauseAffordance}
                    onPress={handleTap}
                    onToggle={handleToggle}
                    onPressIn={handlePlayPressIn}
                    onPressOut={handlePlayPressOut}
                    contentStyle={shellContentStyle}
                    metaStyle={metaFadeStyle}
                    titleStyle={titleAnimatedStyle}
                    artistStyle={artistAnimatedStyle}
                    playButtonStyle={playFadeStyle}
                />
            </Animated.View>
        </GestureDetector>
    );
}

export const SharedPlayerShell = React.memo(SharedPlayerShellInner);

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: MINI_HEIGHT,
        elevation: 0,
        shadowColor: 'transparent',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0,
        shadowRadius: 0,
        overflow: 'hidden',
        zIndex: 10001,
    },
});
