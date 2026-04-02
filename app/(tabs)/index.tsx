import { AlbumCard, CustomIcon, EmptyState } from '@/src/components/ui';
import { useScreenEntryAnimation, useScreenEntryKey } from '@/src/hooks';
import { useI18n, type TranslationKey } from '@/src/i18n';
import { openTrackActionsMenu } from '@/src/services/playlistActions';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useOnboardingStore } from '@/src/stores/onboardingStore';
import { typeScale, useAnimatedColors, usePerformanceProfile, useTheme } from '@/src/theme';
import { Album, Track } from '@/src/types';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useCallback, useMemo, useRef } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from 'react-native-paper';
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TRACK_CARD_WIDTH = 140;
const HERO_PICK_COUNT = 5;
const HERO_CAROUSEL_GAP = 14;
const HERO_CAROUSEL_EDGE_PADDING = 32;
const HERO_CARD_INACTIVE_SCALE = 0.992;
const HERO_CARD_INACTIVE_OPACITY = 0.94;

function getGreeting(t: (key: TranslationKey) => string): string {
  const hour = new Date().getHours();
  if (hour < 6) return t('home.greeting.night');
  if (hour < 12) return t('home.greeting.morning');
  if (hour < 18) return t('home.greeting.afternoon');
  return t('home.greeting.night');
}

const HeroCarouselDot = React.memo(({
  index,
  scrollX,
  step,
}: {
  index: number;
  scrollX: SharedValue<number>;
  step: number;
}) => {
  const animatedStyle = useAnimatedStyle(() => {
    const inputRange = [
      (index - 1) * step,
      index * step,
      (index + 1) * step,
    ];

    return {
      width: interpolate(scrollX.value, inputRange, [8, 24, 8], Extrapolation.CLAMP),
      opacity: interpolate(scrollX.value, inputRange, [0.34, 1, 0.34], Extrapolation.CLAMP),
      transform: [
        {
          scale: interpolate(scrollX.value, inputRange, [0.92, 1, 0.92], Extrapolation.CLAMP),
        },
      ],
    };
  }, [index, scrollX, step]);

  return <Animated.View style={[styles.heroCarouselDot, animatedStyle]} />;
});

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
  const performanceProfile = usePerformanceProfile();
  const imageCachePolicy = performanceProfile.imageCachePolicyList;

  const cardBgStyle = useMemo(() => ({
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.outline + '26',
  }), [theme.colors.outline, theme.colors.surface]);

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
      unstable_pressDelay={80}
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
            source={{ uri: track.artworkThumb || track.artwork }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey={track.id}
            cachePolicy={imageCachePolicy}
            transition={0}
          />
        ) : (
          <CustomIcon
            name="Cancion"
            size={32}
            color={theme.colors.onSurfaceVariant + '60'}
          />
        )}
      </View>
      <Text variant="bodySmall" numberOfLines={1} style={[styles.trackCardTitle, titleStyle]}>
        {track.title}
      </Text>
      <Text variant="labelSmall" numberOfLines={1} style={[styles.trackCardSubtitle, subtitleStyle]}>
        {track.artist}
      </Text>
    </Pressable>
  );
});

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
  const { t } = useI18n();
  const titleStyle = useMemo(() => ({ color: theme.colors.onBackground }), [theme.colors.onBackground]);
  const seeAllStyle = useMemo(() => ({ color: theme.colors.primary }), [theme.colors.primary]);

  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleRow}>
        <CustomIcon name={icon} size={22} color={theme.colors.primary} style={styles.sectionIcon} />
        <Text variant="titleMedium" style={[styles.sectionTitle, titleStyle]}>
          {title}
        </Text>
      </View>
      {onSeeAll != null && (
        <Pressable onPress={onSeeAll} hitSlop={12}>
          <Text variant="labelMedium" style={seeAllStyle}>
            {t('home.seeAll')}
          </Text>
        </Pressable>
      )}
    </View>
  );
});

const HeroCarouselCard = React.memo(({
  track,
  index,
  scrollX,
  step,
  width,
  onPress,
  onLongPress,
}: {
  track: Track;
  index: number;
  scrollX: SharedValue<number>;
  step: number;
  width: number;
  onPress: (track: Track) => void;
  onLongPress?: (track: Track) => void;
}) => {
  const { theme } = useTheme();
  const performanceProfile = usePerformanceProfile();
  const imageCachePolicy = performanceProfile.imageCachePolicyList;
  const artworkHeight = Math.min(width - 6, 332);
  const cardHeight = artworkHeight + 132;
  const albumLabel = track.album && track.album !== 'Unknown Album' ? track.album : track.artist;
  const animatedStyle = useAnimatedStyle(() => {
    const inputRange = [
      (index - 1) * step,
      index * step,
      (index + 1) * step,
    ];

    return {
      opacity: interpolate(scrollX.value, inputRange, [HERO_CARD_INACTIVE_OPACITY, 1, HERO_CARD_INACTIVE_OPACITY], Extrapolation.CLAMP),
      transform: [
        {
          scale: interpolate(scrollX.value, inputRange, [HERO_CARD_INACTIVE_SCALE, 1, HERO_CARD_INACTIVE_SCALE], Extrapolation.CLAMP),
        },
      ],
    };
  }, [index, scrollX, step]);

  return (
    <Animated.View
      style={[
        styles.heroCarouselCard,
        animatedStyle,
        {
          width,
          height: cardHeight,
        },
      ]}
    >
      <Pressable
        unstable_pressDelay={80}
        onPress={() => onPress(track)}
        onLongPress={() => onLongPress?.(track)}
        delayLongPress={200}
        style={({ pressed }) => [
          styles.heroCarouselPressable,
          pressed && styles.heroCarouselPressed,
        ]}
      >
        <View style={styles.heroCarouselBody}>
          <View
            style={[
              styles.heroCarouselArtworkShell,
              {
                height: artworkHeight,
                backgroundColor: theme.colors.surfaceVariant,
              },
            ]}
          >
            {track.artwork ? (
              <Image
                source={{ uri: track.artwork || track.artworkThumb }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                recyclingKey={`hero-carousel-${track.id}`}
                cachePolicy={imageCachePolicy}
                transition={0}
              />
            ) : (
              <CustomIcon name="Album" size={54} color={theme.colors.onSurfaceVariant + '80'} />
            )}

            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.10)', 'rgba(0,0,0,0.34)']}
              locations={[0, 0.62, 1]}
              style={styles.heroCarouselArtworkFade}
            />
          </View>

          <View style={styles.heroCarouselInfo}>
            <Text variant="headlineSmall" style={[styles.heroCarouselTitle, { color: theme.colors.onBackground }]}>
              {track.title}
            </Text>
            <Text variant="bodyMedium" style={[styles.heroCarouselArtist, { color: theme.colors.onSurfaceVariant }]}>
              {track.artist}
            </Text>
            <View style={styles.heroCarouselMetaRow}>
              <CustomIcon name="Album" size={12} color={theme.colors.onSurfaceVariant} />
              <Text variant="bodySmall" style={[styles.heroCarouselMetaText, { color: theme.colors.onSurfaceVariant }]}>
                {albumLabel}
              </Text>
            </View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
});

const HeroCarousel = React.memo(({
  tracks,
  cardWidth,
  onPressTrack,
  onLongPressTrack,
}: {
  tracks: Track[];
  cardWidth: number;
  onPressTrack: (track: Track) => void;
  onLongPressTrack?: (track: Track) => void;
}) => {
  const scrollX = useSharedValue(0);
  const step = cardWidth + HERO_CAROUSEL_GAP;
  const snapOffsets = useMemo(() => tracks.map((_, index) => index * step), [step, tracks]);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
    },
  });
  const renderItem = useCallback(({ item, index }: { item: Track; index: number }) => (
    <View style={index === tracks.length - 1 ? null : styles.heroCarouselItemSpacing}>
      <HeroCarouselCard
        track={item}
        index={index}
        scrollX={scrollX}
        step={step}
        width={cardWidth}
        onPress={onPressTrack}
        onLongPress={onLongPressTrack}
      />
    </View>
  ), [cardWidth, onLongPressTrack, onPressTrack, scrollX, step, tracks.length]);
  const keyExtractor = useCallback((item: Track) => `hero-wrap-${item.id}`, []);
  const getItemLayout = useCallback((_: ArrayLike<Track> | null | undefined, index: number) => ({
    length: step,
    offset: step * index,
    index,
  }), [step]);

  return (
    <View>
      <Animated.FlatList
        data={tracks}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemLayout={getItemLayout}
        showsHorizontalScrollIndicator={false}
        horizontal
        directionalLockEnabled
        overScrollMode="never"
        contentContainerStyle={styles.heroCarouselList}
        snapToOffsets={snapOffsets}
        snapToAlignment="start"
        disableIntervalMomentum
        decelerationRate="fast"
        bounces={false}
        removeClippedSubviews
        initialNumToRender={tracks.length}
        maxToRenderPerBatch={tracks.length}
        windowSize={3}
        scrollEventThrottle={8}
        onScroll={scrollHandler}
      />
      <View style={styles.heroCarouselDots}>
        {tracks.map((track, index) => (
          <HeroCarouselDot
            key={`hero-dot-${track.id}`}
            index={index}
            scrollX={scrollX}
            step={step}
          />
        ))}
      </View>
    </View>
  );
});

export default function HomeScreen() {
  const { theme, config } = useTheme();
  const performanceProfile = usePerformanceProfile();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const screenEntryKey = useScreenEntryKey('home-tab');
  const heroEntryStyle = useScreenEntryAnimation(screenEntryKey, { duration: 400 });
  const recentlyPlayedEntryStyle = useScreenEntryAnimation(screenEntryKey, { delay: 70 });
  const recentlyAddedEntryStyle = useScreenEntryAnimation(screenEntryKey, { delay: 130 });
  const albumsEntryStyle = useScreenEntryAnimation(screenEntryKey, { delay: 190 });
  const emptyEntryStyle = useScreenEntryAnimation(screenEntryKey, { delay: 120, duration: 260, translateY: 0 });

  const tracksMap = useLibraryStore(s => s.tracks);
  const albumsMap = useLibraryStore(s => s.albums);
  const isScanning = useLibraryStore(s => s.isScanning);
  const scanLibrary = useLibraryStore(s => s.scanLibrary);
  const getAllPlaylists = useLibraryStore(s => s.getAllPlaylists);
  const createPlaylist = useLibraryStore(s => s.createPlaylist);
  const addToPlaylist = useLibraryStore(s => s.addToPlaylist);
  const deleteTrack = useLibraryStore(s => s.deleteTrack);

  const play = usePlayerStore(s => s.play);
  const addToQueue = usePlayerStore(s => s.addToQueue);
  const recentlyPlayed = usePlayerStore(s => s.recentlyPlayed);
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

  const tracks = useMemo(() => toValues<Track>(tracksMap as unknown), [toValues, tracksMap]);
  const albums = useMemo(() => toValues<Album>(albumsMap as unknown), [toValues, albumsMap]);

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

  const heroPicks = useMemo(() => quickPicks.slice(0, HERO_PICK_COUNT), [quickPicks]);
  const recentlyPlayedSlice = useMemo(() => recentlyPlayed.slice(0, 10), [recentlyPlayed]);
  const hasMusic = tracks.length > 0;
  const heroCardWidth = useMemo(() => Math.max(252, screenWidth - 128), [screenWidth]);
  const lightweightMode = config.lightweightMode;
  const heroTracks = useMemo(() => lightweightMode ? quickPicks.slice(0, 8) : heroPicks, [heroPicks, lightweightMode, quickPicks]);
  const horizontalDrawDistance = performanceProfile.reducedListWindowing ? TRACK_CARD_WIDTH : TRACK_CARD_WIDTH * 2;

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

  const goToLibrary = useCallback(() => router.push('/library'), []);
  const goToSettings = useCallback(() => router.push('/settings'), []);

  const renderTrackCard = useCallback(({ item }: { item: Track }) => (
    <TrackCard track={item} onPress={handleTrackPress} onLongPress={handleTrackLongPress} />
  ), [handleTrackPress, handleTrackLongPress]);

  const trackKeyExtractor = useCallback((item: Track) => item.id, []);
  const renderHorizontalSeparator = useCallback(() => <View style={styles.listSeparator} />, []);

  const aC = useAnimatedColors();
  const animBg = useAnimatedStyle(() => ({ backgroundColor: aC.background.value }));

  return (
    <Animated.View style={[styles.container, animBg]}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 6, paddingBottom: styles.content.paddingBottom + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        decelerationRate="fast"
      >
        <Animated.View style={[styles.heroCard, heroEntryStyle]}>
          <View style={styles.header}>
            <View style={styles.headerTop}>
              <Pressable onPress={() => router.push('/settings')} style={styles.profileArea}>
                <View style={[styles.avatarContainer, { borderColor: theme.colors.outline + '30', backgroundColor: theme.colors.surfaceVariant }]}>
                  {userAvatarUri ? (
                    <Image source={{ uri: userAvatarUri }} style={styles.avatar} contentFit="cover" cachePolicy={performanceProfile.imageCachePolicyOverlay} transition={0} />
                  ) : (
                    <View style={[styles.avatarPlaceholder, { backgroundColor: theme.colors.primaryContainer }]}>
                      <Text style={[typeScale.title, { color: theme.colors.primary }]}>
                        {userName ? userName.charAt(0).toUpperCase() : 'U'}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.headerTextContainer}>
                  <Text variant="bodyMedium" style={[styles.greetingText, { color: theme.colors.onSurfaceVariant }]}>
                    {getGreeting(t)}
                  </Text>
                  <Text variant="headlineSmall" style={[styles.appTitle, { color: theme.colors.onBackground }]} numberOfLines={1}>
                    {userName || t('common.appName')}
                  </Text>
                </View>
              </Pressable>

              <Pressable onPress={goToSettings} style={[styles.settingsBtn, { backgroundColor: theme.colors.surfaceVariant + '70', borderColor: theme.colors.outline + '24' }]}>
                <CustomIcon name="Ajustes" size={22} color={theme.colors.onSurfaceVariant} />
              </Pressable>
            </View>
          </View>

          {hasMusic && heroTracks.length > 0 ? (
            <View style={styles.heroPicksSection}>
              {lightweightMode ? (
                <FlashList
                  data={heroTracks}
                  renderItem={renderTrackCard}
                  keyExtractor={trackKeyExtractor}
                  ItemSeparatorComponent={renderHorizontalSeparator}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.horizontalList}
                  drawDistance={horizontalDrawDistance}
                />
              ) : (
                <HeroCarousel
                  tracks={heroTracks}
                  cardWidth={heroCardWidth}
                  onPressTrack={handleTrackPress}
                  onLongPressTrack={handleTrackLongPress}
                />
              )}
            </View>
          ) : null}
        </Animated.View>

        {recentlyPlayedSlice.length > 0 && (
          <Animated.View style={[styles.sectionBlock, recentlyPlayedEntryStyle]}>
            <SectionHeader title={t('home.recentlyPlayed')} icon="Reciente" />
            <FlashList
              data={recentlyPlayedSlice}
              renderItem={renderTrackCard}
              keyExtractor={trackKeyExtractor}
              ItemSeparatorComponent={renderHorizontalSeparator}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              drawDistance={horizontalDrawDistance}
            />
          </Animated.View>
        )}

        {recentlyAddedTracks.length > 0 && (
          <Animated.View style={[styles.sectionBlock, recentlyAddedEntryStyle]}>
            <SectionHeader title={t('home.recentlyAdded')} icon="Reciente" onSeeAll={goToLibrary} />
            <FlashList
              data={recentlyAddedTracks}
              renderItem={renderTrackCard}
              keyExtractor={trackKeyExtractor}
              ItemSeparatorComponent={renderHorizontalSeparator}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              drawDistance={horizontalDrawDistance}
            />
          </Animated.View>
        )}

        {recentlyAddedAlbums.length > 0 && (
          <Animated.View style={[styles.sectionBlock, albumsEntryStyle]}>
            <SectionHeader title={t('home.albumsSection')} icon="Album" onSeeAll={goToLibrary} />
            <View style={styles.albumGrid}>
              {recentlyAddedAlbums.map((album) => (
                <View key={album.id} style={styles.albumWrapper}>
                  <AlbumCard album={album} size="medium" onPress={handleAlbumPress} />
                </View>
              ))}
            </View>
          </Animated.View>
        )}

        {!hasMusic && (
          <Animated.View style={[styles.emptyContainer, emptyEntryStyle]}>
            <EmptyState
              icon="📁"
              title={t('home.empty.title')}
              description={t('home.empty.description')}
              actionLabel={isScanning ? t('settings.library.scanning') : t('home.empty.action')}
              onAction={scanLibrary}
            />
          </Animated.View>
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
  header: { paddingHorizontal: 2, paddingTop: 22, marginBottom: 22 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  profileArea: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatarContainer: { width: 56, height: 56, borderRadius: 18, borderWidth: 1, overflow: 'hidden', marginRight: 14 },
  avatar: { width: '100%', height: '100%' },
  avatarPlaceholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  headerTextContainer: { flex: 1 },
  greetingText: { ...typeScale.caption, marginBottom: 0, opacity: 0.8 },
  appTitle: { ...typeScale.screenTitle },
  settingsBtn: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  heroPicksSection: { marginBottom: 18, marginHorizontal: -16 },
  heroCarouselList: { paddingLeft: HERO_CAROUSEL_EDGE_PADDING, paddingRight: HERO_CAROUSEL_EDGE_PADDING },
  heroCarouselItemSpacing: { marginRight: HERO_CAROUSEL_GAP },
  heroCarouselCard: {
    borderRadius: 28,
    borderWidth: 0,
    overflow: 'hidden',
  },
  heroCarouselPressable: {
    flex: 1,
  },
  heroCarouselPressed: { opacity: 0.96 },
  heroCarouselBody: {
    flex: 1,
  },
  heroCarouselArtworkShell: {
    borderRadius: 28,
    borderWidth: 0,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCarouselArtworkFade: { ...StyleSheet.absoluteFillObject },
  heroCarouselInfo: { marginTop: 14, paddingHorizontal: 2, minHeight: 112 },
  heroCarouselTitle: { ...typeScale.screenTitle, lineHeight: 32, fontWeight: '700' },
  heroCarouselArtist: { marginTop: 6, lineHeight: 22 },
  heroCarouselMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  heroCarouselMetaText: { flexShrink: 1, lineHeight: 18 },
  heroCarouselDots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  heroCarouselDot: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
  sectionBlock: { marginHorizontal: 16, marginBottom: 28 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 0, marginBottom: 14 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center' },
  sectionIcon: { marginRight: 8 },
  sectionTitle: { ...typeScale.title, letterSpacing: -0.2, fontWeight: '700' },
  horizontalList: { paddingLeft: 0, paddingRight: 0, marginBottom: 2 },
  listSeparator: { width: 14 },
  trackCard: { width: TRACK_CARD_WIDTH, borderRadius: 16, overflow: 'hidden', padding: 8, borderWidth: 1 },
  pressedCard: { opacity: 0.8, transform: [{ scale: 0.96 }] },
  trackCardArt: { width: TRACK_CARD_WIDTH - 16, height: TRACK_CARD_WIDTH - 16, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  trackCardTitle: { ...typeScale.bodyStrong, paddingHorizontal: 2 },
  trackCardSubtitle: { paddingHorizontal: 2 },
  albumGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 6, marginBottom: 4 },
  albumWrapper: { width: '50%', padding: 8, marginBottom: 10 },
  emptyContainer: { marginTop: 20, height: 300, paddingHorizontal: 20 },
  bottomSpacer: { height: 40 },
});


