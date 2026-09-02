import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { AudioEngine } from '@/src/services';
import { scheduleAndroidAutoCatalogSync } from '@/src/services/androidAutoCatalogSync';
import { bootstrapAppUpdates } from '@/src/services/appUpdateService';
import { refreshAndroidEqualizerCapabilities, syncAndroidEqualizerFromSettings } from '@/src/services/androidEqualizerService';
import { hasPermissions } from '@/src/services/fileScanner';
import { addAudioLibraryChangedListenerNative } from '@/src/services/nativeLibraryIndexer';
import { ensureOnboardingMirrorPlaylist } from '@/src/services/onboardingTasteService';
import { ensureSeededSpotifyTop50Playlist, hydrateSpotifyTop50GlobalPlaylist } from '@/src/services/spotifyChartsService';
import { useLibraryStore, usePlayerStore, useSettingsStore } from '@/src/stores';

function AudioSync() {
  useEffect(() => {
    import('@/src/services/database').then(m => m.getDatabase());
  }, []);

  const lastState = useRef({
    isPlaying: false,
    isLoading: false,
    position: 0,
    duration: 0,
    queueIndex: -1,
    trackId: usePlayerStore.getState().currentTrack?.id
  });

  useEffect(() => {
    void AudioEngine.initialize({
      onStateChange: (audioState) => {
        const hasMeaningfulChange =
          audioState.isPlaying !== lastState.current.isPlaying ||
          audioState.isLoading !== lastState.current.isLoading ||
          audioState.queueIndex !== lastState.current.queueIndex ||
          audioState.currentTrack?.id !== lastState.current.trackId ||
          Math.abs((audioState.duration ?? 0) - lastState.current.duration) > 1000 ||
          Math.abs((audioState.position ?? 0) - lastState.current.position) > 1000;

        if (!hasMeaningfulChange) {
          return;
        }

        usePlayerStore.getState().updateFromEngine({
          isPlaying: audioState.isPlaying,
          isLoading: audioState.isLoading,
          position: audioState.position,
          duration: audioState.duration,
          currentTrack: audioState.currentTrack,
          queueIndex: audioState.queueIndex,
        });
        lastState.current = {
          isPlaying: audioState.isPlaying ?? false,
          isLoading: audioState.isLoading ?? false,
          position: audioState.position ?? 0,
          duration: audioState.duration ?? 0,
          queueIndex: audioState.queueIndex ?? -1,
          trackId: audioState.currentTrack?.id,
        };
      },
    });
  }, []);

  return null;
}

function DiscoveryBootstrap() {
  useEffect(() => {
    ensureSeededSpotifyTop50Playlist();
    void hydrateSpotifyTop50GlobalPlaylist();
    void ensureOnboardingMirrorPlaylist();

    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        void hydrateSpotifyTop50GlobalPlaylist({ force: true });
        void ensureOnboardingMirrorPlaylist();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return null;
}

function AndroidAutoCatalogBootstrap() {
  const hasHydrated = useLibraryStore(state => state._hasHydrated);
  const catalogRevision = useLibraryStore(state => state.catalogRevision);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    scheduleAndroidAutoCatalogSync();
  }, [hasHydrated, catalogRevision]);

  return null;
}

function LibraryAutoScanBootstrap() {
  const hasHydrated = useLibraryStore(state => state._hasHydrated);
  const isScanning = useLibraryStore(state => state.isScanning);
  const trackCount = useLibraryStore(state => state.tracks.size);
  const scanLibrary = useLibraryStore(state => state.scanLibrary);
  const pruneInvalidLibraryEntries = useLibraryStore(state => state.pruneInvalidLibraryEntries);
  const initialScanAttemptedRef = useRef(false);
  const pruneAttemptedRef = useRef(false);
  const mediaStoreScanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isScanningRef = useRef(isScanning);

  useEffect(() => {
    isScanningRef.current = isScanning;
  }, [isScanning]);

  useEffect(() => {
    if (!hasHydrated || isScanning || trackCount > 0 || initialScanAttemptedRef.current) {
      return;
    }

    initialScanAttemptedRef.current = true;
    void hasPermissions().then(granted => {
      if (granted) {
        void scanLibrary();
      }
    });
  }, [hasHydrated, isScanning, scanLibrary, trackCount]);

  useEffect(() => {
    if (!hasHydrated || pruneAttemptedRef.current) return;

    pruneAttemptedRef.current = true;
    void pruneInvalidLibraryEntries();
  }, [hasHydrated, pruneInvalidLibraryEntries]);

  useEffect(() => {
    if (!hasHydrated) return;

    const subscription = addAudioLibraryChangedListenerNative(() => {
      if (mediaStoreScanTimeoutRef.current) {
        clearTimeout(mediaStoreScanTimeoutRef.current);
      }

      mediaStoreScanTimeoutRef.current = setTimeout(() => {
        mediaStoreScanTimeoutRef.current = null;
        if (isScanningRef.current) return;

        void hasPermissions().then(granted => {
          if (granted) {
            void scanLibrary();
          }
        });
      }, 1500);
    });

    return () => {
      subscription?.remove();
      if (mediaStoreScanTimeoutRef.current) {
        clearTimeout(mediaStoreScanTimeoutRef.current);
        mediaStoreScanTimeoutRef.current = null;
      }
    };
  }, [hasHydrated, scanLibrary]);

  return null;
}

function EqualizerBootstrap() {
  const hasHydrated = useSettingsStore(state => state._hasHydrated);
  const currentTrackId = usePlayerStore(state => state.currentTrack?.id);
  const equalizerMode = useSettingsStore(state => state.equalizer.mode);
  const equalizerEnabled = useSettingsStore(state => state.equalizer.enabled);

  useEffect(() => {
    if (Platform.OS !== 'android' || !hasHydrated) {
      return;
    }

    void refreshAndroidEqualizerCapabilities(false);
  }, [hasHydrated]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !hasHydrated) {
      return;
    }

    if (equalizerMode === 'app' && equalizerEnabled) {
      void syncAndroidEqualizerFromSettings();
      return;
    }

    void refreshAndroidEqualizerCapabilities(false);
  }, [equalizerEnabled, equalizerMode, hasHydrated]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !hasHydrated) {
      return;
    }

    if (equalizerMode !== 'app' || !equalizerEnabled || !currentTrackId) {
      return;
    }

    void syncAndroidEqualizerFromSettings();
  }, [currentTrackId, equalizerEnabled, equalizerMode, hasHydrated]);

  return null;
}

function AppUpdateBootstrap({ isAppReady }: { isAppReady: boolean }) {
  useEffect(() => {
    if (!isAppReady) {
      return;
    }

    void bootstrapAppUpdates();
  }, [isAppReady]);

  return null;
}

export function AppBootstraps({ isAppReady }: { isAppReady: boolean }) {
  return (
    <>
      <DiscoveryBootstrap />
      <AppUpdateBootstrap isAppReady={isAppReady} />
      <AndroidAutoCatalogBootstrap />
      <LibraryAutoScanBootstrap />
      <EqualizerBootstrap />
      <AudioSync />
    </>
  );
}
