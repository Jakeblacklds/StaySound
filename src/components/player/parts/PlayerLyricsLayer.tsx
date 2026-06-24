import { usePlayerColors } from '@/src/hooks/usePlayerColors';
import { usePlayerLyrics } from '@/src/hooks/usePlayerLyrics';
import { usePlayerStore } from '@/src/stores';
import { useSettingsStore } from '@/src/stores/settingsStore';
import { usePerformanceProfile, useTheme } from '@/src/theme';
import type { RepeatMode, Track } from '@/src/types/audio';
import { KaraokeLyricsJSON } from '@/src/types/karaokeTypes';
import { pickReadableColor, withAlpha } from '@/src/utils/colorContrast';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { KaraokeView, KaraokeSpectrumView } from 'karaoke-view';
import React, { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, View, processColor } from 'react-native';
import { Text } from 'react-native-paper';
import Animated, { Easing, Extrapolation, interpolate, runOnJS, useAnimatedReaction, useAnimatedStyle, useFrameCallback, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LYRICS_MOTION_OPTIONS } from '../lyricsMotionProfiles';
import { playerStyles as styles } from '../playerStyles';
import { ThemeBackground } from '../backgrounds/ThemeBackground';
import { ProgressSlider } from '../ProgressSlider';
import { LyricsSkeleton } from '../../ui';
import { LyricsSuggestionModal } from './LyricsSuggestionModal';

const LYRICS_KEEP_AWAKE_TAG = 'StaySoundLyricsView';
const CD_SPIN_DEGREES_PER_MS = 360 / 42000;

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
  refreshNonce?: number;
  seek: (positionMs: number) => Promise<void>;
};

type AnimatedPressableProps = {
  onPress?: () => void;
  style?: any;
  pressedScale?: number;
  children: React.ReactNode;
  /** When true, paints an animated accent selection pill behind the content. */
  active?: boolean;
  activeColor?: string;
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
  active = false,
  activeColor,
  accessibilityRole,
  accessibilityLabel,
  accessibilityState,
  accessibilityHint,
}: AnimatedPressableProps) {
  const pressScale = useSharedValue(1);
  const activeProgress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    activeProgress.value = withSpring(active ? 1 : 0, {
      damping: 18,
      stiffness: 260,
      mass: 0.6,
    });
  }, [active, activeProgress]);

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  const pillStyle = useAnimatedStyle(() => ({
    opacity: interpolate(activeProgress.value, [0, 1], [0, 0.2]),
    transform: [{ scale: interpolate(activeProgress.value, [0, 1], [0.5, 1]) }],
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
        {activeColor ? (
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { borderRadius: 999, backgroundColor: activeColor }, pillStyle]}
          />
        ) : null}
        {children}
      </Pressable>
    </Animated.View>
  );
}

/** A single toolbar item that springs in/out with a staggered delay based on its index. */
function LyricsToolbarItem({
  index,
  expanded,
  bgColor,
  borderColor,
  children,
}: {
  index: number;
  expanded: boolean;
  bgColor: string;
  borderColor: string;
  children: React.ReactNode;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withSpring(expanded ? 1 : 0, {
      damping: 18,
      stiffness: 220,
      mass: 0.6,
    });
  }, [expanded, progress]);

  const itemStyle = useAnimatedStyle(() => {
    // Stagger: later items appear earlier when expanding (reverse order visually)
    const staggerDelay = index * 0.08;
    const adjustedProgress = interpolate(
      progress.value,
      [staggerDelay, staggerDelay + 0.6],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      opacity: adjustedProgress,
      transform: [
        { translateX: interpolate(adjustedProgress, [0, 1], [20, 0], Extrapolation.CLAMP) },
        { scale: interpolate(adjustedProgress, [0, 1], [0.85, 1], Extrapolation.CLAMP) },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents={expanded ? 'auto' : 'none'}
      style={[
        styles.lyricsToolbarItemContainer,
        { backgroundColor: bgColor, borderColor },
        itemStyle,
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Smooth crossfade + scale between play and pause glyphs. */
const AnimatedPlayPauseIcon = React.memo(function AnimatedPlayPauseIcon({
  isPlaying,
  color,
  size,
}: {
  isPlaying: boolean;
  color: string;
  size: number;
}) {
  const progress = useSharedValue(isPlaying ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(isPlaying ? 1 : 0, {
      duration: 220,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [isPlaying, progress]);

  const playStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, 0.7]) }],
  }));
  const pauseStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.7, 1]) }],
  }));

  return (
    <View style={styles.lyricsPlayIconStack}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.lyricsPlayIconCenter, playStyle]}>
        <MaterialCommunityIcons name="play" size={size} color={color} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.lyricsPlayIconCenter, pauseStyle]}>
        <MaterialCommunityIcons name="pause" size={size} color={color} />
      </Animated.View>
    </View>
  );
});

/** Primary play control with a soft accent glow that reacts to playback state. */
const LyricsPlayButton = React.memo(function LyricsPlayButton({
  isPlaying,
  accent,
  onPrimaryColor,
  onPress,
}: {
  isPlaying: boolean;
  accent: string;
  onPrimaryColor?: string;
  onPress: () => void;
}) {
  const glow = useSharedValue(isPlaying ? 1 : 0);

  useEffect(() => {
    glow.value = withTiming(isPlaying ? 1 : 0, {
      duration: 380,
      easing: Easing.out(Easing.cubic),
    });
  }, [isPlaying, glow]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(glow.value, [0, 1], [0.05, 0.16]),
    transform: [{ scale: interpolate(glow.value, [0, 1], [0.82, 1]) }],
  }));
  const iconColor = React.useMemo(
    () => pickReadableColor(accent, [onPrimaryColor, '#05070D', '#FFFFFF']),
    [accent, onPrimaryColor]
  );

  return (
    <View style={styles.lyricsPlayWrap}>
      <Animated.View pointerEvents="none" style={[styles.lyricsPlayGlow, { backgroundColor: accent }, glowStyle]} />
      <AnimatedPressable
        onPress={onPress}
        style={[styles.lyricsPlayButton, { backgroundColor: accent }]}
        pressedScale={0.9}
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? 'Pausar' : 'Reproducir'}
      >
        <AnimatedPlayPauseIcon isPlaying={isPlaying} color={iconColor} size={34} />
      </AnimatedPressable>
    </View>
  );
});

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
  onPlayPause,
  onNext,
  onPrevious,
  onToggleShuffle,
  onCycleRepeatMode,
  onArtistPress,
  onAlbumPress,
  onOpenMoreOptions,
  refreshNonce,
  seek,
}: PlayerLyricsLayerProps) {
  const { isDark, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const performanceProfile = usePerformanceProfile();
  const positionShared = usePlayerStore(state => state.positionShared);
  const spectrumDelayMs = useSettingsStore(state => state.spectrumDelayMs);
  const karaokeViewRef = React.useRef<{ setNativeProps?: (props: { currentTimeMs: number }) => void } | null>(null);
  const syncedRenderTimeRef = React.useRef(0);
  const lyricsCdSpin = useSharedValue(0);

  const {
    trackLyricsOptions,
    suggestedLyricsOptions,
    isLyricsSuggestionModalVisible,
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
    handleSelectSuggestedLyrics,
    dismissLyricsSuggestionModal,
    lyricsTransitionProgress,
  } = usePlayerLyrics({ visible, currentTrack, refreshNonce });

  const {
    lyricsBaseSurface,
    lyricsTextColor,
    protectedAccentColor,
    lyricsHighlightColor,
    protectedGlowColor,
    protectedSpectrumGlowColor,
    protectedInactiveColor,
    secondaryLyricsTextColor,
    motionRailBackground,
    motionRailBorder,
    inactiveMotionIconColor,
    chromeSurfaceColor,
  } = usePlayerColors({
    themeBackground: theme.colors.background,
    themePrimary: theme.colors.primary,
    isDark,
    shouldUseThemePlayerColors: false,
    playerColors: colors,
    accentColor,
    textColor,
  });



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

  const lyricsCdSpinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${lyricsCdSpin.value}deg` }],
  }));

  React.useEffect(() => {
    lyricsCdSpin.value = 0;
  }, [currentTrack?.id, lyricsCdSpin]);

  useFrameCallback((frameInfo) => {
    if (!visible || !expanded || !isPlaying || performanceProfile.mode === 'lite') return;
    const deltaMs = frameInfo.timeSincePreviousFrame ?? 16.67;
    lyricsCdSpin.value = (lyricsCdSpin.value + deltaMs * CD_SPIN_DEGREES_PER_MS) % 360;
  }, true);

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
  const repeatIconName = repeatMode === 'one' ? 'repeat-once' : repeatMode === 'all' ? 'repeat' : 'repeat-off';
  const playerBottom = Math.max(insets.bottom + 14, 22);
  const lyricProgressBottom = playerBottom + 88;
  const lyricControlsBottom = lyricProgressBottom + 48;
  const topHeaderOffset = Math.max(insets.top + 12, 34);

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

        <KaraokeSpectrumView
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          enabled={visible && expanded}
          isPlaying={isPlaying}
          renderDelayMs={spectrumDelayMs}
          glowColor={processColor(protectedSpectrumGlowColor)}
        />

        <View pointerEvents="none" style={styles.lyricsTopBlurBand}>
          <BlurView
            style={StyleSheet.absoluteFill}
            intensity={colors.isDark ? 34 : 42}
            tint={colors.isDark ? 'dark' : 'light'}
          />
          <LinearGradient
            pointerEvents="none"
            colors={[
              withAlpha(lyricsBaseSurface, colors.isDark ? 0.78 : 0.62),
              withAlpha(lyricsBaseSurface, colors.isDark ? 0.52 : 0.34),
              'transparent',
            ]}
            style={StyleSheet.absoluteFill}
          />
        </View>

        {/* Soft bottom scrim — replaces the heavy transport pill, keeps the
            naked controls legible over bright lyrics. */}
        <LinearGradient
          pointerEvents="none"
          colors={['transparent', withAlpha('#000000', colors.isDark ? 0.42 : 0.26)]}
          style={styles.lyricsBottomScrim}
        />

        <View style={[styles.fullScreenLyricsHeader, { top: topHeaderOffset }]}>
          <View style={styles.lyricsHeaderActionsRow}>
            <View style={[styles.lyricsHeaderGrabber, { backgroundColor: withAlpha(lyricsTextColor, 0.28) }]} />
            <View style={styles.lyricsHeaderButtonCluster}>
              <AnimatedPressable
                onPress={onOpenMoreOptions}
                style={[styles.lyricsHeaderIconButton, { backgroundColor: withAlpha(chromeSurfaceColor, 0.5) }]}
                pressedScale={0.92}
                accessibilityRole="button"
                accessibilityLabel="Mas opciones"
              >
                <MaterialCommunityIcons name="dots-horizontal" size={25} color={lyricsTextColor} />
              </AnimatedPressable>
            </View>
          </View>

          <AnimatedPressable
            onPress={onAlbumPress ?? onArtistPress}
            style={styles.lyricsNowPlayingPress}
            pressedScale={0.985}
            accessibilityRole="button"
            accessibilityLabel="Abrir album"
          >
            {lyricsBackdropUri ? (
              <View style={styles.lyricsTopArtworkWrap}>
                <Animated.View style={[styles.fullImage, lyricsCdSpinStyle]}>
                  <Image
                    source={{ uri: lyricsBackdropUri }}
                    style={styles.lyricsTopArtwork}
                    contentFit="cover"
                    transition={160}
                  />
                </Animated.View>
                <View pointerEvents="none" style={[styles.lyricsTopCdOuterRim, { borderColor: withAlpha('#FFFFFF', 0.42) }]} />
                <View pointerEvents="none" style={[styles.lyricsTopCdOuterRimShadow, { borderColor: withAlpha('#000000', 0.34) }]} />
                <View pointerEvents="none" style={[styles.lyricsTopCdGroove, { borderColor: withAlpha(lyricsTextColor, 0.26) }]} />
                <View pointerEvents="none" style={[styles.lyricsTopCdRing, { borderColor: withAlpha(lyricsTextColor, 0.52) }]} />
                <View
                  pointerEvents="none"
                  style={[
                    styles.lyricsTopCdHole,
                    {
                      backgroundColor: lyricsBaseSurface,
                      borderColor: withAlpha(lyricsTextColor, 0.48),
                    },
                  ]}
                />
              </View>
            ) : (
              <View style={[styles.lyricsTopArtworkFallback, { backgroundColor: chromeSurfaceColor }]}>
                <MaterialCommunityIcons name="music-note" size={22} color={secondaryLyricsTextColor} />
              </View>
            )}
            <View style={styles.lyricsTopMeta}>
              <View style={styles.lyricsTopTitleRow}>
                <Text numberOfLines={1} style={[styles.lyricsTopTitle, { color: lyricsTextColor }]}>
                  {currentTrack?.title ?? selectedTrackLyrics?.meta?.song ?? ''}
                </Text>
                {qualityBadge ? (
                  <View
                    style={[
                      styles.lyricsTopQualityBadge,
                      {
                        borderColor: withAlpha(secondaryLyricsTextColor, 0.28),
                        backgroundColor: withAlpha(secondaryLyricsTextColor, 0.08),
                      },
                    ]}
                  >
                    <Text numberOfLines={1} style={[styles.lyricsTopQualityBadgeText, { color: secondaryLyricsTextColor }]}>
                      {qualityBadge.label}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text numberOfLines={1} style={[styles.lyricsTopArtist, { color: secondaryLyricsTextColor }]}>
                {currentTrack?.artist ?? selectedTrackLyrics?.meta?.artist ?? ''}
              </Text>
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
                fontSize={26}
                isLineByLine={false}
                enableSeekOnTap={true}
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
            <View style={[styles.lyricsToolbarAnchor, { bottom: lyricControlsBottom }]}>
              {/* Staggered toolbar items — each with its own spring animation */}
              <LyricsToolbarItem
                index={0}
                expanded={lyricsControlsExpanded}
                bgColor={motionRailBackground}
                borderColor={motionRailBorder}
              >
                <View style={styles.lyricsToolbarTimingRow}>
                  <AnimatedPressable
                    style={styles.lyricsToolbarSmallAction}
                    onPress={() => applyLyricsOffsetStep(-50)}
                    accessibilityRole="button"
                    accessibilityLabel="Retrasar letras 50 milisegundos"
                  >
                    <Text style={[styles.lyricsTimingActionText, { color: secondaryLyricsTextColor }]}>−50</Text>
                  </AnimatedPressable>
                  <AnimatedPressable
                    style={[styles.lyricsTimingReset, { backgroundColor: chromeSurfaceColor }]}
                    onPress={() => setLyricsTimingOffsetMs(0)}
                    pressedScale={0.95}
                  >
                    <Text style={[styles.lyricsTimingValue, { color: protectedAccentColor }]}>
                      {lyricsTimingOffsetMs > 0 ? `+${lyricsTimingOffsetMs}` : lyricsTimingOffsetMs}ms
                    </Text>
                  </AnimatedPressable>
                  <AnimatedPressable
                    style={styles.lyricsToolbarSmallAction}
                    onPress={() => applyLyricsOffsetStep(50)}
                    accessibilityRole="button"
                    accessibilityLabel="Adelantar letras 50 milisegundos"
                  >
                    <Text style={[styles.lyricsTimingActionText, { color: secondaryLyricsTextColor }]}>+50</Text>
                  </AnimatedPressable>
                </View>
              </LyricsToolbarItem>

              {hasMultipleSyncedLyricsOptions ? (
                <LyricsToolbarItem
                  index={1}
                  expanded={lyricsControlsExpanded}
                  bgColor={motionRailBackground}
                  borderColor={motionRailBorder}
                >
                  <AnimatedPressable
                    onPress={handleCycleSyncedLyricsOption}
                    style={styles.lyricsToolbarVariantRow}
                    pressedScale={0.96}
                  >
                    <MaterialCommunityIcons name="format-list-numbered" size={17} color={protectedAccentColor} />
                    <Text style={[styles.lyricsVariantSwitcherText, { color: secondaryLyricsTextColor }]}>
                      {selectedTrackLyricsOptionIndex + 1}/{trackLyricsOptions.length}
                    </Text>
                  </AnimatedPressable>
                </LyricsToolbarItem>
              ) : null}

              <LyricsToolbarItem
                index={hasMultipleSyncedLyricsOptions ? 2 : 1}
                expanded={lyricsControlsExpanded}
                bgColor={motionRailBackground}
                borderColor={motionRailBorder}
              >
                <View style={styles.lyricsToolbarMotionColumn}>
                  {LYRICS_MOTION_OPTIONS.map(option => {
                    const selected = option.id === selectedMotionOptionId;
                    return (
                      <AnimatedPressable
                        key={option.id}
                        onPress={() => setSelectedMotionOptionId(option.id)}
                        style={styles.lyricsThemeOptionButton}
                        active={selected}
                        activeColor={protectedAccentColor}
                        accessibilityRole="button"
                        accessibilityLabel={`Estilo de animación ${option.id}`}
                        accessibilityState={{ selected }}
                      >
                        <MaterialCommunityIcons
                          name={option.icon as any}
                          size={18}
                          color={selected ? protectedAccentColor : inactiveMotionIconColor}
                        />
                      </AnimatedPressable>
                    );
                  })}
                </View>
              </LyricsToolbarItem>

              {/* Always-visible toggle button */}
              <AnimatedPressable
                onPress={() => setLyricsControlsExpanded(prev => !prev)}
                style={[styles.lyricsToolbarToggle, { backgroundColor: motionRailBackground, borderColor: motionRailBorder }]}
                active={lyricsControlsExpanded}
                activeColor={protectedAccentColor}
                accessibilityRole="button"
                accessibilityLabel="Controles de letras"
                accessibilityState={{ expanded: lyricsControlsExpanded }}
              >
                <MaterialCommunityIcons
                  name={lyricsControlsExpanded ? 'close' : (activeMotionOption?.icon ?? LYRICS_MOTION_OPTIONS[0]?.icon) as any}
                  size={22}
                  color={protectedAccentColor}
                />
              </AnimatedPressable>
            </View>

            {hasMultipleSyncedLyricsOptions && activeSyncedLyricsOption ? (
              <View style={[styles.lyricsVariantCaption, { bottom: lyricControlsBottom + 68 }]}>
                <Text numberOfLines={1} style={[styles.lyricsVariantCaptionText, { color: secondaryLyricsTextColor }]}>
                  {activeSyncedLyricsOption.label}
                </Text>
              </View>
            ) : null}


            {currentTrack?.duration ? (
              <View style={[styles.lyricsProgressTrackWrap, { bottom: lyricProgressBottom }]}>
                <ProgressSlider
                  duration={currentTrack.duration}
                  onSeek={seek}
                  showTime={true}
                  activeColor={protectedAccentColor}
                  inactiveColor={withAlpha(secondaryLyricsTextColor, 0.22)}
                  textColor={secondaryLyricsTextColor}
                />
              </View>
            ) : null}

            <View
              style={[
                styles.lyricsBottomPlayer,
                { bottom: playerBottom },
              ]}
            >
              <AnimatedPressable
                onPress={onToggleShuffle}
                style={styles.lyricsTransportButton}
                pressedScale={0.9}
                active={shuffleEnabled}
                activeColor={protectedAccentColor}
                accessibilityRole="button"
                accessibilityLabel="Aleatorio"
                accessibilityState={{ selected: shuffleEnabled }}
              >
                <MaterialCommunityIcons name="shuffle" size={27} color={shuffleEnabled ? protectedAccentColor : secondaryLyricsTextColor} />
              </AnimatedPressable>
              <AnimatedPressable onPress={onPrevious} style={styles.lyricsTransportButton} pressedScale={0.88} accessibilityRole="button" accessibilityLabel="Anterior">
                <MaterialCommunityIcons name="skip-previous" size={34} color={lyricsTextColor} />
              </AnimatedPressable>
              <LyricsPlayButton
                isPlaying={isPlaying}
                accent={protectedAccentColor}
                onPrimaryColor={onPrimaryColor}
                onPress={onPlayPause}
              />
              <AnimatedPressable onPress={onNext} style={styles.lyricsTransportButton} pressedScale={0.88} accessibilityRole="button" accessibilityLabel="Siguiente">
                <MaterialCommunityIcons name="skip-next" size={34} color={lyricsTextColor} />
              </AnimatedPressable>
              <AnimatedPressable
                onPress={onCycleRepeatMode}
                style={styles.lyricsTransportButton}
                pressedScale={0.9}
                active={repeatMode !== 'off'}
                activeColor={protectedAccentColor}
                accessibilityRole="button"
                accessibilityLabel="Repetir"
                accessibilityState={{ selected: repeatMode !== 'off' }}
              >
                <MaterialCommunityIcons name={repeatIconName as any} size={27} color={repeatMode !== 'off' ? protectedAccentColor : secondaryLyricsTextColor} />
              </AnimatedPressable>
            </View>
          </Animated.View>
        ) : (
          <>
            <View style={styles.lyricsFallbackState}>
              {isLyricsLoading ? (
                <LyricsSkeleton isDownloading={false} />
              ) : !hasResolvedLyricsAttempt ? null : (
                <View style={{ alignItems: 'center', width: '100%' }}>
                  <Text style={[styles.lyricsFallbackTitle, { color: lyricsTextColor }]}>No se encontraron letras</Text>
                </View>
              )}
            </View>

            {currentTrack?.duration ? (
              <View style={[styles.lyricsProgressTrackWrap, { bottom: lyricProgressBottom }]}>
                <ProgressSlider
                  duration={currentTrack.duration}
                  onSeek={seek}
                  showTime={true}
                  activeColor={protectedAccentColor}
                  inactiveColor={withAlpha(secondaryLyricsTextColor, 0.22)}
                  textColor={secondaryLyricsTextColor}
                />
              </View>
            ) : null}

            <View
              style={[
                styles.lyricsBottomPlayer,
                { bottom: playerBottom },
              ]}
            >
              <AnimatedPressable
                onPress={onToggleShuffle}
                style={styles.lyricsTransportButton}
                pressedScale={0.9}
                active={shuffleEnabled}
                activeColor={protectedAccentColor}
                accessibilityRole="button"
                accessibilityLabel="Aleatorio"
                accessibilityState={{ selected: shuffleEnabled }}
              >
                <MaterialCommunityIcons name="shuffle" size={27} color={shuffleEnabled ? protectedAccentColor : secondaryLyricsTextColor} />
              </AnimatedPressable>
              <AnimatedPressable onPress={onPrevious} style={styles.lyricsTransportButton} pressedScale={0.88} accessibilityRole="button" accessibilityLabel="Anterior">
                <MaterialCommunityIcons name="skip-previous" size={34} color={lyricsTextColor} />
              </AnimatedPressable>
              <LyricsPlayButton
                isPlaying={isPlaying}
                accent={protectedAccentColor}
                onPrimaryColor={onPrimaryColor}
                onPress={onPlayPause}
              />
              <AnimatedPressable onPress={onNext} style={styles.lyricsTransportButton} pressedScale={0.88} accessibilityRole="button" accessibilityLabel="Siguiente">
                <MaterialCommunityIcons name="skip-next" size={34} color={lyricsTextColor} />
              </AnimatedPressable>
              <AnimatedPressable
                onPress={onCycleRepeatMode}
                style={styles.lyricsTransportButton}
                pressedScale={0.9}
                active={repeatMode !== 'off'}
                activeColor={protectedAccentColor}
                accessibilityRole="button"
                accessibilityLabel="Repetir"
                accessibilityState={{ selected: repeatMode !== 'off' }}
              >
                <MaterialCommunityIcons name={repeatIconName as any} size={27} color={repeatMode !== 'off' ? protectedAccentColor : secondaryLyricsTextColor} />
              </AnimatedPressable>
            </View>
          </>
        )}

        <LyricsSuggestionModal
          visible={isLyricsSuggestionModalVisible}
          options={suggestedLyricsOptions}
          requestedTitle={currentTrack?.title ?? ''}
          requestedArtist={currentTrack?.artist ?? ''}
          requestedDurationSec={currentTrack?.duration ? currentTrack.duration / 1000 : undefined}
          accentColor={protectedAccentColor}
          onSelect={handleSelectSuggestedLyrics}
          onClose={dismissLyricsSuggestionModal}
        />
      </View>
    </Animated.View>
  );
});
