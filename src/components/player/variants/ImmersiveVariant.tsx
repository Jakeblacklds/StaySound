import { Track } from '@/src/types/audio';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, interpolate, interpolateColor, runOnJS, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withSpring, withSequence, withTiming } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AnimatedFavoriteButton } from '../parts/PlayerButtons';
import { playerStyles as styles } from '../playerStyles';
import { ProgressSlider } from '../ProgressSlider';

interface ImmersiveVariantProps {
    track: Track;
    topInset: number;
    bottomInset: number;
    isPlaying: boolean;
    shuffleEnabled: boolean;
    repeatMode: string;
    isFavorite: boolean;
    accentColor: string;
    textColor: string;
    onPrimaryColor: string;
    qualityBadge: { label: string; tone: string; };
    qualityBadgeInk: string;
    trackTechLabel: string;
    shuffleIcon: string;
    repeatIcon: string;
    playIcon: string;
    pauseIcon: string;
    nextIcon: string;
    previousIcon: string;
    showLyrics: boolean;
    lrcPreviewText?: string;
    isLyricsExpanded: boolean;
    lrcAccentBorderColor?: string;
    controlSurfaceColor?: string;
    controlSurfaceStrongColor?: string;
    controlBorderColor?: string;
    onClose: () => void;
    onOpenMoreOptions: () => void;
    onToggleLyrics: () => void;
    onArtistPress: () => void;
    onOpenQueue: () => void;
    onToggleFavorite: () => void;
    onToggleShuffle: () => void;
    onCycleRepeatMode: () => void;
    onPlayPause: () => void;
    onNext: () => void;
    onPrevious: () => void;
    onSeek: (pos: number) => void;
    textStyle: any;
    accentTextStyle: any;
    accentBgStyle: any;
    ARTWORK_SIZE: number;
}

/* ------------------------------------------------------------------ *
 *  Minimal transport glyph — naked icon, only a subtle press scale.
 *  No surfaces, no pills: the icon IS the control.
 * ------------------------------------------------------------------ */
const Glyph = React.memo(function Glyph({
    name,
    size,
    color,
    onPress,
    accessibilityLabel,
    style,
    children,
}: {
    name?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
    size?: number;
    color?: string;
    onPress: () => void;
    accessibilityLabel: string;
    style?: any;
    children?: React.ReactNode;
}) {
    const pressed = useSharedValue(0);
    const aStyle = useAnimatedStyle(() => ({
        transform: [{ scale: interpolate(pressed.value, [0, 1], [1, 0.86]) }],
        opacity: interpolate(pressed.value, [0, 1], [1, 0.6]),
    }));
    return (
        <Pressable
            onPressIn={() => { pressed.value = withTiming(1, { duration: 80, easing: Easing.out(Easing.quad) }); }}
            onPressOut={() => { pressed.value = withTiming(0, { duration: 150, easing: Easing.out(Easing.cubic) }); }}
            onPress={onPress}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            style={style}
        >
            <Animated.View style={aStyle}>
                {children ?? (
                    <MaterialCommunityIcons name={name!} size={size} color={color} />
                )}
            </Animated.View>
        </Pressable>
    );
});

/* Crossfading play / pause glyph (naked). */
const PlayPauseGlyph = React.memo(function PlayPauseGlyph({
    isPlaying,
    color,
    size,
}: {
    isPlaying: boolean;
    color: string;
    size: number;
}) {
    const progress = useSharedValue(isPlaying ? 1 : 0);
    useEffect(() => {
        progress.value = withTiming(isPlaying ? 1 : 0, { duration: 200, easing: Easing.inOut(Easing.cubic) });
    }, [isPlaying, progress]);

    const playStyle = useAnimatedStyle(() => ({
        opacity: 1 - progress.value,
        transform: [{ scale: interpolate(progress.value, [0, 1], [1, 0.7]) }],
    }));
    const pauseStyle = useAnimatedStyle(() => ({
        opacity: progress.value,
        transform: [{ scale: interpolate(progress.value, [0, 1], [0.7, 1]) }],
    }));

    return (
        <View style={{ width: size, height: size }}>
            <Animated.View style={[StyleSheet.absoluteFill, styles.flexCenter, playStyle]}>
                <MaterialCommunityIcons name="play" size={size} color={color} />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, styles.flexCenter, pauseStyle]}>
                <MaterialCommunityIcons name="pause" size={size} color={color} />
            </Animated.View>
        </View>
    );
});

/* ------------------------------------------------------------------ *
 *  ActiveGlyph — naked toggle glyph (shuffle / repeat). Animates its
 *  color between an inactive ghost and the album accent, and gives a
 *  little spring "pop" the moment it becomes active.
 * ------------------------------------------------------------------ */
const ActiveGlyph = React.memo(function ActiveGlyph({
    name,
    size,
    active,
    activeColor,
    inactiveColor,
    onPress,
    accessibilityLabel,
    accessibilityState,
    style,
}: {
    name: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
    size: number;
    active: boolean;
    activeColor: string;
    inactiveColor: string;
    onPress: () => void;
    accessibilityLabel: string;
    accessibilityState?: { selected?: boolean };
    style?: any;
}) {
    const pressed = useSharedValue(0);
    const activeProgress = useSharedValue(active ? 1 : 0);
    const pop = useSharedValue(0);
    const firstRun = useRef(true);

    useEffect(() => {
        activeProgress.value = withTiming(active ? 1 : 0, {
            duration: 220,
            easing: Easing.out(Easing.cubic),
        });
        // Pop only when turning ON, and never on the very first mount.
        if (!firstRun.current && active) {
            pop.value = withSequence(
                withTiming(1, { duration: 130, easing: Easing.out(Easing.quad) }),
                withSpring(0, { damping: 9, stiffness: 240, mass: 0.5 }),
            );
        }
        firstRun.current = false;
    }, [active, activeProgress, pop]);

    const iconColor = useDerivedValue(() =>
        interpolateColor(activeProgress.value, [0, 1], [inactiveColor, activeColor]),
    );
    const [resolvedColor, setResolvedColor] = useState(active ? activeColor : inactiveColor);
    useAnimatedReaction(
        () => iconColor.value,
        (c) => runOnJS(setResolvedColor)(c),
        [inactiveColor, activeColor],
    );

    const aStyle = useAnimatedStyle(() => ({
        transform: [
            { scale: interpolate(pressed.value, [0, 1], [1, 0.84]) * interpolate(pop.value, [0, 1], [1, 1.28]) },
        ],
        opacity: interpolate(pressed.value, [0, 1], [1, 0.6]),
    }));

    return (
        <Pressable
            onPressIn={() => { pressed.value = withTiming(1, { duration: 80, easing: Easing.out(Easing.quad) }); }}
            onPressOut={() => { pressed.value = withTiming(0, { duration: 150, easing: Easing.out(Easing.cubic) }); }}
            onPress={onPress}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={accessibilityState}
            style={style}
        >
            <Animated.View style={aStyle}>
                <MaterialCommunityIcons name={name} size={size} color={resolvedColor} />
            </Animated.View>
        </Pressable>
    );
});

/* ------------------------------------------------------------------ *
 *  LrcPreviewLine — single current-phrase line from the LRC engine.
 *  Each new phrase fades + slides up; while loading it whispers "…".
 *  Tapping it opens the full lyrics view.
 * ------------------------------------------------------------------ */
const LrcPreviewLine = React.memo(function LrcPreviewLine({
    text,
    color,
    onPress,
}: {
    text?: string;
    color: string;
    onPress: () => void;
}) {
    const enter = useSharedValue(1);
    const visibleText = text && text.length > 0 ? text : '···';

    useEffect(() => {
        enter.value = 1;
        enter.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) });
    }, [visibleText, enter]);

    const lineStyle = useAnimatedStyle(() => ({
        opacity: interpolate(enter.value, [0, 1], [1, 0]),
        transform: [{ translateY: interpolate(enter.value, [0, 1], [0, 10]) }],
    }));

    return (
        <Pressable
            onPress={onPress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Mostrar letras"
            style={styles.lrcLineMinimal}
        >
            <Animated.Text
                style={[styles.lrcLineText, { color }, lineStyle]}
                numberOfLines={1}
            >
                {visibleText}
            </Animated.Text>
        </Pressable>
    );
});

export function ImmersiveVariant({
    track,
    topInset,
    bottomInset,
    isPlaying,
    isFavorite,
    shuffleEnabled,
    repeatMode,
    accentColor,
    textColor,
    trackTechLabel,
    showLyrics,
    lrcPreviewText,
    isLyricsExpanded,
    onOpenMoreOptions,
    onToggleLyrics,
    onArtistPress,
    onOpenQueue,
    onToggleFavorite,
    onToggleShuffle,
    onCycleRepeatMode,
    onPlayPause,
    onNext,
    onPrevious,
    onSeek,
    textStyle,
    accentTextStyle,
    ARTWORK_SIZE,
}: ImmersiveVariantProps) {
    return (
        <View style={[styles.contentMinimal, { paddingTop: topInset, paddingBottom: Math.max(bottomInset + 18, 40) }]}>
            {/* Top: grabber + whisper-quiet context line */}
            <View style={styles.grabberWrap}>
                <View style={[styles.grabber, { backgroundColor: textColor }]} />
            </View>
            <Animated.Text
                style={[styles.topContextLabel, textStyle]}
                numberOfLines={1}
            >
                {track.album || ''}
            </Animated.Text>

            {/* Cover slot — the real cover is the absolute morphing layer in
                FullPlayer; this reserves its exact footprint so nothing below
                can ever be covered. */}
            <View style={[styles.coverSlotMinimal, { height: ARTWORK_SIZE + 8 }]}>
                {showLyrics ? null : (
                    <View style={{ width: ARTWORK_SIZE, height: ARTWORK_SIZE }} />
                )}
            </View>

            {/* Flexible breathing space — keeps the lower stack pinned low. */}
            <View style={styles.flexSpacer} />

            {!isLyricsExpanded && (
                <View style={styles.lowerMinimal}>
                    {/* Title + artist, with the heart as the single trailing control */}
                    <View style={styles.titleRowMinimal}>
                        <View style={styles.titleColMinimal}>
                            <Animated.Text
                                style={[styles.titleMinimal, textStyle]}
                                numberOfLines={1}
                                accessibilityRole="text"
                            >
                                {track.title}
                            </Animated.Text>
                            <Pressable
                                onPress={onArtistPress}
                                hitSlop={{ top: 8, bottom: 8, left: 4, right: 12 }}
                                accessibilityRole="link"
                                accessibilityLabel={`Ver artista ${track.artist}`}
                            >
                                <Animated.Text
                                    style={[styles.artistMinimal, accentTextStyle]}
                                    numberOfLines={1}
                                >
                                    {track.artist}
                                </Animated.Text>
                            </Pressable>
                            {trackTechLabel ? (
                                <Animated.Text
                                    style={[styles.techMinimal, textStyle]}
                                    numberOfLines={1}
                                >
                                    {trackTechLabel}
                                </Animated.Text>
                            ) : null}
                        </View>
                        <AnimatedFavoriteButton
                            isFavorite={isFavorite}
                            onPress={onToggleFavorite}
                            activeColor={accentColor}
                            inactiveColor={textColor}
                            size={26}
                            style={styles.heartMinimal}
                        />
                    </View>

                    {/* Current lyric phrase (lrclib engine) — taps open full lyrics */}
                    {showLyrics ? null : (
                        <LrcPreviewLine
                            text={lrcPreviewText}
                            color={accentColor}
                            onPress={onToggleLyrics}
                        />
                    )}

                    {/* Progress */}
                    <View style={styles.progressMinimal}>
                        <ProgressSlider
                            duration={track.duration}
                            onSeek={onSeek}
                            activeColor={accentColor}
                            inactiveColor={textColor + '24'}
                            textColor={textColor + '99'}
                        />
                    </View>

                    {/* Transport — naked glyphs: shuffle · prev · play · next · repeat */}
                    <View style={styles.transportMinimal}>
                        <ActiveGlyph
                            name="shuffle"
                            size={24}
                            active={shuffleEnabled}
                            activeColor={accentColor}
                            inactiveColor={textColor + '66'}
                            onPress={onToggleShuffle}
                            accessibilityLabel={shuffleEnabled ? 'Desactivar aleatorio' : 'Activar aleatorio'}
                            accessibilityState={{ selected: shuffleEnabled }}
                            style={styles.transportEdge}
                        />
                        <Glyph
                            name="skip-previous"
                            size={36}
                            color={textColor}
                            onPress={onPrevious}
                            accessibilityLabel="Pista anterior"
                            style={styles.transportSide}
                        />
                        <Glyph
                            onPress={onPlayPause}
                            accessibilityLabel={isPlaying ? 'Pausar' : 'Reproducir'}
                            style={styles.transportPlay}
                        >
                            <PlayPauseGlyph isPlaying={isPlaying} color={textColor} size={62} />
                        </Glyph>
                        <Glyph
                            name="skip-next"
                            size={36}
                            color={textColor}
                            onPress={onNext}
                            accessibilityLabel="Siguiente pista"
                            style={styles.transportSide}
                        />
                        <ActiveGlyph
                            name={repeatMode === 'one' ? 'repeat-once' : 'repeat'}
                            size={24}
                            active={repeatMode !== 'off'}
                            activeColor={accentColor}
                            inactiveColor={textColor + '66'}
                            onPress={onCycleRepeatMode}
                            accessibilityLabel={
                                repeatMode === 'off'
                                    ? 'Activar repetición'
                                    : repeatMode === 'one'
                                        ? 'Repetir una vez, toca para desactivar'
                                        : 'Repetir cola, toca para repetir una vez'
                            }
                            accessibilityState={{ selected: repeatMode !== 'off' }}
                            style={styles.transportEdge}
                        />
                    </View>

                    {/* Footer — three quiet actions */}
                    <View style={styles.footerMinimal}>
                        <Glyph
                            name="text"
                            size={24}
                            color={showLyrics ? accentColor : textColor + 'B0'}
                            onPress={onToggleLyrics}
                            accessibilityLabel={showLyrics ? 'Ocultar letras' : 'Mostrar letras'}
                            style={styles.footerBtn}
                        />
                        <Glyph
                            name="playlist-music"
                            size={24}
                            color={textColor + 'B0'}
                            onPress={onOpenQueue}
                            accessibilityLabel="Ver cola de reproducción"
                            style={styles.footerBtn}
                        />
                        <Glyph
                            name="dots-horizontal"
                            size={24}
                            color={textColor + 'B0'}
                            onPress={onOpenMoreOptions}
                            accessibilityLabel="Más opciones"
                            style={styles.footerBtn}
                        />
                    </View>
                </View>
            )}
        </View>
    );
}
