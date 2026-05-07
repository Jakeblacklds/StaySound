import { Track } from '@/src/types/audio';
import React, { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from 'react-native-paper';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AnimatedFavoriteButton, AnimatedPlayerButton } from '../parts/PlayerButtons';
import { playerStyles as styles } from '../playerStyles';
import { ProgressSlider } from '../ProgressSlider';

interface ImmersiveVariantProps {
    track: Track;
    topInset: number;
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

type HeaderSectionProps = {
    album: string;
    textColor: string;
    textStyle: any;
    accentTextStyle: any;
    onClose: () => void;
    onOpenMoreOptions: () => void;
};

const HeaderSection = React.memo(function HeaderSection({
    album,
    textColor,
    textStyle,
    accentTextStyle,
    onClose,
    onOpenMoreOptions,
}: HeaderSectionProps) {
    return (
        <View style={styles.headerImmersive}>
            <Pressable
                onPress={onClose}
                style={styles.headerBtnImmersive}
                accessibilityRole="button"
                accessibilityLabel="Minimizar reproductor"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
                <MaterialCommunityIcons name="chevron-down" size={32} color={textColor} />
            </Pressable>
            <View style={styles.headerCenterImmersive}>
                <Animated.Text
                    style={[styles.albumLabelImmersive, textStyle]}
                    numberOfLines={1}
                    accessibilityRole="text"
                    importantForAccessibility="yes"
                >
                    {album || 'Unknown Album'}
                </Animated.Text>
            </View>
            <Pressable
                onPress={onOpenMoreOptions}
                style={styles.headerBtnImmersive}
                accessibilityRole="button"
                accessibilityLabel="Más opciones"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
                <MaterialCommunityIcons name="dots-horizontal" size={28} color={textColor} />
            </Pressable>
        </View>
    );
});

type ArtworkSectionProps = {
    showLyrics: boolean;
    ARTWORK_SIZE: number;
};

const ArtworkSection = React.memo(function ArtworkSection({
    showLyrics,
    ARTWORK_SIZE,
}: ArtworkSectionProps) {
    return (
        <View style={styles.artworkSectionImmersive}>
            {showLyrics ? (
                <View style={{ flex: 1 }} />
            ) : (
                <View style={[styles.artworkFrameImmersive, { width: ARTWORK_SIZE, height: ARTWORK_SIZE }]} />
            )}
        </View>
    );
});

type TrackInfoSectionProps = {
    title: string;
    artist: string;
    isLyricsExpanded: boolean;
    qualityBadge: { label: string; tone: string; };
    qualityBadgeInk: string;
    trackTechLabel: string;
    isFavorite: boolean;
    accentColor: string;
    textColor: string;
    textStyle: any;
    accentTextStyle: any;
    lrcPreviewText?: string;
    onArtistPress: () => void;
    onToggleFavorite: () => void;
};

const LrcPreviewLine = React.memo(function LrcPreviewLine({
    text,
    textStyle,
}: {
    text?: string;
    textStyle: any;
}) {
    const slide = useSharedValue(0);
    const visibleText = text || '...';

    useEffect(() => {
        slide.value = 1;
        slide.value = withTiming(0, {
            duration: 260,
            easing: Easing.out(Easing.cubic),
        });
    }, [slide, visibleText]);

    const lineStyle = useAnimatedStyle(() => ({
        opacity: interpolate(slide.value, [0, 1], [1, 0]),
        transform: [{ translateY: interpolate(slide.value, [0, 1], [0, 12]) }],
    }));

    return (
        <View style={styles.lrcPreviewImmersive}>
            <Animated.Text style={[styles.lrcPreviewText, textStyle, lineStyle]} numberOfLines={1}>
                {visibleText}
            </Animated.Text>
        </View>
    );
});

const TrackInfoSection = React.memo(function TrackInfoSection({
    title,
    artist,
    isLyricsExpanded,
    qualityBadge,
    qualityBadgeInk,
    trackTechLabel,
    isFavorite,
    accentColor,
    textColor,
    textStyle,
    accentTextStyle,
    lrcPreviewText,
    onArtistPress,
    onToggleFavorite,
}: TrackInfoSectionProps) {
    if (isLyricsExpanded) {
        return null;
    }

    return (
        <View style={styles.trackInfoSectionImmersive}>
            <View style={styles.trackInfoRowImmersive}>
                <View style={styles.trackTextImmersive}>
                    <Animated.Text
                        style={[styles.titleImmersiveNew, textStyle]}
                        numberOfLines={1}
                        accessibilityRole="text"
                    >
                        {title}
                    </Animated.Text>
                    <Pressable
                        hitSlop={{ top: 12, bottom: 12, left: 4, right: 12 }}
                        onPress={onArtistPress}
                        accessibilityRole="link"
                        accessibilityLabel={`Ver artista ${artist}`}
                        accessibilityHint="Navega al perfil del artista"
                    >
                        <Animated.Text
                            style={[styles.artistImmersive, accentTextStyle]}
                            numberOfLines={1}
                            accessibilityElementsHidden
                        >
                            {artist}
                        </Animated.Text>
                    </Pressable>
                    <View
                        style={styles.techMetaRow}
                        accessible={true}
                        accessibilityLabel={`Formato: ${trackTechLabel}`}
                    >
                        <View style={[styles.qualityBadge, { backgroundColor: qualityBadge.tone }]}>
                            <Text style={[styles.qualityBadgeText, { color: qualityBadgeInk }]}>{qualityBadge.label}</Text>
                        </View>
                        <Animated.Text style={[styles.techMetaImmersive, textStyle]} numberOfLines={1} accessibilityElementsHidden>
                            {trackTechLabel}
                        </Animated.Text>
                    </View>
                    <LrcPreviewLine text={lrcPreviewText} textStyle={textStyle} />
                </View>
                <View style={styles.trackActionsImmersive}>
                    <AnimatedFavoriteButton
                        isFavorite={isFavorite}
                        onPress={onToggleFavorite}
                        activeColor={accentColor}
                        inactiveColor={textColor}
                        size={28}
                    />
                </View>
            </View>
        </View>
    );
});

type ControlsSectionProps = {
    isPlaying: boolean;
    shuffleEnabled: boolean;
    repeatMode: string;
    accentColor: string;
    textColor: string;
    onPrimaryColor: string;
    shuffleIcon: string;
    repeatIcon: string;
    playIcon: string;
    pauseIcon: string;
    nextIcon: string;
    previousIcon: string;
    accentBgStyle: any;
    onToggleShuffle: () => void;
    onCycleRepeatMode: () => void;
    onPlayPause: () => void;
    onNext: () => void;
    onPrevious: () => void;
};

const ControlsSection = React.memo(function ControlsSection({
    isPlaying,
    shuffleEnabled,
    repeatMode,
    accentColor,
    textColor,
    onPrimaryColor,
    shuffleIcon,
    repeatIcon,
    playIcon,
    pauseIcon,
    nextIcon,
    previousIcon,
    accentBgStyle,
    onToggleShuffle,
    onCycleRepeatMode,
    onPlayPause,
    onNext,
    onPrevious,
}: ControlsSectionProps) {
    // Smooth animated play glow: 0 = paused, 1 = playing
    const glowAnim = useSharedValue(isPlaying ? 1 : 0);

    useEffect(() => {
        glowAnim.value = withTiming(isPlaying ? 1 : 0, {
            duration: 380,
            easing: Easing.out(Easing.cubic),
        });
    }, [isPlaying, glowAnim]);

    const glowStyle = useAnimatedStyle(() => ({
        opacity: interpolate(glowAnim.value, [0, 1], [0.14, 0.40]),
        transform: [{ scale: interpolate(glowAnim.value, [0, 1], [0.78, 1.0]) }],
    }));
    return (
        <View style={styles.controlsSectionImmersive}>
            <AnimatedPlayerButton
                variant="immersive"
                kind="secondary"
                style={styles.secondaryBtnImmersive}
                onPress={onToggleShuffle}
                accessibilityLabel={shuffleEnabled ? 'Desactivar aleatorio' : 'Activar aleatorio'}
                accessibilityState={{ selected: shuffleEnabled }}
            >
                <MaterialCommunityIcons
                    name="shuffle"
                    size={24}
                    color={shuffleEnabled ? accentColor : textColor + '60'}
                />
            </AnimatedPlayerButton>

            <AnimatedPlayerButton
                variant="immersive"
                kind="nav"
                style={styles.navBtnImmersive}
                onPress={onPrevious}
                accessibilityLabel="Pista anterior"
            >
                <MaterialCommunityIcons
                    name="skip-previous"
                    size={40}
                    color={textColor}
                />
            </AnimatedPlayerButton>

            <View style={styles.playContainer}>
                {/* Play Glow - Atmospheric focus, animated smoothly */}
                <Animated.View
                    pointerEvents="none"
                    style={[
                        styles.playGlow,
                        accentBgStyle,
                        glowStyle,
                    ]}
                />
                <AnimatedPlayerButton
                    variant="immersive"
                    kind="primary"
                    onPress={onPlayPause}
                    style={[styles.playBtnImmersiveNew, accentBgStyle]}
                    accessibilityLabel={isPlaying ? 'Pausar' : 'Reproducir'}
                    accessibilityState={{ selected: isPlaying }}
                >
                    <View style={styles.flexCenter}>
                        <MaterialCommunityIcons
                            name={isPlaying ? 'pause' : 'play'}
                            size={44}
                            color={onPrimaryColor}
                        />
                    </View>
                </AnimatedPlayerButton>
            </View>

            <AnimatedPlayerButton
                variant="immersive"
                kind="nav"
                style={styles.navBtnImmersive}
                onPress={onNext}
                accessibilityLabel="Siguiente pista"
            >
                <MaterialCommunityIcons
                    name="skip-next"
                    size={40}
                    color={textColor}
                />
            </AnimatedPlayerButton>

            <AnimatedPlayerButton
                variant="immersive"
                kind="secondary"
                style={styles.secondaryBtnImmersive}
                onPress={onCycleRepeatMode}
                accessibilityLabel={
                    repeatMode === 'off'
                        ? 'Activar repetición'
                        : repeatMode === 'one'
                            ? 'Repetir una vez, toca para desactivar'
                            : 'Repetir cola, toca para repetir una vez'
                }
                accessibilityState={{ selected: repeatMode !== 'off' }}
            >
                <MaterialCommunityIcons
                    name={repeatMode === 'one' ? 'repeat-once' : 'repeat'}
                    size={24}
                    color={repeatMode !== 'off' ? accentColor : textColor + '60'}
                />
            </AnimatedPlayerButton>
        </View>
    );
});

type BottomActionsProps = {
    textColor: string;
    accentColor: string;
    showLyrics: boolean;
    onOpenQueue: () => void;
    onToggleLyrics: () => void;
};

const BottomActions = React.memo(function BottomActions({
    textColor,
    accentColor,
    showLyrics,
    onOpenQueue,
    onToggleLyrics,
}: BottomActionsProps) {
    return (
        <View style={styles.bottomActionsImmersive}>
            {/* Lyrics toggle — generic music-note icon */}
            <AnimatedPlayerButton
                variant="immersive"
                kind="secondary"
                style={styles.bottomBtnImmersive}
                onPress={onToggleLyrics}
                accessibilityRole="button"
                accessibilityLabel={showLyrics ? 'Ocultar letras' : 'Mostrar letras'}
                accessibilityState={{ selected: showLyrics }}
            >
                <MaterialCommunityIcons
                    name="music-note-outline"
                    size={26}
                    color={showLyrics ? accentColor : textColor + '80'}
                />
            </AnimatedPlayerButton>

            {/* Queue */}
            <AnimatedPlayerButton
                variant="immersive"
                kind="secondary"
                style={styles.bottomBtnImmersive}
                onPress={onOpenQueue}
                accessibilityRole="button"
                accessibilityLabel="Ver cola de reproducción"
            >
                <MaterialCommunityIcons
                    name="playlist-play"
                    size={26}
                    color={textColor + '80'}
                />
            </AnimatedPlayerButton>
        </View>
    );
});

export function ImmersiveVariant({
    track,
    topInset,
    isPlaying,
    shuffleEnabled,
    repeatMode,
    isFavorite,
    accentColor,
    textColor,
    onPrimaryColor,
    qualityBadge,
    qualityBadgeInk,
    trackTechLabel,
    shuffleIcon,
    repeatIcon,
    playIcon,
    pauseIcon,
    nextIcon,
    previousIcon,
    showLyrics,
    lrcPreviewText,
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
    accentBgStyle,
    ARTWORK_SIZE
}: ImmersiveVariantProps) {
    return (
        <View style={[styles.contentImmersive, { paddingTop: topInset }]}>
            <HeaderSection
                album={track.album}
                textColor={textColor}
                textStyle={textStyle}
                accentTextStyle={accentTextStyle}
                onClose={onClose}
                onOpenMoreOptions={onOpenMoreOptions}
            />

            <ArtworkSection
                showLyrics={showLyrics}
                ARTWORK_SIZE={ARTWORK_SIZE}
            />

            <View style={styles.playerLowerStack}>
                <TrackInfoSection
                    title={track.title}
                    artist={track.artist}
                    lrcPreviewText={lrcPreviewText}
                    isLyricsExpanded={isLyricsExpanded}
                    qualityBadge={qualityBadge}
                    qualityBadgeInk={qualityBadgeInk}
                    trackTechLabel={trackTechLabel}
                    isFavorite={isFavorite}
                    accentColor={accentColor}
                    textColor={textColor}
                    textStyle={textStyle}
                    accentTextStyle={accentTextStyle}
                    onArtistPress={onArtistPress}
                    onToggleFavorite={onToggleFavorite}
                />

                <View style={styles.progressSectionImmersive}>
                    <ProgressSlider duration={track.duration} onSeek={onSeek} activeColor={accentColor} />
                </View>

                <ControlsSection
                    isPlaying={isPlaying}
                    shuffleEnabled={shuffleEnabled}
                    repeatMode={repeatMode}
                    accentColor={accentColor}
                    textColor={textColor}
                    onPrimaryColor={onPrimaryColor}
                    shuffleIcon={shuffleIcon}
                    repeatIcon={repeatIcon}
                    playIcon={playIcon}
                    pauseIcon={pauseIcon}
                    nextIcon={nextIcon}
                    previousIcon={previousIcon}
                    accentBgStyle={accentBgStyle}
                    onToggleShuffle={onToggleShuffle}
                    onCycleRepeatMode={onCycleRepeatMode}
                    onPlayPause={onPlayPause}
                    onNext={onNext}
                    onPrevious={onPrevious}
                />

                <BottomActions
                    textColor={textColor}
                    accentColor={accentColor}
                    showLyrics={showLyrics}
                    onOpenQueue={onOpenQueue}
                    onToggleLyrics={onToggleLyrics}
                />
            </View>
        </View>
    );
}
