import { CustomIcon, EmptyState } from '@/src/components/ui';
import { useScreenEntryAnimation, useScreenEntryKey } from '@/src/hooks';
import { useI18n } from '@/src/i18n';
import { useLibraryStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { Playlist } from '@/src/types';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
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
  const featuredPlaylist = playlists[0];
  const remainingPlaylists = playlists.slice(1);
  const featureRotation = useSharedValue(0);

  useEffect(() => {
    featureRotation.value = withRepeat(
      withTiming(360, { duration: 36000, easing: Easing.linear }),
      -1,
      false,
    );
  }, [featureRotation]);

  const featureArtworkStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${featureRotation.value}deg` }],
  }));

  const openCreatePlaylist = useCallback(() => {
    router.push('/playlist-create');
  }, []);

  const handleOpenPlaylist = useCallback((playlist: Playlist) => {
    router.push({ pathname: '/playlist/[id]', params: { id: playlist.id } });
  }, []);

  return (
    <SafeAreaView
      style={styles.container}
      edges={['top']}
    >
      <Animated.View
        style={[styles.headerShell, headerEntryStyle]}
      >
        <Text style={[styles.screenTitle, { color: theme.colors.onBackground }]}>{t('playlists.title')}</Text>
        <Pressable onPress={openCreatePlaylist} hitSlop={14}>
          <Ionicons name="add" size={28} color={theme.colors.onSurfaceVariant} />
        </Pressable>
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
            data={remainingPlaylists}
            keyExtractor={item => item.id}
            ListHeaderComponent={featuredPlaylist ? (
              <View style={styles.featuredBlock}>
                <Animated.Text style={[styles.featuredLabel, { color: theme.colors.onSurfaceVariant }]}>MEZCLA DESTACADA</Animated.Text>
                <Pressable onPress={() => handleOpenPlaylist(featuredPlaylist)} style={styles.featuredHero}>
                  <Animated.View style={[styles.featuredArtwork, { borderColor: theme.colors.primary }, featureArtworkStyle]}>
                    {featuredPlaylist.artwork ? (
                      <Image source={{ uri: featuredPlaylist.artwork }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    ) : (
                      <CustomIcon name="Playlist" size={68} color={theme.colors.primary} />
                    )}
                  </Animated.View>
                  <View style={styles.featuredCopy}>
                    <Text style={[styles.featuredName, { color: theme.colors.onBackground }]} numberOfLines={2}>
                      {featuredPlaylist.name}
                    </Text>
                    <Text style={[styles.featuredDescription, { color: theme.colors.onSurfaceVariant }]} numberOfLines={3}>
                      {featuredPlaylist.description || 'Una selección para escuchar sin interrupciones.'}
                    </Text>
                    <View style={[styles.featuredPlay, { backgroundColor: theme.colors.primary }]}>
                      <CustomIcon name="Play" size={18} color={theme.colors.onPrimary} />
                    </View>
                  </View>
                </Pressable>
                {remainingPlaylists.length > 0 ? (
                  <Animated.Text style={[styles.moreTitle, { color: theme.colors.onSurfaceVariant }]}>TUS PLAYLISTS</Animated.Text>
                ) : null}
              </View>
            ) : null}
            renderItem={({ item }) => {
              return (
                <Pressable onPress={() => handleOpenPlaylist(item)} style={({ pressed }) => [styles.playlistRow, pressed && styles.rowPressed]}>
                  <View style={[styles.rowArtwork, { backgroundColor: theme.colors.surfaceVariant }]}>
                    {item.artwork ? <Image source={{ uri: item.artwork }} style={StyleSheet.absoluteFill} contentFit="cover" /> : (
                      <CustomIcon name="Playlist" size={25} color={theme.colors.primary} />
                    )}
                  </View>
                  <Text style={[styles.rowName, { color: theme.colors.onBackground }]} numberOfLines={1}>{item.name}</Text>
                  <Ionicons name="ellipsis-horizontal" size={20} color={theme.colors.onSurfaceVariant} />
                </Pressable>
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
    marginHorizontal: 20,
    marginTop: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  screenTitle: {
    fontFamily: 'StaySound',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
    letterSpacing: -1.25,
  },
  newButton: {
    borderRadius: 17,
  },
  newButtonContent: {
    minHeight: 44,
    flexDirection: 'row-reverse',
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
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  cardWrap: {
    padding: 4,
  },
  featuredBlock: {
    paddingBottom: 22,
  },
  featuredLabel: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 14,
  },
  featuredHero: {
    minHeight: 190,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  featuredArtwork: {
    width: 172,
    height: 172,
    borderRadius: 86,
    borderWidth: 1.5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featuredCopy: {
    flex: 1,
    alignItems: 'flex-start',
  },
  featuredName: {
    fontFamily: 'StaySound',
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  featuredDescription: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 7,
  },
  featuredPlay: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  moreTitle: {
    marginTop: 30,
    marginBottom: 14,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  playlistRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  rowPressed: {
    opacity: 0.58,
  },
  rowArtwork: {
    width: 50,
    height: 50,
    borderRadius: 7,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowName: {
    fontFamily: 'StaySound',
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
});
