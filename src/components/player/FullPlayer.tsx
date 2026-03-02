/**
 * FullPlayer - Material 3 Expressive Container Transform Player
 * 
 * Key improvements:
 * 1. M3 Emphasized easing curves for all transitions
 * 2. Container transform pattern: morphs from MiniPlayer position
 * 3. Staggered content reveal with spring physics
 * 4. Animation pausing when collapsed for performance
 * 5. Smooth cross-fade between mini/full states
 */

import { useDynamicColors } from '@/src/hooks';
import { LyricsRepository } from '@/src/services';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import type { KaraokeLyricsJSON } from '@/src/types/karaokeTypes';
// KaraokeLyrics (Skia JS) removed — we use native Kotlin KaraokeView on Android
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { usePathname } from 'expo-router';
import { KaraokeView } from 'karaoke-view';
import React, { useCallback, useState } from 'react';
import { BackHandler, Dimensions, Pressable, StyleProp, StyleSheet, View, ViewStyle, processColor } from 'react-native';
import DraggableFlatList, { type RenderItemParams } from 'react-native-draggable-flatlist';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Button, IconButton, Text } from 'react-native-paper';
import Animated, {
    Easing,
    Extrapolation,
    FadeIn,
    FadeOut,
    cancelAnimation,
    interpolate,
    runOnJS,
    useAnimatedReaction,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withSequence,
    withSpring,
    withTiming,
    type SharedValue
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LyricsSkeleton } from '../ui';
import { ProgressSlider } from './ProgressSlider';
import { ThemeBackground } from './backgrounds/ThemeBackground';


const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// MiniPlayer placement constants (Synced with MiniPlayer)
const MINI_HEIGHT = 72;
const MINI_MARGIN = 14;
const TAB_BAR_HEIGHT = 88;
const TAB_BAR_FLOAT_OFFSET = 10;
const MINI_GAP_FROM_TAB = 10;
const DETAIL_HEIGHT = 84;
const DETAIL_EXTRA_BOTTOM = 8;

// ═══════════════════════════════════════════════════
// M3 EXPRESSIVE MOTION TOKENS
// ═══════════════════════════════════════════════════

// Emphasized easing: "snappy take-offs and very soft landings"
const M3_EMPHASIZED = Easing.bezier(0.2, 0.0, 0, 1.0);
const M3_EMPHASIZED_DECEL = Easing.bezier(0.05, 0.7, 0.1, 1.0);
const M3_EMPHASIZED_ACCEL = Easing.bezier(0.3, 0.0, 0.8, 0.15);

// Snappy spring for pan gesture bounce-back only
const M3_SNAP_SPRING = {
    damping: 26,
    stiffness: 340,
    mass: 0.5,
    restDisplacementThreshold: 0.01,
    restSpeedThreshold: 2,
};

// Transition durations — tuned for smoothness
const EXPAND_DURATION = 400;
const COLLAPSE_DURATION = 320;

function getHexLuminance(hexColor: string): number {
    const normalized = hexColor.trim();
    const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized;

    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return 0;

    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;

    const toLinear = (channel: number) => (
        channel <= 0.03928
            ? channel / 12.92
            : Math.pow((channel + 0.055) / 1.055, 2.4)
    );

    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function getContrastingInk(bgColor: string, darkInk = '#111111', lightInk = '#F5EFE2') {
    return getHexLuminance(bgColor) > 0.42 ? darkInk : lightInk;
}

function formatKHz(sampleRate?: number): string | null {
    if (!sampleRate || sampleRate <= 0) return null;
    const khz = sampleRate / 1000;
    return Number.isInteger(khz) ? `${khz} kHz` : `${khz.toFixed(1)} kHz`;
}

function inferFormatFromUri(uri?: string): string | null {
    if (!uri) return null;
    const match = uri.toLowerCase().match(/\.([a-z0-9]+)(\?|$)/);
    if (!match) return null;
    return match[1].toUpperCase();
}

function getTrackTechLabel(track?: { quality?: string; format?: string; sampleRate?: number; bitDepth?: number; uri?: string } | null): string {
    if (!track) return 'UNKNOWN';
    const formatLabel = (track.format ?? inferFormatFromUri(track.uri) ?? 'UNKNOWN').toUpperCase();
    const sampleRateLabel = formatKHz(track.sampleRate);
    const bitDepthLabel = track.bitDepth ? `${track.bitDepth}-bit` : null;

    const parts = [formatLabel, sampleRateLabel, bitDepthLabel].filter(Boolean);
    return parts.join('  •  ');
}

function getQualityBadge(track?: { quality?: string; format?: string; uri?: string } | null) {
    if (!track) return { label: 'LOSSY', tone: '#D97706' };
    const qualityRaw = (track.quality ?? '').toUpperCase();
    const resolvedFormat = (track.format ?? inferFormatFromUri(track.uri) ?? '').toUpperCase();
    if (qualityRaw.includes('HI_RES')) return { label: 'HI-RES', tone: '#1FBF75' };
    if (qualityRaw.includes('LOSSLESS') || resolvedFormat === 'FLAC') {
        return { label: 'LOSSLESS', tone: '#3B82F6' };
    }
    return { label: 'LOSSY', tone: '#D97706' };
}

type PlayerButtonKind = 'primary' | 'nav' | 'secondary';
type PlayerVariant = 'aurora' | 'cyber' | 'brutal' | 'immersive'; const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function AnimatedPlayerButton({
    variant,
    kind,
    onPress,
    style,
    children,
}: {
    variant: PlayerVariant;
    kind: PlayerButtonKind;
    onPress: () => void;
    style?: StyleProp<ViewStyle>;
    children: React.ReactNode;
}) {
    const pressed = useSharedValue(0);

    const handlePressIn = useCallback(() => {
        pressed.value = withTiming(1, {
            duration: variant === 'cyber' ? 60 : 90,
            easing: Easing.out(Easing.quad),
        });
    }, [pressed, variant]);

    const handlePressOut = useCallback(() => {
        pressed.value = withTiming(0, {
            duration: variant === 'brutal' ? 110 : 140,
            easing: Easing.out(Easing.cubic),
        });
    }, [pressed, variant]);

    const pressStyle = useAnimatedStyle(() => {
        const p = pressed.value;

        if (variant === 'aurora') {
            const downScale = kind === 'primary' ? 0.93 : 0.96;
            return {
                transform: [
                    { scale: interpolate(p, [0, 1], [1, downScale]) },
                    { translateY: interpolate(p, [0, 1], [0, 2]) },
                    { rotate: `${interpolate(p, [0, 1], [0, -2.5])}deg` },
                ],
            };
        }

        if (variant === 'cyber') {
            const downScale = kind === 'primary' ? 0.95 : 0.97;
            return {
                opacity: interpolate(p, [0, 1], [1, 0.86]),
                transform: [
                    { scale: interpolate(p, [0, 1], [1, downScale]) },
                    { translateY: interpolate(p, [0, 1], [0, 1]) },
                ],
            };
        }

        if (variant === 'brutal') {
            const downScale = kind === 'primary' ? 0.9 : 0.93;
            return {
                transform: [
                    { scale: interpolate(p, [0, 1], [1, downScale]) },
                    { translateX: interpolate(p, [0, 1], [0, 2]) },
                    { translateY: interpolate(p, [0, 1], [0, 2]) },
                ],
            };
        }

        const downScale = kind === 'primary' ? 0.94 : 0.97;
        return {
            transform: [
                { scale: interpolate(p, [0, 1], [1, downScale]) },
                { translateY: interpolate(p, [0, 1], [0, 2]) },
            ],
        };
    });

    return (
        <AnimatedPressable
            onPress={onPress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            style={[style, pressStyle]}
        >
            {children}
        </AnimatedPressable>
    );
}

// Combines scale + shadow + tinted background for a premium drag feel
function QueueItemDecorator({
    children,
    accentColor,
    isDragging,
}: {
    children: React.ReactNode;
    accentColor: string;
    isDragging: boolean;
}) {
    const activeAnim = useSharedValue(0);

    React.useEffect(() => {
        if (isDragging) {
            // Snap up with a snappy spring
            activeAnim.value = withSpring(1, {
                damping: 18,
                stiffness: 280,
                mass: 0.35,
            });
        } else {
            // Settle back quickly with timing — no spring overshoot delay
            activeAnim.value = withTiming(0, { duration: 150 });
        }
    }, [isDragging]);

    const decoratorStyle = useAnimatedStyle(() => {
        const p = activeAnim.value;
        const scale = interpolate(p, [0, 1], [1, 1.04]);

        return {
            transform: [{ scale }],
            elevation: interpolate(p, [0, 1], [0, 12]),
            shadowColor: '#000',
            shadowOpacity: interpolate(p, [0, 1], [0, 0.3]),
            shadowRadius: interpolate(p, [0, 1], [0, 8]),
            shadowOffset: { width: 0, height: interpolate(p, [0, 1], [0, 4]) },
            backgroundColor: p > 0.01 ? accentColor + '1F' : 'transparent',
            borderRadius: 12,
            zIndex: isDragging ? 999 : 0,
        };
    }, [isDragging, accentColor]);

    return (
        <Animated.View style={decoratorStyle}>
            {children}
        </Animated.View>
    );

}

function Particle({ index, count, progress, color }: { index: number; count: number; progress: SharedValue<number>; color: string }) {
    const angle = (index * (360 / count)) * (Math.PI / 180);
    const distance = 35;

    const animatedStyle = useAnimatedStyle(() => {
        const opacity = interpolate(progress.value, [0, 0.2, 0.8, 1], [0, 1, 1, 0]);
        const scale = interpolate(progress.value, [0, 0.2, 1], [0, 1.2, 0]);
        const translateX = Math.cos(angle) * distance * progress.value;
        const translateY = Math.sin(angle) * distance * progress.value;

        return {
            position: 'absolute',
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: color,
            opacity,
            transform: [
                { translateX },
                { translateY },
                { scale }
            ],
        };
    });

    return <Animated.View style={animatedStyle} />;
}

function AnimatedFavoriteButton({
    isFavorite,
    onPress,
    activeColor,
    inactiveColor,
    size = 28,
    style,
}: {
    isFavorite: boolean;
    onPress: () => void;
    activeColor: string;
    inactiveColor: string;
    size?: number;
    style?: any;
}) {
    const scale = useSharedValue(1);
    const particleProgress = useSharedValue(0);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    const handlePress = () => {
        const becomingFavorite = !isFavorite;
        onPress();

        if (becomingFavorite) {
            // A bit more readable punch, but still stops dead.
            scale.value = withSequence(
                withTiming(1.8, { duration: 200 }),
                withSpring(1.1, { damping: 30, stiffness: 600, mass: 0.8 })
            );

            particleProgress.value = 0;
            particleProgress.value = withTiming(1, { duration: 400 });
        } else {
            // Instant snap off
            scale.value = withTiming(1, { duration: 100 });
        }
    };

    const particles = Array.from({ length: 8 });

    return (
        <View style={[style, { alignItems: 'center', justifyContent: 'center' }]}>
            {particles.map((_, i) => (
                <Particle
                    key={i}
                    index={i}
                    count={particles.length}
                    progress={particleProgress}
                    color={activeColor}
                />
            ))}
            <Animated.View style={animatedStyle}>
                <IconButton
                    icon={isFavorite ? 'heart' : 'heart-outline'}
                    size={size}
                    iconColor={isFavorite ? activeColor : inactiveColor}
                    onPress={handlePress}
                    style={{ margin: 0 }}
                />
            </Animated.View>
        </View>
    );
}

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
    const queueIndex = usePlayerStore(state => state.queueIndex);

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
    const brutalButtonBg = albumColors.isDark ? '#171717' : '#F7F2E8';
    const brutalButtonInk = getContrastingInk(brutalButtonBg);
    const brutalBorder = '#000000';
    const brutalPlayInk = getContrastingInk(accentColor);
    const playerIcons = theme.components?.player?.icons;
    const playIcon = playerIcons?.play ?? 'play';
    const pauseIcon = playerIcons?.pause ?? 'pause';
    const nextIcon = playerIcons?.next ?? 'skip-next';
    const previousIcon = playerIcons?.previous ?? 'skip-previous';
    const shuffleIcon = playerIcons?.shuffle ?? 'shuffle';
    const repeatIcon = repeatMode === 'one'
        ? (playerIcons?.repeatOne ?? 'repeat-once')
        : (playerIcons?.repeat ?? 'repeat');

    // Lyrics toggle state
    const [showLyrics, setShowLyrics] = useState(false);
    const [lyricsMode, setLyricsMode] = useState<'synced' | 'lrc'>('synced');
    const [trackLyrics, setTrackLyrics] = useState<KaraokeLyricsJSON | null>(null);
    const [lrcLyrics, setLrcLyrics] = useState<KaraokeLyricsJSON | null>(null);
    const [isLyricsLoading, setIsLyricsLoading] = useState(false);
    const [isDownloadingLrc, setIsDownloadingLrc] = useState(false);
    const [lrcError, setLrcError] = useState<string | null>(null);
    const [showQueue, setShowQueue] = useState(false);
    const [queueVisible, setQueueVisible] = useState(false);
    const [queueDraft, setQueueDraft] = useState(queue);
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
    const miniCollapsedBottom = Math.max(insets.bottom + tabReservedSpace + MINI_GAP_FROM_TAB, 98);

    const miniLeft = isDetailRoute ? 0 : MINI_MARGIN;
    const miniBottom = isDetailRoute ? Math.max(insets.bottom + DETAIL_EXTRA_BOTTOM, DETAIL_EXTRA_BOTTOM) : miniCollapsedBottom;
    const miniHeight = isDetailRoute ? DETAIL_HEIGHT : MINI_HEIGHT;
    const miniWidth = SCREEN_WIDTH - (miniLeft * 2);
    const miniRadius = isDetailRoute
        ? 0
        : activeVariant === 'brutal'
            ? 8
            : 24;

    // Position for native karaoke (synced from positionShared)
    const positionShared = usePlayerStore(state => state.positionShared);
    const [nativePositionMs, setNativePositionMs] = useState(0);

    // Bridge shared value to regular state for native component prop
    // ONLY runs when lyrics are visible — otherwise it was burning ~60 setState/s for nothing
    const updateNativePosition = useCallback((value: number) => {
        setNativePositionMs(value);
    }, []);

    const lyricsActive = showLyrics && isVisible;

    useAnimatedReaction(
        () => {
            // Skip entirely when lyrics aren't showing for performance
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

    // Auto-expand when lyrics are toggled on
    React.useEffect(() => {
        if (showLyrics) {
            toggleLyricsFull(true);
        } else {
            toggleLyricsFull(false);
        }
    }, [showLyrics]);

    const handleDownloadLrc = useCallback(async () => {
        const songTitle = currentTrack?.title?.trim();
        const artist = currentTrack?.artist?.trim();
        // track.duration está en ms (ver fileScanner: asset.duration * 1000)
        // LRCLIB espera segundos — dividimos por 1000
        const durationSec = currentTrack?.duration ? currentTrack.duration / 1000 : undefined;

        if (!songTitle || !artist) return;

        setIsDownloadingLrc(true);
        setLrcError(null);
        try {
            console.log(`[FullPlayer] Buscando en LRCLib: "${songTitle}" - "${artist}" (${durationSec}s)`);
            const payload = await LyricsRepository.getLrcLibLyrics(songTitle, artist, durationSec);
            console.log('[FullPlayer] LRCLib resultado:', payload ? `OK (${payload.lyrics?.length} líneas)` : 'null (no encontrado)');
            if (payload && Array.isArray(payload.lyrics) && payload.lyrics.length > 0) {
                setLrcLyrics(payload as KaraokeLyricsJSON);
                setLyricsMode('lrc');
            } else {
                setLrcError('No se encontraron letras para esta canción en LRCLib.');
            }
        } catch (error: any) {
            console.error('[FullPlayer] Error downloading LRC:', error);
            setLrcError('Error al descargar las letras.');
        } finally {
            setIsDownloadingLrc(false);
        }
    }, [currentTrack]);

    // Reset lyrics when track changes
    React.useEffect(() => {
        if (showLyrics) {
            setShowLyrics(false);
            setTrackLyrics(null);
            setLrcLyrics(null);
            setLyricsMode('synced');
            setLrcError(null);
        }
    }, [currentTrack?.id]);

    React.useEffect(() => {
        const songTitle = currentTrack?.title?.trim();
        const artist = currentTrack?.artist?.trim();

        if (!songTitle || !artist) {
            setTrackLyrics(null);
            setLrcLyrics(null);
            setIsLyricsLoading(false);
            return;
        }

        let cancelled = false;
        setIsLyricsLoading(true);
        setTrackLyrics(null);
        setLrcLyrics(null);

        LyricsRepository.getCachedLrcLibLyrics(songTitle, artist)
            .then((cachedLrc) => {
                if (cancelled) return;
                const hasWords = Array.isArray(cachedLrc?.lyrics) && cachedLrc.lyrics.length > 0;
                if (hasWords) {
                    setLrcLyrics(cachedLrc);
                    setLyricsMode(prev => (prev === 'synced' ? 'lrc' : prev));
                } else {
                    setLrcLyrics(null);
                }
            });

        LyricsRepository.getLyrics(songTitle, artist)
            .then((payload) => {
                if (cancelled) return;
                const hasWords = Array.isArray(payload?.lyrics) && payload.lyrics.length > 0;
                setTrackLyrics(hasWords ? payload : null);
                if (hasWords) setLyricsMode('synced');
            })
            .finally(() => {
                if (!cancelled) {
                    setIsLyricsLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist]);

    React.useEffect(() => {
        if (!isVisible) {
            setShowQueue(false);
            setQueueVisible(false);
            queueAnimation.value = 0;
        }
    }, [isVisible]);

    React.useEffect(() => {
        if (showQueue) {
            setQueueDraft(queue);
        }
    }, [queue, showQueue]);

    const handleOpenQueue = useCallback(() => {
        if (!showLyrics) {
            // 1) Mount the queue overlay (at opacity 0 — animation value is still 0)
            setQueueVisible(true);
            setShowQueue(true);
            // 2) Wait one frame so DraggableFlatList can layout without competing with animation
            requestAnimationFrame(() => {
                queueAnimation.value = withSpring(1, {
                    damping: 22,
                    stiffness: 200,
                    mass: 0.6,
                });
            });
        }
    }, [showLyrics, queueAnimation]);

    const handleCloseQueue = useCallback(() => {
        setShowQueue(false);
        queueAnimation.value = withTiming(0, {
            duration: 220,
            easing: M3_EMPHASIZED_ACCEL,
        }, (finished) => {
            if (finished) {
                runOnJS(setQueueVisible)(false);
            }
        });
    }, [queueAnimation]);

    const handleQueueTrackPress = useCallback((index: number) => {
        skipTo(index);
        handleCloseQueue();
    }, [skipTo, handleCloseQueue]);

    const handleQueueRemove = useCallback((index: number) => {
        removeFromQueue(index);
    }, [removeFromQueue]);

    const handleQueueDragEnd = useCallback(({ data }: { data: typeof queue }) => {
        const currentTrackId = currentTrack?.id;
        if (!currentTrackId) return;

        const newIndex = data.findIndex(track => track.id === currentTrackId);
        if (newIndex < 0) return;

        // Lightweight state-only update — NO AudioEngine calls.
        // The current track keeps playing uninterrupted.
        // We only update the queue order + index in the store.
        setQueueDraft(data);
        usePlayerStore.setState({ queue: data, queueIndex: newIndex });
    }, [currentTrack?.id]);

    // ═══════════════════════════════════════════════════
    // SHARED VALUES FOR HIGH-PERFORMANCE ANIMATIONS
    // ═══════════════════════════════════════════════════
    const expansion = useSharedValue(0);
    const lyricsExpansion = useSharedValue(0);
    const breathing = useSharedValue(0);

    // Track whether animations should be active (performance optimization)
    // Deferred: only true AFTER expansion animation completes to avoid heavy rendering during transition
    const [animationsActive, setAnimationsActive] = useState(false);

    // Sync state for React renders
    const [isLyricsExpanded, setIsLyricsExpanded] = useState(false);

    // Toggle lyrics with M3 emphasized easing
    const toggleLyricsFull = (val: boolean) => {
        setIsLyricsExpanded(val);
        lyricsExpansion.value = withTiming(val ? 1 : 0, {
            duration: val ? 350 : 200,
            easing: val ? M3_EMPHASIZED_DECEL : M3_EMPHASIZED_ACCEL,
        });
    };

    // ═══════════════════════════════════════════════════
    // GESTURE HANDLERS WITH M3 MOTION
    // ═══════════════════════════════════════════════════

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
                // M3: Emphasized accelerate for exit
                expansion.value = withTiming(0, {
                    duration: COLLAPSE_DURATION,
                    easing: M3_EMPHASIZED,
                });
                runOnJS(setPlayerVisible)(false);
            } else {
                // Snap back with responsive spring
                expansion.value = withSpring(1, M3_SNAP_SPRING);
            }
        });

    const tapGesture = Gesture.Tap()
        .enabled(!isLyricsExpanded)
        .onEnd(() => {
            if (showLyrics && lyricsExpansion.value === 0) {
                toggleLyricsFull(true);
            }
        });

    // ═══════════════════════════════════════════════════
    // ANIMATED STYLES - M3 CONTAINER TRANSFORM
    // ═══════════════════════════════════════════════════

    const rootAnimatedStyle = useAnimatedStyle(() => {
        const p = expansion.value;

        // M3 Container Transform: morph from mini player bounds to full screen
        const width = interpolate(p, [0, 1], [miniWidth, SCREEN_WIDTH], Extrapolation.CLAMP);
        const height = interpolate(p, [0, 1], [miniHeight, SCREEN_HEIGHT], Extrapolation.CLAMP);
        const bottom = interpolate(p, [0, 1], [miniBottom, 0], Extrapolation.CLAMP);
        const left = interpolate(p, [0, 1], [miniLeft, 0], Extrapolation.CLAMP);

        // M3: Border radius morphs with emphasized curve (faster at start)
        const midRadius = isDetailRoute ? 0 : miniRadius * 0.86;
        const radius = interpolate(p, [0, 0.55, 1], [miniRadius, midRadius, 0], Extrapolation.CLAMP);

        return {
            width,
            height,
            bottom,
            left,
            borderRadius: radius,
            opacity: p > 0.001 ? 1 : 0,
            pointerEvents: p > 0.5 ? 'auto' : 'none',
            // Fixed elevation — no per-frame interpolation
            elevation: p > 0.1 ? 24 : 8,
            zIndex: 9999,
            borderWidth: 0,
            overflow: 'hidden',
        };
    });

    // SHARED ELEMENT ARTWORK TRANSITION
    const ARTWORK_SIZE = SCREEN_WIDTH - 64;
    const BRUTAL_ARTWORK_SIZE = ARTWORK_SIZE * 0.78;
    const miniArtworkSize = 52;
    const miniArtworkPadding = 10;

    const artworkAnimatedStyle = useAnimatedStyle(() => {
        const p = expansion.value;
        const targetArtworkSize = activeVariant === 'brutal' ? BRUTAL_ARTWORK_SIZE : ARTWORK_SIZE;
        const size = interpolate(p, [0, 1], [miniArtworkSize, targetArtworkSize], Extrapolation.CLAMP);
        const targetX = (SCREEN_WIDTH - targetArtworkSize) / 2;
        const targetY = 120;
        const initialX = miniArtworkPadding;
        const initialY = (miniHeight - miniArtworkSize) / 2;

        // M3: Artwork position with fluid arc motion
        const translateX = interpolate(p, [0, 1], [initialX, targetX], Extrapolation.CLAMP);
        const translateY = interpolate(p, [0, 1], [initialY, targetY], Extrapolation.CLAMP);

        // M3: Border radius morphs faster (emphasized start)
        const startRadius = activeVariant === 'brutal' ? 0 : 16;
        const targetRadius = activeVariant === 'aurora'
            ? 28
            : activeVariant === 'brutal'
                ? 0
                : 24;
        const radius = interpolate(p, [0, 0.35], [startRadius, targetRadius], Extrapolation.CLAMP);

        return {
            width: size,
            height: size,
            position: 'absolute',
            left: translateX,
            top: translateY,
            borderRadius: radius,
            overflow: activeVariant === 'brutal' ? 'visible' : 'hidden',
            // M3: Subtle shadow increase during transform
            elevation: interpolate(p, [0, 0.5, 1], [0, 16, 12], Extrapolation.CLAMP),
            shadowColor: '#000',
            shadowOffset: {
                width: 0,
                height: interpolate(p, [0, 1], [0, 8], Extrapolation.CLAMP),
            },
            shadowOpacity: interpolate(p, [0, 0.5, 1], [0, 0.3, 0.25], Extrapolation.CLAMP),
            shadowRadius: interpolate(p, [0, 1], [0, 20], Extrapolation.CLAMP),
        };
    });

    // M3: Staggered content reveal - content fades in AFTER container is mostly formed
    const contentAnimatedStyle = useAnimatedStyle(() => {
        const p = expansion.value;
        return {
            // Content appears slightly later for staggered feel but reduced range
            opacity: interpolate(p, [0.25, 0.6], [0, 1], Extrapolation.CLAMP) * (1 - lyricsExpansion.value),
            transform: [{
                // M3: Gentle slide up
                translateY: interpolate(p, [0.25, 0.7], [16, 0], Extrapolation.CLAMP)
            }]
        };
    });


    // Queue overlay slide-up + fade animation
    const queueOverlayAnimStyle = useAnimatedStyle(() => {
        const p = queueAnimation.value;
        return {
            opacity: interpolate(p, [0, 0.4], [0, 1], Extrapolation.CLAMP),
            transform: [
                { translateY: interpolate(p, [0, 1], [30, 0], Extrapolation.CLAMP) },
            ],
        };
    });

    const mainContainerStyle = useAnimatedStyle(() => {
        return {
            backgroundColor: animColors?.background?.value || theme.colors.background,
        };
    });

    const themeBackgroundFadeStyle = useAnimatedStyle(() => {
        const p = expansion.value;
        return {
            opacity: interpolate(p, [0, 0.22, 0.55], [0, 0.2, 1], Extrapolation.CLAMP),
        };
    });

    const miniShellStyle = useAnimatedStyle(() => {
        const p = expansion.value;
        return {
            opacity: interpolate(p, [0, 0.35, 0.82], [1, 0.94, 0], Extrapolation.CLAMP),
        };
    });

    const miniShellMetaStyle = useAnimatedStyle(() => {
        const p = expansion.value;
        return {
            opacity: interpolate(p, [0.04, 0.78], [1, 0], Extrapolation.CLAMP),
            transform: [
                { scale: interpolate(p, [0, 0.8], [1, 0.96], Extrapolation.CLAMP) },
                { translateY: interpolate(p, [0, 0.8], [0, -2], Extrapolation.CLAMP) },
            ],
        };
    });

    const miniShellAuraPrimaryStyle = useAnimatedStyle(() => {
        const p = expansion.value;
        return {
            backgroundColor: animColors.primary.value + '2A',
            opacity: interpolate(p, [0, 0.35, 0.8], [0.82, 0.55, 0], Extrapolation.CLAMP),
            transform: [
                { translateX: interpolate(p, [0, 1], [0, 46], Extrapolation.CLAMP) },
                { translateY: interpolate(p, [0, 1], [0, -26], Extrapolation.CLAMP) },
                { scale: interpolate(p, [0, 1], [1, 1.18], Extrapolation.CLAMP) },
            ],
        };
    });

    const miniShellAuraSecondaryStyle = useAnimatedStyle(() => {
        const p = expansion.value;
        return {
            backgroundColor: animColors.secondary.value + '22',
            opacity: interpolate(p, [0, 0.35, 0.8], [0.76, 0.5, 0], Extrapolation.CLAMP),
            transform: [
                { translateX: interpolate(p, [0, 1], [0, -32], Extrapolation.CLAMP) },
                { translateY: interpolate(p, [0, 1], [0, 18], Extrapolation.CLAMP) },
                { scale: interpolate(p, [0, 1], [1, 1.14], Extrapolation.CLAMP) },
            ],
        };
    });

    const lyricsBgOverlayStyle = useAnimatedStyle(() => ({
        opacity: interpolate(lyricsExpansion.value, [0, 1], [0, 0.6]),
    }));

    const lyricsContentAnimStyle = useAnimatedStyle(() => ({
        opacity: lyricsExpansion.value,
        transform: [
            { translateY: interpolate(lyricsExpansion.value, [0, 1], [40, 0], Extrapolation.CLAMP) }
        ]
    }));

    const textStyle = useAnimatedStyle(() => ({ color: animColors.text.value }));
    const accentTextStyle = useAnimatedStyle(() => ({ color: animColors.primary.value }));
    const accentBgStyle = useAnimatedStyle(() => ({ backgroundColor: animColors.primary.value }));

    // Aurora-specific organic styles (ONLY computed when visible & not lyrics)
    const auroraOrbStyle = useAnimatedStyle(() => ({
        transform: [
            { scale: 1 + breathing.value * 0.05 },
            { rotate: `${breathing.value * 5}deg` }
        ] as any
    }));

    const auroraRibbonStyle = useAnimatedStyle(() => ({
        transform: [
            { translateY: breathing.value * -10 },
        ] as any
    }));

    // Share references with store
    React.useEffect(() => {
        setExpansion(expansion);
    }, []);

    // ═══════════════════════════════════════════════════
    // ANIMATION LIFECYCLE MANAGEMENT (PERFORMANCE)
    // ═══════════════════════════════════════════════════
    // 
    // Key optimization: ALL looping animations are paused when the
    // full player is not visible. This prevents unnecessary GPU/CPU work
    // from background animations like aurora blobs, breathing effects,
    // scanlines, and jitter effects.

    // No longer gating component mounting mid-animation.
    // ThemeBackground and content are always rendered when visible,
    // controlled purely through opacity in animated styles.
    // This avoids the expensive mount/unmount cycle that caused frame drops.

    React.useEffect(() => {
        if (isVisible && !isLyricsExpanded && !queueVisible) {
            // Delay breathing start until after expansion animation
            const timer = setTimeout(() => {
                setAnimationsActive(true);
                breathing.value = withRepeat(
                    withTiming(1, { duration: 8000, easing: Easing.inOut(Easing.sin) }),
                    -1,
                    true
                );
            }, EXPAND_DURATION + 50);
            return () => clearTimeout(timer);
        } else if (isVisible && isLyricsExpanded) {
            setAnimationsActive(true);
            breathing.value = withTiming(0, { duration: 300, easing: M3_EMPHASIZED_ACCEL });
        } else {
            // Player is NOT visible: cancel ALL animations for performance
            setAnimationsActive(false);
            cancelAnimation(breathing);
            breathing.value = 0;
        }
    }, [isVisible, isLyricsExpanded, queueVisible]);

    // ═══════════════════════════════════════════════════
    // M3 CONTAINER TRANSFORM: EXPANSION ANIMATION
    // ═══════════════════════════════════════════════════

    // Hardware Back Button interceptor
    React.useEffect(() => {
        if (!isVisible) return;

        const onBackPress = () => {
            if (isLyricsExpanded) {
                setShowLyrics(false);
                toggleLyricsFull(false);
                return true;
            }
            if (queueVisible) {
                handleCloseQueue();
                return true;
            }

            // Standard collapse
            expansion.value = withTiming(0, {
                duration: COLLAPSE_DURATION,
                easing: M3_EMPHASIZED,
            });
            runOnJS(setPlayerVisible)(false);
            return true;
        };

        const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
        return () => subscription.remove();
    }, [isVisible, isLyricsExpanded, queueVisible, expansion, handleCloseQueue, setPlayerVisible]);

    React.useEffect(() => {
        if (isVisible) {
            // Fast timing-based expand — no spring overshoot settling delay
            expansion.value = withTiming(1, {
                duration: EXPAND_DURATION,
                easing: M3_EMPHASIZED,
            });
        } else {
            // Fast emphasized collapse
            expansion.value = withTiming(0, {
                duration: COLLAPSE_DURATION,
                easing: M3_EMPHASIZED,
            });
        }
    }, [isVisible]);

    // Early return moved below all hooks (line ~896) to comply with Rules of Hooks.
    // Render functions below use `track` (non-null alias) safely since they are only
    // called from the JSX return which is guarded by `if (!currentTrack) return null`.
    const track = currentTrack!;
    const trackTechLabel = getTrackTechLabel(track);
    const qualityBadge = getQualityBadge(track);
    const qualityBadgeInk = getContrastingInk(qualityBadge.tone);

    // --- RENDER FUNCTIONS FOR RADICAL LAYOUTS ---

    const renderAurora = () => (
        <View style={styles.contentAurora}>
            <View style={styles.headerAurora}>
                <IconButton icon="chevron-down" onPress={() => setPlayerVisible(false)} iconColor={textColor} />
                <BlurView intensity={20} tint="light" style={styles.auroraGlassLabel}>
                    <Animated.Text style={[styles.albumLabelAurora, textStyle]}>{track.album?.toUpperCase()}</Animated.Text>
                </BlurView>
                <IconButton icon={showLyrics ? 'close' : 'playlist-music'} onPress={showLyrics ? () => setShowLyrics(false) : handleOpenQueue} iconColor={textColor} />
            </View>

            <View style={styles.auroraNexusContainer}>
                <View style={{ width: ARTWORK_SIZE * 0.86, height: ARTWORK_SIZE * 0.86 }} />
                <Animated.View style={auroraRibbonStyle}>
                    <BlurView intensity={38} tint="default" style={styles.auroraInfoRibbon}>
                        <Animated.Text style={[styles.titleAurora, textStyle]} numberOfLines={1}>{track.title}</Animated.Text>
                        <Animated.Text style={[styles.artistAurora, accentTextStyle]} numberOfLines={1}>{track.artist}</Animated.Text>
                        <View style={styles.techMetaRow}>
                            <View style={[styles.qualityBadge, { backgroundColor: qualityBadge.tone }]}>
                                <Text style={[styles.qualityBadgeText, { color: qualityBadgeInk }]}>{qualityBadge.label}</Text>
                            </View>
                            <Animated.Text style={[styles.techMetaAurora, textStyle]} numberOfLines={1}>{trackTechLabel}</Animated.Text>
                        </View>
                        <AnimatedFavoriteButton
                            isFavorite={isFavorite}
                            onPress={() => toggleFavorite(track.id)}
                            activeColor={accentColor}
                            inactiveColor={textColor}
                            size={24}
                            style={styles.auroraHeartBtn}
                        />
                    </BlurView>
                </Animated.View>
            </View>

            <View style={styles.auroraFloatingControls}>
                <View style={styles.progressSectionAurora}>
                    <ProgressSlider duration={track.duration} onSeek={seek} activeColor={accentColor} />
                </View>

                <View style={styles.auroraMainNodes}>
                    <AnimatedPlayerButton variant="aurora" kind="secondary" style={styles.auroraAction} onPress={toggleShuffle}>
                        <IconButton icon={shuffleIcon} size={20} iconColor={shuffleEnabled ? accentColor : textColor + '70'} />
                    </AnimatedPlayerButton>
                    <AnimatedPlayerButton variant="aurora" kind="nav" onPress={previous}>
                        <IconButton icon={previousIcon} size={32} iconColor={textColor} />
                    </AnimatedPlayerButton>
                    <AnimatedPlayerButton variant="aurora" kind="primary" onPress={togglePlayPause} style={[styles.playBtnAurora, accentBgStyle]}>
                        <View style={styles.flexCenter}>
                            <IconButton icon={isPlaying ? pauseIcon : playIcon} size={42} iconColor={onPrimaryColor} />
                        </View>
                    </AnimatedPlayerButton>
                    <AnimatedPlayerButton variant="aurora" kind="nav" onPress={next}>
                        <IconButton icon={nextIcon} size={32} iconColor={textColor} />
                    </AnimatedPlayerButton>
                    <AnimatedPlayerButton variant="aurora" kind="secondary" style={styles.auroraAction} onPress={cycleRepeatMode}>
                        <IconButton icon={repeatIcon} size={20} iconColor={repeatMode !== 'off' ? accentColor : textColor + '70'} />
                    </AnimatedPlayerButton>
                </View>
            </View>
        </View>
    );

    const renderCyber = () => (
        <View style={styles.contentCyber}>
            <View style={styles.cyberOSHeader}>
                <View style={[styles.cyberStatusLine, { backgroundColor: accentColor }]} />
                <View style={styles.cyberHeaderTextRow}>
                    <Animated.Text style={[styles.cyberStatusText, textStyle]}>STAYSOUND_OS [V2.0]</Animated.Text>
                    <Pressable onPress={() => setPlayerVisible(false)}>
                        <Animated.Text style={[styles.cyberStatusText, accentTextStyle]}>EXIT</Animated.Text>
                    </Pressable>
                </View>
            </View>

            <View style={styles.cyberMainGrid}>
                <View style={[styles.artworkFrameCyber, { width: ARTWORK_SIZE * 0.7, height: ARTWORK_SIZE * 0.7, borderColor: accentColor }]} />
                <View style={styles.cyberInfoBlock}>
                    <Animated.Text style={[styles.titleCyber, textStyle]} numberOfLines={2}>{track.title.toUpperCase()}</Animated.Text>
                    <Animated.Text style={[styles.artistCyber, accentTextStyle]} numberOfLines={1}>{track.artist}</Animated.Text>
                    <View style={styles.techMetaRow}>
                        <View style={[styles.qualityBadge, { backgroundColor: qualityBadge.tone }]}>
                            <Text style={[styles.qualityBadgeText, { color: qualityBadgeInk }]}>{qualityBadge.label}</Text>
                        </View>
                        <Animated.Text style={[styles.techMetaCyber, textStyle]} numberOfLines={1}>{trackTechLabel}</Animated.Text>
                    </View>
                    <AnimatedFavoriteButton
                        isFavorite={isFavorite}
                        onPress={() => toggleFavorite(track.id)}
                        activeColor={accentColor}
                        inactiveColor={textColor}
                        size={24}
                        style={{ margin: 0, marginTop: 8 }}
                    />
                </View>
            </View>

            <View style={styles.cyberFooter}>
                <ProgressSlider duration={track.duration} onSeek={seek} activeColor={accentColor} />
                <View style={styles.cyberTransportRow}>
                    <AnimatedPlayerButton variant="cyber" kind="secondary" style={[styles.cyberKey, { borderColor: accentColor }]} onPress={toggleShuffle}>
                        <IconButton icon={shuffleIcon} size={20} iconColor={shuffleEnabled ? accentColor : textColor + '70'} />
                    </AnimatedPlayerButton>
                    <AnimatedPlayerButton variant="cyber" kind="nav" style={[styles.cyberKey, { borderColor: accentColor }]} onPress={previous}>
                        <IconButton icon={previousIcon} size={24} iconColor={textColor} />
                    </AnimatedPlayerButton>
                    <AnimatedPlayerButton variant="cyber" kind="primary" style={[styles.cyberPlayKey, { borderColor: accentColor }]} onPress={togglePlayPause}>
                        <IconButton icon={isPlaying ? pauseIcon : playIcon} size={30} iconColor={accentColor} />
                    </AnimatedPlayerButton>
                    <AnimatedPlayerButton variant="cyber" kind="nav" style={[styles.cyberKey, { borderColor: accentColor }]} onPress={next}>
                        <IconButton icon={nextIcon} size={24} iconColor={textColor} />
                    </AnimatedPlayerButton>
                    <AnimatedPlayerButton variant="cyber" kind="secondary" style={[styles.cyberKey, { borderColor: accentColor }]} onPress={cycleRepeatMode}>
                        <IconButton icon={repeatIcon} size={20} iconColor={repeatMode !== 'off' ? accentColor : textColor + '70'} />
                    </AnimatedPlayerButton>
                </View>
            </View>
        </View>
    );

    const renderBrutal = () => (
        <View style={styles.contentBrutal}>
            <View style={styles.brutalTitleColumn}>
                <View style={styles.brutalMetaWrap}>
                    <Animated.Text style={[styles.artistBrutal, { color: textColor }]} numberOfLines={1}>{track.artist.toUpperCase()}</Animated.Text>
                    <View style={styles.techMetaRow}>
                        <View style={[styles.qualityBadge, { backgroundColor: qualityBadge.tone }]}>
                            <Text style={[styles.qualityBadgeText, { color: qualityBadgeInk }]}>{qualityBadge.label}</Text>
                        </View>
                        <Animated.Text style={[styles.techMetaBrutal, { color: textColor }]} numberOfLines={1}>{trackTechLabel}</Animated.Text>
                    </View>
                    <AnimatedFavoriteButton
                        isFavorite={isFavorite}
                        onPress={() => toggleFavorite(track.id)}
                        activeColor={accentColor}
                        inactiveColor={textColor}
                        size={24}
                        style={[styles.brutalFavoriteBtn, { borderColor: brutalBorder, backgroundColor: brutalButtonBg }]}
                    />
                </View>
                <IconButton
                    icon="close"
                    onPress={() => setPlayerVisible(false)}
                    iconColor={brutalButtonInk}
                    style={[styles.brutalSmallBtn, { backgroundColor: brutalButtonBg, borderColor: brutalBorder }]}
                />
            </View>

            <View style={styles.brutalMainArea}>
                <View style={styles.artworkContainerBrutal}>
                    <View style={{ width: BRUTAL_ARTWORK_SIZE, height: BRUTAL_ARTWORK_SIZE }} />
                </View>

                <View style={styles.brutalControlsGrid}>
                    <View style={styles.brutalActionsRow}>
                        <AnimatedPlayerButton variant="brutal" kind="secondary" style={[styles.brutalControlBtn, { backgroundColor: brutalButtonBg, borderColor: brutalBorder }]} onPress={toggleShuffle}>
                            <IconButton icon={shuffleIcon} size={22} iconColor={shuffleEnabled ? accentColor : brutalButtonInk} style={styles.iconBtnReset} />
                        </AnimatedPlayerButton>
                        <AnimatedPlayerButton variant="brutal" kind="nav" style={[styles.brutalControlBtn, { backgroundColor: brutalButtonBg, borderColor: brutalBorder }]} onPress={previous}>
                            <IconButton icon={previousIcon} size={28} iconColor={brutalButtonInk} style={styles.iconBtnReset} />
                        </AnimatedPlayerButton>
                        <AnimatedPlayerButton variant="brutal" kind="primary" style={[styles.brutalControlPrimaryBtn, { backgroundColor: accentColor }]} onPress={togglePlayPause}>
                            <IconButton icon={isPlaying ? pauseIcon : playIcon} size={40} iconColor={brutalPlayInk} style={styles.iconBtnReset} />
                        </AnimatedPlayerButton>
                        <AnimatedPlayerButton variant="brutal" kind="nav" style={[styles.brutalControlBtn, { backgroundColor: brutalButtonBg, borderColor: brutalBorder }]} onPress={next}>
                            <IconButton icon={nextIcon} size={28} iconColor={brutalButtonInk} style={styles.iconBtnReset} />
                        </AnimatedPlayerButton>
                        <AnimatedPlayerButton variant="brutal" kind="secondary" style={[styles.brutalControlBtn, { backgroundColor: brutalButtonBg, borderColor: brutalBorder }]} onPress={cycleRepeatMode}>
                            <IconButton icon={repeatIcon} size={22} iconColor={repeatMode !== 'off' ? accentColor : brutalButtonInk} style={styles.iconBtnReset} />
                        </AnimatedPlayerButton>
                    </View>
                </View>

                <View style={styles.brutalFooter}>
                    <ProgressSlider
                        duration={track.duration}
                        onSeek={seek}
                        activeColor={accentColor}
                        inactiveColor={textColor + '33'}
                        textColor={textColor}
                    />
                </View>
            </View>
        </View>
    );

    const renderImmersive = () => (
        <View style={styles.contentImmersive}>
            {/* Header with close button, album name, and menu */}
            <View style={styles.headerImmersive}>
                <Pressable onPress={() => setPlayerVisible(false)} style={styles.headerBtnImmersive}>
                    <IconButton icon="chevron-down" size={26} iconColor={textColor} />
                </Pressable>
                <View style={styles.headerCenterImmersive}>
                    <Animated.Text style={[styles.playingFromLabel, textStyle]}>PLAYING FROM</Animated.Text>
                    <Animated.Text style={[styles.albumLabelImmersive, accentTextStyle]} numberOfLines={1}>
                        {track.album || 'Unknown Album'}
                    </Animated.Text>
                </View>
                <Pressable style={styles.headerBtnImmersive}>
                    <IconButton icon="dots-vertical" size={26} iconColor={textColor} />
                </Pressable>
            </View>

            {/* Artwork Section or Lyrics Section */}
            <View style={styles.artworkSectionImmersive}>
                {showLyrics ? (
                    <View style={{ flex: 1 }} />
                ) : (
                    <View style={[styles.artworkFrameImmersive, { width: ARTWORK_SIZE, height: ARTWORK_SIZE }]} />
                )}
            </View>

            {/* Track Info with action buttons */}
            {!isLyricsExpanded && (
                <View style={styles.trackInfoSectionImmersive}>
                    <View style={styles.trackInfoRowImmersive}>
                        <View style={styles.trackTextImmersive}>
                            <Animated.Text style={[styles.titleImmersiveNew, textStyle]} numberOfLines={1}>
                                {track.title}
                            </Animated.Text>
                            <Animated.Text style={[styles.artistImmersive, accentTextStyle]} numberOfLines={1}>
                                {track.artist}
                            </Animated.Text>
                            <View style={styles.techMetaRow}>
                                <View style={[styles.qualityBadge, { backgroundColor: qualityBadge.tone }]}>
                                    <Text style={[styles.qualityBadgeText, { color: qualityBadgeInk }]}>{qualityBadge.label}</Text>
                                </View>
                                <Animated.Text style={[styles.techMetaImmersive, textStyle]} numberOfLines={1}>
                                    {trackTechLabel}
                                </Animated.Text>
                            </View>
                        </View>
                        <View style={styles.trackActionsImmersive}>
                            <IconButton
                                icon="text"
                                size={28}
                                onPress={() => setShowLyrics(!showLyrics)}
                                iconColor={showLyrics ? accentColor : textColor}
                                style={{ margin: 0 }}
                            />
                            <AnimatedFavoriteButton
                                isFavorite={isFavorite}
                                onPress={() => toggleFavorite(track.id)}
                                activeColor={accentColor}
                                inactiveColor={textColor}
                                size={28}
                            />
                        </View>
                    </View>
                </View>
            )}

            {/* Progress Bar */}
            <View style={styles.progressSectionImmersive}>
                <ProgressSlider duration={track.duration} onSeek={seek} activeColor={accentColor} />
            </View>

            {/* Main Controls */}
            <View style={styles.controlsSectionImmersive}>
                <AnimatedPlayerButton variant="immersive" kind="secondary" style={styles.secondaryBtnImmersive} onPress={toggleShuffle}>
                    <IconButton icon={shuffleIcon} size={24} iconColor={shuffleEnabled ? accentColor : textColor + '60'} />
                </AnimatedPlayerButton>

                <AnimatedPlayerButton variant="immersive" kind="nav" style={styles.navBtnImmersive} onPress={previous}>
                    <IconButton icon={previousIcon} size={36} iconColor={textColor} />
                </AnimatedPlayerButton>

                <AnimatedPlayerButton variant="immersive" kind="primary" onPress={togglePlayPause} style={[styles.playBtnImmersiveNew, accentBgStyle]}>
                    <View style={styles.flexCenter}>
                        <IconButton icon={isPlaying ? pauseIcon : playIcon} size={40} iconColor={onPrimaryColor} />
                    </View>
                </AnimatedPlayerButton>

                <AnimatedPlayerButton variant="immersive" kind="nav" style={styles.navBtnImmersive} onPress={next}>
                    <IconButton icon={nextIcon} size={36} iconColor={textColor} />
                </AnimatedPlayerButton>

                <AnimatedPlayerButton variant="immersive" kind="secondary" style={styles.secondaryBtnImmersive} onPress={cycleRepeatMode}>
                    <IconButton icon={repeatIcon} size={24} iconColor={repeatMode !== 'off' ? accentColor : textColor + '60'} />
                </AnimatedPlayerButton>
            </View>

            {/* Bottom Actions */}
            <View style={styles.bottomActionsImmersive}>
                <Pressable style={styles.bottomBtnImmersive}>
                    <IconButton icon="playlist-music" size={22} iconColor={textColor + '80'} onPress={handleOpenQueue} />
                </Pressable>
                <Pressable style={styles.bottomBtnImmersive}>
                    <IconButton icon="cast" size={22} iconColor={textColor + '80'} />
                </Pressable>
                <Pressable style={styles.bottomBtnImmersive}>
                    <IconButton icon="share-variant" size={22} iconColor={textColor + '80'} />
                </Pressable>
            </View>
        </View>
    );



    const renderThemeContent = () => {
        if (isLyricsExpanded) return null;
        switch (activeVariant) {
            case 'aurora': return renderAurora();
            case 'cyber': return renderCyber();
            case 'brutal': return renderBrutal();
            default: return renderImmersive();
        }
    };

    const renderQueueItem = useCallback((params: RenderItemParams<typeof queue[number]>) => {
        const { item, drag, isActive: isDragging, getIndex } = params;
        const index = getIndex() ?? 0;
        const isCurrent = index === queueIndex;

        return (
            <QueueItemDecorator
                accentColor={accentColor}
                isDragging={isDragging}
            >
                <Pressable
                    style={({ pressed }) => [
                        styles.queueRow,
                        isCurrent && { backgroundColor: albumColors.primary + '30' },
                        pressed && !isDragging && { opacity: 0.75 },
                    ]}
                    onPress={() => handleQueueTrackPress(index)}
                    onLongPress={drag}
                    delayLongPress={150}
                    disabled={isDragging}
                >
                    <View style={styles.queueTrackInfo}>
                        <Text numberOfLines={1} style={[styles.queueTrackTitle, { color: isCurrent ? accentColor : textColor }]}>
                            {item.title}
                        </Text>
                        <Text numberOfLines={1} style={[styles.queueTrackArtist, { color: textColor + 'B3' }]}>
                            {item.artist}
                        </Text>
                    </View>

                    {/* Passive drag handle indicator — 3 horizontal lines */}
                    <View style={styles.queueDragHandle}>
                        <View style={[styles.queueDragLine, { backgroundColor: textColor + '40' }]} />
                        <View style={[styles.queueDragLine, { backgroundColor: textColor + '40' }]} />
                        <View style={[styles.queueDragLine, { backgroundColor: textColor + '40' }]} />
                    </View>

                    <IconButton
                        icon="close"
                        size={16}
                        iconColor={textColor + '80'}
                        onPress={() => handleQueueRemove(index)}
                        style={styles.queueRemoveBtn}
                    />
                </Pressable>
            </QueueItemDecorator>
        );
    }, [queueIndex, albumColors.primary, accentColor, textColor, handleQueueTrackPress, handleQueueRemove]);

    const queueKeyExtractor = useCallback((item: typeof queue[number]) => item.id, []);

    const renderQueueEmpty = useCallback(() => (
        <View style={styles.queueEmptyWrap}>
            <Text style={[styles.queueTrackArtist, { color: textColor + 'B3' }]}>No hay canciones en la cola</Text>
        </View>
    ), [textColor]);

    if (!currentTrack) return null;

    return (
        <Animated.View style={[styles.root, rootAnimatedStyle]}>
            <GestureDetector gesture={Gesture.Exclusive(panGesture, tapGesture)}>
                <Animated.View style={[styles.mainContainer, mainContainerStyle]}>
                    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, miniShellStyle, { zIndex: 2 }]}>
                        <View style={styles.miniShellAuraLayer}>
                            <Animated.View style={[styles.miniShellAuraOrbPrimary, miniShellAuraPrimaryStyle]} />
                            <Animated.View style={[styles.miniShellAuraOrbSecondary, miniShellAuraSecondaryStyle]} />
                        </View>
                        <Animated.View style={[styles.miniShellMetaRow, miniShellMetaStyle]}>
                            <View style={styles.miniShellMetaTextWrap}>
                                <Text numberOfLines={1} style={[styles.miniShellTitle, { color: textColor }]}>{track.title}</Text>
                                <Text numberOfLines={1} style={[styles.miniShellArtist, { color: textColor + 'B3' }]}>{track.artist}</Text>
                            </View>
                            <View style={[styles.miniShellPlayBtn, { borderColor: accentColor + '7A', backgroundColor: accentColor + '2B' }]}>
                                <MaterialCommunityIcons
                                    name={(isPlaying ? pauseIcon : playIcon) as any}
                                    size={22}
                                    color={textColor}
                                />
                            </View>
                        </Animated.View>
                    </Animated.View>

                    {/* ThemeBackground - strictly unmounted completely to save CPU/GPU overhead when collapsed */}
                    {isVisible && (
                        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, themeBackgroundFadeStyle]}>
                            <ThemeBackground
                                variant={activeVariant}
                                colors={albumColors}
                                animColors={animColors}
                                artwork={track.artwork}
                                isVisible={animationsActive}
                                expansion={expansion}
                            />
                        </Animated.View>
                    )}

                    {/* Highly subtle dark overlay for lyrics readability */}
                    <Animated.View
                        style={[
                            StyleSheet.absoluteFill,
                            { backgroundColor: '#000' },
                            lyricsBgOverlayStyle
                        ]}
                        pointerEvents="none"
                    />


                    {/* Global Shared-Element Artwork */}
                    {!isLyricsExpanded && !showQueue && (
                        <Animated.View style={[
                            artworkAnimatedStyle,
                            activeVariant === 'aurora' && auroraOrbStyle,
                            { zIndex: 10 }
                        ]}>
                            <Image
                                source={{ uri: track.artwork }}
                                style={styles.fullImage}
                                contentFit="cover"
                                recyclingKey={track.id}
                                transition={0}
                            />
                            {activeVariant === 'brutal' && (
                                <View style={[styles.brutalArtworkBadge, { backgroundColor: accentColor }]}>
                                    <Animated.Text style={[styles.titleBrutalVertical, { color: onPrimaryColor }]} numberOfLines={1}>
                                        {track.title.toUpperCase()}
                                    </Animated.Text>
                                </View>
                            )}
                        </Animated.View>
                    )}

                    <Animated.View style={[{ flex: 1 }, contentAnimatedStyle]}>
                        {renderThemeContent()}
                    </Animated.View>

                    {queueVisible && !isLyricsExpanded && (
                        <Animated.View style={[styles.queueOverlay, { backgroundColor: albumColors.background + 'F0' }, queueOverlayAnimStyle]}>
                            <View style={styles.queueHeader}>
                                <Text style={[styles.queueTitle, { color: textColor }]}>Cola de reproducción</Text>
                                <IconButton icon="close" size={22} iconColor={textColor} onPress={handleCloseQueue} />
                            </View>

                            <DraggableFlatList
                                data={queueDraft}
                                keyExtractor={queueKeyExtractor}
                                renderItem={renderQueueItem}
                                onDragEnd={handleQueueDragEnd}
                                contentContainerStyle={styles.queueListContent}
                                showsVerticalScrollIndicator={false}
                                activationDistance={5}
                                autoscrollSpeed={260}
                                autoscrollThreshold={60}
                                dragHitSlop={{ top: -2, bottom: -2, left: 0, right: 0 }}
                                ListEmptyComponent={renderQueueEmpty}
                                animationConfig={{
                                    damping: 28,
                                    stiffness: 380,
                                    mass: 0.3,
                                    overshootClamping: true,
                                } as any}
                            />
                        </Animated.View>
                    )}
                </Animated.View>
            </GestureDetector>

            {isLyricsExpanded && (
                <Animated.View
                    style={[StyleSheet.absoluteFill, lyricsContentAnimStyle]}
                    pointerEvents="box-none"
                >
                    <View style={StyleSheet.absoluteFill}>
                        <View style={styles.fullScreenLyricsHeader}>
                            <IconButton
                                icon="close-circle"
                                size={36}
                                iconColor="#FFFFFF"
                                onPress={() => {
                                    setShowLyrics(false);
                                    toggleLyricsFull(false);
                                }}
                            />

                            <View style={styles.lyricsModeContainer}>
                                {(trackLyrics && lrcLyrics) && (
                                    <View style={styles.lyricsModeSwitcher}>
                                        <Pressable
                                            onPress={() => setLyricsMode('synced')}
                                            style={[styles.modeTab, lyricsMode === 'synced' && styles.modeTabActive]}
                                        >
                                            <Text style={[styles.modeTabText, lyricsMode === 'synced' && { color: accentColor }]}>SINCRONIZADAS</Text>
                                        </Pressable>
                                        <Pressable
                                            onPress={() => setLyricsMode('lrc')}
                                            style={[styles.modeTab, lyricsMode === 'lrc' && styles.modeTabActive]}
                                        >
                                            <Text style={[styles.modeTabText, lyricsMode === 'lrc' && { color: accentColor }]}>LRC</Text>
                                        </Pressable>
                                    </View>
                                )}
                            </View>
                        </View>

                        {isDownloadingLrc && (
                            <Animated.View
                                entering={FadeIn.duration(400)}
                                exiting={FadeOut.duration(400)}
                                style={styles.downloadOverlay}
                            >
                                <LyricsSkeleton isDownloading={true} />
                            </Animated.View>
                        )}

                        {(lyricsMode === 'synced' ? trackLyrics : lrcLyrics) ? (
                            <Animated.View
                                key="lyrics-content"
                                entering={FadeIn.duration(600)}
                                style={{ flex: 1 }}
                            >
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
                                    onLineChange={({ nativeEvent }) => {
                                        // console.log('[NativeKaraoke] Line:', nativeEvent.lineIndex);
                                    }}
                                    onSeek={({ nativeEvent }) => {
                                        seek(nativeEvent.timeMs / 1000);
                                    }}
                                />
                            </Animated.View>
                        ) : (
                            <Animated.View
                                key="lyrics-fallback"
                                entering={FadeIn.duration(400)}
                                style={[styles.lyricsFallbackState, isLyricsLoading && { justifyContent: 'flex-start' }]}
                            >
                                {(isLyricsLoading || isDownloadingLrc) ? (
                                    <Animated.View
                                        key="lyrics-loading"
                                        entering={FadeIn.duration(400)}
                                        exiting={FadeOut.duration(400)}
                                    >
                                        <LyricsSkeleton isDownloading={isDownloadingLrc} />
                                    </Animated.View>
                                ) : (
                                    <Animated.View
                                        key="lyrics-empty"
                                        entering={FadeIn.duration(400)}
                                        style={{ alignItems: 'center', width: '100%', paddingHorizontal: 40 }}
                                    >
                                        <Text style={styles.lyricsFallbackTitle}>
                                            No se encontraron letras
                                        </Text>
                                        {!lrcLyrics && (
                                            <View style={styles.lyricsActionContainer}>
                                                <Text style={styles.lyricsFallbackSubtitle}>
                                                    {lrcError ?? 'No hay letras disponibles localmente.'}
                                                </Text>
                                                <Button
                                                    mode="contained"
                                                    onPress={handleDownloadLrc}
                                                    icon="cloud-download"
                                                    style={[styles.downloadBtn, { backgroundColor: lrcError ? '#CC4444' : accentColor }]}
                                                    contentStyle={{ height: 50, paddingHorizontal: 16 }}
                                                    labelStyle={{ color: onPrimaryColor, fontWeight: '900' }}
                                                >
                                                    {lrcError ? 'Reintentar' : 'Descargar Letras'}
                                                </Button>
                                            </View>
                                        )}
                                    </Animated.View>
                                )}
                            </Animated.View>
                        )}
                    </View>
                </Animated.View>
            )}
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    root: {
        position: 'absolute',
        zIndex: 1000,
        overflow: 'hidden',
    },
    mainContainer: {
        flex: 1,
    },
    miniShellMetaRow: {
        position: 'absolute',
        left: 72,
        right: 10,
        top: 0,
        bottom: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 2,
    },
    miniShellMetaTextWrap: {
        flex: 1,
        marginRight: 10,
    },
    miniShellTitle: {
        fontSize: 13,
        fontWeight: '800',
        letterSpacing: -0.1,
    },
    miniShellArtist: {
        fontSize: 11,
        marginTop: 1,
    },
    miniShellPlayBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    miniShellAuraLayer: {
        ...StyleSheet.absoluteFillObject,
        overflow: 'hidden',
    },
    miniShellAuraOrbPrimary: {
        position: 'absolute',
        width: 210,
        height: 210,
        borderRadius: 105,
        top: -84,
        right: -48,
    },
    miniShellAuraOrbSecondary: {
        position: 'absolute',
        width: 180,
        height: 180,
        borderRadius: 90,
        bottom: -96,
        left: -40,
    },
    flexCenter: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    spacer: {
        flex: 1,
    },
    content: {
        flex: 1,
        paddingBottom: 40,
        justifyContent: 'space-between',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 10,
        height: 60,
    },
    albumLabel: {
        fontSize: 12,
        fontWeight: '900',
        letterSpacing: 2,
        textTransform: 'uppercase',
        opacity: 0.6,
    },
    fullImage: {
        width: '100%',
        height: '100%',
    },
    progressSection: {
        paddingHorizontal: 25,
    },
    // --- Aurora Theme ---
    contentAurora: {
        flex: 1,
        padding: 20,
    },
    headerAurora: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 80,
    },
    auroraGlassLabel: {
        paddingHorizontal: 15,
        paddingVertical: 5,
        borderRadius: 20,
        overflow: 'hidden',
    },
    albumLabelAurora: {
        fontSize: 10,
        fontWeight: '900',
        letterSpacing: 3,
    },
    auroraNexusContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: -20,
    },
    artworkOrbAurora: {
        borderRadius: 1000,
        overflow: 'hidden',
        borderWidth: 0.5,
        borderColor: 'rgba(255,255,255,0.3)',
        elevation: 40,
        shadowColor: '#000',
        shadowOpacity: 0.3,
        shadowRadius: 50,
    },
    auroraInfoRibbon: {
        width: SCREEN_WIDTH * 0.82,
        paddingVertical: 14,
        paddingHorizontal: 22,
        borderRadius: 26,
        marginTop: -42,
        zIndex: 10,
        overflow: 'hidden',
        borderWidth: 0.5,
        borderColor: 'rgba(255,255,255,0.2)',
    },
    titleAurora: {
        fontSize: 22,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    artistAurora: {
        fontSize: 14,
        opacity: 0.8,
        marginTop: 2,
        textAlign: 'center',
    },
    techMetaAurora: {
        fontSize: 10,
        opacity: 0.72,
        marginTop: 6,
        textAlign: 'center',
        letterSpacing: 0.6,
    },
    techMetaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 6,
    },
    qualityBadge: {
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    qualityBadgeText: {
        fontSize: 9,
        fontWeight: '900',
        letterSpacing: 0.4,
    },
    auroraFloatingControls: {
        marginTop: 'auto',
        marginBottom: 24,
        paddingHorizontal: 6,
    },
    progressSectionAurora: {
        paddingHorizontal: 10,
        marginBottom: 12,
    },
    auroraControlNodes: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        marginTop: 20,
    },
    auroraMainNodes: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingHorizontal: 6,
    },
    auroraAction: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 0.5,
        borderColor: 'rgba(255,255,255,0.25)',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    auroraSmallNode: {
        width: 44,
        height: 44,
        borderRadius: 22,
        overflow: 'hidden',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 0.5,
        borderColor: 'rgba(255,255,255,0.2)',
    },
    playBtnAurora: {
        width: 72,
        height: 72,
        borderRadius: 36,
        elevation: 10,
    },
    // --- Cyber Theme ---
    contentCyber: {
        flex: 1,
        padding: 20,
    },
    cyberOSHeader: {
        marginTop: 20,
        marginBottom: 30,
    },
    cyberStatusLine: {
        height: 2,
        width: '100%',
        marginBottom: 5,
    },
    cyberHeaderTextRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    cyberStatusText: {
        fontSize: 10,
        fontWeight: '900',
        opacity: 0.5,
    },
    cyberMainGrid: {
        flexDirection: 'column',
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cyberLeftColumn: {
        flex: 1,
    },
    artworkFrameCyber: {
        borderWidth: 2,
        backgroundColor: '#000',
        borderRadius: 4,
    },
    cyberInfoBlock: {
        marginTop: 18,
        width: '92%',
        paddingLeft: 12,
        paddingVertical: 10,
        borderLeftWidth: 3,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    titleCyber: {
        fontSize: 30,
        fontWeight: '900',
        lineHeight: 32,
    },
    artistCyber: {
        fontSize: 14,
        fontWeight: 'bold',
        letterSpacing: 2,
    },
    techMetaCyber: {
        fontSize: 10,
        opacity: 0.65,
        letterSpacing: 0.8,
        flexShrink: 1,
    },
    cyberRightColumn: {
        width: 70,
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 15,
    },
    cyberVerticalDivider: {
        width: 1,
        height: 40,
        backgroundColor: 'rgba(255,255,255,0.1)',
        marginVertical: 10,
    },
    playBtnCyber: {
        width: 70,
        height: 70,
        borderWidth: 2,
    },
    cyberFooter: {
        marginTop: 14,
        marginBottom: 18,
    },
    cyberTransportRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 14,
        gap: 8,
    },
    cyberKey: {
        width: 54,
        height: 54,
        borderWidth: 1.5,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.35)',
    },
    cyberPlayKey: {
        width: 70,
        height: 70,
        borderWidth: 2,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.55)',
    },
    cyberDataRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 10,
    },
    cyberSmallData: {
        fontSize: 10,
        fontWeight: 'bold',
        opacity: 0.4,
    },
    // --- Brutal Theme ---
    contentBrutal: {
        flex: 1,
        padding: 20,
    },
    brutalTitleColumn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 10,
    },
    brutalMetaWrap: {
        flex: 1,
        paddingRight: 10,
    },
    brutalVerticalActions: {
        marginTop: 40,
        gap: 20,
    },
    titleBrutalVertical: {
        fontSize: 16,
        fontWeight: '900',
        letterSpacing: 0.8,
        textAlign: 'center',
    },
    brutalMainArea: {
        flex: 1,
        paddingTop: 10,
        justifyContent: 'space-between',
    },
    artworkContainerBrutal: {
        marginTop: 12,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 30,
    },
    brutalArtworkBadge: {
        position: 'absolute',
        bottom: -12,
        alignSelf: 'center',
        maxWidth: '86%',
        paddingHorizontal: 18,
        paddingVertical: 9,
        borderWidth: 4,
        borderColor: '#000',
        transform: [{ rotate: '2deg' }],
        zIndex: 60,
        elevation: 20,
    },
    artistBrutal: {
        fontSize: 14,
        fontWeight: '900',
        letterSpacing: 1.2,
    },
    techMetaBrutal: {
        fontSize: 10,
        fontWeight: '700',
        opacity: 0.72,
        letterSpacing: 0.5,
        flexShrink: 1,
    },
    brutalControlsGrid: {
        alignItems: 'center',
        width: '100%',
        maxWidth: 440,
        marginTop: 18,
        marginBottom: 8,
        paddingHorizontal: 2,
    },
    brutalControlPrimaryBtn: {
        flexBasis: '24%',
        width: '24%',
        minWidth: 80,
        maxWidth: 94,
        height: 90,
        borderWidth: 4,
        borderColor: '#000',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 6, height: 6 },
        shadowOpacity: 1,
        shadowRadius: 0,
        elevation: 10,
    },
    brutalActionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        gap: 6,
        marginTop: 6,
    },
    brutalControlBtn: {
        flexBasis: '18%',
        width: '18%',
        minWidth: 58,
        maxWidth: 68,
        height: 64,
        borderWidth: 3,
        borderColor: '#000',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 4, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 0,
        elevation: 8,
    },
    brutalSmallBtn: {
        borderWidth: 3,
        borderColor: '#000',
        backgroundColor: '#fff',
        minWidth: 64,
        minHeight: 64,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 4, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 0,
        elevation: 8,
    },
    iconBtnReset: {
        margin: 0,
    },
    brutalFooter: {
        marginTop: 'auto',
        marginBottom: 8,
    },
    brutalCross: {
        position: 'absolute',
        top: -SCREEN_HEIGHT + 140,
        left: -10,
        borderWidth: 3,
        borderColor: '#000',
        backgroundColor: '#fff',
    },
    // --- Immersive/Material 3 Theme (Redesigned) ---
    contentImmersive: {
        flex: 1,
        paddingHorizontal: 24,
        paddingTop: 16,
        paddingBottom: 40,
    },
    headerImmersive: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 56,
        marginBottom: 8,
    },
    headerBtnImmersive: {
        width: 48,
        height: 48,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerCenterImmersive: {
        flex: 1,
        alignItems: 'center',
    },
    playingFromLabel: {
        fontSize: 10,
        fontWeight: '600',
        letterSpacing: 1.5,
        opacity: 0.5,
    },
    albumLabelImmersive: {
        fontSize: 13,
        fontWeight: '700',
        marginTop: 2,
    },
    artworkSectionImmersive: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 16,
    },
    artworkFrameImmersive: {
        borderRadius: 16,
        overflow: 'hidden',
        elevation: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 20,
    },
    lyricsContainerImmersive: {
        width: '100%',
        borderRadius: 20,
        overflow: 'hidden',
        backgroundColor: 'rgba(0,0,0,0.3)',
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 10,
    },
    lyricsFullScreenContainer: {
        position: 'absolute',
        top: -100,
        bottom: -200,
        left: -24,
        right: -24,
        zIndex: 100,
        backgroundColor: '#000',
        borderRadius: 0,
        paddingTop: 60,
    },
    fullScreenLyricsHeader: {
        position: 'absolute',
        top: 40,
        left: 0,
        right: 0,
        height: 60,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        zIndex: 110,
    },
    lyricsFallbackState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
        backgroundColor: 'transparent',
    },
    lyricsFallbackTitle: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '700',
        textAlign: 'center',
    },
    lyricsFallbackSubtitle: {
        color: 'rgba(255,255,255,0.74)',
        fontSize: 14,
        marginTop: 10,
        textAlign: 'center',
    },
    trackInfoSectionImmersive: {
        marginBottom: 16,
    },
    trackInfoRowImmersive: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    trackTextImmersive: {
        flex: 1,
        marginRight: 16,
    },
    titleImmersiveNew: {
        fontSize: 24,
        fontWeight: '800',
        letterSpacing: -0.3,
    },
    artistImmersive: {
        fontSize: 16,
        fontWeight: '500',
        opacity: 0.8,
        marginTop: 4,
    },
    techMetaImmersive: {
        fontSize: 10,
        opacity: 0.7,
        letterSpacing: 0.4,
        flexShrink: 1,
    },
    trackActionsImmersive: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    actionBtnImmersive: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    progressSectionImmersive: {
        marginBottom: 24,
    },
    controlsSectionImmersive: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        marginBottom: 24,
    },
    secondaryBtnImmersive: {
        width: 48,
        height: 48,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
    },
    navBtnImmersive: {
        width: 56,
        height: 56,
        borderRadius: 28,
        justifyContent: 'center',
        alignItems: 'center',
    },
    playBtnImmersiveNew: {
        width: 72,
        height: 72,
        borderRadius: 36,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
    },
    bottomActionsImmersive: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 32,
    },
    bottomBtnImmersive: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
    },
    // Legacy styles (kept for compatibility)
    lyricsContainer: {
        width: '100%',
        borderRadius: 20,
        overflow: 'hidden',
        backgroundColor: 'rgba(0,0,0,0.3)',
    },
    queueOverlay: {
        position: 'absolute',
        left: 10,
        right: 10,
        top: 74,
        bottom: 20,
        zIndex: 50,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.18)',
        overflow: 'hidden',
    },
    queueHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingTop: 8,
    },
    queueTitle: {
        fontSize: 16,
        fontWeight: '700',
    },
    queueListContent: {
        paddingHorizontal: 8,
        paddingBottom: 8,
    },
    queueRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 12,
        marginBottom: 4,
        paddingLeft: 12,
    },
    queueTrackInfo: {
        flex: 1,
        paddingVertical: 8,
    },
    queueTrackTitle: {
        fontSize: 14,
        fontWeight: '600',
    },
    queueTrackArtist: {
        fontSize: 12,
        marginTop: 2,
    },
    queueRemoveBtn: {
        margin: 0,
    },
    queueDragHandle: {
        width: 24,
        height: 24,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 3,
        marginRight: 2,
    },
    queueDragLine: {
        width: 14,
        height: 1.5,
        borderRadius: 1,
    },
    queueEmptyWrap: {
        paddingVertical: 24,
        alignItems: 'center',
    },
    lyricsModeContainer: {
        flex: 1,
        alignItems: 'center',
    },
    lyricsModeSwitcher: {
        flexDirection: 'row',
        backgroundColor: 'rgba(255,255,255,0.12)',
        borderRadius: 20,
        padding: 2,
    },
    modeTab: {
        paddingHorizontal: 16,
        paddingVertical: 6,
        borderRadius: 18,
    },
    modeTabActive: {
        backgroundColor: 'rgba(255,255,255,0.25)',
    },
    modeTabText: {
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: '900',
        letterSpacing: 1,
    },
    downloadOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'transparent',
        zIndex: 200,
        justifyContent: 'flex-start',
    },
    downloadTextContainer: {
        position: 'absolute',
        bottom: 80,
        left: 20,
        right: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.08)',
        paddingVertical: 16,
        paddingHorizontal: 24,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    downloadText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '700',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    lyricsActionContainer: {
        alignItems: 'center',
        marginTop: 20,
    },
    downloadBtn: {
        marginTop: 24,
        borderRadius: 28,
        paddingHorizontal: 12,
    },
    auroraHeartBtn: {
        marginTop: 10,
        alignSelf: 'center',
    },
    brutalFavoriteBtn: {
        borderWidth: 3,
        shadowColor: '#000',
        shadowOffset: { width: 4, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 0,
        elevation: 8,
    },
});
