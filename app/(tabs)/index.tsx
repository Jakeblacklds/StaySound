import { AlbumCard, EmptyState } from '@/src/components/ui';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { Album } from '@/src/types';
import { router } from 'expo-router';
import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, IconButton, Text } from 'react-native-paper';
import Animated, { FadeInDown } from 'react-native-reanimated';

export default function HomeScreen() {
  const { theme, config } = useTheme();
  const { getAllTracks, getAllAlbums, scanLibrary, isScanning } = useLibraryStore();
  const { setQueue, play, toggleShuffle, shuffleEnabled } = usePlayerStore();

  const tracks = getAllTracks();
  const albums = getAllAlbums();

  // Show only first 6 albums or recently added
  const recentAlbums = albums.slice(0, 6);

  const handlePlayAll = useCallback(() => {
    if (tracks.length > 0) {
      play(tracks[0], tracks);
    }
  }, [tracks, play]);

  const handleShuffle = useCallback(() => {
    if (tracks.length > 0) {
      if (!shuffleEnabled) toggleShuffle();
      const randomIndex = Math.floor(Math.random() * tracks.length);
      play(tracks[randomIndex], tracks);
    }
  }, [tracks, play, toggleShuffle, shuffleEnabled]);

  const handleAlbumPress = useCallback((album: Album) => {
    router.push({ pathname: '/album/[id]', params: { id: album.id } });
  }, []);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.content}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text
              variant="headlineMedium"
              style={[styles.greeting, { color: theme.colors.onBackground }]}
            >
              StaySound
            </Text>
            <Text
              variant="bodyMedium"
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              Enjoy your local music
            </Text>
          </View>
          <IconButton
            icon="cog-outline"
            size={24}
            iconColor={theme.colors.onSurfaceVariant}
            onPress={() => router.push('/settings')}
          />
        </View>
      </View>

      {/* Quick Actions */}
      <View style={styles.buttonRow}>
        <Button
          mode="contained"
          style={styles.button}
          contentStyle={styles.buttonContent}
          icon="play"
          onPress={handlePlayAll}
          disabled={tracks.length === 0}
        >
          Play All
        </Button>
        <Button
          mode="contained-tonal"
          style={styles.button}
          contentStyle={styles.buttonContent}
          icon="shuffle"
          onPress={handleShuffle}
          disabled={tracks.length === 0}
        >
          Shuffle
        </Button>
      </View>

      {albums.length > 0 ? (
        <Animated.View entering={FadeInDown.duration(400)}>
          <Text
            variant="titleLarge"
            style={[styles.sectionTitle, { color: theme.colors.onBackground }]}
          >
            Recently Added
          </Text>

          <View style={styles.grid}>
            {recentAlbums.map((album) => (
              <View key={album.id} style={styles.albumWrapper}>
                <AlbumCard
                  album={album}
                  size="medium"
                  onPress={handleAlbumPress}
                />
              </View>
            ))}
          </View>

          <Button
            mode="text"
            onPress={() => router.push('/library')}
            style={styles.viewMore}
          >
            View Full Library
          </Button>
        </Animated.View>
      ) : (
        <View style={styles.emptyContainer}>
          <EmptyState
            icon="📁"
            title="Scan your Library"
            description="We didn't find any music files on your device. Let's scan your storage to find them."
            actionLabel={isScanning ? "Scanning..." : "Scan for Music"}
            onAction={scanLibrary}
          />
        </View>
      )}

      {/* Feature Highlight */}
      <View style={[styles.featureCard, { backgroundColor: theme.colors.surfaceVariant + '40' }]}>
        <Text variant="titleMedium" style={{ color: theme.colors.primary, fontWeight: 'bold' }}>
          ✨ Dynamic Theming
        </Text>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
          StaySound automatically adjusts its colors to match the album art of the music you play.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 140,
  },
  header: {
    marginBottom: 24,
    marginTop: 10,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greeting: {
    fontWeight: 'bold',
    letterSpacing: -0.5,
  },
  sectionTitle: {
    fontWeight: '700',
    marginBottom: 16,
    letterSpacing: -0.5,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 32,
  },
  button: {
    flex: 1,
    borderRadius: 16,
  },
  buttonContent: {
    paddingVertical: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -8,
  },
  albumWrapper: {
    width: '50%',
    padding: 8,
    marginBottom: 8,
  },
  viewMore: {
    marginTop: 8,
    alignSelf: 'flex-end',
  },
  emptyContainer: {
    marginTop: 20,
    height: 300,
  },
  featureCard: {
    marginTop: 40,
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
});
