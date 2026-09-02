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
    lrcPreviousText?: string;
    lrcNextText?: string;
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
 *  Each new phrase hands off vertically to the next one; while loading it
 *  whispers "…". The active phrase gets two lines plus font fitting so a
 *  longer lyric remains readable instead of truncating to an ellipsis.
 *  Tapping it opens the full lyrics view.
 * ------------------------------------------------------------------ */
const LrcPreviewLine = React.memo(function LrcPreviewLine({
    text,
    previousText,
    nextText,
    color,
    inactiveColor,
    onPress,
}: {
    text?: string;
    previousText?: string;
    nextText?: string;
    color: string;
    inactiveColor: string;
    onPress: () => void;
}) {
    const transition = useSharedValue(1);
    const visibleText = text && text.length > 0 ? text : '···';
    const previousTextRef = useRef(visibleText);
    const [outgoingText, setOutgoingText] = useState('');

    useEffect(() => {
        const previousText = previousTextRef.current;
        previousTextRef.current = visibleText;
        if (previousText === visibleText) return;

        setOutgoingText(previousText === '···' ? '' : previousText);
        transition.value = 0;
        transition.value = withTiming(1, { duration: 440, easing: Easing.out(Easing.cubic) });
        const timer = setTimeout(() => setOutgoingText(''), 460);
        return () => clearTimeout(timer);
    }, [transition, visibleText]);

    const incomingLineStyle = useAnimatedStyle(() => ({
        opacity: interpolate(transition.value, [0, 0.22, 1], [0, 0.82, 1]),
        transform: [
            { translateY: interpolate(transition.value, [0, 1], [13, 0]) },
            { scale: interpolate(transition.value, [0, 1], [0.975, 1]) },
        ],
    }));
    const outgoingLineStyle = useAnimatedStyle(() => ({
        opacity: interpolate(transition.value, [0, 0.72, 1], [0.58, 0.16, 0]),
        transform: [{ translateY: interpolate(transition.value, [0, 1], [0, -13]) }],
    }));
    const markerStyle = useAnimatedStyle(() => ({
        opacity: interpolate(transition.value, [0, 0.35, 1], [0.42, 1, 0.76]),
        transform: [
            { scaleX: interpolate(transition.value, [0, 0.35, 1], [0.4, 1.12, 1]) },
            { scaleY: interpolate(transition.value, [0, 0.35, 1], [0.8, 1.2, 1]) },
        ],
    }));

    return (
        <Pressable
            onPress={onPress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Mostrar letras"
            style={styles.lyricRail}
        >
            <View style={[styles.lyricRailRule, { backgroundColor: inactiveColor }]}>
                <Animated.View style={[styles.lyricRailMarker, { backgroundColor: color }, markerStyle]} />
            </View>
            <View style={styles.lyricCurrentStage}>
                {outgoingText ? (
                    <Animated.Text
                        style={[styles.lrcLineText, styles.lyricLineLayer, { color }, outgoingLineStyle]}
                        numberOfLines={2}
                        adjustsFontSizeToFit
                        minimumFontScale={0.72}
                    >
                        {outgoingText}
                    </Animated.Text>
                ) : null}
                <Animated.Text
                    style={[styles.lrcLineText, styles.lyricLineLayer, { color }, incomingLineStyle]}
                    numberOfLines={2}
                    adjustsFontSizeToFit
                    minimumFontScale={0.72}
                >
                    {visibleText}
                </Animated.Text>
            </View>
            <Animated.Text
                style={[styles.lyricRailGhost, { color: inactiveColor }]}
                numberOfLines={1}
            >
                {previousText || ' '}
            </Animated.Text>
            <Animated.Text
                style={[styles.lyricRailGhost, { color: inactiveColor }]}
                numberOfLines={1}
            >
                {nextText || ' '}
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
    onPrimaryColor,
    trackTechLabel,
    showLyrics,
    lrcPreviewText,
    lrcPreviousText,
    lrcNextText,
    isLyricsExpanded,
    onClose,
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
        <View style={[styles.contentMinimal, { paddingTop: topInset, paddingBottom: Math.max(bottomInset + 8, 26) }]}>
            {/* Top chrome floats upward without changing the reserved cover slot. */}
            <View style={styles.topChromeMinimal}>
                <Pressable
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel="Cerrar reproductor"
                    hitSlop={12}
                    style={styles.playerCloseButton}
                >
                    <MaterialCommunityIcons
                        name="chevron-down"
                        size={34}
                        color={textColor + '70'}
                    />
                </Pressable>
                <Animated.Text
                    style={[styles.topContextLabel, textStyle]}
                    numberOfLines={1}
                >
                    {track.title}
                </Animated.Text>
            </View>

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
                            previousText={lrcPreviousText}
                            nextText={lrcNextText}
                            color={accentColor}
                            inactiveColor={textColor + '35'}
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
                            style={[styles.transportPlay, { backgroundColor: accentColor }]}
                        >
                            <PlayPauseGlyph isPlaying={isPlaying} color={onPrimaryColor} size={45} />
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
                            name="playlist-play"
                            size={24}
                            color={textColor + 'A8'}
                            onPress={onOpenQueue}
                            accessibilityLabel="Ver cola de reproducción"
                            style={styles.footerBtn}
                        />
                        <Glyph
                            name="playlist-music"
                            size={24}
                            color={showLyrics ? accentColor : textColor + 'A8'}
                            onPress={onToggleLyrics}
                            accessibilityLabel={showLyrics ? 'Ocultar letras' : 'Mostrar letras'}
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
