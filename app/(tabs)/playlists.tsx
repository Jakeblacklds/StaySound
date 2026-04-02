import { CustomIcon, EmptyState, PlaylistCard } from '@/src/components/ui';
import { useScreenEntryAnimation, useScreenEntryKey } from '@/src/hooks';
import { useI18n } from '@/src/i18n';
import { useLibraryStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { Playlist } from '@/src/types';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import Animated from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

export default function PlaylistsScreen() {
  const { theme } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const screenEntryKey = useScreenEntryKey('playlists-tab');
  const headerEntryStyle = useScreenEntryAnimation(screenEntryKey);
  const contentEntryStyle = useScreenEntryAnimation(screenEntryKey, { delay: 140, duration: 280, translateY: 0 });

  const playlistsMap = useLibraryStore(state => state.playlists);

  const playlists = useMemo(
    () => Array.from(playlistsMap.values()).sort((a, b) => b.updatedAt - a.updatedAt),
    [playlistsMap]
  );

  const openCreatePlaylist = useCallback(() => {
    router.push('/playlist-create');
  }, []);

  const handleOpenPlaylist = useCallback((playlist: Playlist) => {
    router.push({ pathname: '/playlist/[id]', params: { id: playlist.id } });
  }, []);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={['top']}
    >
      <Animated.View
        style={[styles.headerShell, headerEntryStyle]}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text
              variant="headlineMedium"
              style={[styles.title, { color: theme.colors.onBackground }]}
            >
              {t('playlists.title')}
            </Text>
          </View>

          <Button
            mode="contained-tonal"
            style={styles.newButton}
            contentStyle={{ flexDirection: 'row-reverse' }}
            icon={() => (
              <CustomIcon
                name="Playlist"
                size={18}
                color={theme.colors.onSecondaryContainer}
              />
            )}
            onPress={openCreatePlaylist}
          >
            {t('playlists.new')}
          </Button>
        </View>
      </Animated.View>

      <Animated.View
        style={[styles.content, contentEntryStyle]}
      >
        {playlists.length === 0 ? (
          <View style={styles.emptyContainer}>
            <EmptyState
              icon="Playlist"
              title={t('playlists.empty.title')}
              description={t('playlists.empty.description')}
            />
            <Button
              mode="contained"
              contentStyle={{ flexDirection: 'row-reverse' }}
              icon={() => (
                <CustomIcon name="Play" size={18} color={theme.colors.onPrimary} />
              )}
              onPress={openCreatePlaylist}
            >
              {t('playlists.create')}
            </Button>
          </View>
        ) : (
          <FlashList
            data={playlists}
            keyExtractor={item => item.id}
            numColumns={2}
            masonry
            optimizeItemArrangement
            renderItem={({ item, index }) => {
              const isTall = index % 3 === 0;
              const height = isTall ? 260 : index % 2 === 0 ? 180 : 220;

              return (
                <View style={styles.cardWrap}>
                  <PlaylistCard
                    playlist={item}
                    size="full"
                    height={height}
                    trackCount={item.trackIds.length}
                    onPress={handleOpenPlaylist}
                    onOptionsPress={handleOpenPlaylist}
                  />
                </View>
              );
            }}
            contentContainerStyle={[
              styles.gridContent,
              { paddingBottom: insets.bottom + 190 },
            ]}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews
          />
        )}
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerShell: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 14,
  },
  header: {
    paddingHorizontal: 2,
    paddingVertical: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    paddingRight: 8,
  },
  title: {
    fontWeight: '800',
  },
  newButton: {
    borderRadius: 14,
  },
  content: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 12,
  },
  gridContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  cardWrap: {
    padding: 4,
  },
});
