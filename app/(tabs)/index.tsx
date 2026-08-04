import { AlbumCard, CustomIcon, EmptyState, GlassIconButton, TrackListItem } from '@/src/components/ui';
import { useDynamicColors, useScreenEntryAnimation, useScreenEntryKey } from '@/src/hooks';
import { useI18n, type TranslationKey } from '@/src/i18n';
import { openTrackActionsMenu } from '@/src/services/playlistActions';
import { createTidalStreamTrack } from '@/src/services/tidalService';
import { useLibraryStore, useNotificationStore, usePlayerStore } from '@/src/stores';
import { useOnboardingStore } from '@/src/stores/onboardingStore';
import { typeScale, usePerformanceProfile, useTheme } from '@/src/theme';
import { Album, TidalTrack, Track } from '@/src/types';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useCallback, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from 'react-native-paper';
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TRACK_CARD_WIDTH = 140;
const HERO_PICK_COUNT = 5;
const HERO_CAROUSEL_GAP = 0;

function getGreeting(t: (key: TranslationKey) => string): string {
  const hour = new Date().getHours();
  if (hour < 6) return t('home.greeting.night');
  if (hour < 12) return t('home.greeting.morning');
  if (hour < 18) return t('home.greeting.afternoon');
  return t('home.greeting.night');
}

function getTrackTidalId(track: Track): number | null {
  if (typeof track.tidalId === 'number' && Number.isFinite(track.tidalId)) {
    return track.tidalId;
  }

  const match = track.id?.match(/^tidal(?:_stream)?_(\d+)$/);
  if (!match) return null;

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTidalTrackPayload(track: Track): TidalTrack | null {
  const tidalId = getTrackTidalId(track);
  if (!tidalId) return null;

  return {
    id: tidalId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.duration,
    quality: track.quality || 'LOSSLESS',
    isHiRes: (track.quality || '').toUpperCase().includes('HI_RES'),
    artworkUrl: track.artwork,
    trackNumber: track.trackNumber,
    year: track.year,
    sampleRate: track.sampleRate,
    bitDepth: track.bitDepth,
    codec: track.codec,
    albumId: track.tidalAlbumId,
  };
}

const HeroCarouselDot = React.memo(({
  index,
  scrollX,
  step,
  color,
}: {
  index: number;
  scrollX: SharedValue<number>;
  step: number;
  color: string;
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

  return <Animated.View style={[styles.heroCarouselDot, { backgroundColor: color }, animatedStyle]} />;
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
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  }), []);

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
            source={{ uri: track.artwork || track.artworkThumb }}
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

const HeroCarouselCard = React.memo(({
  track,
  index,
  scrollX,
  step,
  width,
  onPress,
  onLongPress,
  accentColor,
}: {
  track: Track;
  index: number;
  scrollX: SharedValue<number>;
  step: number;
  width: number;
  onPress: (track: Track) => void;
  onLongPress?: (track: Track) => void;
  accentColor: string;
}) => {
  const { theme } = useTheme();
  const performanceProfile = usePerformanceProfile();
  const imageCachePolicy = performanceProfile.imageCachePolicyList;
  const artworkSize = Math.min(410, Math.max(318, width * 0.94));
  const artworkRight = -Math.min(210, width * 0.4);
  const copyWidth = Math.min(150, Math.max(132, width * 0.39));
  const cardHeight = 350;
  const sampleRateKHz = track.sampleRate
    ? `${Math.round((track.sampleRate / 1000) * 10) / 10} kHz`
    : '44.1 kHz';
  const bitDepthLabel = `${track.bitDepth || 16}-bit`;
  const qualityLabel = (track.codec || 'FLAC').toUpperCase();
  const qualityMeta = `${qualityLabel} · ${sampleRateKHz} · ${bitDepthLabel}`;
  const artworkVisibilityStyle = useAnimatedStyle(() => {
    const inputRange = [
      (index - 0.72) * step,
      index * step,
      (index + 0.72) * step,
    ];
    return {
      opacity: interpolate(scrollX.value, inputRange, [0, 1, 0], Extrapolation.CLAMP),
    };
  }, [index, scrollX, step]);
  const copyAnimatedStyle = useAnimatedStyle(() => {
    const inputRange = [(index - 1) * step, index * step, (index + 1) * step];
    return {
      opacity: interpolate(scrollX.value, inputRange, [0, 1, 0], Extrapolation.CLAMP),
    };
  }, [index, scrollX, step]);

  return (
    <Animated.View
      style={[
        styles.heroCarouselCard,
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
          <Animated.View
            style={[
              styles.heroCarouselArtworkShell,
              artworkVisibilityStyle,
              {
                width: artworkSize,
                height: artworkSize,
                right: artworkRight,
                backgroundColor: theme.colors.surfaceVariant,
                borderColor: `${accentColor}A8`,
                shadowColor: accentColor,
              },
            ]}
          >
            <View style={styles.heroCarouselArtworkClip}>
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
            </View>
            <View
              pointerEvents="none"
              style={[styles.heroCarouselInnerRing, { borderColor: `${accentColor}66` }]}
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.heroCarouselInfo,
              { width: copyWidth },
              copyAnimatedStyle,
            ]}
          >
            <Text style={[styles.heroCarouselKicker, { color: theme.colors.onSurfaceVariant }]}>STAYSOUND PICKS</Text>
            <Text
              variant="headlineSmall"
              numberOfLines={3}
              ellipsizeMode="tail"
              style={[styles.heroCarouselTitle, { color: theme.colors.onBackground }]}
            >
              {track.title}
            </Text>
            <Text
              variant="bodyMedium"
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[styles.heroCarouselArtist, { color: accentColor }]}
            >
              {track.artist}
            </Text>
            <View style={styles.heroCarouselMetaRow}>
              <Text
                variant="bodySmall"
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[styles.heroCarouselMetaText, { color: theme.colors.onSurfaceVariant }]}
              >
                {qualityMeta}
              </Text>
            </View>
            <View style={styles.heroCarouselPlayRow}>
              <View style={[styles.heroCarouselPlay, { backgroundColor: accentColor }]}>
                <CustomIcon name="Play" size={18} color={theme.colors.onPrimary} />
              </View>
              <Text style={[styles.heroCarouselPlayLabel, { color: accentColor }]}>
                Reproducir
              </Text>
            </View>
          </Animated.View>
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
  accentColor,
}: {
  tracks: Track[];
  cardWidth: number;
  onPressTrack: (track: Track) => void;
  onLongPressTrack?: (track: Track) => void;
  accentColor: string;
}) => {
  const scrollX = useSharedValue(0);
  const step = cardWidth + HERO_CAROUSEL_GAP;
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
    },
  });
  const renderItem = useCallback(({ item, index }: { item: Track; index: number }) => (
    <View>
      <HeroCarouselCard
        track={item}
        index={index}
        scrollX={scrollX}
        step={step}
        width={cardWidth}
        onPress={onPressTrack}
        onLongPress={onLongPressTrack}
        accentColor={accentColor}
      />
    </View>
  ), [accentColor, cardWidth, onLongPressTrack, onPressTrack, scrollX, step]);
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
        style={styles.heroCarouselViewport}
        directionalLockEnabled
        overScrollMode="never"
        contentContainerStyle={styles.heroCarouselList}
        snapToInterval={step}
        snapToAlignment="start"
        pagingEnabled
        disableIntervalMomentum
        decelerationRate="fast"
        bounces={false}
        removeClippedSubviews={false}
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
            color={accentColor}
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
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const addToQueue = usePlayerStore(s => s.addToQueue);
  const recentlyPlayed = usePlayerStore(s => s.recentlyPlayed);
  const setPendingTrackPreview = usePlayerStore(s => s.setPendingTrackPreview);
  const showNotification = useNotificationStore(s => s.showNotification);
  const { userName, userAvatarUri } = useOnboardingStore();
  const currentArtwork = currentTrack?.artwork || currentTrack?.artworkThumb;
  const { colors: playbackColors } = useDynamicColors(currentArtwork, {
    enabled: performanceProfile.enableDynamicColors,
    applyToTheme: false,
  });
  const playbackAccent = playbackColors.primary || theme.colors.primary;

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
  const heroCardWidth = screenWidth;
  const lightweightMode = config.lightweightMode;
  const heroTracks = useMemo(() => lightweightMode ? quickPicks.slice(0, 8) : heroPicks, [heroPicks, lightweightMode, quickPicks]);
  const horizontalDrawDistance = performanceProfile.reducedListWindowing ? TRACK_CARD_WIDTH : TRACK_CARD_WIDTH * 2;

  const handleTrackPress = useCallback((track: Track) => {
    const libraryTrack = tracks.find(item => item.id === track.id);
    if (libraryTrack) {
      void play(libraryTrack, tracks);
      return;
    }

    const tidalId = getTrackTidalId(track);
    const downloadedTidalTrack = tidalId
      ? tracks.find(item => item.id === `tidal_${tidalId}`)
      : undefined;
    if (downloadedTidalTrack) {
      void play(downloadedTidalTrack, [downloadedTidalTrack]);
      return;
    }

    const tidalPayload = toTidalTrackPayload(track);
    if (!tidalPayload) {
      void play(track, [track]);
      return;
    }

    setPendingTrackPreview({
      id: track.id,
      title: track.title,
      artist: track.artist,
      artwork: track.artwork,
      tidalId: tidalPayload.id,
    });

    void (async () => {
      try {
        const streamTrack = await createTidalStreamTrack(tidalPayload, { qobuzOnly: true });
        await play(streamTrack, [streamTrack]);
      } catch (error) {
        setPendingTrackPreview(null);
        const message = error instanceof Error ? error.message : 'No se pudo reproducir esta pista';
        showNotification(message, 'error');
      }
    })();
  }, [play, setPendingTrackPreview, showNotification, tracks]);

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

  const renderTrackCard = useCallback(({ item }: { item: Track }) => (
    <TrackCard track={item} onPress={handleTrackPress} onLongPress={handleTrackLongPress} />
  ), [handleTrackPress, handleTrackLongPress]);

  const trackKeyExtractor = useCallback((item: Track) => item.id, []);
  const renderHorizontalSeparator = useCallback(() => <View style={styles.listSeparator} />, []);
  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 6, paddingBottom: styles.content.paddingBottom + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        decelerationRate="fast"
      >
        <Animated.View style={[styles.heroCard, heroEntryStyle]}>
          <View style={styles.header}>
            <View style={styles.headerTop}>
              <View style={styles.profileArea}>
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
              </View>
            </View>
          </View>

          {hasMusic ? (
            <View style={styles.heroPicksSection}>
              <HeroCarousel
                tracks={heroTracks}
                cardWidth={heroCardWidth}
                onPressTrack={handleTrackPress}
                onLongPressTrack={handleTrackLongPress}
                accentColor={playbackAccent}
              />
            </View>
          ) : null}
        </Animated.View>

        {quickPicks.length > 0 && (
          <Animated.View style={[styles.sectionBlock, recentlyAddedEntryStyle]}>
            <SectionHeader title="Para esta noche" icon="Reciente" onSeeAll={goToLibrary} />
            <FlashList
              data={quickPicks}
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
    </View>
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
  heroCard: { marginTop: 2, marginBottom: 12 },
  header: { paddingHorizontal: 24, paddingTop: 26, marginBottom: 0, zIndex: 8, elevation: 8 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  profileArea: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatarContainer: { display: 'none' },
  avatar: { width: '100%', height: '100%' },
  avatarPlaceholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  headerTextContainer: { flex: 1 },
  greetingText: { ...typeScale.micro, fontFamily: 'StaySound', marginBottom: 4, opacity: 0.72, textTransform: 'uppercase', letterSpacing: 1.6, fontWeight: '500' },
  appTitle: { ...typeScale.screenTitle, fontSize: 30, lineHeight: 34, letterSpacing: -1.05 },
  spotlight: {
    height: 430,
    borderRadius: 34,
    overflow: 'hidden',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.32,
    shadowRadius: 30,
    elevation: 10,
  },
  spotlightPressed: { transform: [{ scale: 0.985 }], opacity: 0.96 },
  spotlightBadge: {
    alignSelf: 'flex-start',
    margin: 18,
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(4,6,12,0.64)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  spotlightBadgeText: { color: '#fff', fontSize: 10, lineHeight: 13, fontWeight: '900', letterSpacing: 1.4 },
  spotlightCopy: { padding: 22, paddingTop: 72 },
  spotlightTitle: { color: '#fff', fontSize: 35, lineHeight: 38, fontWeight: '900', letterSpacing: -1.35 },
  spotlightArtist: { color: 'rgba(255,255,255,0.74)', fontSize: 16, lineHeight: 22, marginTop: 7, fontWeight: '600' },
  spotlightActionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  spotlightPlay: { width: 38, height: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  spotlightActionText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  commandRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  commandCard: { flex: 1, minHeight: 86, borderRadius: 25, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11 },
  commandIcon: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  commandCopy: { flex: 1 },
  commandEyebrow: { fontSize: 9, fontWeight: '900', letterSpacing: 1.15, opacity: 0.68 },
  commandTitle: { fontSize: 14, lineHeight: 18, fontWeight: '800', marginTop: 3 },
  statCard: { width: 94, minHeight: 86, borderRadius: 25, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  statNumber: { fontSize: 25, lineHeight: 29, fontWeight: '900', letterSpacing: -0.8 },
  statLabel: { fontSize: 11, marginTop: 1, fontWeight: '700' },
  commandPressed: { transform: [{ scale: 0.97 }], opacity: 0.86 },
  heroPicksSection: { marginTop: 0, marginBottom: 8 },
  heroCarouselList: { paddingLeft: 0, paddingRight: 0 },
  heroCarouselViewport: { overflow: 'visible' },
  heroCarouselItemSpacing: { marginRight: HERO_CAROUSEL_GAP },
  heroCarouselCard: {
    borderRadius: 0,
    borderWidth: 0,
    overflow: 'visible',
  },
  heroCarouselPressable: {
    flex: 1,
    overflow: 'visible',
  },
  heroCarouselPressed: { opacity: 0.96 },
  heroCarouselBody: {
    flex: 1,
  },
  heroCarouselArtworkShell: {
    position: 'absolute',
    top: -100,
    borderRadius: 999,
    borderWidth: 1.5,
    overflow: 'visible',
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: -10, height: 10 },
    shadowOpacity: 0.38,
    shadowRadius: 22,
    elevation: 12,
  },
  heroCarouselArtworkClip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCarouselInnerRing: {
    position: 'absolute',
    inset: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  heroCarouselInfo: { position: 'absolute', left: 24, bottom: 18, overflow: 'visible', zIndex: 4 },
  heroCarouselKicker: { ...typeScale.micro, fontFamily: 'StaySound', fontSize: 10, letterSpacing: 1.35, fontWeight: '500', marginBottom: 10 },
  heroCarouselTitle: { ...typeScale.screenTitle, fontSize: 27, lineHeight: 28, fontWeight: '900', letterSpacing: -0.8 },
  heroCarouselArtist: { marginTop: 6, lineHeight: 22, fontWeight: '800' },
  heroCarouselMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  heroCarouselMetaText: { flexShrink: 1, lineHeight: 18 },
  heroCarouselPlayRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  heroCarouselPlay: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  heroCarouselPlayLabel: { ...typeScale.label, fontWeight: '800' },
  heroCarouselDots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 0,
  },
  heroCarouselDot: {
    height: 5,
    borderRadius: 999,
  },
  sectionBlock: { marginHorizontal: 24, marginBottom: 28 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 0, marginBottom: 14 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center' },
  sectionIcon: { marginRight: 8 },
  sectionTitle: { ...typeScale.body, fontFamily: 'StaySound', fontSize: 14, lineHeight: 18, letterSpacing: -0.15, fontWeight: '500', opacity: 0.78 },
  horizontalList: { paddingLeft: 0, paddingRight: 0, marginBottom: 2 },
  listSeparator: { width: 14 },
  trackCard: { width: 92, borderRadius: 0, overflow: 'visible', padding: 0, borderWidth: 0, alignItems: 'center' },
  pressedCard: { opacity: 0.8, transform: [{ scale: 0.96 }] },
  trackCardArt: { width: 86, height: 86, borderRadius: 43, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.24)', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  trackCardTitle: { ...typeScale.bodyStrong, width: 92, paddingHorizontal: 1, letterSpacing: -0.2, textAlign: 'center', fontSize: 11 },
  trackCardSubtitle: { width: 92, paddingHorizontal: 1, opacity: 0.72, textAlign: 'center', fontSize: 9 },
  recentStack: { borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 6, overflow: 'hidden' },
  albumRail: { gap: 12, paddingRight: 18, paddingBottom: 8 },
  albumWrapper: { width: 176 },
  emptyContainer: { marginTop: 20, height: 300, paddingHorizontal: 20 },
  bottomSpacer: { height: 40 },
});
