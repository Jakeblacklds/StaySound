/**
 * MiniPlayer - Floating player bar with gesture expansion support
 * 
 * Performance: Optimized for 120fps scroll coexistence.
 * - Restored Dynamic Colors & Premium Aesthetics (WOW factor).
 * - Focused selectors to avoid re-renders.
 * - Minimal Reanimated mappings: only updates when expansion OR track changes.
 * - React.memo to isolate from layout changes.
 */

import { useDynamicColors } from '@/src/hooks';
import { usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { usePathname } from 'expo-router';
import React, { useCallback, useEffect, useMemo } from 'react';
import { Dimensions, Pressable, StyleSheet, View } from 'react-native';
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

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

// Sync constants with FullPlayer
const MINI_HEIGHT = 72;
const MINI_MARGIN = 14;
const TAB_BAR_HEIGHT = 88;
const TAB_BAR_FLOAT_OFFSET = 10;
const MINI_GAP_FROM_TAB = 10;
const DETAIL_HEIGHT = 84;
const DETAIL_EXTRA_BOTTOM = 0;

// M3 Expressive: Emphasized easing curves
const M3_EMPHASIZED = Easing.bezier(0.2, 0.0, 0, 1.0);
const M3_EMPHASIZED_DECEL = Easing.bezier(0.05, 0.7, 0.1, 1.0);

const EXPAND_DURATION = 400;
const COLLAPSE_DURATION = 320;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function MiniPlayerInner() {
    const { theme, config } = useTheme();
    const pathname = usePathname();
    const insets = useSafeAreaInsets();

    // ─── Focused Selectors ───────────────────────────────────────────
    const currentTrack = usePlayerStore(s => s.currentTrack);
    const isPlaying = usePlayerStore(s => s.isPlaying);
    const togglePlayPause = usePlayerStore(s => s.togglePlayPause);
    const setPlayerVisible = usePlayerStore(s => s.setPlayerVisible);
    const stop = usePlayerStore(s => s.stop);
    const expansion = usePlayerStore(s => s.expansion);

    const surfaceColor = theme.colors.surface;
    const insetsBottom = insets.bottom;

    // ─── Dynamic Colors ──────────────────────────────────────────────
    // This hook is reactive but only "works" when artwork changes.
    const { colors: albumColors, animated: animColors } = useDynamicColors(currentTrack?.artwork);

    const playerVariant = theme.components?.player?.variant || 'standard';
    const miniArtworkRadius = playerVariant === 'brutal' ? 0 : 16;
    const radius = playerVariant === 'brutal' ? 8 : 24;
    const routeProgress = useSharedValue(0);
    const translateX = useSharedValue(0);
    const isHorizontal = useSharedValue(false);
    const isVertical = useSharedValue(false);
    const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.35;
    const tabReservedSpace = config.style === 'material3'
        ? TAB_BAR_HEIGHT + TAB_BAR_FLOAT_OFFSET
        : 85;
    const collapsedBottom = Math.max(insets.bottom + tabReservedSpace + MINI_GAP_FROM_TAB, 98);

    const isDetailRoute =
        pathname.startsWith('/album/') ||
        pathname.startsWith('/artist/') ||
        pathname.startsWith('/playlist/') ||
        pathname.startsWith('/tidal-album/') ||
        pathname.startsWith('/tidal-artist/');

    useEffect(() => {
        routeProgress.value = withTiming(isDetailRoute ? 1 : 0, {
            duration: 360,
            easing: M3_EMPHASIZED_DECEL,
        });
    }, [isDetailRoute, routeProgress]);

    useEffect(() => {
        translateX.value = 0;
    }, [currentTrack?.id, translateX]);

    // ─── Performance Styles ──────────────────────────────────────────

    // Merge background animations: opacity (expansion) + colors (track change)
    const bgAnimatedStyle = useAnimatedStyle(() => {
        const routeP = routeProgress.value;
        const detailBottom = insetsBottom;
        const collapseBtm = Math.max(insetsBottom + tabReservedSpace + MINI_GAP_FROM_TAB, 98);

        return {
            backgroundColor: animColors?.background?.value || surfaceColor,
            borderColor: 'transparent',
            borderWidth: 0,
            borderTopWidth: 0,
            bottom: interpolate(routeP, [0, 1], [collapseBtm, detailBottom], Extrapolation.CLAMP),
            left: interpolate(routeP, [0, 1], [MINI_MARGIN, 0], Extrapolation.CLAMP),
            right: interpolate(routeP, [0, 1], [MINI_MARGIN, 0], Extrapolation.CLAMP),
            height: interpolate(routeP, [0, 1], [MINI_HEIGHT, DETAIL_HEIGHT], Extrapolation.CLAMP),
            borderRadius: interpolate(routeP, [0, 1], [radius, 0], Extrapolation.CLAMP),
            transform: [
                { translateY: 0 },
                { scale: interpolate(routeP, [0, 1], [1, 1.01], Extrapolation.CLAMP) },
                { translateX: translateX.value },
                { rotate: `${interpolate(translateX.value, [-SCREEN_WIDTH, 0, SCREEN_WIDTH], [-10, 0, 10], Extrapolation.CLAMP)}deg` },
            ],
            opacity: interpolate(Math.abs(translateX.value), [0, SCREEN_WIDTH * 0.8], [1, 0], Extrapolation.CLAMP),
        };
    });

    // Merge content animations: fade out and scale during expansion
    const contentAnimatedStyle = useAnimatedStyle(() => {
        const p = expansion?.value ?? 0;

        return {
            opacity: interpolate(p, [0.06, 0.88], [1, 0], Extrapolation.CLAMP),
            transform: [
                { scale: interpolate(p, [0, 0.8], [1, 0.965], Extrapolation.CLAMP) },
                { translateY: interpolate(p, [0, 0.8], [0, -3], Extrapolation.CLAMP) },
            ],
        };
    });

    const metaFadeStyle = useAnimatedStyle(() => {
        const p = expansion?.value ?? 0;
        return {
            opacity: interpolate(p, [0.1, 0.82], [1, 0], Extrapolation.CLAMP),
            transform: [{ translateY: interpolate(p, [0, 0.8], [0, -2], Extrapolation.CLAMP) }],
        };
    });

    const playFadeStyle = useAnimatedStyle(() => {
        const p = expansion?.value ?? 0;
        return {
            opacity: interpolate(p, [0.08, 0.84], [1, 0], Extrapolation.CLAMP),
            transform: [
                { scale: interpolate(p, [0, 0.8], [1, 0.9], Extrapolation.CLAMP) },
                { translateY: interpolate(p, [0, 0.8], [0, -2], Extrapolation.CLAMP) },
            ],
            borderWidth: interpolate(p, [0, 0.8], [1, 0.2], Extrapolation.CLAMP),
        };
    });

    // Color animations for text (runs on UI thread)
    const textAnimatedStyle = useAnimatedStyle(() => ({
        color: animColors?.text?.value || theme.colors.onSurface,
    }));

    const miniAuraPrimaryStyle = useAnimatedStyle(() => ({
        backgroundColor: (animColors?.primary?.value || albumColors.primary || theme.colors.primary) + '2A',
        opacity: interpolate(routeProgress.value, [0, 1], [0.85, 0.55], Extrapolation.CLAMP),
        transform: [{ translateX: interpolate(routeProgress.value, [0, 1], [0, 26], Extrapolation.CLAMP) }],
    }));

    const miniAuraSecondaryStyle = useAnimatedStyle(() => ({
        backgroundColor: (animColors?.secondary?.value || albumColors.secondary || theme.colors.secondary) + '22',
        opacity: interpolate(routeProgress.value, [0, 1], [0.8, 0.5], Extrapolation.CLAMP),
        transform: [{ translateX: interpolate(routeProgress.value, [0, 1], [0, -20], Extrapolation.CLAMP) }],
    }));

    // Gesture Handlers (Memoized)
    const containerPan = useMemo(() => Gesture.Pan()
        .onStart(() => {
            isHorizontal.value = false;
            isVertical.value = false;
        })
        .onUpdate((e) => {
            // Determine direction lock on first significant movement (5px threshold)
            if (!isHorizontal.value && !isVertical.value) {
                if (Math.abs(e.translationX) > 5 || Math.abs(e.translationY) > 5) {
                    if (Math.abs(e.translationX) > Math.abs(e.translationY)) {
                        // Only allow horizontal swipe if we are completely collapsed
                        // Checking < 0.05 accounts for floating point inaccuracies
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
                // Horizontal swipe for closing
                translateX.value = e.translationX;
            } else if (isVertical.value) {
                // Vertical swipe for expansion
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
                // Check horizontal swipe first
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
                    // Snap back horizontal
                    translateX.value = withTiming(0, {
                        duration: 250,
                        easing: M3_EMPHASIZED_DECEL
                    });
                }
            } else if (isVertical.value) {
                isVertical.value = false;
                // Vertical snaps
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
                // Snap back default fallback
                translateX.value = withTiming(0, {
                    duration: 250,
                    easing: M3_EMPHASIZED_DECEL
                });
                if (expansion) expansion.value = withTiming(0, {
                    duration: COLLAPSE_DURATION,
                    easing: M3_EMPHASIZED_DECEL,
                });
            }
        }), [collapsedBottom, expansion, setPlayerVisible, stop, SWIPE_THRESHOLD, isHorizontal, isVertical]);

    const handleTap = useCallback(() => {
        setPlayerVisible(true);
    }, [setPlayerVisible]);

    const handleToggle = useCallback(() => {
        togglePlayPause();
    }, [togglePlayPause]);

    const playPress = useSharedValue(0);

    const playButtonAnimatedStyle = useAnimatedStyle(() => {
        const p = playPress.value;

        if (playerVariant === 'cyber') {
            return {
                opacity: interpolate(p, [0, 1], [1, 0.85]),
                transform: [
                    { scale: interpolate(p, [0, 1], [1, 0.95]) },
                    { translateY: interpolate(p, [0, 1], [0, 1]) },
                ],
            };
        }

        if (playerVariant === 'brutal') {
            return {
                transform: [
                    { scale: interpolate(p, [0, 1], [1, 0.91]) },
                    { translateX: interpolate(p, [0, 1], [0, 1.8]) },
                    { translateY: interpolate(p, [0, 1], [0, 1.8]) },
                ],
            };
        }

        if (playerVariant === 'aurora') {
            return {
                transform: [
                    { scale: interpolate(p, [0, 1], [1, 0.93]) },
                    { translateY: interpolate(p, [0, 1], [0, 1.8]) },
                    { rotate: `${interpolate(p, [0, 1], [0, -2])}deg` },
                ],
            };
        }

        return {
            transform: [
                { scale: interpolate(p, [0, 1], [1, 0.94]) },
                { translateY: interpolate(p, [0, 1], [0, 1.5]) },
            ],
        };
    });

    const handlePlayPressIn = useCallback(() => {
        playPress.value = withTiming(1, {
            duration: playerVariant === 'cyber' ? 60 : 90,
            easing: Easing.out(Easing.quad),
        });
    }, [playPress, playerVariant]);

    const handlePlayPressOut = useCallback(() => {
        playPress.value = withTiming(0, {
            duration: playerVariant === 'brutal' ? 110 : 140,
            easing: Easing.out(Easing.cubic),
        });
    }, [playPress, playerVariant]);

    if (!currentTrack) return null;

    return (
        <GestureDetector gesture={containerPan}>
            <Animated.View style={[
                styles.container,
                { borderRadius: radius },
                bgAnimatedStyle
            ]}>
                <View pointerEvents="none" style={styles.miniAuraLayer}>
                    <Animated.View style={[styles.miniAuraOrbPrimary, miniAuraPrimaryStyle]} />
                    <Animated.View style={[styles.miniAuraOrbSecondary, miniAuraSecondaryStyle]} />
                </View>
                <Animated.View style={[styles.content, contentAnimatedStyle]}>
                    <Pressable onPress={handleTap} style={styles.tappableArea}>
                        <View style={[
                            styles.artworkContainer,
                            { borderRadius: miniArtworkRadius }
                        ]}>
                            {currentTrack.artwork ? (
                                <Image
                                    source={{ uri: currentTrack.artwork }}
                                    style={styles.artwork}
                                    contentFit="cover"
                                    recyclingKey={currentTrack.id}
                                    cachePolicy="memory-disk"
                                    transition={0}
                                />
                            ) : null}
                        </View>

                        <Animated.View style={[styles.info, metaFadeStyle]}>
                            <Animated.Text numberOfLines={1} style={[styles.titleText, textAnimatedStyle]}>
                                {currentTrack.title}
                            </Animated.Text>
                            <Animated.Text numberOfLines={1} style={[styles.artistText, textAnimatedStyle]}>
                                {currentTrack.artist}
                            </Animated.Text>
                        </Animated.View>
                    </Pressable>

                    <AnimatedPressable
                        onPress={handleToggle}
                        onPressIn={handlePlayPressIn}
                        onPressOut={handlePlayPressOut}
                        style={[
                            styles.playButton,
                            {
                                backgroundColor: (albumColors.primary || theme.colors.primary) + '2B',
                                borderColor: (albumColors.primary || theme.colors.primary) + '7A',
                            },
                            playButtonAnimatedStyle,
                            playFadeStyle,
                        ]}
                        hitSlop={12}
                    >
                        <MaterialCommunityIcons
                            name={isPlaying ? "pause" : "play"}
                            size={24}
                            color={albumColors.text || theme.colors.onSurface}
                        />
                    </AnimatedPressable>
                </Animated.View>
            </Animated.View>
        </GestureDetector>
    );
}

export const MiniPlayer = React.memo(MiniPlayerInner);

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        bottom: 0,
        left: MINI_MARGIN,
        right: MINI_MARGIN,
        height: MINI_HEIGHT,
        elevation: 10,
        shadowColor: 'black',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.24,
        shadowRadius: 12,
        overflow: 'hidden',
    },
    content: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        zIndex: 1,
    },
    artworkContainer: {
        width: 52,
        height: 52,
        overflow: 'hidden',
    },
    artwork: {
        width: '100%',
        height: '100%',
    },
    info: {
        flex: 1,
        marginLeft: 12,
        marginRight: 8,
    },
    titleText: {
        fontSize: 13,
        fontWeight: '800',
        letterSpacing: -0.1,
    },
    artistText: {
        fontSize: 11,
        opacity: 0.7,
    },
    playButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    tappableArea: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    miniAuraLayer: {
        ...StyleSheet.absoluteFillObject,
        overflow: 'hidden',
    },
    miniAuraOrbPrimary: {
        position: 'absolute',
        width: 210,
        height: 210,
        borderRadius: 105,
        top: -84,
        right: -48,
    },
    miniAuraOrbSecondary: {
        position: 'absolute',
        width: 180,
        height: 180,
        borderRadius: 90,
        bottom: -96,
        left: -40,
    },
});
