import { usePlayerColors } from '@/src/hooks/usePlayerColors';
import { usePlayerLyrics } from '@/src/hooks/usePlayerLyrics';
import { usePlayerStore } from '@/src/stores';
import { usePerformanceProfile, useTheme } from '@/src/theme';
import type { RepeatMode, Track } from '@/src/types/audio';
import { KaraokeLyricsJSON } from '@/src/types/karaokeTypes';
import { withAlpha } from '@/src/utils/colorContrast';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { KaraokeView } from 'karaoke-view';
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, View, processColor } from 'react-native';
import { Text } from 'react-native-paper';
import Animated, { Easing, Extrapolation, interpolate, runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LYRICS_MOTION_OPTIONS } from '../lyricsMotionProfiles';
import { playerStyles as styles } from '../playerStyles';
import { ThemeBackground } from '../backgrounds/ThemeBackground';
import { LyricsSkeleton } from '../../ui';

const LYRICS_KEEP_AWAKE_TAG = 'StaySoundLyricsView';

export type PhraseLyricLine = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
};

type PlayerLyricsLayerProps = {
  visible: boolean;
  expanded: boolean;
  currentTrack: Track | null;
  accentColor: string;
  textColor: string;
  colors: any;
  animColors?: any;
  isPlaying: boolean;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  qualityBadge?: { label: string; tone: string };
  trackTechLabel?: string;
  onPrimaryColor?: string;
  animStyle: any;
  onClose: () => void;
  onPlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onToggleShuffle: () => void;
  onCycleRepeatMode: () => void;
  onArtistPress?: () => void;
  onAlbumPress?: () => void;
  onOpenMoreOptions?: () => void;
  seek: (positionMs: number) => Promise<void>;
};

type AnimatedPressableProps = {
  onPress?: () => void;
  style?: any;
  pressedScale?: number;
  children: React.ReactNode;
  accessibilityRole?: string;
  accessibilityLabel?: string;
  accessibilityState?: object;
  accessibilityHint?: string;
};

function normalizeLineWords(words: any[]) {
  return words
    .map(word => `${word.w}${word.sp ? ' ' : ''}`)
    .join('')
    .trim();
}

export function buildPhraseLyricsLines(lyricsJson: KaraokeLyricsJSON | null): PhraseLyricLine[] {
  if (!lyricsJson?.lyrics?.length) return [];

  const lines: PhraseLyricLine[] = [];
  const foregroundLyrics = lyricsJson.lyrics.filter(word => !word.bg);
  let currentWords: typeof foregroundLyrics = [];

  const flushLine = () => {
    if (!currentWords.length) return;
    const text = normalizeLineWords(currentWords);
    if (!text) {
      currentWords = [];
      return;
    }

    const startMs = Math.max(0, Math.round(currentWords[0].s * 1000));
    const endMs = Math.max(startMs, Math.round(currentWords[currentWords.length - 1].e * 1000));
    lines.push({ id: `${startMs}-${lines.length}`, text, startMs, endMs });
    currentWords = [];
  };

  for (const word of foregroundLyrics) {
    currentWords.push(word);
    if (word.n) flushLine();
  }

  flushLine();
  return lines;
}

export function getActivePhraseLineIndex(lines: PhraseLyricLine[], currentTimeMs: number) {
  if (!lines.length) return -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (currentTimeMs >= lines[index].startMs) {
      return index;
    }
  }
  return 0;
}

function AnimatedPressable({
  onPress,
  style,
  pressedScale = 0.93,
  children,
  accessibilityRole,
  accessibilityLabel,
  accessibilityState,
  accessibilityHint,
}: AnimatedPressableProps) {
  const pressScale = useSharedValue(1);

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  const handlePressIn = useCallback(() => {
    pressScale.value = withTiming(pressedScale, { duration: 120, easing: Easing.out(Easing.quad) });
  }, [pressScale, pressedScale]);

  const handlePressOut = useCallback(() => {
    pressScale.value = withTiming(1, { duration: 170, easing: Easing.out(Easing.back(1.2)) });
  }, [pressScale]);

  return (
    <Animated.View style={pressStyle}>
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={style}
        accessibilityRole={accessibilityRole as any}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={accessibilityState as any}
        accessibilityHint={accessibilityHint}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

export const PlayerLyricsLayer = React.memo(function PlayerLyricsLayer({
  visible,
  expanded,
  currentTrack,
  accentColor,
  textColor,
  colors,
  animColors,
  isPlaying,
  shuffleEnabled,
  repeatMode,
  qualityBadge,
  trackTechLabel,
  onPrimaryColor,
  animStyle,
  onClose,
  onPlayPause,
  onNext,
  onPrevious,
  onToggleShuffle,
  onCycleRepeatMode,
  onArtistPress,
  onAlbumPress,
  onOpenMoreOptions,
  seek,
}: PlayerLyricsLayerProps) {
  const { isDark, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const performanceProfile = usePerformanceProfile();
  const positionShared = usePlayerStore(state => state.positionShared);
  const karaokeViewRef = React.useRef<{ setNativeProps?: (props: { currentTimeMs: number }) => void } | null>(null);
  const syncedRenderTimeRef = React.useRef(0);

  const {
    trackLyricsOptions,
    selectedTrackLyrics,
    selectedTrackLyricsOptionIndex,
    isLyricsLoading,
    hasResolvedLyricsAttempt,
    nativePositionMs,
    selectedMotionOptionId,
    setSelectedMotionOptionId,
    lyricsControlsExpanded,
    setLyricsControlsExpanded,
    lyricsTimingOffsetMs,
    setLyricsTimingOffsetMs,
    applyLyricsOffsetStep,
    activeMotionOption,
    appliedMotionProfile,
    hasSyncedLyrics,
    hasMultipleSyncedLyricsOptions,
    activeSyncedLyricsOption,
    handleCycleSyncedLyricsOption,
    lyricsTransitionProgress,
  } = usePlayerLyrics({ visible, currentTrack });

  const {
    lyricsBaseSurface,
    lyricsTextColor,
    protectedAccentColor,
    lyricsHighlightColor,
    protectedGlowColor,
    protectedInactiveColor,
    secondaryLyricsTextColor,
    modeTabActiveBackground,
    motionRailBackground,
    motionRailBorder,
    inactiveMotionIconColor,
  } = usePlayerColors({
    themeBackground: theme.colors.background,
    themePrimary: theme.colors.primary,
    isDark,
    shouldUseThemePlayerColors: false,
    playerColors: colors,
    accentColor,
    textColor,
  });

  const themeIslandExpandProgress = useSharedValue(0);

  React.useEffect(() => {
    themeIslandExpandProgress.value = withTiming(lyricsControlsExpanded ? 1 : 0, {
      duration: lyricsControlsExpanded ? 260 : 200,
      easing: lyricsControlsExpanded ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
    });
  }, [lyricsControlsExpanded, themeIslandExpandProgress]);

  const themeOptionsAnimatedStyle = useAnimatedStyle(() => ({
    opacity: themeIslandExpandProgress.value,
    maxHeight: interpolate(themeIslandExpandProgress.value, [0, 1], [0, 260], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(themeIslandExpandProgress.value, [0, 1], [14, 0], Extrapolation.CLAMP) },
      { scale: interpolate(themeIslandExpandProgress.value, [0, 1], [0.95, 1], Extrapolation.CLAMP) },
    ],
  }));

  const lyricsTransitionStyle = useAnimatedStyle(() => ({
    opacity: lyricsTransitionProgress.value,
    transform: [
      {
        translateY: interpolate(lyricsTransitionProgress.value, [0, 1], [24, 0], Extrapolation.CLAMP),
      },
      {
        scale: interpolate(lyricsTransitionProgress.value, [0, 1], [0.96, 1], Extrapolation.CLAMP),
      },
    ],
  }));

  React.useEffect(() => {
    if (!visible || !expanded) return;

    void activateKeepAwakeAsync(LYRICS_KEEP_AWAKE_TAG);
    return () => {
      void deactivateKeepAwake(LYRICS_KEEP_AWAKE_TAG);
    };
  }, [expanded, visible]);

  const updateKaraokeNativeTime = useCallback((timeMs: number) => {
    syncedRenderTimeRef.current = timeMs;
    karaokeViewRef.current?.setNativeProps?.({ currentTimeMs: timeMs });
  }, []);

  useAnimatedReaction(
    () => {
      if (!visible || !expanded || !selectedTrackLyrics?.lyrics?.length) return -1;
      return Math.max(0, Math.round(positionShared.value + lyricsTimingOffsetMs));
    },
    (current, previous) => {
      if (current >= 0 && current !== previous) {
        runOnJS(updateKaraokeNativeTime)(current);
      }
    },
    [selectedTrackLyrics?.lyrics?.length, expanded, lyricsTimingOffsetMs, positionShared, visible]
  );

  if (!expanded) {
    return null;
  }

  const lyricsBackdropUri = currentTrack?.artwork || currentTrack?.artworkThumb;
  const shouldShowSyncedSearchSkeleton =
    isLyricsLoading &&
    !hasResolvedLyricsAttempt &&
    !hasSyncedLyrics;
  const fallbackCurrentTimeMs = Math.max(0, nativePositionMs + lyricsTimingOffsetMs);
  const syncedCurrentTimeMs =
    syncedRenderTimeRef.current > 0 ? syncedRenderTimeRef.current : fallbackCurrentTimeMs;
  const shouldRenderThemeBackground = visible && performanceProfile.enableAnimatedBackgrounds;
  const topMeta = [currentTrack?.album, trackTechLabel, qualityBadge?.label].filter(Boolean).join(' / ');
  const repeatIconName = repeatMode === 'one' ? 'repeat-once' : repeatMode === 'all' ? 'repeat' : 'repeat-off';
  const playerBottom = Math.max(insets.bottom + 14, 22);
  const lyricControlsBottom = playerBottom + 76;
  const topHeaderOffset = Math.max(insets.top + 8, 34);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 10020 }, animStyle]} pointerEvents="box-none">
      <View style={StyleSheet.absoluteFill}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: lyricsBaseSurface }]} />
        {shouldRenderThemeBackground ? (
          <ThemeBackground
            colors={colors}
            animColors={animColors}
            artwork={lyricsBackdropUri}
            isVisible={visible}
            lightweight={performanceProfile.mode === 'lite'}
            isDark={colors.isDark}
          />
        ) : null}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: withAlpha('#000000', colors.isDark ? 0.26 : 0.08),
            },
          ]}
        />

        <View style={[styles.fullScreenLyricsHeader, { top: topHeaderOffset }]}>
          <View style={styles.lyricsHeaderActionsRow}>
            <AnimatedPressable
              onPress={onClose}
              style={styles.lyricsHeaderIconButton}
              pressedScale={0.92}
              accessibilityRole="button"
              accessibilityLabel="Cerrar letras"
            >
              <MaterialCommunityIcons name="close" size={25} color={lyricsTextColor} />
            </AnimatedPressable>

            <AnimatedPressable
              onPress={onOpenMoreOptions}
              style={styles.lyricsHeaderIconButton}
              pressedScale={0.92}
              accessibilityRole="button"
              accessibilityLabel="Mas opciones"
            >
              <MaterialCommunityIcons name="dots-horizontal" size={25} color={lyricsTextColor} />
            </AnimatedPressable>
          </View>

          <AnimatedPressable
            onPress={onAlbumPress ?? onArtistPress}
            style={styles.lyricsNowPlayingPress}
            pressedScale={0.985}
            accessibilityRole="button"
            accessibilityLabel="Abrir album"
          >
            {lyricsBackdropUri ? (
              <Image
                source={{ uri: lyricsBackdropUri }}
                style={styles.lyricsTopArtwork}
                contentFit="cover"
                transition={160}
              />
            ) : (
              <View style={styles.lyricsTopArtworkFallback}>
                <MaterialCommunityIcons name="music-note" size={22} color={secondaryLyricsTextColor} />
              </View>
            )}
            <View style={styles.lyricsTopMeta}>
              <Text numberOfLines={1} style={[styles.lyricsTopTitle, { color: lyricsTextColor }]}>
                {currentTrack?.title ?? selectedTrackLyrics?.meta?.song ?? ''}
              </Text>
              <Text numberOfLines={1} style={[styles.lyricsTopArtist, { color: secondaryLyricsTextColor }]}>
                {currentTrack?.artist ?? selectedTrackLyrics?.meta?.artist ?? ''}
              </Text>
              {topMeta ? (
                <Text numberOfLines={1} style={[styles.lyricsTopSubmeta, { color: secondaryLyricsTextColor }]}>
                  {topMeta}
                </Text>
              ) : null}
            </View>
          </AnimatedPressable>
        </View>

        {selectedTrackLyrics ? (
          <Animated.View style={[{ flex: 1 }, lyricsTransitionStyle]}>
            <View style={styles.syncedLyricsViewport}>
              <KaraokeView
                ref={karaokeViewRef}
                key={`karaoke-${appliedMotionProfile}`}
                style={{ flex: 1 }}
                lyrics={selectedTrackLyrics.lyrics}
                currentTimeMs={syncedCurrentTimeMs}
                isPlaying={isPlaying}
                fontSize={25}
                isLineByLine={false}
                enableSeekOnTap={false}
                activeColor={processColor(lyricsHighlightColor)}
                inactiveColor={processColor(protectedInactiveColor)}
                glowColor={processColor(protectedGlowColor)}
                backgroundColor={processColor(lyricsBaseSurface)}
                enableAmbientBackground={performanceProfile.enableAnimatedBackgrounds && performanceProfile.mode !== 'lite'}
                enableSpectralParticles={isPlaying}
                motionProfile={appliedMotionProfile}
                introTitle=""
                introSubtitle=""
                onSeek={({ nativeEvent }) => seek(nativeEvent.timeMs)}
              />
            </View>
            {/* Skeleton overlay: covers stale lyrics from previous track while the new track loads */}
            {shouldShowSyncedSearchSkeleton && (
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <LyricsSkeleton isDownloading={false} />
              </View>
            )}
            <View style={[styles.lyricsIslandsLayer, { bottom: lyricControlsBottom }]}>
              <View style={[styles.lyricsTimingIsland, { backgroundColor: motionRailBackground, borderColor: motionRailBorder }]}>
                <AnimatedPressable style={styles.lyricsTimingAction} onPress={() => applyLyricsOffsetStep(-50)}>
                  <Text style={[styles.lyricsTimingActionText, { color: secondaryLyricsTextColor }]}>-50</Text>
                </AnimatedPressable>
                <AnimatedPressable
                  style={styles.lyricsTimingReset}
                  onPress={() => setLyricsTimingOffsetMs(0)}
                  pressedScale={0.95}
                >
                  <Text style={[styles.lyricsTimingValue, { color: protectedAccentColor }]}>
                    {lyricsTimingOffsetMs > 0 ? `+${lyricsTimingOffsetMs}` : lyricsTimingOffsetMs}ms
                  </Text>
                </AnimatedPressable>
                <AnimatedPressable style={styles.lyricsTimingAction} onPress={() => applyLyricsOffsetStep(50)}>
                  <Text style={[styles.lyricsTimingActionText, { color: secondaryLyricsTextColor }]}>+50</Text>
                </AnimatedPressable>
              </View>

              {hasMultipleSyncedLyricsOptions ? (
                <AnimatedPressable
                  onPress={handleCycleSyncedLyricsOption}
                  style={[styles.lyricsVariantSwitcher, { backgroundColor: motionRailBackground, borderColor: motionRailBorder }]}
                  pressedScale={0.96}
                >
                  <MaterialCommunityIcons name="format-list-numbered" size={19} color={protectedAccentColor} />
                  <Text style={[styles.lyricsVariantSwitcherText, { color: secondaryLyricsTextColor }]}>
                    {selectedTrackLyricsOptionIndex + 1}/{trackLyricsOptions.length}
                  </Text>
                </AnimatedPressable>
              ) : (
                <View style={styles.lyricsVariantSwitcherPlaceholder} />
              )}

              <View style={styles.lyricsThemeIslandWrap}>
                <Animated.View
                  pointerEvents={lyricsControlsExpanded ? 'auto' : 'none'}
                  style={[
                    styles.lyricsThemeOptionsIsland,
                    themeOptionsAnimatedStyle,
                    { backgroundColor: motionRailBackground, borderColor: motionRailBorder },
                  ]}
                >
                  {LYRICS_MOTION_OPTIONS.map(option => {
                    const selected = option.id === selectedMotionOptionId;
                    return (
                      <AnimatedPressable
                        key={option.id}
                        onPress={() => setSelectedMotionOptionId(option.id)}
                        style={[
                          styles.lyricsThemeOptionButton,
                          selected && {
                            backgroundColor: modeTabActiveBackground,
                            borderColor: withAlpha(protectedAccentColor, 0.45),
                          },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={option.icon as any}
                          size={18}
                          color={selected ? protectedAccentColor : inactiveMotionIconColor}
                        />
                      </AnimatedPressable>
                    );
                  })}
                </Animated.View>

                <AnimatedPressable
                  onPress={() => setLyricsControlsExpanded(prev => !prev)}
                  style={[styles.lyricsThemeToggleCircle, { backgroundColor: motionRailBackground, borderColor: motionRailBorder }]}
                >
                  <MaterialCommunityIcons
                    name={(activeMotionOption?.icon ?? LYRICS_MOTION_OPTIONS[0]?.icon) as any}
                    size={22}
                    color={protectedAccentColor}
                  />
                </AnimatedPressable>
              </View>
            </View>

            {hasMultipleSyncedLyricsOptions && activeSyncedLyricsOption ? (
              <View style={[styles.lyricsVariantCaption, { bottom: lyricControlsBottom + 68 }]}>
                <Text numberOfLines={1} style={[styles.lyricsVariantCaptionText, { color: secondaryLyricsTextColor }]}>
                  {activeSyncedLyricsOption.label}
                </Text>
              </View>
            ) : null}

            <View style={[styles.lyricsBottomPlayer, { bottom: playerBottom }]}>
              <AnimatedPressable
                onPress={onToggleShuffle}
                style={styles.lyricsTransportButton}
                pressedScale={0.9}
                accessibilityRole="button"
                accessibilityLabel="Aleatorio"
                accessibilityState={{ selected: shuffleEnabled }}
              >
                <MaterialCommunityIcons name="shuffle" size={21} color={shuffleEnabled ? protectedAccentColor : secondaryLyricsTextColor} />
              </AnimatedPressable>
              <AnimatedPressable onPress={onPrevious} style={styles.lyricsTransportButton} pressedScale={0.88} accessibilityRole="button" accessibilityLabel="Anterior">
                <MaterialCommunityIcons name="skip-previous" size={30} color={lyricsTextColor} />
              </AnimatedPressable>
              <AnimatedPressable
                onPress={onPlayPause}
                style={[styles.lyricsPlayButton, { backgroundColor: protectedAccentColor }]}
                pressedScale={0.9}
                accessibilityRole="button"
                accessibilityLabel={isPlaying ? 'Pausar' : 'Reproducir'}
              >
                <MaterialCommunityIcons name={isPlaying ? 'pause' : 'play'} size={30} color={onPrimaryColor ?? '#000000'} />
              </AnimatedPressable>
              <AnimatedPressable onPress={onNext} style={styles.lyricsTransportButton} pressedScale={0.88} accessibilityRole="button" accessibilityLabel="Siguiente">
                <MaterialCommunityIcons name="skip-next" size={30} color={lyricsTextColor} />
              </AnimatedPressable>
              <AnimatedPressable
                onPress={onCycleRepeatMode}
                style={styles.lyricsTransportButton}
                pressedScale={0.9}
                accessibilityRole="button"
                accessibilityLabel="Repetir"
                accessibilityState={{ selected: repeatMode !== 'off' }}
              >
                <MaterialCommunityIcons name={repeatIconName as any} size={21} color={repeatMode !== 'off' ? protectedAccentColor : secondaryLyricsTextColor} />
              </AnimatedPressable>
            </View>
          </Animated.View>
        ) : (
          <View style={styles.lyricsFallbackState}>
            {isLyricsLoading ? (
              <LyricsSkeleton isDownloading={false} />
            ) : (
              <View style={{ alignItems: 'center', width: '100%' }}>
                <Text style={[styles.lyricsFallbackTitle, { color: lyricsTextColor }]}>No se encontraron letras</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </Animated.View>
  );
});

