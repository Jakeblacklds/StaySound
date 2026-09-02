import { CustomIcon } from '@/src/components/ui';
import { usePerformanceProfile } from '@/src/theme';
import { Image } from 'expo-image';
import React from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, TextStyle, View, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type MiniPlayerTrack = {
    id: string;
    title?: string | null;
    artist?: string | null;
    artwork?: string | null;
};

type MiniPlayerShellProps = {
    variant: 'row' | 'overlay';
    track: MiniPlayerTrack;
    showArtwork?: boolean;
    textColor: string;
    /** Color for the skip controls, which sit on the BAR surface — not inside
     *  the play pill. Falls back to textColor for callers that don't pass it. */
    controlColor?: string;
    buttonFillColor: string;
    buttonBorderColor: string;
    showLoading: boolean;
    showPause: boolean;
    onPress?: () => void;
    onToggle?: () => void;
    onPrevious?: () => void;
    onNext?: () => void;
    onPressIn?: () => void;
    onPressOut?: () => void;
    contentStyle?: StyleProp<ViewStyle>;
    metaStyle?: StyleProp<ViewStyle>;
    titleStyle?: StyleProp<TextStyle>;
    artistStyle?: StyleProp<TextStyle>;
    playButtonStyle?: StyleProp<ViewStyle>;
};

function MiniPlayerPauseIcon({ color, size = 24 }: { color: string; size?: number }) {
    return (
        <Svg
            fillRule="evenodd"
            clipRule="evenodd"
            strokeLinejoin="round"
            strokeMiterlimit={2}
            viewBox="0 0 148 215"
            width={size}
            height={size}
        >
            <Path
                d="M95.518 164.687c.152-120.777-.034-120.754.069-131.718.198-21.27 38.605-33.499 38.375 6.618-.085 14.794.004 124.126-.076 126.75-.812 26.531-37.157 31.281-38.368-1.65"
                fill={color}
                fillOpacity={0.96}
            />
            <Path
                d="M50.249 31.406c.04 11.053.476 133.203-.024 138.158-2.317 22.949-37.812 26.749-38.152-4.873C10.61 28.433 9.962 26.194 18.24 18.781c1.866-1.671 25.213-16.954 32.009 12.625"
                fill={color}
                fillOpacity={0.38}
            />
        </Svg>
    );
}

// Skip marks drawn to match the pause glyph above: leading wedge solid, trailing
// wedge at 45%. Fill + round-joined stroke of the same color gives soft corners
// without a second path.
function MiniSkipIcon({
    direction,
    color,
    size = 22,
}: {
    direction: 'previous' | 'next';
    color: string;
    size?: number;
}) {
    const isNext = direction === 'next';
    const leading = isNext ? 'M12 7 19 12 12 17Z' : 'M12 7 5 12 12 17Z';
    const trailing = isNext ? 'M4.6 7 11.6 12 4.6 17Z' : 'M19.4 7 12.4 12 19.4 17Z';
    const wedge = {
        fill: color,
        stroke: color,
        strokeWidth: 2.1,
        strokeLinejoin: 'round' as const,
    };

    return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
            <Path d={trailing} {...wedge} fillOpacity={0.45} strokeOpacity={0.45} />
            <Path d={leading} {...wedge} />
        </Svg>
    );
}

// Skip controls dim + recede while held — the same touch language as the
// play pill, so the row doesn't feel like a static strip of glyphs.
const skipButtonStyle = ({ pressed }: { pressed: boolean }): StyleProp<ViewStyle> => [
    styles.rowSkipButton,
    pressed ? styles.rowSkipButtonPressed : null,
];

function MiniPlayerShellInner({
    variant,
    track,
    showArtwork = true,
    textColor,
    controlColor,
    buttonFillColor,
    buttonBorderColor,
    showLoading,
    showPause,
    onPress,
    onToggle,
    onPrevious,
    onNext,
    onPressIn,
    onPressOut,
    contentStyle,
    metaStyle,
    titleStyle,
    artistStyle,
    playButtonStyle,
}: MiniPlayerShellProps) {
    const isOverlay = variant === 'overlay';
    const skipColor = controlColor ?? textColor;
    const performanceProfile = usePerformanceProfile();
    const imageCachePolicy = performanceProfile.imageCachePolicyList;

    return (
        <Animated.View style={[isOverlay ? styles.overlayRoot : styles.rowRoot, contentStyle]}>
            {isOverlay ? (
                <>
                    <View style={styles.overlayArtworkWrap}>
                        {track.artwork ? (
                            <Image
                                source={{ uri: track.artwork }}
                                style={styles.artwork}
                                contentFit="cover"
                                cachePolicy={imageCachePolicy}
                                transition={0}
                                recyclingKey={`overlay-shell-${track.id}`}
                            />
                        ) : null}
                    </View>

                    <Animated.View style={[styles.overlayMeta, metaStyle]}>
                        <Animated.Text numberOfLines={1} style={[styles.title, titleStyle]}>
                            {track.title}
                        </Animated.Text>
                        <Animated.Text numberOfLines={1} style={[styles.artist, artistStyle]}>
                            {track.artist}
                        </Animated.Text>
                    </Animated.View>

                    <AnimatedPressable
                        onPress={onToggle}
                        onPressIn={onPressIn}
                        onPressOut={onPressOut}
                        style={[
                            styles.overlayPlayButton,
                            { backgroundColor: buttonFillColor, borderColor: buttonBorderColor },
                            playButtonStyle,
                        ]}
                        hitSlop={12}
                    >
                        {showLoading ? (
                            <ActivityIndicator color={textColor} size="small" />
                        ) : showPause ? (
                            <MiniPlayerPauseIcon color={textColor} size={20} />
                        ) : (
                            <CustomIcon
                                name="Play"
                                size={20}
                                color={textColor}
                                style={styles.playIconOffset}
                            />
                        )}
                    </AnimatedPressable>
                </>
            ) : (
                <>
                    <Pressable onPress={onPress} style={styles.tappableArea}>
                        <View style={styles.rowArtworkWrap}>
                            {showArtwork && track.artwork ? (
                                <Image
                                    source={{ uri: track.artwork }}
                                    style={styles.artwork}
                                    contentFit="cover"
                                    cachePolicy={imageCachePolicy}
                                    transition={0}
                                    recyclingKey={track.id}
                                />
                            ) : null}
                        </View>

                        <Animated.View style={[styles.rowMeta, metaStyle]}>
                            <Animated.Text numberOfLines={1} style={[styles.title, titleStyle]}>
                                {track.title}
                            </Animated.Text>
                            <Animated.Text numberOfLines={1} style={[styles.artist, artistStyle]}>
                                {track.artist}
                            </Animated.Text>
                        </Animated.View>
                    </Pressable>

                    <View style={styles.rowControls}>
                        <Pressable onPress={onPrevious} hitSlop={10} style={skipButtonStyle}>
                            <MiniSkipIcon direction="previous" color={skipColor} />
                        </Pressable>
                        <AnimatedPressable
                            onPress={onToggle}
                            onPressIn={onPressIn}
                            onPressOut={onPressOut}
                            style={[
                                styles.rowPlayButton,
                                { backgroundColor: buttonFillColor, borderColor: buttonBorderColor },
                                playButtonStyle,
                            ]}
                            hitSlop={10}
                        >
                            {showLoading ? (
                                <ActivityIndicator color={textColor} size="small" />
                            ) : showPause ? (
                                <MiniPlayerPauseIcon color={textColor} size={18} />
                            ) : (
                                <CustomIcon
                                    name="Play"
                                    size={18}
                                    color={textColor}
                                    style={styles.playIconOffset}
                                />
                            )}
                        </AnimatedPressable>
                        <Pressable onPress={onNext} hitSlop={10} style={skipButtonStyle}>
                            <MiniSkipIcon direction="next" color={skipColor} />
                        </Pressable>
                    </View>
                </>
            )}
        </Animated.View>
    );
}

export const MiniPlayerShell = React.memo(MiniPlayerShellInner);

const styles = StyleSheet.create({
    rowRoot: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        zIndex: 1,
    },
    overlayRoot: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 2,
    },
    tappableArea: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    rowArtworkWrap: {
        width: 48,
        height: 48,
        borderRadius: 24,
        overflow: 'hidden',
    },
    overlayArtworkWrap: {
        position: 'absolute',
        left: 10,
        top: 9,
        width: 48,
        height: 48,
        borderRadius: 24,
        overflow: 'hidden',
        zIndex: 3,
    },
    artwork: {
        width: '100%',
        height: '100%',
    },
    rowMeta: {
        flex: 1,
        marginLeft: 12,
        marginRight: 8,
    },
    overlayMeta: {
        position: 'absolute',
        left: 72,
        right: 74,
        top: 0,
        bottom: 0,
        justifyContent: 'center',
        paddingTop: 2,
    },
    title: {
        fontFamily: 'StaySound',
        fontSize: 14.5,
        fontWeight: '700',
        letterSpacing: -0.15,
    },
    artist: {
        fontFamily: 'StaySound',
        fontSize: 11.5,
        marginTop: 2,
        opacity: 0.7,
    },
    rowControls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
    rowSkipButton: {
        width: 34,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rowSkipButtonPressed: {
        opacity: 0.55,
        transform: [{ scale: 0.88 }],
    },
    rowPlayButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
    },
    overlayPlayButton: {
        position: 'absolute',
        right: 10,
        top: 16,
        width: 54,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
        elevation: 2,
    },
    playIconOffset: {
        marginLeft: 2,
    },
});
