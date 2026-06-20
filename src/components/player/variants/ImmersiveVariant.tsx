import { Track } from '@/src/types/audio';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
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

export function ImmersiveVariant({
    track,
    topInset,
    bottomInset,
    isPlaying,
    isFavorite,
    accentColor,
    textColor,
    trackTechLabel,
    showLyrics,
    isLyricsExpanded,
    onOpenMoreOptions,
    onToggleLyrics,
    onArtistPress,
    onOpenQueue,
    onToggleFavorite,
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

                    {/* Transport — naked glyphs, evenly weighted, play largest */}
                    <View style={styles.transportMinimal}>
                        <Glyph
                            name="skip-previous"
                            size={38}
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
                            <PlayPauseGlyph isPlaying={isPlaying} color={textColor} size={64} />
                        </Glyph>
                        <Glyph
                            name="skip-next"
                            size={38}
                            color={textColor}
                            onPress={onNext}
                            accessibilityLabel="Siguiente pista"
                            style={styles.transportSide}
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
