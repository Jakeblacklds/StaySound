/**
 * DetailActionBar
 *
 * Primary action cluster for Tidal detail screens: a filled "Reproducir" pill
 * (tinted with the screen's animated accent), plus frosted shuffle and download
 * circles. Logic stays in the screen — this is presentation + busy states only.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Animated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { radius, typeScale, useTheme, withAlpha } from '@/src/theme';

interface DetailActionBarProps {
    /** Animated accent (extracted primary) shared value for the play pill. */
    accent?: SharedValue<string>;
    /** Fallback solid accent when no animated value is provided. */
    accentColor?: string;
    onPrimaryColor?: string;
    playLabel?: string;
    preparing?: null | 'play' | 'shuffle';
    downloadingAll?: boolean;
    onPlay: () => void;
    onShuffle: () => void;
    onDownloadAll: () => void;
}

export const DetailActionBar: React.FC<DetailActionBarProps> = ({
    accent,
    accentColor,
    onPrimaryColor,
    playLabel = 'Reproducir',
    preparing,
    downloadingAll,
    onPlay,
    onShuffle,
    onDownloadAll,
}) => {
    const { theme } = useTheme();
    const solidAccent = accentColor ?? theme.colors.primary;
    const labelColor = onPrimaryColor ?? theme.colors.onPrimary;
    const circleBorder = withAlpha(theme.colors.onSurface, '24');

    const playBgStyle = useAnimatedStyle(() => ({
        backgroundColor: accent ? accent.value : solidAccent,
    }));

    return (
        <View style={styles.row}>
            <Pressable
                onPress={onPlay}
                disabled={!!preparing}
                style={({ pressed }) => [styles.primaryWrap, { opacity: pressed ? 0.85 : 1 }]}
            >
                <Animated.View style={[StyleSheet.absoluteFill, styles.primaryBg, playBgStyle]} />
                {preparing === 'play' ? (
                    <ActivityIndicator size={18} color={labelColor} />
                ) : (
                    <Ionicons name="play" size={18} color={labelColor} />
                )}
                <Text style={[styles.primaryLabel, { color: labelColor }]}>{playLabel}</Text>
            </Pressable>

            <Pressable
                onPress={onShuffle}
                disabled={!!preparing}
                style={({ pressed }) => [styles.circle, { borderColor: circleBorder, opacity: pressed ? 0.7 : 1 }]}
            >
                {preparing === 'shuffle' ? (
                    <ActivityIndicator size={18} color={theme.colors.onSurface} />
                ) : (
                    <Ionicons name="shuffle" size={20} color={theme.colors.onSurface} />
                )}
            </Pressable>

            <Pressable
                onPress={onDownloadAll}
                disabled={downloadingAll}
                style={({ pressed }) => [styles.circle, { borderColor: circleBorder, opacity: pressed ? 0.7 : 1 }]}
            >
                {downloadingAll ? (
                    <ActivityIndicator size={18} color={theme.colors.onSurface} />
                ) : (
                    <Ionicons name="arrow-down-outline" size={22} color={theme.colors.onSurface} />
                )}
            </Pressable>
        </View>
    );
};

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    primaryWrap: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 54,
        borderRadius: radius.lg,
        overflow: 'hidden',
    },
    primaryBg: {
        borderRadius: radius.lg,
    },
    primaryLabel: {
        ...typeScale.title,
        fontWeight: '800',
    },
    circle: {
        width: 54,
        height: 54,
        borderRadius: radius.lg,
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
