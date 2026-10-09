/**
 * TrackListItem - Single track row for lists
 * 
 * Performance notes:
 * - NO per-item Reanimated animations tied to scroll (position, opacity, etc.) â€”
 *   those would run a worklet every frame per cell, killing 120fps scroll.
 * - Two useAnimatedStyle hooks read singleton shared values from ThemeProvider
 *   (surface + surfaceVariant colors). Their worklets only execute during the
 *   700ms dynamic-color transition when the song changes â€” never during scroll.
 *   FlashList recycles ~15-20 cells max, so overhead is negligible.
 * - Uses plain Pressable with native ripple for zero-cost press feedback.
 * - Playing state is passed from parent to avoid hundreds of store subscribers.
 */

import { formatDuration } from '@/src/services';
import { typeScale, useAnimatedColors, usePerformanceProfile, useTheme } from '@/src/theme';
import { Track } from '@/src/types';
import { Image } from 'expo-image';
import React, { ReactNode, useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedProps, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { CustomIcon, IconName } from './CustomIcon';

const AnimatedCustomIcon = Animated.createAnimatedComponent(CustomIcon);

interface TrackListItemProps {
    track: Track;
    index?: number;
    showArtwork?: boolean;
    showIndex?: boolean;
    outerInset?: number;
    contentPaddingHorizontal?: number;
    visualStyle?: 'default' | 'library';
    isPlaying?: boolean;
    onPress: (track: Track) => void;
    onOptionsPress?: (track: Track) => void;
    optionsIcon?: IconName;
    optionsIconColor?: string;
    optionsBusy?: boolean;
    optionsLabel?: string;
    optionsDisabled?: boolean;
    optionsAccessory?: ReactNode;
}

function LibraryTrackListItemInner({
    track,
    index,
    showArtwork = true,
    showIndex = false,
    outerInset,
    contentPaddingHorizontal = 12,
    isPlaying: isPlayingProp,
    onPress,
    onOptionsPress,
    optionsIcon,
    optionsIconColor,
    optionsBusy = false,
    optionsLabel,
    optionsDisabled = false,
    optionsAccessory,
}: TrackListItemProps) {
    const { theme } = useTheme();
    const performanceProfile = usePerformanceProfile();
    const aC = useAnimatedColors();
    const trackStyles = theme.components.trackItem;
    const globalStyles = theme.components.global;
    const isPlaying = !!isPlayingProp;
    const imageCachePolicy = performanceProfile.imageCachePolicyList;
    const isMaterial3 = theme.id.startsWith('material3');
    const subtitle = track.album && track.album !== 'Unknown Album'
        ? `${track.artist} - ${track.album}`
        : track.artist;

    const containerStyle = useMemo(() => ([
        styles.container,
        {
            height: trackStyles.height,
            borderRadius: 0,
            marginHorizontal: outerInset ?? (globalStyles.screenPadding / 2),
            marginVertical: 0,
            overflow: 'hidden' as const,
        }
    ]), [globalStyles.screenPadding, outerInset, trackStyles.height]);

    const artworkContainerStyle = useMemo(() => ([
        styles.artwork,
        styles.libraryArtwork,
        {
            width: trackStyles.artworkSize,
            height: trackStyles.artworkSize,
            borderRadius: 7,
        }
    ]), [trackStyles.artworkRadius, trackStyles.artworkSize]);

    const dividerInset = (trackStyles.artworkSize || 58) + contentPaddingHorizontal + 12;
    const animatedArtworkStyle = useAnimatedStyle(() => ({
        backgroundColor: aC.surfaceVariant.value,
    }));
    const suffix = isMaterial3 ? '66' : '40';
    const animatedPlayingStyle = useAnimatedStyle(() => ({
        backgroundColor: aC.primaryContainer.value + suffix,
    }));
    const animatedTitleStyle = useAnimatedStyle(() => ({
        color: isPlaying ? aC.onPrimaryContainer.value : aC.onSurface.value,
    }));
    const animatedPlayingIconStyle = useAnimatedStyle(() => ({
        opacity: isPlaying ? 1 : 0.72,
    }));
    const animatedSubtleStyle = useAnimatedStyle(() => ({
        color: isPlaying ? aC.onPrimaryContainer.value : aC.onSurface.value,
        opacity: isPlaying ? 0.88 : 0.72,
    }));
    const animatedLibraryIconProps = useAnimatedProps(() => ({
        color: isPlaying ? aC.onPrimaryContainer.value : aC.onSurfaceVariant.value,
    }));
    const animatedFavoriteProps = useAnimatedProps(() => ({
        color: aC.primary.value,
    }));
    const animatedOptionsProps = useAnimatedProps(() => ({
        color: optionsIconColor ?? (isPlaying ? aC.onPrimaryContainer.value : aC.onSurfaceVariant.value),
    }));

    return (
        <Animated.View style={containerStyle}>
            {isPlaying ? (
                <Animated.View
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFillObject,
                        { borderRadius: 0 },
                        animatedPlayingStyle,
                    ]}
                />
            ) : null}
            <Pressable
                unstable_pressDelay={80}
                onPress={() => onPress(track)}
                android_ripple={{ color: theme.colors.primary + '15' }}
                accessibilityRole="button"
                accessibilityLabel={`${track.title} por ${track.artist}${isPlaying ? ', reproduciéndose ahora' : ''}`}
                accessibilityState={{ selected: isPlaying }}
                style={({ pressed }) => [
                    styles.pressableInner,
                    { paddingHorizontal: contentPaddingHorizontal },
                    pressed && styles.pressed,
                ]}
            >
                {showIndex && index !== undefined ? (
                    <View style={[styles.indexContainer, { width: trackStyles.artworkSize || 40 }]}>
                        {isPlaying ? (
                            <AnimatedCustomIcon
                                name="Play"
                                size={14}
                                animatedProps={animatedLibraryIconProps}
                                style={[styles.playingIndicator, animatedPlayingIconStyle]}
                            />
                        ) : (
                            <Animated.Text style={[styles.indexText, animatedSubtleStyle, { opacity: 0.8 }]}>
                                {(index + 1).toString().padStart(2, '0')}
                            </Animated.Text>
                        )}
                    </View>
                ) : showArtwork ? (
                    <Animated.View style={[artworkContainerStyle, animatedArtworkStyle]}>
                        {track.artwork || track.artworkThumb ? (
                            <Image
                                source={{ uri: track.artwork || track.artworkThumb }}
                                style={styles.artworkImage}
                                contentFit="cover"
                                recyclingKey={track.id}
                                cachePolicy={imageCachePolicy}
                                transition={0}
                            />
                        ) : (
                            <CustomIcon name="Cancion" size={trackStyles.artworkSize * 0.6} color={theme.colors.primary} />
                        )}
                    </Animated.View>
                ) : null}
                {!showIndex && showArtwork && index !== undefined ? (
                    <Animated.Text
                        style={[
                            styles.libraryInlineIndex,
                            animatedSubtleStyle,
                            isPlaying ? { opacity: 1 } : null,
                        ]}
                    >
                        {(index + 1).toString().padStart(2, '0')}
                    </Animated.Text>
                ) : null}

                <View style={styles.info}>
                    <Animated.Text
                        numberOfLines={1}
                        style={[styles.title, animatedTitleStyle]}
                    >
                        {track.title}
                    </Animated.Text>
                    <Animated.Text
                        numberOfLines={1}
                        style={[styles.subtitle, animatedSubtleStyle]}
                    >
                        {subtitle}
                    </Animated.Text>
                </View>

                <View style={styles.rightContainer}>
                    <Animated.Text
                        style={[styles.duration, animatedSubtleStyle]}
                    >
                        {formatDuration(track.duration)}
                    </Animated.Text>
                    {track.favorite ? (
                        <AnimatedCustomIcon
                            name="Heart"
                            size={12}
                            animatedProps={animatedFavoriteProps}
                            style={[{ marginLeft: 6, opacity: 0.9 }]}
                        />
                    ) : null}
                    {optionsAccessory ? (
                        <View style={styles.customOptionsWrap}>
                            {optionsAccessory}
                        </View>
                    ) : onOptionsPress || optionsIcon ? (
                        <View
                            style={[
                                styles.queueBtnWrap,
                                {
                                    backgroundColor: optionsBusy
                                        ? `${theme.colors.primary}${theme.id.startsWith('material3') ? '26' : '20'}`
                                        : 'transparent',
                                    opacity: optionsDisabled ? 0.88 : (optionsBusy ? 1 : 0.92),
                                },
                            ]}
                        >
                            <Pressable
                                hitSlop={12}
                                android_ripple={{ color: theme.colors.primary + '15', borderless: true }}
                                disabled={optionsDisabled || !onOptionsPress}
                                style={[
                                    styles.queueBtn,
                                    optionsLabel ? styles.queueBtnWithLabel : null,
                                ]}
                                onPress={(event) => {
                                    event.stopPropagation();
                                    if (optionsDisabled || !onOptionsPress) return;
                                    onOptionsPress(track);
                                }}
                            >
                                <AnimatedCustomIcon
                                    name={optionsIcon ?? 'Cola'}
                                    size={19}
                                    animatedProps={animatedOptionsProps}
                                    style={{ opacity: isPlaying || optionsBusy ? 0.96 : 0.75 }}
                                />
                                {optionsLabel ? (
                                    <Animated.Text
                                        style={[
                                            styles.optionsLabel,
                                            optionsBusy ? styles.optionsBusyLabel : animatedTitleStyle
                                        ]}
                                    >
                                        {optionsLabel}
                                    </Animated.Text>
                                ) : null}
                            </Pressable>
                        </View>
                    ) : null}
                </View>
            </Pressable>
            {!isPlaying ? (
                <View
                    pointerEvents="none"
                    style={[
                        styles.libraryDivider,
                        {
                            left: dividerInset,
                            right: Math.max(contentPaddingHorizontal, 4),
                            backgroundColor: `${theme.colors.outline}26`,
                        },
                    ]}
                />
            ) : null}
        </Animated.View>
    );
}

function DefaultTrackListItemInner({
    track,
    index,
    showArtwork = true,
    showIndex = false,
    outerInset,
    contentPaddingHorizontal = 12,
    visualStyle = 'default',
    isPlaying: isPlayingProp,
    onPress,
    onOptionsPress,
    optionsIcon,
    optionsIconColor,
    optionsBusy = false,
    optionsLabel,
    optionsDisabled = false,
    optionsAccessory,
}: TrackListItemProps) {
    const { theme } = useTheme();
    const performanceProfile = usePerformanceProfile();
    const aC = useAnimatedColors();
    const isMaterial3 = theme.id.startsWith('material3');
    const isLibraryStyle = visualStyle === 'library';

    const isPlaying = !!isPlayingProp;
    const imageCachePolicy = performanceProfile.imageCachePolicyList;

    // Get component styles from theme
    const trackStyles = theme.components.trackItem;
    const globalStyles = theme.components.global;

    // Static parts of Styles (Pre-calculated)
    // Note: backgroundColor is handled via animatedContainerStyle to react to dynamic color changes
    // without requiring a React re-render (which React.memo's custom comparator would block).
    const containerBaseStyle = useMemo(() => [
        styles.container,
        {
            height: trackStyles.height,
            borderRadius: isLibraryStyle ? 18 : Math.max(globalStyles.buttonRadius, 18),
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: isLibraryStyle ? `${theme.colors.outline}24` : (isMaterial3 ? `${theme.colors.outline}38` : globalStyles.borderColor),
            marginHorizontal: outerInset ?? (globalStyles.screenPadding / 2),
            marginVertical: isLibraryStyle ? 3 : (isMaterial3 ? 4 : 0),
            overflow: 'hidden' as const,
            shadowColor: 'transparent',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0,
            shadowRadius: 0,
            elevation: 0,
        }
    ], [trackStyles.height, trackStyles.variant, globalStyles.buttonRadius, globalStyles.borderWidth, globalStyles.borderColor, globalStyles.screenPadding, isLibraryStyle, isMaterial3, outerInset, theme.colors.outline]);

    // Animated background â€” runs on the UI thread, bypasses React.memo block
    const animatedContainerStyle = useAnimatedStyle(() => ({
        backgroundColor: isLibraryStyle
            ? `${aC.surface.value}78`
            : (isMaterial3 ? `${aC.surface.value}A8` : 'transparent'),
    }));

    const animatedArtworkStyle = useAnimatedStyle(() => ({
        backgroundColor: aC.surfaceVariant.value,
    }));

    // Playing highlight â€” animated so it cross-fades smoothly on song change
    const suffix = isMaterial3 ? '66' : '40';
    const animatedPlayingStyle = useAnimatedStyle(() => ({
        backgroundColor: aC.primaryContainer.value + suffix,
    }));

    const artworkContainerBaseStyle = useMemo(() => [
        styles.artwork,
        {
            width: trackStyles.artworkSize,
            height: trackStyles.artworkSize,
            borderRadius: trackStyles.artworkRadius,
        }
    ], [trackStyles.artworkSize, trackStyles.artworkRadius]);

    const subtitle = track.album && track.album !== 'Unknown Album'
        ? `${track.artist} - ${track.album}`
        : track.artist;

    // Animated text colors â€” UI-thread worklets, only active during the 700ms transition
    const animatedTitleStyle = useAnimatedStyle(() => ({
        color: isPlaying ? aC.onPrimaryContainer.value : aC.onSurface.value,
    }));
    const animatedSubtleStyle = useAnimatedStyle(() => ({
        color: isPlaying ? aC.onPrimaryContainer.value : aC.onSurface.value,
        opacity: isPlaying ? 0.88 : 0.72,
    }));
    const animatedIndexStyle = useAnimatedStyle(() => ({
        color: isPlaying ? aC.onPrimaryContainer.value : aC.onSurfaceVariant.value,
        opacity: isPlaying ? 1 : 0.8,
    }));

    const animatedIconProps = useAnimatedProps(() => ({
        color: optionsBusy
            ? aC.onPrimaryContainer.value
            : (optionsIconColor ?? (isPlaying ? aC.onPrimaryContainer.value : aC.onSurfaceVariant.value)),
    }));

    const animatedHeartProps = useAnimatedProps(() => ({
        color: aC.primary.value,
    }));
    const optionsPulse = useSharedValue(optionsBusy ? 1 : 0);

    useEffect(() => {
        if (optionsBusy) {
            optionsPulse.value = withRepeat(
                withTiming(1, { duration: 850, easing: Easing.inOut(Easing.quad) }),
                -1,
                true,
            );
            return;
        }

        cancelAnimation(optionsPulse);
        optionsPulse.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) });
    }, [optionsBusy, optionsPulse]);

    const animatedOptionsButtonStyle = useAnimatedStyle(() => ({
        transform: [{ scale: 1 + (optionsPulse.value * 0.06) }],
        backgroundColor: optionsBusy
            ? `${aC.primary.value}${isMaterial3 ? '26' : '20'}`
            : 'transparent',
        opacity: optionsDisabled ? 0.88 : (optionsBusy ? 1 : 0.92),
    }));
    const animatedOptionsLabelStyle = useAnimatedStyle(() => ({
        color: optionsBusy
            ? '#FFFFFF'
            : (isPlaying ? aC.onPrimaryContainer.value : aC.onSurface.value),
        opacity: optionsBusy ? 1 : 0.95,
    }));

    return (
        <Animated.View style={[containerBaseStyle, animatedContainerStyle]}>
            {/* Playing highlight â€” at Animated.View level so it fills the full container */}
            {isPlaying ? (
                <Animated.View
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFillObject,
                        {
                            borderRadius: isLibraryStyle ? 18 : Math.max(globalStyles.buttonRadius, 18),
                        },
                        animatedPlayingStyle,
                    ]}
                />
            ) : null}
            <Pressable
                unstable_pressDelay={80}
                onPress={() => onPress(track)}
                android_ripple={{ color: theme.colors.primary + '15' }}
                accessibilityRole="button"
                accessibilityLabel={`${track.title} por ${track.artist}${isPlaying ? ', reproduciéndose ahora' : ''}`}
                accessibilityState={{ selected: isPlaying }}
                style={({ pressed }) => [
                    styles.pressableInner,
                    { paddingHorizontal: contentPaddingHorizontal },
                    pressed && styles.pressed,
                ]}
            >

                {/* Index or Artwork */}
                {showIndex && index !== undefined ? (
                    <View style={[styles.indexContainer, { width: trackStyles.artworkSize || 40 }]}>
                        {isPlaying ? (
                            <AnimatedCustomIcon
                                name="Play"
                                size={14}
                                animatedProps={animatedIconProps}
                                style={styles.playingIndicator}
                            />
                        ) : (
                            <Animated.Text style={[styles.indexText, animatedIndexStyle]}>
                                {(index + 1).toString().padStart(2, '0')}
                            </Animated.Text>
                        )}
                    </View>
                ) : showArtwork ? (
                    <Animated.View style={[artworkContainerBaseStyle, animatedArtworkStyle]}>
                        {track.artwork || track.artworkThumb ? (
                            <Image
                                source={{ uri: track.artwork || track.artworkThumb }}
                                style={styles.artworkImage}
                                contentFit="cover"
                                recyclingKey={track.id}
                                cachePolicy={imageCachePolicy}
                                transition={0}
                            />
                        ) : (
                            <CustomIcon name="Cancion" size={trackStyles.artworkSize * 0.6} color={theme.colors.primary} />
                        )}
                    </Animated.View>
                ) : null}

                {/* Track Info */}
                <View style={styles.info}>
                    <Animated.Text
                        numberOfLines={1}
                        style={[styles.title, animatedTitleStyle]}
                    >
                        {track.title}
                    </Animated.Text>
                    <Animated.Text
                        numberOfLines={1}
                        style={[styles.subtitle, animatedSubtleStyle]}
                    >
                        {subtitle}
                    </Animated.Text>
                </View>

                {/* Duration */}
                <View style={styles.rightContainer}>
                    <Animated.Text
                        style={[styles.duration, animatedSubtleStyle]}
                    >
                        {formatDuration(track.duration)}
                    </Animated.Text>
                    {track.favorite && (
                        <AnimatedCustomIcon
                            name="Heart"
                            size={12}
                            animatedProps={animatedHeartProps}
                            style={{ marginLeft: 6, opacity: 0.9 }}
                        />
                    )}
                    {optionsAccessory ? (
                        <View style={styles.customOptionsWrap}>
                            {optionsAccessory}
                        </View>
                    ) : onOptionsPress || optionsIcon ? (
                        <Animated.View style={[styles.queueBtnWrap, animatedOptionsButtonStyle]}>
                            <Pressable
                                hitSlop={12}
                                android_ripple={{ color: theme.colors.primary + '15', borderless: true }}
                                disabled={optionsDisabled || !onOptionsPress}
                                style={[
                                    styles.queueBtn,
                                    optionsLabel ? styles.queueBtnWithLabel : null,
                                ]}
                                onPress={(event) => {
                                    event.stopPropagation();
                                    if (optionsDisabled || !onOptionsPress) return;
                                    onOptionsPress(track);
                                }}
                            >
                                <AnimatedCustomIcon
                                    name={optionsIcon ?? 'Cola'}
                                    size={19}
                                    animatedProps={animatedIconProps}
                                    style={{ opacity: isPlaying || optionsBusy ? 0.96 : 0.75 }}
                                />
                                {optionsLabel ? (
                                    <Animated.Text style={[styles.optionsLabel, animatedOptionsLabelStyle]}>
                                        {optionsLabel}
                                    </Animated.Text>
                                ) : null}
                            </Pressable>
                        </Animated.View>
                    ) : null}
                </View>
            </Pressable>
            {null}
        </Animated.View>
    );
}

// Custom comparator: only re-render when data that affects visuals actually changes.
// Ignore callback reference changes (onPress, onOptionsPress) since they're stable via useCallback.
function arePropsEqual(prev: TrackListItemProps, next: TrackListItemProps): boolean {
    return (
        prev.track.id === next.track.id &&
        prev.track.title === next.track.title &&
        prev.track.artist === next.track.artist &&
        prev.track.album === next.track.album &&
        prev.track.artwork === next.track.artwork &&
        prev.track.artworkThumb === next.track.artworkThumb &&
        prev.track.duration === next.track.duration &&
        prev.track.favorite === next.track.favorite &&
        prev.index === next.index &&
        prev.isPlaying === next.isPlaying &&
        prev.showArtwork === next.showArtwork &&
        prev.showIndex === next.showIndex &&
        prev.outerInset === next.outerInset &&
        prev.contentPaddingHorizontal === next.contentPaddingHorizontal &&
        prev.visualStyle === next.visualStyle &&
        prev.optionsIcon === next.optionsIcon &&
        prev.optionsIconColor === next.optionsIconColor &&
        prev.optionsBusy === next.optionsBusy &&
        prev.optionsLabel === next.optionsLabel &&
        prev.optionsDisabled === next.optionsDisabled &&
        prev.optionsAccessory === next.optionsAccessory
    );
}

function TrackListItemSwitch(props: TrackListItemProps) {
    if (props.visualStyle === 'library') {
        return <LibraryTrackListItemInner {...props} />;
    }

    return <DefaultTrackListItemInner {...props} />;
}

export const TrackListItem = React.memo(TrackListItemSwitch, arePropsEqual);
export default TrackListItem;

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    pressableInner: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    pressed: {
        opacity: 0.82,
    },
    noPadding: {
        paddingHorizontal: 0,
    },
    withPadding: {
        paddingHorizontal: 4,
    },
    indexContainer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    artwork: {
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    libraryArtwork: {
        overflow: 'hidden',
    },
    artworkImage: {
        width: '100%',
        height: '100%',
    },
    info: {
        flex: 1,
        marginLeft: 12,
        marginRight: 8,
    },
    title: {
        ...typeScale.title,
    },
    rightContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    queueBtn: {
        padding: 4,
        borderRadius: 99,
        flexDirection: 'row',
        alignItems: 'center',
    },
    queueBtnWrap: {
        marginLeft: 8,
        borderRadius: 99,
    },
    customOptionsWrap: {
        marginLeft: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    queueBtnWithLabel: {
        paddingHorizontal: 8,
        gap: 5,
    },
    optionsLabel: {
        ...typeScale.caption,
        fontWeight: '700',
    },
    optionsBusyLabel: {
        color: '#FFFFFF',
        opacity: 0.95,
    },
    indexText: {
        ...typeScale.titleLarge,
    },
    playingIndicator: {
        opacity: 0.9,
    },
    subtitle: {
        ...typeScale.caption,
    },
    duration: {
        ...typeScale.label,
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        opacity: 0.2,
    },
    libraryDivider: {
        position: 'absolute',
        bottom: 0,
        height: StyleSheet.hairlineWidth,
    },
    libraryInlineIndex: {
        width: 28,
        marginLeft: 10,
        fontFamily: 'StaySound',
        fontSize: 11,
        lineHeight: 14,
        textAlign: 'center',
    },
});


