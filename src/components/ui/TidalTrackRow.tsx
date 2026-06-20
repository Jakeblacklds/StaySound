import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme, withAlpha } from '@/src/theme';
import { DownloadAnimatedButton } from './DownloadAnimatedButton';

function formatDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// Static "now playing" mark — three calm bars, no animation.
const NowPlayingMark: React.FC<{ color: string }> = ({ color }) => (
    <View style={styles.nowPlaying}>
        <View style={[styles.nowPlayingBar, { backgroundColor: color, height: 8 }]} />
        <View style={[styles.nowPlayingBar, { backgroundColor: color, height: 15 }]} />
        <View style={[styles.nowPlayingBar, { backgroundColor: color, height: 11 }]} />
    </View>
);

export interface TidalTrackRowProps {
    title: string;
    artist: string;
    artworkUrl?: string;
    durationMs?: number;
    index?: number;
    showArtwork?: boolean;
    showIndex?: boolean;
    isActive?: boolean;
    isPlaying?: boolean;
    downloadStatus?: 'idle' | 'downloading' | 'done' | 'error';
    progress?: number;
    extraLine?: string;
    /** 'glass' tone suits translucent atmosphere backgrounds. */
    tone?: 'default' | 'glass';
    /** Accent (extracted primary) for the active-row highlight. Plain string. */
    accentColor?: string;
    onPress: () => void;
    onDownloadPress?: () => void;
}

export const TidalTrackRow: React.FC<TidalTrackRowProps> = ({
    title,
    artist,
    artworkUrl,
    durationMs,
    index,
    showArtwork = true,
    showIndex = false,
    isActive = false,
    isPlaying = false,
    downloadStatus = 'idle',
    progress = 0,
    extraLine,
    tone = 'default',
    accentColor,
    onPress,
    onDownloadPress,
}) => {
    const { theme } = useTheme();
    const accent = accentColor ?? theme.colors.primary;
    const titleColor = isActive ? accent : theme.colors.onBackground;

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.row,
                tone === 'glass' && styles.rowGlass,
                isActive && { backgroundColor: withAlpha(accent, '1F') },
                pressed && !isActive && { backgroundColor: withAlpha(theme.colors.onSurface, '0A') },
            ]}
        >
            {showArtwork ? (
                <View style={styles.art}>
                    {artworkUrl ? (
                        <Image source={{ uri: artworkUrl }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={200} />
                    ) : (
                        <View style={[StyleSheet.absoluteFill, styles.center]}>
                            <Ionicons name="musical-note" size={18} color={theme.colors.onSurfaceVariant} />
                        </View>
                    )}
                    {isActive ? (
                        <View style={styles.artScrim}>
                            {isPlaying ? <NowPlayingMark color="#FFFFFF" /> : <Ionicons name="pause" size={16} color="#FFFFFF" />}
                        </View>
                    ) : null}
                </View>
            ) : showIndex ? (
                <View style={styles.indexBox}>
                    {isActive ? (
                        isPlaying ? (
                            <NowPlayingMark color={accent} />
                        ) : (
                            <Ionicons name="pause" size={15} color={accent} />
                        )
                    ) : (
                        <Text style={[styles.indexText, { color: withAlpha(theme.colors.onSurfaceVariant, 'B0') }]}>
                            {(index ?? 0) + 1}
                        </Text>
                    )}
                </View>
            ) : null}

            <View style={styles.copy}>
                <Text numberOfLines={1} style={[styles.title, { color: titleColor }]}>{title}</Text>
                <Text numberOfLines={1} style={[styles.sub, { color: theme.colors.onSurfaceVariant }]}>
                    {artist}{durationMs ? ` · ${formatDuration(durationMs)}` : ''}
                </Text>
                {extraLine ? (
                    <Text numberOfLines={1} style={[styles.extra, { color: withAlpha(theme.colors.onSurfaceVariant, 'A0') }]}>
                        {extraLine}
                    </Text>
                ) : null}
            </View>

            {onDownloadPress ? (
                <DownloadAnimatedButton
                    status={downloadStatus}
                    progress={progress}
                    size={22}
                    onPress={(event) => {
                        event.stopPropagation();
                        onDownloadPress();
                    }}
                />
            ) : null}
        </Pressable>
    );
};

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 14,
    },
    rowGlass: {
        borderRadius: 16,
    },
    art: {
        width: 52,
        height: 52,
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: 'rgba(127,127,127,0.1)',
    },
    artScrim: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.42)',
    },
    center: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    indexBox: {
        width: 30,
        height: 30,
        alignItems: 'center',
        justifyContent: 'center',
    },
    indexText: {
        fontSize: 15,
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
    },
    nowPlaying: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 2,
        height: 16,
    },
    nowPlayingBar: {
        width: 3,
        borderRadius: 2,
    },
    copy: {
        flex: 1,
        gap: 3,
    },
    title: {
        fontSize: 15,
        fontWeight: '700',
        letterSpacing: -0.2,
    },
    sub: {
        fontSize: 13,
    },
    extra: {
        fontSize: 11,
        marginTop: 1,
    },
});
