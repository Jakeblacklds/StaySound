import { typeScale, useAnimatedColors, usePerformanceProfile, useTheme } from '@/src/theme';
import { Playlist } from '@/src/types';
import { BlurView } from 'expo-blur';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';
import { CustomIcon } from './CustomIcon';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface PlaylistCardProps {
    playlist: Playlist;
    trackCount?: number;
    artwork?: string;
    size?: 'row' | 'full';
    height?: number;
    onPress: (playlist: Playlist) => void;
    onOptionsPress?: (playlist: Playlist) => void;
}

export function PlaylistCard({
    playlist,
    trackCount,
    artwork,
    size = 'row',
    height,
    onPress,
    onOptionsPress
}: PlaylistCardProps) {
    const { theme } = useTheme();
    const performanceProfile = usePerformanceProfile();
    const aC = useAnimatedColors();
    const scale = useSharedValue(1);

    const handlePressIn = () => {
        scale.value = withSpring(0.98);
    };

    const handlePressOut = () => {
        scale.value = withSpring(1);
    };

    const animatedScaleStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    const animatedBgStyle = useAnimatedStyle(() => ({
        backgroundColor: size === 'row' ? `${theme.colors.surface}A8` : aC.surfaceVariant.value,
    }));

    const count = trackCount ?? playlist.trackIds.length;
    const finalArtwork = artwork || playlist.artwork;

    const renderFullGridContent = () => (
        <Animated.View style={[styles.gridArtwork, animatedBgStyle, { height: height || 200, borderRadius: 24, borderColor: `${theme.colors.outline}38`, overflow: 'hidden' }]}>
            {finalArtwork ? (
                <ExpoImage
                    source={{ uri: finalArtwork }}
                    style={styles.gridArtworkImage}
                    contentFit="cover"
                    recyclingKey={playlist.id}
                    cachePolicy={performanceProfile.imageCachePolicyList}
                    transition={0}
                />
            ) : (
                <CustomIcon
                    name={playlist.id === 'playlist_liked' ? 'Heart' : 'Playlist'}
                    size={60}
                    color={theme.colors.primary}
                />
            )}

            <View style={styles.gridInfoOverlay}>
                {performanceProfile.enableBlurEffects ? (
                    <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
                ) : null}
                <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.85)']}
                    style={StyleSheet.absoluteFill}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                />

                {onOptionsPress && (
                    <View style={styles.gridOptionsContainer}>
                        <Pressable onPress={() => onOptionsPress(playlist)} style={styles.gridOptionsButton}>
                            <CustomIcon name="Cola" size={16} color="#FFFFFF" />
                        </Pressable>
                    </View>
                )}

                <View style={styles.gridInfo}>
                    <Text numberOfLines={1} style={[styles.gridName, { fontFamily: theme.typography.fontFamily.bold }]}>
                        {playlist.name}
                    </Text>
                    <Text numberOfLines={1} style={[styles.gridSubtitle, { fontFamily: theme.typography.fontFamily.regular }]}>
                        {count} {count === 1 ? 'song' : 'songs'}
                    </Text>
                </View>
            </View>
        </Animated.View>
    );

    const renderRowContent = () => (
        <Animated.View style={[styles.rowContainer, animatedBgStyle]}>
            <View style={[styles.rowArtwork, { backgroundColor: theme.colors.surfaceVariant }]}>
                {finalArtwork ? (
                    <ExpoImage
                        source={{ uri: finalArtwork }}
                        style={styles.rowArtworkImage}
                        contentFit="cover"
                        recyclingKey={playlist.id}
                        cachePolicy={performanceProfile.imageCachePolicyList}
                        transition={0}
                    />
                ) : (
                    <View style={styles.rowPlaceholderArtwork}>
                        <CustomIcon
                            name={playlist.id === 'playlist_liked' ? 'Heart' : 'Playlist'}
                            size={32}
                            color={theme.colors.primary}
                        />
                    </View>
                )}
            </View>

            <View style={styles.rowInfo}>
                <Text variant="titleMedium" numberOfLines={1} style={[styles.rowName, { color: theme.colors.onSurface }]}>
                    {playlist.name}
                </Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {count} {count === 1 ? 'song' : 'songs'}
                </Text>
            </View>

            {onOptionsPress && (
                <IconButton
                    icon={() => <CustomIcon name="Cola" size={20} color={theme.colors.onSurfaceVariant} />}
                    onPress={() => onOptionsPress(playlist)}
                />
            )}
        </Animated.View>
    );

    return (
        <AnimatedPressable
            onPress={() => onPress(playlist)}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            style={[
                size === 'row' ? styles.pressableRow : styles.pressableGrid,
                animatedScaleStyle,
            ]}
        >
            {size === 'row' ? renderRowContent() : renderFullGridContent()}
        </AnimatedPressable>
    );
}

const styles = StyleSheet.create({
    pressableGrid: {
        marginBottom: 16,
    },
    pressableRow: {
        marginBottom: 8,
    },
    rowContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 10,
        borderRadius: 20,
        borderWidth: StyleSheet.hairlineWidth,
    },
    rowArtwork: {
        width: 56,
        height: 56,
        borderRadius: 16,
        overflow: 'hidden',
    },
    rowArtworkImage: {
        width: '100%',
        height: '100%',
    },
    rowPlaceholderArtwork: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rowInfo: {
        flex: 1,
        marginLeft: 12,
    },
    rowName: {
        ...typeScale.title,
    },
    gridArtwork: {
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        borderWidth: StyleSheet.hairlineWidth,
    },
    gridArtworkImage: {
        width: '100%',
        height: '100%',
    },
    gridInfoOverlay: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingBottom: 4,
        paddingTop: 30,
    },
    gridInfo: {
        paddingVertical: 12,
        paddingHorizontal: 14,
    },
    gridName: {
        ...typeScale.title,
        color: '#FFFFFF',
    },
    gridSubtitle: {
        ...typeScale.micro,
        color: 'rgba(255,255,255,0.7)',
        marginTop: 2,
    },
    gridOptionsContainer: {
        position: 'absolute',
        top: 4,
        right: 4,
        zIndex: 10,
    },
    gridOptionsButton: {
        padding: 8,
    },
});
