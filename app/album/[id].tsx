import { CustomIcon, MemoizedTrackListItem } from '@/src/components/ui';
import { TidalAtmosphere } from '@/src/components/tidal';
import { useDynamicColors } from '@/src/hooks';
import { formatDuration } from '@/src/services';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { Track } from '@/src/types';
import { FlashList } from '@shopify/flash-list';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { Pressable, StatusBar, StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const BACK_BUTTON_TOP_OFFSET = 10;

export default function AlbumDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();

    const getAlbumById = useLibraryStore(state => state.getAlbumById);
    const getTracksByAlbum = useLibraryStore(state => state.getTracksByAlbum);
    const play = usePlayerStore(state => state.play);
    const currentTrackId = usePlayerStore(state => state.currentTrack?.id);

    const album = getAlbumById(id);
    const tracks = useMemo(() => getTracksByAlbum(id), [id, getTracksByAlbum]);

    // Extract dynamic colors from metadata artwork
    const { colors: albumColors } = useDynamicColors(album?.artwork);

    const totalDuration = useMemo(() => {
        return tracks.reduce((acc, track) => acc + track.duration, 0);
    }, [tracks]);

    const handleTrackPress = useCallback((track: Track) => {
        play(track, tracks);
    }, [tracks, play]);

    const keyExtractor = useCallback((item: Track) => item.id, []);

    const renderTrackItem = useCallback(({ item, index }: { item: Track; index: number }) => (
        <MemoizedTrackListItem
            track={item}
            index={index}
            showIndex={true}
            showArtwork={false}
            visualStyle="library"
            outerInset={8}
            contentPaddingHorizontal={16}
            isPlaying={currentTrackId === item.id}
            onPress={handleTrackPress}
        />
    ), [currentTrackId, handleTrackPress]);

    // Early return MUST happen after all hooks but before any callbacks defined with useCallback
    // The issue is that FlatList's ListHeaderComponent needs a stable reference

    // Memoized ListHeader to avoid recreation on each render
    const ListHeader = useMemo(() => {
        if (!album) return null;

        return (
            <View style={styles.headerContent}>
                <View style={styles.albumHero}>
                    <View style={[styles.artwork, { backgroundColor: theme.colors.surfaceVariant }]}>
                        {album.artwork || album.artworkThumb ? (
                            <Image source={{ uri: album.artwork || album.artworkThumb }} style={styles.artworkImage} />
                        ) : (
                            <CustomIcon name="Album" size={72} color={theme.colors.onSurfaceVariant} />
                        )}
                    </View>
                    <View style={styles.albumInfo}>
                        <Text
                            variant="labelMedium"
                            style={[styles.albumKicker, { color: albumColors.primary }]}
                        >
                            ÁLBUM
                        </Text>
                        <Text
                            style={[styles.albumTitle, { color: albumColors.text }]}
                            numberOfLines={3}
                        >
                            {album.name}
                        </Text>
                        <Text style={[styles.albumArtist, { color: albumColors.primary }]} numberOfLines={2}>
                            {album.artist}
                        </Text>
                        <Text style={[styles.albumMeta, { color: albumColors.isDark ? 'rgba(255,255,255,0.68)' : 'rgba(0,0,0,0.56)' }]}>
                            {tracks.length} canciones · {formatDuration(totalDuration)}
                        </Text>
                        {tracks[0] ? (
                            <Pressable
                                onPress={() => handleTrackPress(tracks[0])}
                                style={[styles.playAlbumButton, { backgroundColor: albumColors.primary }]}
                            >
                                <CustomIcon name="Play" size={18} color={albumColors.onPrimary} />
                                <Text style={[styles.playAlbumLabel, { color: albumColors.onPrimary }]}>Reproducir</Text>
                            </Pressable>
                        ) : null}
                    </View>
                </View>

                {/* Track list header */}
                <Text
                    variant="titleSmall"
                    style={[styles.trackListTitle, { color: albumColors.text, opacity: 0.6 }]}
                >
                    TRACKS
                </Text>
            </View>
        );
    }, [album, albumColors, handleTrackPress, theme.colors.onSurfaceVariant, theme.colors.surfaceVariant, tracks, totalDuration]);

    if (!album) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
                <Text style={{ color: theme.colors.onBackground }}>Album not found</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <StatusBar barStyle={albumColors.isDark ? 'light-content' : 'dark-content'} />
            <TidalAtmosphere sourceUri={album.artwork || album.artworkThumb} mode="artwork" />

            {/* Back Button */}
            <View style={[styles.backButton, { top: insets.top + BACK_BUTTON_TOP_OFFSET }]}>
                <BlurView intensity={40} tint={isDark ? 'dark' : 'light'} style={styles.blurButton}>
                    <IconButton
                        icon={() => <CustomIcon name="Previous" size={24} color={theme.colors.onBackground} />}
                        size={24}
                        onPress={() => router.back()}
                    />
                </BlurView>
            </View>

            {/* Track List */}
            <FlashList
                data={tracks}
                keyExtractor={keyExtractor}
                renderItem={renderTrackItem}
                ListHeaderComponent={ListHeader}
                contentContainerStyle={[
                    styles.listContent,
                    { paddingTop: insets.top + 72 }
                ]}
                showsVerticalScrollIndicator={false}
                drawDistance={300}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    artwork: {
        width: '45%',
        aspectRatio: 1,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.22)',
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.24,
        shadowRadius: 12,
    },
    artworkImage: {
        width: '100%',
        height: '100%',
    },
    backButton: {
        position: 'absolute',
        left: 16,
        zIndex: 20,
    },
    blurButton: {
        borderRadius: 20,
        overflow: 'hidden',
    },
    listContent: {
        paddingBottom: 120,
    },
    headerContent: {
        paddingHorizontal: 18,
        paddingTop: 12,
    },
    albumHero: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 18,
        marginBottom: 34,
    },
    albumInfo: {
        flex: 1,
        alignItems: 'flex-start',
    },
    albumKicker: {
        letterSpacing: 1.4,
        marginBottom: 8,
    },
    albumTitle: {
        fontSize: 28,
        lineHeight: 29,
        fontWeight: '900',
        textAlign: 'left',
        marginBottom: 7,
        letterSpacing: -1.1,
    },
    albumArtist: {
        fontSize: 14,
        lineHeight: 18,
        fontWeight: '800',
        marginBottom: 4,
    },
    albumMeta: {
        marginTop: 2,
        fontSize: 11,
        lineHeight: 15,
    },
    playAlbumButton: {
        minHeight: 40,
        marginTop: 13,
        paddingHorizontal: 14,
        borderRadius: 15,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
    },
    playAlbumLabel: {
        fontSize: 12,
        fontWeight: '900',
    },
    trackListTitle: {
        letterSpacing: 1.6,
        marginBottom: 12,
        marginLeft: 0,
        fontSize: 11,
        fontWeight: '800',
    },
});
