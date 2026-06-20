import { useDynamicColors } from '@/src/hooks';
import { pickReadableColor } from '@/src/utils/colorContrast';
import { usePlayerStore } from '@/src/stores';
import { useUIStore } from '@/src/stores/uiStore';
import { useAnimatedColors, usePerformanceProfile, useTheme } from '@/src/theme';
import { usePathname } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    Easing,
    Extrapolation,
    interpolate,
    runOnJS,
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
    TAB_BAR_HEIGHT,
    isPlayerDetailRoute,
} from './playerLayout';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const M3_EMPHASIZED = Easing.bezier(0.2, 0.0, 0, 1.0);
const M3_EMPHASIZED_DECEL = Easing.bezier(0.05, 0.7, 0.1, 1.0);
const EXPAND_DURATION = 280;
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
    const lastTrackIdRef = useRef<string | null>(null);
    const shouldHoldPauseAffordance = !shouldShowTidalLoading && (isPlaying || isLoading || isTrackSwitching);
    const shellArtworkUri = pendingTrackPreview?.artwork || currentTrack?.artwork || currentTrack?.artworkThumb;
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
    // Same pill recipe as the tab bar's liquid pill so mini + navbar match.
    const playPillFill = theme.colors.primaryContainer;
    const playPillIcon = pickReadableColor(theme.colors.primaryContainer, [
        theme.colors.onPrimaryContainer,
        theme.colors.onPrimary,
        theme.colors.onSurface,
        theme.colors.onBackground,
    ]);
    const routeProgress = useSharedValue(0);
    const isVertical = useSharedValue(false);
    const playPress = useSharedValue(0);
    const collapsedBottom = (config.style === 'material3' ? TAB_BAR_HEIGHT : 85) + insets.bottom;
    const isDetailRoute = isPlayerDetailRoute(pathname);

    useEffect(() => {
        routeProgress.value = withTiming(isDetailRoute ? 1 : 0, {
            duration: 360,
            easing: M3_EMPHASIZED_DECEL,
        });
    }, [isDetailRoute, routeProgress]);

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

    const shellContainerStyle = useAnimatedStyle(() => {
        const routeP = routeProgress.value;
        const detailBottom = Math.max(insets.bottom + DETAIL_EXTRA_BOTTOM, DETAIL_EXTRA_BOTTOM);
        const collapseBtm = (config.style === 'material3' ? TAB_BAR_HEIGHT : 85) + insets.bottom;

        return {
            bottom: interpolate(routeP, [0, 1], [collapseBtm, detailBottom], Extrapolation.CLAMP),
            left: interpolate(routeP, [0, 1], [0, 0], Extrapolation.CLAMP),
            right: interpolate(routeP, [0, 1], [0, 0], Extrapolation.CLAMP),
            height: interpolate(routeP, [0, 1], [MINI_HEIGHT, DETAIL_HEIGHT], Extrapolation.CLAMP),
            borderTopLeftRadius: interpolate(routeP, [0, 1], [22, 0], Extrapolation.CLAMP),
            borderTopRightRadius: interpolate(routeP, [0, 1], [22, 0], Extrapolation.CLAMP),
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
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

    // Title uses the contrast-managed text color (not the accent) so it stays
    // readable over the translucent glass surface.
    const titleAnimatedStyle = useAnimatedStyle(() => ({
        color: playerAnimColors?.text?.value || playerColors.text || theme.colors.onSurface,
    }));
    const artistAnimatedStyle = useAnimatedStyle(() => ({
        color: playerAnimColors?.text?.value || playerColors.text || theme.colors.onSurface,
        opacity: 0.68,
    }));

    const panGesture = useMemo(() => Gesture.Pan()
        .enabled(!playerVisible)
        .onStart(() => {
            isVertical.value = false;
        })
        .onUpdate((e) => {
            if (!isVertical.value) {
                if (Math.abs(e.translationX) > 5 || Math.abs(e.translationY) > 5) {
                    if (Math.abs(e.translationY) >= Math.abs(e.translationX)) {
                        isVertical.value = true;
                    }
                }
            }

            if (isVertical.value) {
                if (expansion) {
                    const travelRange = Math.max(240, SCREEN_HEIGHT - (collapsedBottom + MINI_HEIGHT));
                    const newVal = (-e.translationY / travelRange);
                    expansion.value = Math.max(0, Math.min(1, newVal));
                }
            }
        })
        .onEnd((e) => {
            if (isVertical.value) {
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
                if (expansion) expansion.value = withTiming(0, {
                    duration: COLLAPSE_DURATION,
                    easing: M3_EMPHASIZED_DECEL,
                });
            }
        }), [collapsedBottom, expansion, setPlayerVisible, isVertical, playerVisible]);

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
                pointerEvents={playerVisible ? 'none' : 'auto'}
                style={[styles.container, shellContainerStyle]}
            >
                <MiniPlayerShell
                    variant="row"
                    track={displayTrack}
                    showArtwork={false}
                    textColor={playPillIcon}
                    buttonFillColor={playPillFill}
                    buttonBorderColor="transparent"
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
