import { LyricsRepository } from '@/src/services';
import type { AppleWordLyricsCandidate } from '@/src/services/lyricsRepository';
import { FileSystemStorage } from '@/src/services/storage';
import { useLibraryStore, usePlayerStore } from '@/src/stores';
import { useSettingsStore } from '@/src/stores/settingsStore';
import type { Track } from '@/src/types/audio';
import type { KaraokeLyricsJSON } from '@/src/types/karaokeTypes';
import { usePerformanceProfile } from '@/src/theme';
import { DEFAULT_LYRICS_MOTION_OPTION_ID, LYRICS_MOTION_OPTIONS } from '@/src/components/player/lyricsMotionProfiles';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { runOnJS, useAnimatedReaction, useSharedValue, withTiming, Easing } from 'react-native-reanimated';

const LYRICS_SYNC_OFFSET_STORAGE_KEY = 'lyrics-sync-offsets-v1';
const LYRICS_MOTION_PROFILE_STORAGE_KEY = 'lyrics-motion-profile-v1';

type LyricsOffsetCacheMap = Record<string, number>;

type LyricsLookupTrack = Partial<Track> & {
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
};

export type UsePlayerLyricsArgs = {
  visible: boolean;
  currentTrack: Track | null;
  /** Bump this to force a fresh network search (clears the track's lyrics cache first). */
  refreshNonce?: number;
  /** Kotlin consumes the shared timeline directly; skip JS position snapshots. */
  nativeTimeline?: boolean;
};

function normalizeLyricsOffsetKeyPart(value?: string | null) {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getLyricsOffsetCacheKeys(track: {
  id?: string | null;
  isrc?: string | null;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
}) {
  const keys: string[] = [];

  const trackId = normalizeLyricsOffsetKeyPart(track.id);
  if (trackId) keys.push(`track:${trackId}`);

  const isrc = normalizeLyricsOffsetKeyPart(track.isrc);
  if (isrc) keys.push(`isrc:${isrc}`);

  const title = normalizeLyricsOffsetKeyPart(track.title);
  const artist = normalizeLyricsOffsetKeyPart(track.artist);
  const album = normalizeLyricsOffsetKeyPart(track.album);
  if (title && artist) {
    keys.push(`song:${title}::${artist}`);
    if (album) {
      keys.push(`song:${title}::${artist}::${album}`);
    }
  }

  return keys;
}

export function usePlayerLyrics({ visible, currentTrack, refreshNonce = 0, nativeTimeline = false }: UsePlayerLyricsArgs) {
  const performanceProfile = usePerformanceProfile();
  const lyricsSources = useSettingsStore(state => state.lyricsSources);
  const currentTrackId = currentTrack?.id ?? null;
  const positionShared = usePlayerStore(state => state.positionShared);
  const queue = usePlayerStore(state => state.queue);
  const queueIndex = usePlayerStore(state => state.queueIndex);
  const nextTrackInQueue = useMemo(
    () => (queueIndex >= 0 && queueIndex < queue.length - 1 ? queue[queueIndex + 1] ?? null : null),
    [queue, queueIndex]
  );
  const libraryLyricsTrack = useLibraryStore(state =>
    currentTrackId ? state.tracks.get(currentTrackId) ?? null : null
  );

  const [lyricsMode, setLyricsMode] = useState<'synced' | 'lrc'>('synced');
  const [trackLyricsOptions, setTrackLyricsOptions] = useState<AppleWordLyricsCandidate[]>([]);
  const [suggestedLyricsOptions, setSuggestedLyricsOptions] = useState<AppleWordLyricsCandidate[]>([]);
  const [isLyricsSuggestionModalVisible, setIsLyricsSuggestionModalVisible] = useState(false);
  const [selectedTrackLyricsOptionIndex, setSelectedTrackLyricsOptionIndex] = useState(0);
  const [lrcLyrics, setLrcLyrics] = useState<KaraokeLyricsJSON | null>(null);
  const [isLyricsLoading, setIsLyricsLoading] = useState(false);
  const [isDownloadingLrc, setIsDownloadingLrc] = useState(false);
  const [lrcError, setLrcError] = useState<string | null>(null);
  const [hasResolvedLyricsAttempt, setHasResolvedLyricsAttempt] = useState(false);
  const [nativePositionMs, setNativePositionMs] = useState(0);
  const [selectedMotionOptionId, setSelectedMotionOptionId] = useState(DEFAULT_LYRICS_MOTION_OPTION_ID);
  const [lyricsControlsExpanded, setLyricsControlsExpanded] = useState(false);
  const [lyricsTimingOffsetMs, setLyricsTimingOffsetMs] = useState(0);
  const [isLyricsOffsetCacheLoaded, setIsLyricsOffsetCacheLoaded] = useState(false);
  const [lyricsOffsetHydratedKey, setLyricsOffsetHydratedKey] = useState('');
  const [lastRenderedLyrics, setLastRenderedLyrics] = useState<KaraokeLyricsJSON | null>(null);

  const lyricsRequestIdRef = useRef(0);
  const prevRefreshNonceRef = useRef(refreshNonce);
  const hasManualLyricsSelectionRef = useRef(false);
  const manualLyricsOptionIdRef = useRef<string | null>(null);
  const lyricsOffsetCacheRef = useRef<LyricsOffsetCacheMap>({});
  const lyricsOffsetSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetchedTrackIdRef = useRef<string | null>(null);
  const prefetchRequestIdRef = useRef(0);
  const lyricsTransitionProgress = useSharedValue(1);
  const prevTrackIdRef = useRef<string | null>(null);

  const resetLyricsState = useCallback(() => {
    setTrackLyricsOptions([]);
    setSuggestedLyricsOptions([]);
    setIsLyricsSuggestionModalVisible(false);
    setSelectedTrackLyricsOptionIndex(0);
    setLrcLyrics(null);
    setLyricsMode('synced');
    setIsLyricsLoading(false);
    setIsDownloadingLrc(false);
    setLrcError(null);
    setHasResolvedLyricsAttempt(false);
    setNativePositionMs(0);
    setLastRenderedLyrics(null);
    hasManualLyricsSelectionRef.current = false;
    manualLyricsOptionIdRef.current = null;
  }, []);

  const hasMeaningfulLyricsValue = useCallback((value?: string | null) => {
    const normalized = value?.trim().toLowerCase();
    return !!normalized && normalized !== 'unknown' && normalized !== 'unknown title' && normalized !== 'unknown artist';
  }, []);

  const lyricsLookupTrack: LyricsLookupTrack | null = useMemo(() => {
    if (!currentTrack && !libraryLyricsTrack) return null;

    const baseTrack = currentTrack ?? libraryLyricsTrack;
    if (!baseTrack) return null;

    return {
      ...baseTrack,
      title: hasMeaningfulLyricsValue(libraryLyricsTrack?.title) ? libraryLyricsTrack!.title : (baseTrack.title ?? ''),
      artist: hasMeaningfulLyricsValue(libraryLyricsTrack?.artist) ? libraryLyricsTrack!.artist : (baseTrack.artist ?? ''),
      album: hasMeaningfulLyricsValue(libraryLyricsTrack?.album) ? libraryLyricsTrack!.album : (baseTrack.album ?? ''),
      duration: libraryLyricsTrack?.duration || baseTrack.duration,
    };
  }, [currentTrack, hasMeaningfulLyricsValue, libraryLyricsTrack]);

  const activeMotionOption = useMemo(
    () => LYRICS_MOTION_OPTIONS.find(option => option.id === selectedMotionOptionId) ?? LYRICS_MOTION_OPTIONS[0],
    [selectedMotionOptionId]
  );

  const appliedMotionProfile = activeMotionOption.nativeProfile;
  const lyricsOffsetKeys = useMemo(
    () => getLyricsOffsetCacheKeys(lyricsLookupTrack ?? {}),
    [lyricsLookupTrack]
  );
  const lyricsOffsetPrimaryKey = lyricsOffsetKeys[0] ?? '';

  const updateNativePosition = useCallback((value: number) => {
    setNativePositionMs(value);
  }, []);

  useAnimatedReaction(
    () => {
      if (!visible || nativeTimeline) return -1;
      const stepMs = lyricsMode === 'lrc' ? 32 : 48;
      return Math.floor(positionShared.value / stepMs) * stepMs;
    },
    (current, previous) => {
      if (current >= 0 && current !== previous) {
        runOnJS(updateNativePosition)(current);
      }
    },
    [lyricsMode, positionShared, visible, nativeTimeline]
  );

  const applyLyricsOffsetStep = useCallback((deltaMs: number) => {
    setLyricsTimingOffsetMs(prev => {
      const next = prev + deltaMs;
      return Math.max(-5000, Math.min(5000, next));
    });
  }, []);

  const handleDownloadLrc = useCallback(async () => {
    const songTitle = lyricsLookupTrack?.title?.trim();
    const artist = lyricsLookupTrack?.artist?.trim();
    const durationSec = lyricsLookupTrack?.duration ? lyricsLookupTrack.duration / 1000 : undefined;
    const trackId = lyricsLookupTrack?.id;

    if (!songTitle || !artist) return;

    setIsDownloadingLrc(true);
    setLrcError(null);
    try {
      const payload = await LyricsRepository.getLrcLibLyrics(songTitle, artist, durationSec, trackId, lyricsLookupTrack?.album);
      if (payload && Array.isArray(payload.lyrics) && payload.lyrics.length > 0) {
        setLrcLyrics(payload as KaraokeLyricsJSON);
        setLyricsMode('lrc');
      } else {
        setLrcError('No se encontraron letras en LRCLib.');
      }
    } catch {
      setLrcError('Error al descargar las letras.');
    } finally {
      setIsDownloadingLrc(false);
    }
  }, [lyricsLookupTrack]);

  React.useEffect(() => {
    const trackId = currentTrack?.id ?? null;
    if (trackId === prevTrackIdRef.current) return;

    if (prevTrackIdRef.current !== null) {
      lyricsTransitionProgress.value = 0;
    }
    prevTrackIdRef.current = trackId;
    resetLyricsState();
  }, [currentTrack?.id, lyricsTransitionProgress, resetLyricsState]);

  React.useEffect(() => {
    setLyricsControlsExpanded(false);
  }, [currentTrack?.id]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await FileSystemStorage.getItem(LYRICS_MOTION_PROFILE_STORAGE_KEY);
        if (cancelled || !saved) return;
        const valid = LYRICS_MOTION_OPTIONS.find(o => o.id === saved);
        if (valid) setSelectedMotionOptionId(valid.id);
      } catch {
        // keep default profile
      }
    })();
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    void FileSystemStorage.setItem(LYRICS_MOTION_PROFILE_STORAGE_KEY, selectedMotionOptionId);
  }, [selectedMotionOptionId]);

  React.useEffect(() => {
    let isCancelled = false;

    (async () => {
      try {
        const raw = await FileSystemStorage.getItem(LYRICS_SYNC_OFFSET_STORAGE_KEY);
        if (isCancelled) return;
        if (!raw) {
          lyricsOffsetCacheRef.current = {};
          setIsLyricsOffsetCacheLoaded(true);
          return;
        }

        const parsed = JSON.parse(raw) as LyricsOffsetCacheMap;
        const safe: LyricsOffsetCacheMap = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (!key) continue;
          if (typeof value !== 'number' || Number.isNaN(value)) continue;
          safe[key] = Math.max(-5000, Math.min(5000, Math.round(value)));
        }
        lyricsOffsetCacheRef.current = safe;
      } catch {
        lyricsOffsetCacheRef.current = {};
      } finally {
        if (!isCancelled) {
          setIsLyricsOffsetCacheLoaded(true);
        }
      }
    })();

    return () => {
      isCancelled = true;
      if (lyricsOffsetSaveTimeoutRef.current) {
        clearTimeout(lyricsOffsetSaveTimeoutRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (!isLyricsOffsetCacheLoaded) return;

    if (!lyricsOffsetPrimaryKey) {
      setLyricsTimingOffsetMs(0);
      setLyricsOffsetHydratedKey('');
      return;
    }

    const cachedValue = lyricsOffsetKeys
      .map(key => lyricsOffsetCacheRef.current[key])
      .find(value => typeof value === 'number');

    setLyricsTimingOffsetMs(typeof cachedValue === 'number' ? cachedValue : 0);
    setLyricsOffsetHydratedKey(lyricsOffsetPrimaryKey);
  }, [isLyricsOffsetCacheLoaded, lyricsOffsetKeys, lyricsOffsetPrimaryKey]);

  React.useEffect(() => {
    if (!isLyricsOffsetCacheLoaded || !lyricsOffsetPrimaryKey) return;
    if (lyricsOffsetHydratedKey !== lyricsOffsetPrimaryKey) return;

    const clampedValue = Math.max(-5000, Math.min(5000, Math.round(lyricsTimingOffsetMs)));
    const cache = { ...lyricsOffsetCacheRef.current };

    if (clampedValue === 0) {
      for (const key of lyricsOffsetKeys) {
        delete cache[key];
      }
    } else {
      for (const key of lyricsOffsetKeys) {
        cache[key] = clampedValue;
      }
    }

    lyricsOffsetCacheRef.current = cache;

    if (lyricsOffsetSaveTimeoutRef.current) {
      clearTimeout(lyricsOffsetSaveTimeoutRef.current);
    }

    lyricsOffsetSaveTimeoutRef.current = setTimeout(() => {
      void FileSystemStorage.setItem(
        LYRICS_SYNC_OFFSET_STORAGE_KEY,
        JSON.stringify(lyricsOffsetCacheRef.current)
      );
    }, 180);
  }, [
    isLyricsOffsetCacheLoaded,
    lyricsOffsetHydratedKey,
    lyricsOffsetKeys,
    lyricsOffsetPrimaryKey,
    lyricsTimingOffsetMs,
  ]);

  React.useEffect(() => {
    if (!visible && performanceProfile.releaseLyricsStateWhenHidden) {
      lyricsRequestIdRef.current += 1;
      resetLyricsState();
    }
  }, [performanceProfile.releaseLyricsStateWhenHidden, resetLyricsState, visible]);

  React.useEffect(() => {
    const requestId = ++lyricsRequestIdRef.current;
    const songTitle = lyricsLookupTrack?.title?.trim();
    const artist = lyricsLookupTrack?.artist?.trim();
    const album = lyricsLookupTrack?.album?.trim();
    const durationSec = lyricsLookupTrack?.duration ? lyricsLookupTrack.duration / 1000 : undefined;
    const trackId = lyricsLookupTrack?.id;
    const isrc = lyricsLookupTrack?.isrc;

    if (!visible) {
      setIsLyricsLoading(false);
      setIsDownloadingLrc(false);
      return;
    }

    if (!songTitle || !artist) {
      setTrackLyricsOptions([]);
      setSelectedTrackLyricsOptionIndex(0);
      setLrcLyrics(null);
      setIsLyricsLoading(false);
      setIsDownloadingLrc(false);
      setHasResolvedLyricsAttempt(true);
      return;
    }

    const forceRefresh = refreshNonce !== prevRefreshNonceRef.current;
    prevRefreshNonceRef.current = refreshNonce;

    setIsDownloadingLrc(false);
    setLrcError(null);
    setHasResolvedLyricsAttempt(false);

    (async () => {
      let cachedLrcFound = false;

      try {
        if (forceRefresh) {
          // Wipe this track's cache so the lookup below is a genuine fresh search.
          await LyricsRepository.clearTrackLyricsCache(songTitle, artist, trackId);
          if (lyricsRequestIdRef.current !== requestId) return;
          hasManualLyricsSelectionRef.current = false;
          setTrackLyricsOptions([]);
          setSuggestedLyricsOptions([]);
          setLrcLyrics(null);
          setIsLyricsLoading(true);
        }

        const [cached, cachedAppleOptions] = await Promise.all([
          lyricsSources.includes('lrclib') ? LyricsRepository.getCachedLrcLibLyrics(songTitle, artist, trackId) : Promise.resolve(null),
          LyricsRepository.getCachedAppleWordLyricsOptions(songTitle, artist, trackId, lyricsSources),
        ]);
        if (lyricsRequestIdRef.current !== requestId) return;

        if (cached?.lyrics?.length) {
          cachedLrcFound = true;
          setLrcLyrics(cached as KaraokeLyricsJSON);
          setLyricsMode(prev => prev === 'synced' ? 'lrc' : prev);
        }

        let appleOptions = cachedAppleOptions;
        let exactAppleOptions = appleOptions.filter(option => option.isExactMatch);

        const cachedManualOptionIndex = manualLyricsOptionIdRef.current
          ? appleOptions.findIndex(option => option.id === manualLyricsOptionIdRef.current)
          : -1;

        // Metadata can hydrate after the player is already open (duration, album, ISRC),
        // which re-runs this lookup. Keep the option the listener explicitly chose instead
        // of falling back to result 0 just because the same candidates came from cache.
        if (hasManualLyricsSelectionRef.current && cachedManualOptionIndex >= 0) {
          setTrackLyricsOptions(appleOptions);
          setSuggestedLyricsOptions([]);
          setIsLyricsSuggestionModalVisible(false);
          setSelectedTrackLyricsOptionIndex(cachedManualOptionIndex);
          setLyricsMode('synced');
          setLrcError(null);
          setIsLyricsLoading(false);
          setHasResolvedLyricsAttempt(true);
          return;
        }

        if (exactAppleOptions.length > 0) {
          setTrackLyricsOptions(exactAppleOptions);
          setSuggestedLyricsOptions([]);
          setIsLyricsSuggestionModalVisible(false);
          setSelectedTrackLyricsOptionIndex(0);
          setLyricsMode('synced');
          setLrcError(null);
          setIsLyricsLoading(false);
          setHasResolvedLyricsAttempt(true);
          return;
        }

        if (appleOptions.length > 0) {
          setTrackLyricsOptions([]);
          setSuggestedLyricsOptions(appleOptions);
          setIsLyricsSuggestionModalVisible(true);
          setSelectedTrackLyricsOptionIndex(0);
          setIsLyricsLoading(false);
          setHasResolvedLyricsAttempt(true);
          return;
        }

        // Only show the loading skeleton when we have nothing on screen yet. If a cached
        // LRC is already showing, the Apple/KPoe lookup is a silent background upgrade.
        if (!cachedLrcFound) {
          setIsLyricsLoading(true);
        }

        appleOptions = await LyricsRepository.getAppleWordLyricsOptions(songTitle, artist, album, durationSec, trackId, isrc, lyricsSources);
        if (lyricsRequestIdRef.current !== requestId) return;
        exactAppleOptions = appleOptions.filter(option => option.isExactMatch);

        const fetchedManualOptionIndex = manualLyricsOptionIdRef.current
          ? appleOptions.findIndex(option => option.id === manualLyricsOptionIdRef.current)
          : -1;

        if (hasManualLyricsSelectionRef.current && fetchedManualOptionIndex >= 0) {
          setTrackLyricsOptions(appleOptions);
          setSuggestedLyricsOptions([]);
          setIsLyricsSuggestionModalVisible(false);
          setSelectedTrackLyricsOptionIndex(fetchedManualOptionIndex);
          setLyricsMode('synced');
          setLrcError(null);
          return;
        }

        const bestApplePayload = exactAppleOptions[0]?.payload ?? null;
        const hasAppleWords = exactAppleOptions.length > 0;

        let payload: KaraokeLyricsJSON | null = bestApplePayload;
        let hasWords = hasAppleWords;

        if (!hasAppleWords) {
          payload = await LyricsRepository.getLyrics(songTitle, artist);
          if (lyricsRequestIdRef.current !== requestId) return;
          hasWords = !!payload?.lyrics?.length;
        }

        setTrackLyricsOptions(exactAppleOptions);
        setSuggestedLyricsOptions(hasAppleWords ? [] : appleOptions);
        setIsLyricsSuggestionModalVisible(!hasAppleWords && appleOptions.length > 0);
        setSelectedTrackLyricsOptionIndex(0);

        if (hasWords) {
          setLyricsMode('synced');
          setLrcError(null);
        }

        const lrcLibAllowed = lyricsSources.includes('lrclib');

        if (!cachedLrcFound && !hasWords && lrcLibAllowed) {
          setIsDownloadingLrc(true);
          setLrcError(null);

          try {
            const fallback = await LyricsRepository.getLrcLibLyrics(songTitle, artist, durationSec, trackId, lyricsLookupTrack?.album);
            if (lyricsRequestIdRef.current !== requestId) return;

            if (fallback?.lyrics?.length) {
              setLrcLyrics(fallback as KaraokeLyricsJSON);
              if (!hasWords && !hasManualLyricsSelectionRef.current) {
                setLyricsMode('lrc');
                setLrcError(null);
              }
            } else if (!hasWords && !hasManualLyricsSelectionRef.current) {
              setLrcError('No se encontraron letras disponibles.');
            }
          } catch {
            if (
              lyricsRequestIdRef.current === requestId &&
              !hasWords &&
              !hasManualLyricsSelectionRef.current
            ) {
              setLrcError('No se pudieron cargar las letras.');
            }
          } finally {
            if (lyricsRequestIdRef.current === requestId) {
              setIsDownloadingLrc(false);
            }
          }
        } else if (hasWords) {
          setLrcError(null);
        } else if (!cachedLrcFound && !lrcLibAllowed && !hasManualLyricsSelectionRef.current) {
          setLrcError('No se encontraron letras disponibles.');
        }
      } finally {
        if (lyricsRequestIdRef.current === requestId) {
          setIsLyricsLoading(false);
          setHasResolvedLyricsAttempt(true);
        }
      }
    })();

    return () => {
      if (lyricsRequestIdRef.current === requestId) {
        setIsLyricsLoading(false);
        setIsDownloadingLrc(false);
      }
    };
  }, [lyricsLookupTrack?.album, lyricsLookupTrack?.artist, lyricsLookupTrack?.duration, lyricsLookupTrack?.id, lyricsLookupTrack?.isrc, lyricsLookupTrack?.title, lyricsSources, refreshNonce, visible]);

  const selectedTrackLyrics = trackLyricsOptions[selectedTrackLyricsOptionIndex]?.payload ?? null;
  const hasSyncedLyrics = trackLyricsOptions.length > 0 || !!selectedTrackLyrics?.lyrics?.length;
  const hasLrcLyrics = !!lrcLyrics?.lyrics?.length;
  const activeLyrics = lyricsMode === 'synced'
    ? (selectedTrackLyrics ?? lrcLyrics)
    : (lrcLyrics ?? selectedTrackLyrics);
  const hasMultipleSyncedLyricsOptions = trackLyricsOptions.length > 1;
  const activeSyncedLyricsOption = trackLyricsOptions[selectedTrackLyricsOptionIndex] ?? null;
  const shouldShowDownloadLrc =
    hasResolvedLyricsAttempt &&
    !isLyricsLoading &&
    !isDownloadingLrc &&
    !hasSyncedLyrics &&
    !hasLrcLyrics;
  const displayLyrics = activeLyrics ?? ((isLyricsLoading || isDownloadingLrc) ? lastRenderedLyrics : null);

  React.useEffect(() => {
    if (!activeLyrics?.lyrics?.length) return;
    setLastRenderedLyrics(activeLyrics);
  }, [activeLyrics]);

  React.useEffect(() => {
    if (!displayLyrics) return;
    lyricsTransitionProgress.value = withTiming(1, {
      duration: 480,
      easing: Easing.out(Easing.cubic),
    });
  }, [displayLyrics, lyricsTransitionProgress]);

  const nextTrackRef = useRef(nextTrackInQueue);
  nextTrackRef.current = nextTrackInQueue;
  const lyricsSourcesRef = useRef(lyricsSources);
  lyricsSourcesRef.current = lyricsSources;

  const triggerNextTrackPrefetch = useCallback(async () => {
    const next = nextTrackRef.current;
    if (!next) return;
    const trackId = next.id;
    if (prefetchedTrackIdRef.current === trackId) return;
    prefetchedTrackIdRef.current = trackId;

    const myRequestId = ++prefetchRequestIdRef.current;
    const title = next.title?.trim();
    const artist = next.artist?.trim();
    const album = next.album?.trim();
    const durationSec = next.duration ? next.duration / 1000 : undefined;
    const isrc = (next as any).isrc as string | undefined;

    if (!title || !artist) return;

    try {
      const [appleResult] = await Promise.allSettled([
        LyricsRepository.getAppleWordLyricsOptions(title, artist, album, durationSec, trackId, isrc, lyricsSourcesRef.current),
      ]);
      if (prefetchRequestIdRef.current !== myRequestId) return;

      const hasApple = appleResult.status === 'fulfilled' && appleResult.value.length > 0;
      if (!hasApple) {
        await LyricsRepository.getLyrics(title, artist).catch(() => { });
      }
      if (lyricsSourcesRef.current.includes('lrclib')) {
        await LyricsRepository.getLrcLibLyrics(title, artist, durationSec, trackId, album).catch(() => { });
      }
    } catch {
      // best effort prefetch
    }
  }, []);

  React.useEffect(() => {
    prefetchedTrackIdRef.current = null;
  }, [currentTrack?.id]);

  useAnimatedReaction(
    () => {
      if (!visible) return false;
      const durationMs = lyricsLookupTrack?.duration ?? 0;
      if (durationMs < 20000) return false;
      const remaining = durationMs - positionShared.value;
      return remaining > 0 && remaining <= 15000;
    },
    (shouldPrefetch, prev) => {
      if (shouldPrefetch && !prev) {
        runOnJS(triggerNextTrackPrefetch)();
      }
    },
    [lyricsLookupTrack?.duration, positionShared, triggerNextTrackPrefetch, visible]
  );

  const handleCycleSyncedLyricsOption = useCallback(() => {
    if (trackLyricsOptions.length <= 1) return;
    setSelectedTrackLyricsOptionIndex(prev => {
      const nextIndex = (prev + 1) % trackLyricsOptions.length;
      manualLyricsOptionIdRef.current = trackLyricsOptions[nextIndex]?.id ?? null;
      return nextIndex;
    });
    hasManualLyricsSelectionRef.current = true;
    setLyricsMode('synced');
    lyricsTransitionProgress.value = 0;
  }, [lyricsTransitionProgress, trackLyricsOptions]);

  const handleSelectSuggestedLyrics = useCallback((optionId: string) => {
    const selectedIndex = suggestedLyricsOptions.findIndex(option => option.id === optionId);
    if (selectedIndex < 0) return;

    setTrackLyricsOptions(suggestedLyricsOptions);
    setSelectedTrackLyricsOptionIndex(selectedIndex);
    hasManualLyricsSelectionRef.current = true;
    manualLyricsOptionIdRef.current = suggestedLyricsOptions[selectedIndex]?.id ?? null;
    setLyricsMode('synced');
    setLrcError(null);
    setIsLyricsSuggestionModalVisible(false);
    lyricsTransitionProgress.value = 0;
  }, [lyricsTransitionProgress, suggestedLyricsOptions]);

  const dismissLyricsSuggestionModal = useCallback(() => {
    setIsLyricsSuggestionModalVisible(false);
  }, []);

  return {
    lyricsMode,
    setLyricsMode,
    trackLyricsOptions,
    suggestedLyricsOptions,
    isLyricsSuggestionModalVisible,
    selectedTrackLyrics,
    selectedTrackLyricsOptionIndex,
    setSelectedTrackLyricsOptionIndex,
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
    handleSelectSuggestedLyrics,
    dismissLyricsSuggestionModal,
    lyricsTransitionProgress,
  };
}
