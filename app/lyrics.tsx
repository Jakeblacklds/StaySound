/**
 * Lyrics Screen - Full screen animated lyrics with Karaoke mode
 */

import { KaraokeLyrics } from '@/src/components/lyrics';
import { LyricsView } from '@/src/components/player/LyricsView';
import { LyricsSkeleton } from '@/src/components/ui';
import { LyricsRepository } from '@/src/services';
import { usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import type { KaraokeLyricsJSON } from '@/src/types';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function LyricsScreen() {
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();
    const { currentTrack } = usePlayerStore();

    // Toggle between standard LRC and Karaoke mode
    const [karaokeMode, setKaraokeMode] = useState(true);
    const [lyricsPayload, setLyricsPayload] = useState<KaraokeLyricsJSON | null>(null);
    const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const loadLyrics = async () => {
            if (!currentTrack?.title || !currentTrack.artist) {
                setLyricsPayload(null);
                return;
            }

            setIsLoadingLyrics(true);
            const payload = await LyricsRepository.getLyrics(currentTrack.title, currentTrack.artist);

            if (!cancelled) {
                setLyricsPayload(payload);
                setIsLoadingLyrics(false);
            }
        };

        loadLyrics();

        return () => {
            cancelled = true;
        };
    }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist]);

    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" />

            {/* Background with album art blur */}
            {currentTrack?.artwork ? (
                <View style={styles.backgroundImageContainer}>
                    <Image
                        source={{ uri: currentTrack.artwork }}
                        style={styles.backgroundImage}
                        contentFit="cover"
                        transition={300}
                    />
                    <BlurView
                        intensity={80}
                        tint="dark"
                        style={StyleSheet.absoluteFill}
                    />
                    <View style={styles.overlay} />
                </View>
            ) : null}

            {/* Header */}
            <Animated.View
                entering={FadeIn.delay(200)}
                style={[styles.header, { paddingTop: insets.top }]}
            >
                <View style={styles.headerInfo}>
                    <Text variant="titleMedium" style={styles.title} numberOfLines={1}>
                        {currentTrack?.title || 'Lyrics'}
                    </Text>
                    <Text variant="bodySmall" style={styles.artist} numberOfLines={1}>
                        {currentTrack?.artist || 'Unknown Artist'}
                    </Text>
                </View>

                {/* Karaoke Mode Toggle */}
                <Pressable
                    onPress={() => setKaraokeMode(!karaokeMode)}
                    style={[
                        styles.modeToggle,
                        karaokeMode ? styles.modeToggleActive : null
                    ]}
                >
                    <Text style={styles.modeToggleText}>
                        {karaokeMode ? 'KARAOKE' : 'STANDARD'}
                    </Text>
                </Pressable>

                <IconButton
                    icon="close"
                    size={28}
                    iconColor="#FFFFFF"
                    onPress={() => router.back()}
                />
            </Animated.View>

            {/* Lyrics Content */}
            {karaokeMode ? (
                lyricsPayload ? (
                    <KaraokeLyrics lyricsJson={lyricsPayload} />
                ) : (
                    <View style={[styles.emptyLyricsContainer, isLoadingLyrics && { justifyContent: 'flex-start', paddingTop: 60 }]}>
                        {isLoadingLyrics ? (
                            <LyricsSkeleton isDownloading={isLoadingLyrics} />
                        ) : (
                            <Text style={styles.emptyLyricsText}>
                                No hay lyrics para esta cancion
                            </Text>
                        )}
                    </View>
                )
            ) : (
                <LyricsView lyricsJson={lyricsPayload} isLoading={isLoadingLyrics} />
            )}

            {/* Footer gradient for readability */}
            <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
                {/* Could add a mini controller here in the future */}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000000',
        zIndex: 9999,
        elevation: 9999,
    },
    backgroundImageContainer: {
        ...StyleSheet.absoluteFillObject,
    },
    backgroundImage: {
        ...StyleSheet.absoluteFillObject,
        width: '100%',
        height: '100%',
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.4)',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingBottom: 16,
        zIndex: 10,
    },
    headerInfo: {
        flex: 1,
        marginLeft: 8,
    },
    title: {
        color: '#FFFFFF',
        fontWeight: 'bold',
    },
    artist: {
        color: 'rgba(255,255,255,0.7)',
    },
    modeToggle: {
        backgroundColor: 'rgba(255,255,255,0.1)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        marginRight: 8,
    },
    modeToggleActive: {
        backgroundColor: 'rgba(255,255,255,0.25)',
    },
    modeToggleText: {
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: 'bold',
        letterSpacing: 1,
    },
    footer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 150,
        // Gradient or background if needed
    },
    emptyLyricsContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    emptyLyricsText: {
        color: 'rgba(255,255,255,0.7)',
        textAlign: 'center',
    },
});
