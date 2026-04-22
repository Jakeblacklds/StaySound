import { usePlayerColors, LYRICS_BACKDROP_BLUR_RADIUS, LYRICS_BACKDROP_SCALE } from '@/src/hooks/usePlayerColors';
import { usePlayerLyrics } from '@/src/hooks/usePlayerLyrics';
import { usePerformanceProfile, useTheme } from '@/src/theme';
import type { Track } from '@/src/types/audio';
import { KaraokeLyricsJSON } from '@/src/types/karaokeTypes';
import { mixHexColors, withAlpha } from '@/src/utils/colorContrast';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { KaraokeView } from 'karaoke-view';
import React, { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, View, processColor } from 'react-native';
import { Button, IconButton, Text } from 'react-native-paper';
import Animated, { Easing, Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LYRICS_MOTION_OPTIONS } from '../lyricsMotionProfiles';
import { playerStyles as styles } from '../playerStyles';
import { ThemeBackground } from '../backgrounds/ThemeBackground';
import { LyricsSkeleton } from '../../ui';

const LYRICS_KEEP_AWAKE_TAG = 'StaySoundLyricsView';

/**
 * Drift keyframes for the blurred artwork backdrop.
 * Identical to `artworkDrift` in ThemeBackground so both backgrounds
 * move in the same cinematic style.  Defined at module scope → created once.
 */
const lyricsArtworkDrift = {
    '0%':   { transform: [{ scale: 1.0 }, { translateX: 0 },   { translateY: 0 }] },
    '25%':  { transform: [{ scale: 1.04 }, { translateX: 14 },  { translateY: -10 }] },
    '50%':  { transform: [{ scale: 1.02 }, { translateX: 0 },   { translateY: -20 }] },
    '75%':  { transform: [{ scale: 1.06 }, { translateX: -14 }, { translateY: -10 }] },
    '100%': { transform: [{ scale: 1.0 }, { translateX: 0 },   { translateY: 0 }] },
};

type PhraseLyricLine = {
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
  animStyle: any;
  onClose: () => void;
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

function buildPhraseLyricsLines(lyricsJson: KaraokeLyricsJSON | null): PhraseLyricLine[] {
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

function getActivePhraseLineIndex(lines: PhraseLyricLine[], currentTimeMs: number) {
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

type PhraseLyricsViewProps = {
  lyrics: KaraokeLyricsJSON;
  currentTimeMs: number;
  activeColor: string;
  inactiveColor: string;
  secondaryTextColor: string;
  onSeek: (timeMs: number) => void;
};

const PhraseLyricsView = React.memo(function PhraseLyricsView({
  lyrics,
  currentTimeMs,
  activeColor,
  inactiveColor,
  secondaryTextColor,
  onSeek,
}: PhraseLyricsViewProps) {
  const scrollRef = React.useRef<ScrollView | null>(null);
  const lineLayoutsRef = React.useRef<Record<number, { y: number; height: number }>>({});
  const [containerHeight, setContainerHeight] = React.useState(0);

  const lines = React.useMemo(() => buildPhraseLyricsLines(lyrics), [lyrics]);
  const activeLineIndex = React.useMemo(
    () => getActivePhraseLineIndex(lines, currentTimeMs),
    [currentTimeMs, lines]
  );

  React.useEffect(() => {
    const activeLayout = lineLayoutsRef.current[activeLineIndex];
    if (!activeLayout || !scrollRef.current || containerHeight <= 0) return;

    const targetY = Math.max(0, activeLayout.y - containerHeight * 0.28 + activeLayout.height * 0.15);
    scrollRef.current.scrollTo({ y: targetY, animated: true });
  }, [activeLineIndex, containerHeight]);

  return (
    <View style={styles.phraseLyricsRoot} onLayout={event => setContainerHeight(event.nativeEvent.layout.height)}>
      <ScrollView
        ref={scrollRef}
        style={styles.phraseLyricsScroll}
        contentContainerStyle={styles.phraseLyricsContent}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
      >
        {lines.map((line, index) => {
          const distance = activeLineIndex < 0 ? index : Math.abs(index - activeLineIndex);
          const isActive = index === activeLineIndex;
          const isPast = activeLineIndex >= 0 && index < activeLineIndex;
          const lineColor = isActive ? activeColor : isPast ? secondaryTextColor : inactiveColor;

          return (
            <Pressable
              key={line.id}
              onPress={() => onSeek(line.startMs)}
              onLayout={event => {
                lineLayoutsRef.current[index] = event.nativeEvent.layout;
              }}
              style={styles.phraseLinePressable}
            >
              <Text
                style={[
                  styles.phraseLineText,
                  {
                    color: lineColor,
                    opacity: isActive ? 1 : Math.max(0.36, 0.8 - distance * 0.14),
                  },
                ]}
              >
                {line.text}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
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
  animStyle,
  onClose,
  seek,
}: PlayerLyricsLayerProps) {
  const { isDark, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const performanceProfile = usePerformanceProfile();

  const {
    lyricsMode,
    setLyricsMode,
    trackLyricsOptions,
    selectedTrackLyrics,
    selectedTrackLyricsOptionIndex,
    lrcLyrics,
    isLyricsLoading,
    isDownloadingLrc,
    lrcError,
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
    hasLrcLyrics,
    hasMultipleSyncedLyricsOptions,
    activeSyncedLyricsOption,
    shouldShowDownloadLrc,
    displayLyrics,
    handleDownloadLrc,
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
    modeSwitcherBackground,
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

  React.useEffect(() => {
    if (lyricsMode === 'synced' && !hasSyncedLyrics && hasLrcLyrics) {
      setLyricsMode('lrc');
      return;
    }

    if (lyricsMode === 'lrc' && !hasLrcLyrics && hasSyncedLyrics) {
      setLyricsMode('synced');
    }
  }, [hasLrcLyrics, hasSyncedLyrics, lyricsMode, setLyricsMode]);

  if (!expanded) {
    return null;
  }

  const lyricsBackdropUri = currentTrack?.artwork || currentTrack?.artworkThumb;
  const shouldShowOverlaySkeleton =
    isLyricsLoading &&
    !hasResolvedLyricsAttempt &&
    !hasSyncedLyrics;

  // Same drift keyframes as ThemeBackground — artwork floats slowly behind the blur.
  // Declared inline here so they live with their consumer and are created once per module load.

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 10020 }, animStyle]} pointerEvents="box-none">
      <View style={StyleSheet.absoluteFill}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: lyricsBaseSurface }]} />
        <ThemeBackground colors={colors} animColors={animColors} isVisible={visible} />
        {lyricsBackdropUri ? (
          <View style={StyleSheet.absoluteFill}>
            {/* Blurred artwork wrapper — drifts slowly just like the FullPlayer background */}
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                {
                  animationName: performanceProfile.enableAnimatedBackgrounds ? lyricsArtworkDrift : undefined,
                  animationDuration: '24000ms',
                  animationTimingFunction: 'ease-in-out',
                  animationIterationCount: 'infinite',
                  animationDirection: 'alternate',
                  animationFillMode: 'both',
                  animationPlayState: visible ? 'running' : 'paused',
                },
              ]}
            >
              <Image
                source={{ uri: lyricsBackdropUri }}
                style={[
                  StyleSheet.absoluteFill,
                  {
                    transform: [{ scale: LYRICS_BACKDROP_SCALE }],
                    opacity: colors.isDark ? 0.4 : 0.28,
                  },
                ]}
                blurRadius={LYRICS_BACKDROP_BLUR_RADIUS}
                contentFit="cover"
                transition={0}
                cachePolicy={performanceProfile.imageCachePolicyOverlay}
              />
            </Animated.View>
            <BlurView
              intensity={colors.isDark ? 90 : 110}
              tint={colors.isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: withAlpha(lyricsBaseSurface, colors.isDark ? 0.58 : 0.38),
                },
              ]}
            />
          </View>
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: lyricsBaseSurface }]} />
        )}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: withAlpha(mixHexColors(colors.primary, lyricsBaseSurface, 0.7), colors.isDark ? 0.18 : 0.08),
            },
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: withAlpha('#000000', colors.isDark ? 0.24 : 0.08),
            },
          ]}
        />

        <View style={styles.fullScreenLyricsHeader}>
          <IconButton icon="close-circle" size={36} iconColor={lyricsTextColor} onPress={onClose} />
          <View style={styles.lyricsModeContainer}>
            {hasSyncedLyrics && lrcLyrics && (
              <View style={[styles.lyricsModeSwitcher, { backgroundColor: modeSwitcherBackground }]}>
                <Pressable
                  onPress={() => setLyricsMode('synced')}
                  style={[
                    styles.modeTab,
                    lyricsMode === 'synced' && styles.modeTabActive,
                    lyricsMode === 'synced' && { backgroundColor: modeTabActiveBackground },
                  ]}
                >
                  <Text style={[styles.modeTabText, { color: lyricsMode === 'synced' ? protectedAccentColor : secondaryLyricsTextColor }]}>SINCRONIZADAS</Text>
                </Pressable>
                <Pressable
                  onPress={() => setLyricsMode('lrc')}
                  style={[
                    styles.modeTab,
                    lyricsMode === 'lrc' && styles.modeTabActive,
                    lyricsMode === 'lrc' && { backgroundColor: modeTabActiveBackground },
                  ]}
                >
                  <Text style={[styles.modeTabText, { color: lyricsMode === 'lrc' ? protectedAccentColor : secondaryLyricsTextColor }]}>LRC</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>

        {displayLyrics ? (
          <Animated.View style={[{ flex: 1 }, lyricsTransitionStyle]}>
            {lyricsMode === 'lrc' ? (
              <PhraseLyricsView
                lyrics={displayLyrics}
                currentTimeMs={Math.max(0, nativePositionMs + lyricsTimingOffsetMs)}
                activeColor={lyricsHighlightColor}
                inactiveColor={protectedInactiveColor}
                secondaryTextColor={secondaryLyricsTextColor}
                onSeek={timeMs => seek(timeMs)}
              />
            ) : (
              <KaraokeView
                style={{ flex: 1 }}
                lyrics={displayLyrics.lyrics}
                currentTimeMs={Math.max(0, nativePositionMs + lyricsTimingOffsetMs)}
                isPlaying={isPlaying}
                fontSize={29}
                isLineByLine={false}
                enableSeekOnTap={false}
                activeColor={processColor(lyricsHighlightColor)}
                inactiveColor={processColor(protectedInactiveColor)}
                glowColor={processColor(protectedGlowColor)}
                backgroundColor={processColor(lyricsBaseSurface)}
                enableAmbientBackground={false}
                enableSpectralParticles={colors.isDark}
                motionProfile={appliedMotionProfile}
                introTitle={currentTrack?.title ?? displayLyrics?.meta?.song}
                introSubtitle={currentTrack?.artist ?? displayLyrics?.meta?.artist}
                onSeek={({ nativeEvent }) => seek(nativeEvent.timeMs)}
              />
            )}
            {/* Skeleton overlay: covers stale lyrics from previous track while the new track loads */}
            {shouldShowOverlaySkeleton && (
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <LyricsSkeleton isDownloading={false} />
              </View>
            )}
            <View style={[styles.lyricsIslandsLayer, { bottom: Math.max(insets.bottom + 10, 16) }]}>
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

              {hasMultipleSyncedLyricsOptions && lyricsMode === 'synced' ? (
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

            {hasMultipleSyncedLyricsOptions && lyricsMode === 'synced' && activeSyncedLyricsOption ? (
              <View style={[styles.lyricsVariantCaption, { bottom: Math.max(insets.bottom + 82, 88) }]}>
                <Text numberOfLines={1} style={[styles.lyricsVariantCaptionText, { color: secondaryLyricsTextColor }]}>
                  {activeSyncedLyricsOption.label}
                </Text>
              </View>
            ) : null}
          </Animated.View>
        ) : (
          <View style={styles.lyricsFallbackState}>
            {(isLyricsLoading || isDownloadingLrc) ? (
              <LyricsSkeleton isDownloading={isDownloadingLrc} />
            ) : (
              <View style={{ alignItems: 'center', width: '100%' }}>
                <Text style={[styles.lyricsFallbackTitle, { color: lyricsTextColor }]}>No se encontraron letras</Text>
                {shouldShowDownloadLrc && (
                  <Button
                    mode="contained"
                    onPress={handleDownloadLrc}
                    icon="cloud-download"
                    style={[styles.downloadBtn, { backgroundColor: lrcError ? '#CC4444' : protectedAccentColor }]}
                  >
                    {lrcError ? 'Reintentar' : 'Descargar Letras'}
                  </Button>
                )}
                {lrcError && (
                  <Text style={[styles.lyricsFallbackSubtitle, { color: secondaryLyricsTextColor }]}>{lrcError}</Text>
                )}
              </View>
            )}
          </View>
        )}
      </View>
    </Animated.View>
  );
});
