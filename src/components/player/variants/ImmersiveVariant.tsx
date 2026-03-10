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

export function ImmersiveVariant({
    track,
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
        <View style={styles.contentImmersive}>
            <View style={styles.headerImmersive}>
                <Pressable onPress={onClose} style={styles.headerBtnImmersive}>
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

            <View style={styles.artworkSectionImmersive}>
                {showLyrics ? (
                    <View style={{ flex: 1 }} />
                ) : (
                    <View style={[styles.artworkFrameImmersive, { width: ARTWORK_SIZE, height: ARTWORK_SIZE }]} />
                )}
            </View>

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
            )}

            <View style={styles.progressSectionImmersive}>
                <ProgressSlider duration={track.duration} onSeek={onSeek} activeColor={accentColor} />
            </View>

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

            <View style={styles.bottomActionsImmersive}>
                <Pressable style={styles.bottomBtnImmersive}>
                    <IconButton
                        icon={({ size, color }) => <CustomIcon name="Cola" size={size} color={color} />}
                        size={22}
                        iconColor={textColor + '80'}
                        onPress={onOpenQueue}
                    />
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
}
