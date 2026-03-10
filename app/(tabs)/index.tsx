import { AlbumCard, CustomIcon, EmptyState } from '@/src/components/ui';
import { openTrackActionsMenu } from '@/src/services/playlistActions';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useOnboardingStore } from '@/src/stores/onboardingStore';
import { useAnimatedColors, useTheme } from '@/src/theme';
import { Album, Artist, Track } from '@/src/types';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useCallback, useMemo, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View
} from 'react-native';
import { Text } from 'react-native-paper';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TRACK_CARD_WIDTH = 140;
const ARTIST_CARD_SIZE = 80;

// ─── Greeting based on time of day ──────────────────────────
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'Buenas noches';
  if (hour < 12) return 'Buenos días';
  if (hour < 18) return 'Buenas tardes';
  return 'Buenas noches';
}

// ─── Horizontal Track Card (Optimized) ────────────────────
const TrackCard = React.memo(({
  track,
  onPress,
  onLongPress,
}: {
  track: Track;
  onPress: (track: Track) => void;
  onLongPress?: (track: Track) => void;
}) => {
  const { theme } = useTheme();

  // Memoize theme-dependent styles to avoid recalculating on re-render
  const cardBgStyle = useMemo(() => ({
    backgroundColor: theme.colors.surfaceVariant + '30'
  }), [theme.colors.surfaceVariant]);

  const artBgStyle = useMemo(() => ({
    backgroundColor: theme.colors.surfaceVariant
  }), [theme.colors.surfaceVariant]);

  const titleStyle = useMemo(() => ({
    color: theme.colors.onSurface
  }), [theme.colors.onSurface]);

  const subtitleStyle = useMemo(() => ({
    color: theme.colors.onSurfaceVariant
  }), [theme.colors.onSurfaceVariant]);

  return (
    <Pressable
      onPress={() => onPress(track)}
      onLongPress={() => onLongPress?.(track)}
      delayLongPress={200}
      style={({ pressed }) => [
        styles.trackCard,
        cardBgStyle,
        pressed && styles.pressedCard,
      ]}
    >
      <View style={[styles.trackCardArt, artBgStyle]}>
        {track.artwork ? (
          <Image
            source={{ uri: track.artwork }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey={track.id}
            cachePolicy="memory-disk"
            transition={0}
          />
        ) : (
          <CustomIcon
            name="Canción"
            size={32}
            color={theme.colors.onSurfaceVariant + '60'}
          />
        )}
      </View>
      <Text
        variant="bodySmall"
        numberOfLines={1}
        style={[styles.trackCardTitle, titleStyle]}
      >
        {track.title}
      </Text>
      <Text
        variant="labelSmall"
        numberOfLines={1}
        style={[styles.trackCardSubtitle, subtitleStyle]}
      >
        {track.artist}
      </Text>
    </Pressable>
  );
});


// ─── Artist Bubble (Optimized) ────────────────────────────
const ArtistBubble = React.memo(({
  artist,
  onPress,
}: {
  artist: Artist;
  onPress: (id: string) => void;
}) => {
  const { theme } = useTheme();

  const avatarBgStyle = useMemo(() => ({
    backgroundColor: theme.colors.surfaceVariant
  }), [theme.colors.surfaceVariant]);

  const nameStyle = useMemo(() => ({
    color: theme.colors.onSurfaceVariant
  }), [theme.colors.onSurfaceVariant]);

  return (
    <Pressable
      onPress={() => onPress(artist.id)}
      style={({ pressed }) => [
        styles.artistBubble,
        pressed && styles.pressedCard,
      ]}
    >
      <View style={[styles.artistAvatar, avatarBgStyle]}>
        {artist.artwork ? (
          <Image
            source={{ uri: artist.artwork }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey={artist.id}
            cachePolicy="memory-disk"
            transition={0}
          />
        ) : (
          <CustomIcon
            name="Artista"
            size={30}
            color={theme.colors.onSurfaceVariant + '80'}
          />
        )}
      </View>
      <Text
        variant="labelSmall"
        numberOfLines={1}
        style={[styles.artistName, nameStyle]}
      >
        {artist.name}
      </Text>
    </Pressable>
  );
});

// ─── Quick Play Chip (Optimized) ───────────────────────────────
const QuickChip = React.memo(({
  icon,
  label,
  onPress,
  color,
  bgColor,
}: {
  icon: any;
  label: string;
  onPress: () => void;
  color: string;
  bgColor: string;
}) => {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickChip,
        { backgroundColor: bgColor },
        pressed && styles.pressedChip
      ]}
    >
      <CustomIcon name={icon} size={20} color={color} />
      <Text style={[styles.quickChipText, { color }]}>{label}</Text>
    </Pressable>
  );
});

// ─── Section Header ─────────────────────────────────────────
const SectionHeader = React.memo(({
  title,
  icon,
  onSeeAll,
}: {
  title: string;
  icon: any;
  onSeeAll?: () => void;
}) => {
  const { theme } = useTheme();
  const titleStyle = useMemo(() => ({ color: theme.colors.onBackground }), [theme.colors.onBackground]);
  const seeAllStyle = useMemo(() => ({ color: theme.colors.primary }), [theme.colors.primary]);

  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleRow}>
        <CustomIcon
          name={icon}
          size={22}
          color={theme.colors.primary}
          style={styles.sectionIcon}
        />
        <Text variant="titleMedium" style={[styles.sectionTitle, titleStyle]}>
          {title}
        </Text>
      </View>
      {onSeeAll != null && (
        <Pressable onPress={onSeeAll} hitSlop={12}>
          <Text variant="labelMedium" style={seeAllStyle}>
            Ver todo
          </Text>
        </Pressable>
      )}
    </View>
  );
});

// ─── Stats Chip ───────────────────────────
const StatChip = React.memo(({
  icon,
  value,
  label,
}: {
  icon: any;
  value: number;
  label: string;
}) => {
  const { theme } = useTheme();
  const chipStyle = useMemo(() => ({
    backgroundColor: theme.colors.surfaceVariant + '30'
  }), [theme.colors.surfaceVariant]);
  const valueStyle = useMemo(() => ({
    color: theme.colors.onSurface
  }), [theme.colors.onSurface]);

  return (
    <View style={[styles.statChip, chipStyle]}>
      <View style={styles.statIconContainer}>
        <CustomIcon
          name={icon}
          size={16}
          color={theme.colors.primary}
        />
      </View>
      <View style={styles.statTextContainer}>
        <Text variant="titleSmall" style={[styles.statValue, valueStyle]} numberOfLines={1}>
          {value}
        </Text>
        <Text variant="labelSmall" style={[styles.statLabel, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
});

// ─── Now Playing Card ───────────────────────────────────────
const NowPlayingCard = React.memo(({
  track,
}: {
  track: Track;
}) => {
  const { theme } = useTheme();
  const containerStyle = useMemo(() => ({
    backgroundColor: theme.colors.primaryContainer + '30',
    borderColor: theme.colors.primary + '30',
  }), [theme.colors.primaryContainer, theme.colors.primary]);

  const artBgStyle = useMemo(() => ({
    backgroundColor: theme.colors.surfaceVariant
  }), [theme.colors.surfaceVariant]);

  return (
    <Pressable
      onPress={() => router.push('/player')}
      style={({ pressed }) => [
        styles.nowPlayingCard,
        containerStyle,
        pressed && styles.pressedNowPlaying,
      ]}
    >
      <View style={styles.nowPlayingContent}>
        <View style={[styles.nowPlayingArt, artBgStyle]}>
          {track.artwork ? (
            <Image
              source={{ uri: track.artwork }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={0}
            />
          ) : (
            <CustomIcon
              name="Canción"
              size={24}
              color={theme.colors.onSurfaceVariant}
            />
          )}
        </View>
        <View style={styles.nowPlayingInfo}>
          <Text
            variant="labelSmall"
            style={[styles.nowPlayingLabel, { color: theme.colors.primary }]}
          >
            REPRODUCIENDO
          </Text>
          <Text
            variant="bodyLarge"
            numberOfLines={1}
            style={[styles.nowPlayingTitle, { color: theme.colors.onSurface }]}
          >
            {track.title}
          </Text>
          <Text
            variant="bodySmall"
            numberOfLines={1}
            style={{ color: theme.colors.onSurfaceVariant }}
          >
            {track.artist}
          </Text>
        </View>
        <CustomIcon
          name="Next"
          size={24}
          color={theme.colors.primary}
        />
      </View>
    </Pressable>
  );
});

// ═══════════════════════════════════════════════════════════
export default function HomeScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  // Focused selectors
  const tracksMap = useLibraryStore(s => s.tracks);
  const albumsMap = useLibraryStore(s => s.albums);
  const artistsMap = useLibraryStore(s => s.artists);
  const isScanning = useLibraryStore(s => s.isScanning);
  const scanLibrary = useLibraryStore(s => s.scanLibrary);
  const getAllPlaylists = useLibraryStore(s => s.getAllPlaylists);
  const createPlaylist = useLibraryStore(s => s.createPlaylist);
  const addToPlaylist = useLibraryStore(s => s.addToPlaylist);
  const deleteTrack = useLibraryStore(s => s.deleteTrack);

  const play = usePlayerStore(s => s.play);
  const addToQueue = usePlayerStore(s => s.addToQueue);
  const toggleShuffle = usePlayerStore(s => s.toggleShuffle);
  const shuffleEnabled = usePlayerStore(s => s.shuffleEnabled);
  const recentlyPlayed = usePlayerStore(s => s.recentlyPlayed);
  const currentTrack = usePlayerStore(s => s.currentTrack);

  const { userName, userAvatarUri } = useOnboardingStore();

  const toValues = useCallback(<T,>(source: unknown): T[] => {
    if (source instanceof Map) return Array.from(source.values()) as T[];
    if (Array.isArray(source)) {
      return (source as unknown[]).map((entry) => {
        if (Array.isArray(entry) && entry.length === 2) return entry[1] as T;
        return entry as T;
      });
    }
    return [];
  }, []);

  // Derived arrays
  const tracks = useMemo(() => toValues<Track>(tracksMap as unknown), [toValues, tracksMap]);
  const albums = useMemo(() => toValues<Album>(albumsMap as unknown), [toValues, albumsMap]);
  const artists = useMemo(() => toValues<Artist>(artistsMap as unknown), [toValues, artistsMap]);

  // Data derivations
  const recentlyAddedAlbums = useMemo(
    () => [...albums].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)).slice(0, 6),
    [albums]
  );

  const recentlyAddedTracks = useMemo(
    () => [...tracks].sort((a, b) => (b.dateAdded ?? 0) - (a.dateAdded ?? 0)).slice(0, 15),
    [tracks]
  );

  const quickPicksSeedRef = useRef(Date.now());
  const prevTrackCountRef = useRef(tracks.length);

  if (tracks.length !== prevTrackCountRef.current) {
    prevTrackCountRef.current = tracks.length;
    quickPicksSeedRef.current = Date.now();
  }

  const quickPicks = useMemo(() => {
    if (tracks.length === 0) return [];
    const seed = quickPicksSeedRef.current;
    return [...tracks]
      .sort((a, b) => hashSimple(a.id + seed) - hashSimple(b.id + seed))
      .slice(0, 10);
  }, [tracks]);

  const topArtists = useMemo(() => artists.slice(0, 10), [artists]);
  const recentlyPlayedSlice = useMemo(() => recentlyPlayed.slice(0, 10), [recentlyPlayed]);
  const hasMusic = tracks.length > 0;

  // Handlers
  const handlePlayAll = useCallback(() => {
    if (tracks.length > 0) play(tracks[0], tracks);
  }, [tracks, play]);

  const handleShuffle = useCallback(() => {
    if (tracks.length > 0) {
      if (!shuffleEnabled) toggleShuffle();
      const randomIndex = Math.floor(Math.random() * tracks.length);
      play(tracks[randomIndex], tracks);
    }
  }, [tracks, play, toggleShuffle, shuffleEnabled]);

  const handleTrackPress = useCallback((track: Track) => {
    play(track, tracks);
  }, [tracks, play]);

  const handleTrackLongPress = useCallback((track: Track) => {
    openTrackActionsMenu({
      track,
      playlists: getAllPlaylists(),
      addToQueue,
      addToPlaylist,
      createPlaylist,
      deleteTrack,
    });
  }, [addToPlaylist, addToQueue, createPlaylist, deleteTrack, getAllPlaylists]);


  const handleAlbumPress = useCallback((album: Album) => {
    router.push({ pathname: '/album/[id]', params: { id: album.id } });
  }, []);

  const handleArtistPress = useCallback((artistId: string) => {
    router.push({ pathname: '/artist/[id]', params: { id: artistId } });
  }, []);

  const goToLibrary = useCallback(() => router.push('/library'), []);
  const goToSettings = useCallback(() => router.push('/settings'), []);

  // Render helpers
  const renderTrackCard = useCallback(({ item }: { item: Track }) => (
    <TrackCard track={item} onPress={handleTrackPress} onLongPress={handleTrackLongPress} />
  ), [handleTrackPress, handleTrackLongPress]);


  const renderArtistBubble = useCallback(({ item }: { item: Artist }) => (
    <ArtistBubble artist={item} onPress={handleArtistPress} />
  ), [handleArtistPress]);

  const trackKeyExtractor = useCallback((item: Track) => item.id, []);
  const artistKeyExtractor = useCallback((item: Artist) => item.id, []);
  const renderHorizontalSeparator = useCallback(() => <View style={styles.listSeparator} />, []);

  const getTrackItemLayout = useCallback((_data: any, index: number) => ({
    length: TRACK_CARD_WIDTH + 12,
    offset: (TRACK_CARD_WIDTH + 12) * index + 20,
    index,
  }), []);

  const aC = useAnimatedColors();
  const animBg = useAnimatedStyle(() => ({
    backgroundColor: aC.background.value,
  }));

  const heroCardStyle = useMemo(() => ({
    backgroundColor: theme.colors.surface + '80',
    borderColor: theme.colors.outline + '35',
  }), [theme.colors.surface, theme.colors.outline]);

  const sectionSurfaceStyle = useMemo(() => ({
    backgroundColor: theme.colors.surface + '70',
    borderColor: theme.colors.outline + '2F',
  }), [theme.colors.surface, theme.colors.outline]);

  return (
    <Animated.View style={[styles.container, animBg]}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 6, paddingBottom: styles.content.paddingBottom + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        decelerationRate="fast"
      >
        <Animated.View entering={FadeInDown.duration(400)} style={styles.heroCard}>
          <View style={styles.header}>
            <View style={styles.headerTop}>
              <Pressable
                onPress={() => router.push('/settings')}
                style={styles.profileArea}
              >
                <View style={[styles.avatarContainer, { borderColor: theme.colors.primary }]}>
                  {userAvatarUri ? (
                    <Image
                      source={{ uri: userAvatarUri }}
                      style={styles.avatar}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={[styles.avatarPlaceholder, { backgroundColor: theme.colors.primaryContainer }]}>
                      <Text style={{ color: theme.colors.primary, fontWeight: '800' }}>
                        {userName ? userName.charAt(0).toUpperCase() : 'U'}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.headerTextContainer}>
                  <Text
                    variant="bodyMedium"
                    style={[styles.greetingText, { color: theme.colors.onSurfaceVariant }]}
                  >
                    {getGreeting()}
                  </Text>
                  <Text
                    variant="headlineSmall"
                    style={[styles.appTitle, { color: theme.colors.onBackground }]}
                    numberOfLines={1}
                  >
                    {userName || 'StaySound'}
                  </Text>
                </View>
              </Pressable>

              <Pressable
                onPress={goToSettings}
                style={[styles.settingsBtn, { backgroundColor: theme.colors.surfaceVariant + '44' }]}
              >
                <CustomIcon name="Ajustes" size={22} color={theme.colors.onSurfaceVariant} />
              </Pressable>
            </View>
          </View>

          {hasMusic && (
            <>
              <View style={styles.quickChipRow}>
                <QuickChip icon="Play" label="Reproducir" onPress={handlePlayAll} color={theme.colors.onPrimary} bgColor={theme.colors.primary} />
                <QuickChip icon="Shuffle" label="Aleatorio" onPress={handleShuffle} color={theme.colors.primary} bgColor={theme.colors.primaryContainer + '90'} />
              </View>

              <View style={styles.statsRow}>
                <StatChip icon="Canción" value={tracks.length} label="canciones" />
                <StatChip icon="Album" value={albums.length} label="álbumes" />
                <StatChip icon="Artista" value={artists.length} label="artistas" />
              </View>
            </>
          )}
        </Animated.View>

        {recentlyPlayedSlice.length > 0 && (
          <View style={styles.sectionBlock}>
            <SectionHeader title="Escuchado Recientemente" icon="Reciente" />
            <FlashList
              data={recentlyPlayedSlice}
              renderItem={renderTrackCard}
              keyExtractor={trackKeyExtractor}
              ItemSeparatorComponent={renderHorizontalSeparator}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              drawDistance={TRACK_CARD_WIDTH * 2}
            />
          </View>
        )}

        {recentlyAddedTracks.length > 0 && (
          <View style={styles.sectionBlock}>
            <SectionHeader title="Agregado Recientemente" icon="Reciente" onSeeAll={goToLibrary} />
            <FlashList
              data={recentlyAddedTracks}
              renderItem={renderTrackCard}
              keyExtractor={trackKeyExtractor}
              ItemSeparatorComponent={renderHorizontalSeparator}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              drawDistance={TRACK_CARD_WIDTH * 2}
            />
          </View>
        )}

        {recentlyAddedAlbums.length > 0 && (
          <View style={styles.sectionBlock}>
            <SectionHeader title="Álbumes" icon="Album" onSeeAll={goToLibrary} />
            <View style={styles.albumGrid}>
              {recentlyAddedAlbums.map((album) => (
                <View key={album.id} style={styles.albumWrapper}>
                  <AlbumCard album={album} size="medium" onPress={handleAlbumPress} />
                </View>
              ))}
            </View>
          </View>
        )}

        {topArtists.length > 0 && (
          <View style={styles.sectionBlock}>
            <SectionHeader title="Tus Artistas" icon="Artista" onSeeAll={goToLibrary} />
            <FlashList
              data={topArtists}
              renderItem={renderArtistBubble}
              keyExtractor={artistKeyExtractor}
              ItemSeparatorComponent={renderHorizontalSeparator}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              drawDistance={ARTIST_CARD_SIZE * 2}
            />
          </View>
        )}

        {quickPicks.length > 0 && (
          <View style={styles.sectionBlock}>
            <SectionHeader title="Selecciones" icon="Shuffle" />
            <FlashList
              data={quickPicks}
              renderItem={renderTrackCard}
              keyExtractor={trackKeyExtractor}
              ItemSeparatorComponent={renderHorizontalSeparator}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              drawDistance={TRACK_CARD_WIDTH * 2}
            />
          </View>
        )}

        {currentTrack != null && <NowPlayingCard track={currentTrack} />}

        {!hasMusic && (
          <View style={styles.emptyContainer}>
            <EmptyState
              icon="📁"
              title="Escanea tu Biblioteca"
              description="No encontramos música en tu dispositivo. Vamos a buscar archivos de audio para comenzar."
              actionLabel={isScanning ? 'Escaneando...' : 'Buscar Música'}
              onAction={scanLibrary}
            />
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </Animated.View>
  );
}

function hashSimple(str: string | number): number {
  const s = String(str);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 140 },
  heroCard: { marginHorizontal: 16, marginTop: 12, marginBottom: 20 },
  header: { paddingHorizontal: 0, paddingTop: 16, marginBottom: 20 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  profileArea: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatarContainer: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, overflow: 'hidden', marginRight: 14, elevation: 4 },
  avatar: { width: '100%', height: '100%' },
  avatarPlaceholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  headerTextContainer: { flex: 1 },
  greetingText: { fontSize: 13, marginBottom: 0, fontWeight: '500', opacity: 0.8 },
  appTitle: { fontWeight: '900', letterSpacing: -0.8, fontSize: 32 },
  settingsBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  quickChipRow: { flexDirection: 'row', paddingHorizontal: 0, gap: 12, marginBottom: 20 },
  quickChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 16, gap: 8, overflow: 'hidden' },
  quickChipText: { fontSize: 14, fontWeight: '700' },
  pressedChip: { opacity: 0.7, transform: [{ scale: 0.96 }] },
  statsRow: { flexDirection: 'row', paddingHorizontal: 0, gap: 8, marginBottom: 10 },
  statChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 16,
    overflow: 'hidden'
  },
  statIconContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  statTextContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  statValue: { fontWeight: '800', fontSize: 13, lineHeight: 16 },
  statLabel: { fontSize: 10, lineHeight: 12, opacity: 0.8 },
  sectionBlock: { marginHorizontal: 16, marginBottom: 26 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 0, marginBottom: 16 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center' },
  sectionIcon: { marginRight: 8 },
  sectionTitle: { fontWeight: '700', letterSpacing: -0.3 },
  horizontalList: { paddingLeft: 0, paddingRight: 0, marginBottom: 2 },
  listSeparator: { width: 14 },
  trackCard: { width: TRACK_CARD_WIDTH, borderRadius: 14, overflow: 'hidden', paddingBottom: 10 },
  pressedCard: { opacity: 0.8, transform: [{ scale: 0.96 }] },
  trackCardArt: { width: TRACK_CARD_WIDTH, height: TRACK_CARD_WIDTH, borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  trackCardTitle: { fontWeight: '600', paddingHorizontal: 4 },
  trackCardSubtitle: { paddingHorizontal: 4 },
  albumGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 6, marginBottom: 4 },
  albumWrapper: { width: '50%', padding: 8, marginBottom: 10 },
  artistBubble: { alignItems: 'center', width: ARTIST_CARD_SIZE + 10 },
  artistAvatar: { width: ARTIST_CARD_SIZE, height: ARTIST_CARD_SIZE, borderRadius: ARTIST_CARD_SIZE / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  artistName: { textAlign: 'center', fontSize: 11 },
  nowPlayingCard: { marginHorizontal: 16, borderRadius: 18, borderWidth: 1, overflow: 'hidden', marginTop: 6 },
  pressedNowPlaying: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  nowPlayingContent: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  nowPlayingArt: { width: 52, height: 52, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  nowPlayingInfo: { flex: 1, marginLeft: 14 },
  nowPlayingLabel: { fontWeight: '700', letterSpacing: 0.5 },
  nowPlayingTitle: { fontWeight: '600', marginTop: 2 },
  emptyContainer: { marginTop: 20, height: 300, paddingHorizontal: 20 },
  bottomSpacer: { height: 40 },
});
