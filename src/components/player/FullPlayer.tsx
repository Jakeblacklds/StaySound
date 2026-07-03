/**
 * FullPlayer - Material 3 Expressive Container Transform Player
 *
 * Optimized & Scalable Version
 */

import { useDynamicColorsWithOptions, usePlayerColors } from "@/src/hooks";
import { usePlayerLyrics } from "@/src/hooks/usePlayerLyrics";
import { searchTidalArtists } from "@/src/services/tidalService";
import { useLibraryStore, usePlayerStore } from "@/src/stores";
import {
  useAnimatedColors,
  usePerformanceProfile,
  useTheme,
} from "@/src/theme";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { usePathname, useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
  BackHandler,
  Dimensions,
  processColor,
  Share,
  StyleSheet,
  View,
} from "react-native";
import { KaraokeSpectrumView, KaraokeRefractionView } from "karaoke-view";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { pickReadableColor, withAlpha } from "@/src/utils/colorContrast";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconName } from "../ui";
import { ThemeBackground } from "./backgrounds/ThemeBackground";
import { PsychedelicBackground } from "./backgrounds/PsychedelicBackground";
import {
  buildPhraseLyricsLines,
  getActivePhraseLineIndex,
  PlayerLyricsLayer,
} from "./parts/PlayerLyricsLayer";
import { PlayerQueueOverlayLayer } from "./parts/PlayerQueueOverlayLayer";
import { PlayerOptionsModal, PlayerOptionAction } from "./parts/PlayerOptionsModal";
import { useSettingsStore } from "@/src/stores/settingsStore";
import { SharedPlayerShell } from "./SharedPlayerShell";
import {
  BG_CROSSFADE_END,
  BG_CROSSFADE_START,
  DETAIL_EXTRA_BOTTOM,
  DETAIL_HEIGHT,
  MINI_ARTWORK_LEFT,
  MINI_ARTWORK_SIZE,
  MINI_HEIGHT,
  TAB_BAR_HEIGHT,
  isPlayerDetailRoute,
} from "./playerLayout";
import { playerStyles as styles } from "./playerStyles";
import {
  getContrastingInk,
  getQualityBadge,
  getTrackTechLabel,
} from "./playerUtils";
import { ImmersiveVariant } from "./variants/ImmersiveVariant";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

const CD_SPIN_DEGREES_PER_MS = 360 / 60000;
const M3_EMPHASIZED = Easing.bezier(0.2, 0.0, 0, 1.0);
const M3_EMPHASIZED_ACCEL = Easing.bezier(0.3, 0.0, 0.8, 0.15);

const M3_SNAP_SPRING = {
  damping: 26,
  stiffness: 340,
  mass: 0.5,
  restDisplacementThreshold: 0.01,
  restSpeedThreshold: 2,
};

const EXPAND_DURATION = 280;
const COLLAPSE_DURATION = 320;
// Above this expansion the player is no longer "mini" — drop the costly live
// blur and use an opaque album surface instead.
const BLUR_COLLAPSE_THRESHOLD = 0.12;
// How long to freeze the live blur (show opaque) after a route change so it
// doesn't render a stale, still-scrolling snapshot of the previous screen.
const NAV_FREEZE_MS = 320;

function normalizeArtistSearchValue(value?: string | null) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function FullPlayer() {
  const { theme, config, isDark } = useTheme();
  const performanceProfile = usePerformanceProfile();
  const themeAnimatedColors = useAnimatedColors();
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isVisible = usePlayerStore((state) => state.playerVisible);
  const setPlayerVisible = usePlayerStore((state) => state.setPlayerVisible);
  const setExpansion = usePlayerStore((state) => state.setExpansion);
  const artistNavigationInFlightRef = useRef(false);
  const lastArtistRouteRef = useRef<string | null>(null);

  const playerVariant = usePlayerStore((state) => state.playerVariant);
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const isLoading = usePlayerStore((state) => state.isLoading);
  const pendingTrackPreview = usePlayerStore(
    (state) => state.pendingTrackPreview,
  );
  const shuffleEnabled = usePlayerStore((state) => state.shuffleEnabled);
  const repeatMode = usePlayerStore((state) => state.repeatMode);
  const [showOptions, setShowOptions] = useState(false);

  // Track-switching & seek debounce: prevents icon flicker during track changes or seeking.
  // When the track ID changes we hold isPlayingVisual=true for 800ms.
  // We also hold it true if isLoading=true (e.g. buffering after a seek).
  const [isTrackSwitching, setIsTrackSwitching] = useState(false);
  const lastTrackIdRef = useRef<string | null>(null);
  const isPlayingVisual = isPlaying || isTrackSwitching || isLoading;

  React.useEffect(() => {
    const newId = currentTrack?.id ?? null;
    if (newId && newId !== lastTrackIdRef.current) {
      lastTrackIdRef.current = newId;
      setIsTrackSwitching(true);
      const timer = setTimeout(() => setIsTrackSwitching(false), 800);
      return () => clearTimeout(timer);
    }
  }, [currentTrack?.id]);

  // Animated glow progress (0 = paused, 1 = playing) — drives the cover's
  // play/pause breathing scale.
  const playGlowProgress = useSharedValue(0);
  React.useEffect(() => {
    playGlowProgress.value = withSpring(isPlayingVisual ? 1 : 0, {
      damping: 18,
      stiffness: 150,
      mass: 0.7,
    });
  }, [isPlayingVisual]);

  // Actions
  const togglePlayPause = usePlayerStore((state) => state.togglePlayPause);
  const next = usePlayerStore((state) => state.next);
  const previous = usePlayerStore((state) => state.previous);
  const seek = usePlayerStore((state) => state.seek);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const cycleRepeatMode = usePlayerStore((state) => state.cycleRepeatMode);

  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const currentTrackId = currentTrack?.id ?? null;
  const isFavorite = useLibraryStore((state) =>
    currentTrackId ? !!state.tracks.get(currentTrackId)?.favorite : false,
  );

  const activeVariant =
    (theme.components?.player?.variant as any) || playerVariant;
  const lightweightMode = config.lightweightMode;
  const shouldResolveDynamicColors = isVisible;
  const playerArtworkUri = currentTrack?.artwork || currentTrack?.artworkThumb;
  const { colors: albumColors, animated: animColors } =
    useDynamicColorsWithOptions(playerArtworkUri, {
      enabled:
        shouldResolveDynamicColors && performanceProfile.enableDynamicColors,
    });
  const shouldUseThemePlayerColors = !performanceProfile.enableDynamicColors;
  const playerColors = shouldUseThemePlayerColors
    ? {
        primary: theme.colors.primary,
        secondary: theme.colors.secondary,
        background: theme.colors.background,
        text: theme.colors.onSurface,
        onPrimary: theme.colors.onPrimary,
        onSurface: theme.colors.onSurface,
        accent: theme.colors.primary,
        isDark,
      }
    : albumColors;
  const playerAnimColors = shouldUseThemePlayerColors
    ? {
        primary: themeAnimatedColors.primary,
        secondary: themeAnimatedColors.surfaceVariant,
        background: themeAnimatedColors.background,
        accent: themeAnimatedColors.primary,
        text: themeAnimatedColors.onSurface,
      }
    : animColors;
  const textColor = playerColors.text;
  const accentColor = playerColors.primary;
  const onPrimaryColor = pickReadableColor(accentColor, [
    playerColors.onPrimary,
    theme.colors.onPrimary,
    "#05070D",
    "#FFFFFF",
  ]);
  const shouldShowTidalLoading =
    Boolean(pendingTrackPreview) ||
    (isLoading &&
      (currentTrack?.source === "tidal" ||
        currentTrack?.source === "tidal_stream"));
  const {
    playerSurfaceColor,
    protectedSpectrumGlowColor,
    chromeBorderColor,
    chromeSurfaceColor,
    chromeSurfaceStrongColor,
    accentBorderColor,
  } = usePlayerColors({
    themeBackground: theme.colors.background,
    themePrimary: theme.colors.primary,
    isDark,
    shouldUseThemePlayerColors,
    playerColors,
    accentColor,
    textColor,
  });

  const playerIcons = theme.components?.player?.icons;
  const playIcon: IconName = "Play";
  const pauseIcon: IconName = "Pause";
  const nextIcon: IconName = "Next";
  const previousIcon: IconName = "Previous";
  const shuffleIcon: IconName = "Shuffle";
  const repeatIcon: IconName = repeatMode === "one" ? "Repetir 1" : "Repetir 0";

  const [showLyrics, setShowLyrics] = useState(false);
  const [lyricsRefreshNonce, setLyricsRefreshNonce] = useState(0);

  // Queue state
  const [showQueue, setShowQueue] = useState(false);
  const [queueVisible, setQueueVisible] = useState(false);
  const queueAnimation = useSharedValue(0);

  const isDetailRoute = isPlayerDetailRoute(pathname);

  const miniCollapsedBottom =
    (config.style === "material3" ? TAB_BAR_HEIGHT : 85) + insets.bottom;

  const miniLeft = 0;
  const miniBottom = isDetailRoute
    ? Math.max(insets.bottom + DETAIL_EXTRA_BOTTOM, DETAIL_EXTRA_BOTTOM)
    : miniCollapsedBottom;
  const miniHeight = isDetailRoute ? DETAIL_HEIGHT : MINI_HEIGHT;
  const miniWidth = SCREEN_WIDTH - miniLeft * 2;
  const miniRadius = 22;

  // Expansion & Breathing
  const expansion = useSharedValue(0);
  const lyricsExpansion = useSharedValue(0);
  const trackChangeScale = useSharedValue(1);
  const cdSpin = useSharedValue(0);
  const [animationsActive, setAnimationsActive] = useState(false);

  // ---- Simulated frost (perf) ------------------------------------------
  // The collapsed mini + the navbar used to each run a live (dimezis) blur.
  // Two stacked live blurs were the source of the jank (even on an S25 Ultra)
  // and of the seam between them — each BlurView only blurs within its own
  // bounds, so the edges never matched. We now fake the frost with an
  // album-tinted near-opaque surface + a static glass-sheen gradient: free to
  // render and, since both surfaces share the same tint, perfectly seamless.
  // `forceSolid` still pushes the surface fully opaque briefly on route
  // changes so it never flashes the incoming screen's content.
  const forceSolid = useSharedValue(0);

  React.useEffect(() => {
    forceSolid.value = 1;
    const t = setTimeout(() => {
      forceSolid.value = withTiming(0, { duration: 160 });
    }, NAV_FREEZE_MS);
    return () => clearTimeout(t);
  }, [pathname]);
  const [isLyricsExpanded, setIsLyricsExpanded] = useState(false);
  const lrcPreviewState = usePlayerLyrics({
    visible: isVisible && !isLyricsExpanded,
    currentTrack,
  });
  const playerLineLyrics =
    lrcPreviewState.lrcLyrics ?? lrcPreviewState.selectedTrackLyrics;
  const lrcPreviewLines = React.useMemo(
    () => buildPhraseLyricsLines(playerLineLyrics),
    [playerLineLyrics],
  );
  const lrcPreviewTimeMs = Math.max(
    0,
    lrcPreviewState.nativePositionMs + lrcPreviewState.lyricsTimingOffsetMs,
  );
  const lrcPreviewLineIndex = React.useMemo(
    () => getActivePhraseLineIndex(lrcPreviewLines, lrcPreviewTimeMs),
    [lrcPreviewLines, lrcPreviewTimeMs],
  );
  const activeLrcLine =
    lrcPreviewLineIndex >= 0 ? lrcPreviewLines[lrcPreviewLineIndex] : null;
  const lrcPreviewText =
    activeLrcLine?.text ??
    (!lrcPreviewState.hasResolvedLyricsAttempt ||
    lrcPreviewState.isLyricsLoading ||
    lrcPreviewState.isDownloadingLrc
      ? "..."
      : "");

  const toggleLyricsFull = (val: boolean) => {
    setIsLyricsExpanded(val);
    lyricsExpansion.value = val
      ? withSpring(1, { damping: 18, stiffness: 120, mass: 1 })
      : withTiming(0, {
          duration: lightweightMode ? 160 : 200,
          easing: M3_EMPHASIZED_ACCEL,
        });
  };

  React.useEffect(() => {
    if (showLyrics) toggleLyricsFull(true);
    else toggleLyricsFull(false);
  }, [showLyrics]);

  React.useEffect(() => {
    // On track change: do NOT close the lyrics — let the crossfade handle the transition.
    // Only reset the artwork scale animation.
    trackChangeScale.value = isVisible ? 0.94 : 1;
    cdSpin.value = 0;
    if (isVisible && !lightweightMode) {
      trackChangeScale.value = withSpring(1, {
        damping: 12,
        stiffness: 100,
        mass: 0.5,
      });
    }
  }, [cdSpin, currentTrack?.id, lightweightMode]);

  useFrameCallback((frameInfo) => {
    if (!isVisible || !isPlayingVisual || lightweightMode) return;
    const deltaMs = frameInfo.timeSincePreviousFrame ?? 16.67;
    cdSpin.value = (cdSpin.value + deltaMs * CD_SPIN_DEGREES_PER_MS) % 360;
  }, true);

  React.useEffect(() => {
    if (!currentTrack?.id) {
      trackChangeScale.value = 1;
      return;
    }

    if (isVisible && !lightweightMode) {
      trackChangeScale.value = 0.94;
      trackChangeScale.value = withSpring(1, {
        damping: 12,
        stiffness: 100,
        mass: 0.5,
      });
    } else {
      trackChangeScale.value = 1;
    }
  }, [isVisible, currentTrack?.id, lightweightMode]);

  React.useEffect(() => {
    if (!isVisible) {
      setShowQueue(false);
      setQueueVisible(false);
      queueAnimation.value = 0;
    }
  }, [isVisible]);

  const handleOpenQueue = useCallback(() => {
    if (!showLyrics) {
      setQueueVisible(true);
      setShowQueue(true);
      requestAnimationFrame(() => {
        queueAnimation.value = lightweightMode
          ? withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) })
          : withSpring(1, { damping: 22, stiffness: 200, mass: 0.6 });
      });
    }
  }, [lightweightMode, showLyrics]);

  const handleAlbumPress = useCallback(async () => {
    const albumName = currentTrack?.album?.trim();
    const albumId = currentTrack?.albumId?.trim();
    if (!albumName || !albumId) return;

    setPlayerVisible(false);
    router.navigate({
      pathname: "/tidal-album/[id]",
      params: { id: albumId, name: albumName },
    });
  }, [currentTrack?.album, currentTrack?.albumId, router, setPlayerVisible]);

  const handleShareSong = useCallback(async () => {
    if (!currentTrack) return;
    try {
      await Share.share({
        message: `Check out ${currentTrack.title} by ${currentTrack.artist} on StaySound!`,
        title: "StaySound Shared Track",
      });
    } catch (error) {
      console.error("[FullPlayer] Error sharing:", error);
    }
  }, [currentTrack]);

  const handleOpenMoreOptions = useCallback(() => {
    if (!currentTrack) return;
    setShowOptions(true);
  }, [currentTrack]);

  const handleCloseOptions = useCallback(() => {
    setShowOptions(false);
  }, []);

  const handleResearchLyrics = useCallback(() => {
    setShowOptions(false);
    setLyricsRefreshNonce(prev => prev + 1);
  }, []);

  const handleArtistPress = useCallback(async () => {
    const artistName = currentTrack?.artist?.trim();
    if (!artistName || artistNavigationInFlightRef.current) return;

    artistNavigationInFlightRef.current = true;
    setPlayerVisible(false);

    try {
      let artistId = currentTrack?.artistId?.trim() || "";

      if (!/^\d+$/.test(artistId)) {
        const matches = await searchTidalArtists(artistName);
        const normalizedArtistName = normalizeArtistSearchValue(artistName);
        const bestMatch =
          matches.find(
            (candidate) =>
              normalizeArtistSearchValue(candidate.name) ===
              normalizedArtistName,
          ) ?? matches[0];

        artistId = bestMatch ? String(bestMatch.id) : "";
      }

      if (!artistId) return;

      const targetRoute = `/tidal-artist/${artistId}`;
      if (
        pathname === targetRoute ||
        lastArtistRouteRef.current === targetRoute
      ) {
        return;
      }

      lastArtistRouteRef.current = targetRoute;
      router.navigate({
        pathname: "/tidal-artist/[id]",
        params: { id: artistId, name: artistName },
      });
    } finally {
      setTimeout(() => {
        artistNavigationInFlightRef.current = false;
        lastArtistRouteRef.current = null;
      }, 500);
    }
  }, [
    currentTrack?.artist,
    currentTrack?.artistId,
    pathname,
    router,
    setPlayerVisible,
  ]);

  const handleCloseQueue = useCallback(() => {
    setShowQueue(false);
    queueAnimation.value = withTiming(
      0,
      { duration: 220, easing: M3_EMPHASIZED_ACCEL },
      (finished) => {
        if (finished) runOnJS(setQueueVisible)(false);
      },
    );
  }, []);

  const playerOptionsActions: PlayerOptionAction[] = React.useMemo(() => [
    ...(showLyrics ? [{
      label: "Buscar letras de nuevo",
      icon: "magnify",
      onPress: handleResearchLyrics,
    }] : []),
    {
      label: "Ir al Artista",
      icon: "account-music",
      onPress: handleArtistPress,
    },
    {
      label: "Ir al Álbum",
      icon: "album",
      onPress: handleAlbumPress,
    },
    {
      label: "Añadir a Playlist",
      icon: "playlist-plus",
      onPress: () => {
        // TODO: Implement Playlist Selector Modal
      },
    },
    {
      label: "Ecualizador",
      icon: "equalizer",
      onPress: () => {
        setPlayerVisible(false);
        // @ts-ignore
        router.push("/equalizer");
      },
    },
    {
      label: "Compartir canción",
      icon: "share-variant",
      onPress: handleShareSong,
    },
  ], [showLyrics, handleResearchLyrics, handleArtistPress, handleAlbumPress, handleShareSong, setPlayerVisible, router]);

  // Gestures
  const panGesture = Gesture.Pan()
    .enabled(isVisible && !isLyricsExpanded)
    .minDistance(10)
    .failOffsetX([-20, 20])
    .onUpdate((e) => {
      if (e.translationY > 0 && lyricsExpansion.value === 0) {
        const newVal = 1 - e.translationY / (SCREEN_HEIGHT - miniBottom);
        expansion.value = Math.max(0, Math.min(1, newVal));
      }
    })
    .onEnd((e) => {
      if (e.translationY > 180 || e.velocityY > 1200) {
        expansion.value = withTiming(0, {
          duration: COLLAPSE_DURATION,
          easing: M3_EMPHASIZED,
        });
        runOnJS(setPlayerVisible)(false);
      } else {
        expansion.value = withSpring(1, M3_SNAP_SPRING);
      }
    });

  const tapGesture = Gesture.Tap()
    .enabled(isVisible && !isLyricsExpanded)
    .onEnd(() => {
      if (showLyrics && lyricsExpansion.value === 0) {
        runOnJS(toggleLyricsFull)(true);
      }
    });

  // Animated Styles
  const rootAnimatedStyle = useAnimatedStyle(() => {
    const p = expansion.value;
    const radius = interpolate(
      p,
      [0, 0.55, 1],
      [miniRadius, isDetailRoute ? 0 : miniRadius * 0.86, 0],
      Extrapolation.CLAMP,
    );
    return {
      width: interpolate(
        p,
        [0, 1],
        [miniWidth, SCREEN_WIDTH],
        Extrapolation.CLAMP,
      ),
      height: interpolate(
        p,
        [0, 1],
        [miniHeight, SCREEN_HEIGHT],
        Extrapolation.CLAMP,
      ),
      // Reach the screen bottom early (~p=0.32) so the player's own glass
      // covers the tab-bar region quickly. This is synced with the tab bar's
      // glass fade (same 0.32 endpoint) so the dock dissolves into a single
      // continuous glass surface instead of two overlapping translucent layers.
      bottom: interpolate(
        p,
        [0, 0.32, 1],
        [miniBottom, 0, 0],
        Extrapolation.CLAMP,
      ),
      left: interpolate(p, [0, 1], [miniLeft, 0], Extrapolation.CLAMP),
      borderTopLeftRadius: radius,
      borderTopRightRadius: radius,
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
      opacity: 1,
      pointerEvents: isVisible && p > 0.18 ? "auto" : "none",
      elevation: 0,
      zIndex: 9999,
    };
  });

  // --- Expanded-player layout zones -------------------------------------
  // The cover is absolutely positioned (it morphs out of the mini player), so
  // its geometry MUST be derived from the SAME zones the ImmersiveVariant
  // reserves in flow. Otherwise, on shorter screens the flex placeholder
  // collapses, the transport rises, and the absolute cover ends up painted on
  // top of the title + favorite button. We size the cover from the real
  // vertical budget so it can never overlap the lower stack.
  const playerTopInset = Math.max(insets.top + 22, 42);
  const HEADER_ZONE = 51; // grabber (21) + whisper context label (30)
  const LOWER_STACK_ZONE = 366; // title block + lyric line + progress + transport + footer row
  const playerBottomPad = Math.max(insets.bottom + 18, 40);
  const artworkVerticalAvail =
    SCREEN_HEIGHT -
    playerTopInset -
    HEADER_ZONE -
    LOWER_STACK_ZONE -
    playerBottomPad;
  const ARTWORK_SIZE = Math.max(
    200,
    Math.min(SCREEN_WIDTH - 56, artworkVerticalAvail),
  );
  const ARTWORK_TOP = playerTopInset + HEADER_ZONE;

  // Refraction veil: the native overlay sits over the cover (a tiny margin lets the rim breathe).
  const REFRACTION_INFLATE = 1.06;
  const refractionSize = ARTWORK_SIZE * REFRACTION_INFLATE;
  const refractionLeft = SCREEN_WIDTH / 2 - refractionSize / 2;
  const refractionTop = ARTWORK_TOP + ARTWORK_SIZE / 2 - refractionSize / 2;

  // Audio-reactive atmosphere. In artwork mode the native spectrum treats the cover
  // as the light source, so the AGSL field breathes outward from the album center.
  const spectrumFocusY = Math.min(
    0.78,
    Math.max(0.24, (ARTWORK_TOP + ARTWORK_SIZE * 0.5) / SCREEN_HEIGHT),
  );
  const spectrumDelayMs = useSettingsStore((s) => s.spectrumDelayMs);
  const spectrumTheme = useSettingsStore((s) => s.spectrumTheme);
  const spectrumEnabled =
    isVisible &&
    !showLyrics &&
    !showQueue &&
    performanceProfile.enableAnimatedBackgrounds &&
    performanceProfile.mode !== "lite";
  // The "aurora" slot is now a full psychedelic album-color field (Skia), not the
  // native spectrum. The native renderer drives every OTHER theme.
  const isPsychedelicTheme = spectrumTheme === "aurora";
  const psychedelicEnabled = spectrumEnabled && isPsychedelicTheme;
  const nativeSpectrumEnabled = spectrumEnabled && !isPsychedelicTheme;
  const refractionEnabled = spectrumEnabled && spectrumTheme === "refractionVeil";

  const artworkShadowStyle = useAnimatedStyle(() => {
    const p = expansion.value;
    const artworkProgress = interpolate(
      p,
      [0, 0.22, 0.72, 1],
      [0, 0.18, 0.82, 1],
      Extrapolation.CLAMP,
    );
    const miniArtworkTop = (miniHeight - MINI_ARTWORK_SIZE) / 2;
    const targetSize = ARTWORK_SIZE;
    const targetLeft = (SCREEN_WIDTH - targetSize) / 2;
    const targetTop = ARTWORK_TOP;
    const settleScale = interpolate(
      p,
      [0, 0.9, 0.97, 1],
      [1, 1, 1.018, 1],
      Extrapolation.CLAMP,
    );
    // Apple-style: the cover shrinks while paused and blooms back when playing.
    // Only applied once expanded so the mini-player morph is untouched.
    const playScale = interpolate(playGlowProgress.value, [0, 1], [0.86, 1]);
    const expandedPlayScale = 1 + (playScale - 1) * p;
    const baseScale = p > 0.9 ? settleScale * trackChangeScale.value : settleScale;
    const scale = baseScale * expandedPlayScale;

    return {
      width: interpolate(
        artworkProgress,
        [0, 1],
        [MINI_ARTWORK_SIZE, targetSize],
        Extrapolation.CLAMP,
      ),
      height: interpolate(
        artworkProgress,
        [0, 1],
        [MINI_ARTWORK_SIZE, targetSize],
        Extrapolation.CLAMP,
      ),
      position: "absolute",
      left: interpolate(
        artworkProgress,
        [0, 1],
        [MINI_ARTWORK_LEFT, targetLeft],
        Extrapolation.CLAMP,
      ),
      top: interpolate(
        artworkProgress,
        [0, 1],
        [miniArtworkTop, targetTop],
        Extrapolation.CLAMP,
      ),
      transform: [{ scale }],
      opacity: 1,
      elevation: 0,
      shadowColor: "transparent",
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0,
      shadowRadius: 0,
    };
  });

  const artworkContainerStyle = useAnimatedStyle(() => {
    const p = expansion.value;
    const radius = interpolate(
      p,
      [0, 0.35, 1],
      [12, 20, ARTWORK_SIZE / 2],
      Extrapolation.CLAMP,
    );
    return {
      flex: 1,
      borderRadius: radius,
      overflow: "hidden",
    };
  });

  const artworkCdOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      expansion.value,
      [0, 0.55, 1],
      [0, 0, 1],
      Extrapolation.CLAMP,
    ),
  }));

  const artworkCdSpinStyle = useAnimatedStyle(() => {
    const spinVisibility = interpolate(
      expansion.value,
      [0, 0.62, 1],
      [0, 0, 1],
      Extrapolation.CLAMP,
    );
    return {
      transform: [{ rotate: `${cdSpin.value * spinVisibility}deg` }],
    };
  });

  const contentAnimatedStyle = useAnimatedStyle(() => ({
    opacity:
      interpolate(
        expansion.value,
        [BG_CROSSFADE_START, BG_CROSSFADE_END],
        [0, 1],
        Extrapolation.CLAMP,
      ) *
      (1 - lyricsExpansion.value),
    transform: [
      {
        translateY: interpolate(
          expansion.value,
          [BG_CROSSFADE_START, BG_CROSSFADE_END],
          [24, 0],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const queueOverlayAnimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      queueAnimation.value,
      [0, 0.4],
      [0, 1],
      Extrapolation.CLAMP,
    ),
    transform: [
      {
        translateY: interpolate(
          queueAnimation.value,
          [0, 1],
          [30, 0],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  // Collapsed, the surface is a simulated frosted glass shared with the tab
  // bar: an album-hued near-opaque tint (dark 0.90 / light 0.92) so mini +
  // navbar read as one continuous frosted dock. The tint ramps to fully opaque
  // late in the expansion so the full player keeps its solid background.
  const glassTintAlpha = lightweightMode ? 0.96 : (isDark ? 0.9 : 0.92);
  const glassTintStyle = useAnimatedStyle(() => {
    // Collapsed → the frost alpha. As soon as the player expands past the
    // threshold the tint ramps to fully opaque so the growing rectangle is a
    // cheap solid surface. `forceSolid` also pushes it opaque during route
    // changes.
    const ramp = interpolate(
      expansion.value,
      [0, BLUR_COLLAPSE_THRESHOLD, 1],
      [glassTintAlpha, 1, 1],
      Extrapolation.CLAMP,
    );
    return {
      backgroundColor:
        playerAnimColors?.background?.value ||
        (isDark ? playerColors.background : playerSurfaceColor) ||
        theme.colors.background,
      opacity: Math.max(ramp, forceSolid.value),
    };
  });
  const glassEdgeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(expansion.value, [0, 0.18], [1, 0], Extrapolation.CLAMP),
  }));
  const themeBackgroundFadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      expansion.value,
      [0, 0.64, 0.9, 1],
      [0, 0, isDark ? 0.68 : 0.54, 1],
      Extrapolation.CLAMP,
    ),
  }));
  const lyricsBgOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(lyricsExpansion.value, [0, 1], [0, 0.6]),
  }));
  const lyricsContentAnimStyle = useAnimatedStyle(() => ({
    opacity: lyricsExpansion.value,
    transform: [
      {
        translateY: interpolate(
          lyricsExpansion.value,
          [0, 1],
          [32, 0],
          Extrapolation.CLAMP,
        ),
      },
      {
        scale: interpolate(
          lyricsExpansion.value,
          [0, 1],
          [0.94, 1],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const textStyle = useAnimatedStyle(() => ({
    color: playerAnimColors.text.value,
  }));
  const accentTextStyle = useAnimatedStyle(() => ({
    color: playerAnimColors.primary.value,
  }));
  const accentBgStyle = useAnimatedStyle(() => ({
    backgroundColor: playerAnimColors.primary.value,
  }));
  const shouldRenderThemeBackground = !showLyrics && !queueVisible;
  // Safe animated style for mini-shell orb Ã¢â‚¬â€ avoids reading .value during JSX render

  React.useEffect(() => {
    setExpansion(expansion);
  }, []);

  React.useEffect(() => {
    if (isVisible && !queueVisible) {
      const timer = setTimeout(() => {
        setAnimationsActive(true);
      }, EXPAND_DURATION + 50);
      return () => clearTimeout(timer);
    } else {
      setAnimationsActive(false);
    }
  }, [isVisible, queueVisible]);

  React.useEffect(() => {
    if (!isVisible) return;
    const onBackPress = () => {
      if (isLyricsExpanded) {
        setShowLyrics(false);
        toggleLyricsFull(false);
        return true;
      }
      if (queueVisible) {
        handleCloseQueue();
        return true;
      }
      expansion.value = withTiming(0, {
        duration: COLLAPSE_DURATION,
        easing: M3_EMPHASIZED,
      });
      runOnJS(setPlayerVisible)(false);
      return true;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", onBackPress);
    return () => sub.remove();
  }, [isVisible, isLyricsExpanded, queueVisible]);

  React.useEffect(() => {
    expansion.value = withTiming(isVisible ? 1 : 0, {
      duration: isVisible ? EXPAND_DURATION : COLLAPSE_DURATION,
      easing: M3_EMPHASIZED,
    });
  }, [isVisible]);

  if (!currentTrack) return null;
  const track = currentTrack;
  const trackTechLabel = getTrackTechLabel(track);
  const qualityBadge = getQualityBadge(track);
  const qualityBadgeInk = getContrastingInk(qualityBadge.tone);

  const commonProps = {
    track,
    isPlaying: isPlayingVisual,
    shuffleEnabled,
    repeatMode,
    isFavorite,
    accentColor,
    textColor,
    onPrimaryColor,
    qualityBadge,
    qualityBadgeInk,
    trackTechLabel,
    shuffleIcon,
    repeatIcon,
    playIcon,
    pauseIcon,
    nextIcon,
    previousIcon,
    onClose: () => setPlayerVisible(false),
    onToggleLyrics: () => setShowLyrics(!showLyrics),
    onArtistPress: handleArtistPress,
    onOpenQueue: handleOpenQueue,
    onToggleFavorite: () => toggleFavorite(track.id),
    onToggleShuffle: toggleShuffle,
    onCycleRepeatMode: cycleRepeatMode,
    onPlayPause: togglePlayPause,
    onNext: next,
    onPrevious: previous,
    onSeek: seek,
    onOpenMoreOptions: handleOpenMoreOptions,
    textStyle,
    accentTextStyle,
    accentBgStyle,
    ARTWORK_SIZE,
    showLyrics,
    lrcPreviewText,
    isLyricsExpanded,
    lrcAccentBorderColor: accentBorderColor,
    controlSurfaceColor: chromeSurfaceColor,
    controlSurfaceStrongColor: chromeSurfaceStrongColor,
    controlBorderColor: chromeBorderColor,
    topInset: Math.max(insets.top + 22, 42),
    bottomInset: insets.bottom,
  };

  return (
    <>
      <SharedPlayerShell />
      <Animated.View style={[styles.root, rootAnimatedStyle]}>
        <GestureDetector gesture={Gesture.Exclusive(panGesture, tapGesture)}>
          <Animated.View style={styles.mainContainer}>
            {/* Album-tinted frost base (replaces the costly live blur) */}
            <Animated.View
              style={[StyleSheet.absoluteFill, glassTintStyle]}
              pointerEvents="none"
            />
            {/* Glass sheen — a static top highlight that sells the frosted look
                without any live blur. This is the TOP of the combined pane, so
                it carries the bright highlight and fades to clear by its bottom
                edge (where the navbar's frost continues). Collapsed-only. */}
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, glassEdgeStyle]}
            >
              <LinearGradient
                style={StyleSheet.absoluteFill}
                colors={
                  isDark
                    ? ["rgba(255,255,255,0.08)", "rgba(255,255,255,0)"]
                    : ["rgba(255,255,255,0.40)", "rgba(255,255,255,0)"]
                }
                locations={[0, 0.85]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
              />
            </Animated.View>
            {/* Hairline rim — top + sides only. No bottom edge, so the mini and
                the navbar read as one continuous pane with no seam line. */}
            <Animated.View
              pointerEvents="none"
              style={[
                {
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderLeftWidth: StyleSheet.hairlineWidth,
                  borderRightWidth: StyleSheet.hairlineWidth,
                  borderBottomWidth: 0,
                  borderTopLeftRadius: miniRadius,
                  borderTopRightRadius: miniRadius,
                  borderColor: chromeBorderColor,
                },
                glassEdgeStyle,
              ]}
            />
            {shouldRenderThemeBackground ? (
              <Animated.View
                style={[StyleSheet.absoluteFill, themeBackgroundFadeStyle]}
                pointerEvents="none"
              >
                <ThemeBackground
                  colors={playerColors}
                  animColors={playerAnimColors}
                  artwork={playerArtworkUri}
                  isVisible={isVisible}
                  expansion={expansion}
                  lightweight={lightweightMode}
                  isDark={isDark}
                />
              </Animated.View>
            ) : null}

            {nativeSpectrumEnabled ? (
              <Animated.View
                style={[StyleSheet.absoluteFill, themeBackgroundFadeStyle]}
                pointerEvents="none"
              >
                <KaraokeSpectrumView
                  style={StyleSheet.absoluteFill}
                  enabled={nativeSpectrumEnabled}
                  isPlaying={isPlaying}
                  anchorMode="artwork"
                  spectrumTheme={spectrumTheme}
                  focusY={spectrumFocusY}
                  artworkSize={ARTWORK_SIZE}
                  particleIntensity={0.62}
                  renderDelayMs={spectrumDelayMs}
                  glowColor={processColor(protectedSpectrumGlowColor)}
                />
              </Animated.View>
            ) : null}

            {psychedelicEnabled ? (
              <Animated.View
                style={[StyleSheet.absoluteFill, themeBackgroundFadeStyle]}
                pointerEvents="none"
              >
                <PsychedelicBackground
                  colors={playerColors}
                  isPlaying={isPlaying}
                  isDark={isDark}
                />
              </Animated.View>
            ) : null}

            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: "#000" },
                lyricsBgOverlayStyle,
              ]}
              pointerEvents="none"
            />

            {!isLyricsExpanded && !showQueue && (
              <Animated.View style={[artworkShadowStyle, { zIndex: 10 }]}>
                <Animated.View style={artworkContainerStyle}>
                  <Animated.View style={[styles.fullImage, artworkCdSpinStyle]}>
                    <Image
                      source={{ uri: track.artwork || track.artworkThumb }}
                      style={styles.fullImage}
                      contentFit="cover"
                      cachePolicy={performanceProfile.imageCachePolicyPrimary}
                      transition={0}
                      recyclingKey={track.id}
                    />
                  </Animated.View>
                  <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, artworkCdOverlayStyle]}>
                    <View style={[styles.fullPlayerCdOuterRim, { borderColor: withAlpha("#FFFFFF", 0.42) }]} />
                    <View style={[styles.fullPlayerCdOuterRimShadow, { borderColor: withAlpha("#000000", 0.34) }]} />
                    <View style={[styles.fullPlayerCdGroove, { borderColor: withAlpha(textColor, 0.26) }]} />
                    <View style={[styles.fullPlayerCdRing, { borderColor: withAlpha(textColor, 0.52) }]} />
                    <View
                      style={[
                        styles.fullPlayerCdHole,
                        {
                          backgroundColor: playerSurfaceColor,
                          borderColor: withAlpha(textColor, 0.48),
                        },
                      ]}
                    />
                  </Animated.View>
                </Animated.View>
              </Animated.View>
            )}

            {!isLyricsExpanded && !showQueue && refractionEnabled ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  {
                    position: "absolute",
                    left: refractionLeft,
                    top: refractionTop,
                    width: refractionSize,
                    height: refractionSize,
                    zIndex: 11,
                  },
                  artworkCdOverlayStyle,
                ]}
              >
                <KaraokeRefractionView
                  style={StyleSheet.absoluteFill}
                  enabled={refractionEnabled}
                  isPlaying={isPlaying}
                  artworkUri={playerArtworkUri}
                  glowColor={processColor(protectedSpectrumGlowColor)}
                  coverFrac={1 / REFRACTION_INFLATE}
                  intensity={1}
                  arcCenterDeg={-30}
                  arcSweepDeg={180}
                  arcFeatherDeg={20}
                  bandInnerFrac={0.5}
                  refractionStrength={0.18}
                  blur={0.06}
                  chroma={0.04}
                  rimWidth={0.03}
                />
              </Animated.View>
            ) : null}

            <Animated.View style={[{ flex: 1 }, contentAnimatedStyle]}>
              {!isLyricsExpanded && <ImmersiveVariant {...commonProps} />}
            </Animated.View>

            <PlayerQueueOverlayLayer
              visible={queueVisible && !isLyricsExpanded}
              currentTrackId={track.id}
              accentColor={accentColor}
              textColor={textColor}
              backgroundColor={playerColors.background + "F0"}
              animStyle={queueOverlayAnimStyle}
              onClose={handleCloseQueue}
            />

          </Animated.View>
        </GestureDetector>
      </Animated.View>

      {isVisible ? (
        <PlayerLyricsLayer
          visible={showLyrics && isVisible}
          expanded={isLyricsExpanded}
          currentTrack={track}
          accentColor={accentColor}
          textColor={textColor}
          colors={playerColors}
          animColors={playerAnimColors}
          isPlaying={isPlaying}
          shuffleEnabled={shuffleEnabled}
          repeatMode={repeatMode}
          qualityBadge={qualityBadge}
          trackTechLabel={trackTechLabel}
          onPrimaryColor={onPrimaryColor}
          animStyle={lyricsContentAnimStyle}
          onClose={() => {
            setShowLyrics(false);
            toggleLyricsFull(false);
          }}
          onPlayPause={togglePlayPause}
          onNext={next}
          onPrevious={previous}
          onToggleShuffle={toggleShuffle}
          onCycleRepeatMode={cycleRepeatMode}
          onArtistPress={handleArtistPress}
          onAlbumPress={handleAlbumPress}
          onOpenMoreOptions={handleOpenMoreOptions}
          refreshNonce={lyricsRefreshNonce}
          seek={seek}
        />
      ) : null}

      {/* Options sheet is the top-most layer so it renders ABOVE the lyrics overlay —
          otherwise the three-dots menu opened from the karaoke view stays hidden behind it. */}
      {isVisible && currentTrack ? (
        <PlayerOptionsModal
          visible={showOptions}
          track={currentTrack}
          actions={playerOptionsActions}
          accentColor={accentColor}
          textColor={textColor}
          onClose={handleCloseOptions}
          spectrumTunerVisible={spectrumEnabled}
        />
      ) : null}
    </>
  );
}
