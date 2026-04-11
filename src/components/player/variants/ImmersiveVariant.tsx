import { Track } from '@/src/types/audio';
import React from 'react';
import { Pressable, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import Animated from 'react-native-reanimated';
import { CustomIcon, IconName } from '../../ui';
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
    shuffleIcon: IconName;
    repeatIcon: IconName;
    playIcon: IconName;
    pauseIcon: IconName;
    nextIcon: IconName;
    previousIcon: IconName;
    showLyrics: boolean;
    isLyricsExpanded: boolean;
    onClose: () => void;
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
};

const HeaderSection = React.memo(function HeaderSection({
    album,
    textColor,
    textStyle,
    accentTextStyle,
    onClose,
}: HeaderSectionProps) {
    return (
        <View style={styles.headerImmersive}>
            <Pressable onPress={onClose} style={styles.headerBtnImmersive}>
                <IconButton icon="chevron-down" size={26} iconColor={textColor} />
            </Pressable>
            <View style={styles.headerCenterImmersive}>
                <Animated.Text style={[styles.playingFromLabel, textStyle]}>PLAYING FROM</Animated.Text>
                <Animated.Text style={[styles.albumLabelImmersive, accentTextStyle]} numberOfLines={1}>
                    {album || 'Unknown Album'}
                </Animated.Text>
            </View>
            <View style={styles.headerSpacerImmersive} />
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
    showLyrics: boolean;
    isLyricsExpanded: boolean;
    qualityBadge: { label: string; tone: string; };
    qualityBadgeInk: string;
    trackTechLabel: string;
    isFavorite: boolean;
    accentColor: string;
    textColor: string;
    textStyle: any;
    accentTextStyle: any;
    onToggleLyrics: () => void;
    onArtistPress: () => void;
    onToggleFavorite: () => void;
};

const TrackInfoSection = React.memo(function TrackInfoSection({
    title,
    artist,
    showLyrics,
    isLyricsExpanded,
    qualityBadge,
    qualityBadgeInk,
    trackTechLabel,
    isFavorite,
    accentColor,
    textColor,
    textStyle,
    accentTextStyle,
    onToggleLyrics,
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
                    <Animated.Text style={[styles.titleImmersiveNew, textStyle]} numberOfLines={1}>
                        {title}
                    </Animated.Text>
                    <Pressable hitSlop={8} onPress={onArtistPress}>
                        <Animated.Text style={[styles.artistImmersive, accentTextStyle]} numberOfLines={1}>
                            {artist}
                        </Animated.Text>
                    </Pressable>
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
                        icon={({ size, color }) => <CustomIcon name="Lyrics" size={size} color={color} forceDynamicColor />}
                        size={28}
                        onPress={onToggleLyrics}
                        iconColor={showLyrics ? accentColor : textColor}
                        style={{ margin: 0 }}
                    />
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
    shuffleIcon: IconName;
    repeatIcon: IconName;
    playIcon: IconName;
    pauseIcon: IconName;
    nextIcon: IconName;
    previousIcon: IconName;
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
    return (
        <View style={styles.controlsSectionImmersive}>
            <AnimatedPlayerButton variant="immersive" kind="secondary" style={styles.secondaryBtnImmersive} onPress={onToggleShuffle}>
                <IconButton
                    icon={({ size, color }) => <CustomIcon name={shuffleIcon} size={size} color={color} />}
                    size={24}
                    iconColor={shuffleEnabled ? accentColor : textColor + '60'}
                />
            </AnimatedPlayerButton>

            <AnimatedPlayerButton variant="immersive" kind="nav" style={styles.navBtnImmersive} onPress={onPrevious}>
                <IconButton
                    icon={({ size, color }) => <CustomIcon name={previousIcon} size={size} color={color} forceDynamicColor />}
                    size={36}
                    iconColor={textColor}
                />
            </AnimatedPlayerButton>

            <AnimatedPlayerButton variant="immersive" kind="primary" onPress={onPlayPause} style={[styles.playBtnImmersiveNew, accentBgStyle]}>
                <View style={styles.flexCenter}>
                    <IconButton
                        icon={({ size, color }) => <CustomIcon name={isPlaying ? pauseIcon : playIcon} size={size} color={color} />}
                        size={40}
                        iconColor={onPrimaryColor}
                    />
                </View>
            </AnimatedPlayerButton>

            <AnimatedPlayerButton variant="immersive" kind="nav" style={styles.navBtnImmersive} onPress={onNext}>
                <IconButton
                    icon={({ size, color }) => <CustomIcon name={nextIcon} size={size} color={color} forceDynamicColor />}
                    size={36}
                    iconColor={textColor}
                />
            </AnimatedPlayerButton>

            <AnimatedPlayerButton variant="immersive" kind="secondary" style={styles.secondaryBtnImmersive} onPress={onCycleRepeatMode}>
                <IconButton
                    icon={({ size, color }) => <CustomIcon name={repeatIcon} size={size} color={color} />}
                    size={24}
                    iconColor={repeatMode !== 'off' ? accentColor : textColor + '60'}
                />
            </AnimatedPlayerButton>
        </View>
    );
});

type BottomActionsProps = {
    textColor: string;
    onOpenQueue: () => void;
};

const BottomActions = React.memo(function BottomActions({
    textColor,
    onOpenQueue,
}: BottomActionsProps) {
    return (
        <View style={styles.bottomActionsImmersive}>
            <Pressable style={styles.bottomBtnImmersive} onPress={onOpenQueue}>
                <IconButton
                    icon={({ size, color }) => <CustomIcon name="Cola" size={size} color={color} />}
                    size={22}
                    iconColor={textColor + '80'}
                />
            </Pressable>
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
    isLyricsExpanded,
    onClose,
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
            />

            <ArtworkSection
                showLyrics={showLyrics}
                ARTWORK_SIZE={ARTWORK_SIZE}
            />

            <TrackInfoSection
                title={track.title}
                artist={track.artist}
                showLyrics={showLyrics}
                isLyricsExpanded={isLyricsExpanded}
                qualityBadge={qualityBadge}
                qualityBadgeInk={qualityBadgeInk}
                trackTechLabel={trackTechLabel}
                isFavorite={isFavorite}
                accentColor={accentColor}
                textColor={textColor}
                textStyle={textStyle}
                accentTextStyle={accentTextStyle}
                onToggleLyrics={onToggleLyrics}
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
                onOpenQueue={onOpenQueue}
            />
        </View>
    );
}
