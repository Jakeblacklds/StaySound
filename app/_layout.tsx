import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { router, Stack, usePathname, useRootNavigationState } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, InteractionManager, Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { MD3DarkTheme, MD3LightTheme, PaperProvider } from 'react-native-paper';
import 'react-native-reanimated';

import { FullPlayer, MiniPlayer } from '@/src/components/player';
import { scheduleAndroidAutoCatalogSync } from '@/src/services/androidAutoCatalogSync';
import { refreshAndroidEqualizerCapabilities, syncAndroidEqualizerFromSettings } from '@/src/services/androidEqualizerService';
import { ActionSheet, ConfirmationModal, GlobalNotification } from '@/src/components/ui';
import { ensureOnboardingMirrorPlaylist } from '@/src/services/onboardingTasteService';
import { ensureSeededSpotifyTop50Playlist, hydrateSpotifyTop50GlobalPlaylist } from '@/src/services/spotifyChartsService';
import { AudioEngine } from '@/src/services';
import { useAuthStore, useDabAuthStore, useLibraryStore, useOnboardingStore, usePlayerStore, useSettingsStore } from '@/src/stores';
import { createPaperFonts, ThemeProvider, useTheme } from '@/src/theme';

export {
  ErrorBoundary
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  const _hasLibraryHydrated = useLibraryStore(state => state._hasHydrated);
  const _hasSettingsHydrated = useSettingsStore(state => state._hasHydrated);
  const _hasOnboardingHydrated = useOnboardingStore(state => state._hasHydrated);
  const _hasAuthHydrated = useAuthStore(state => state._hasHydrated);
  const _hasDabAuthHydrated = useDabAuthStore(state => state._hasHydrated);
  const isAppReady =
    loaded &&
    _hasLibraryHydrated &&
    _hasSettingsHydrated &&
    _hasOnboardingHydrated &&
    _hasAuthHydrated &&
    _hasDabAuthHydrated;

  return (
    <GestureHandlerRootView style={styles.container}>
      <ThemeProvider>
        <RootLayoutNav isAppReady={isAppReady} />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

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

function SessionBootstrap() {
  const bootstrap = useAuthStore(state => state.bootstrap);
  const dabBootstrap = useDabAuthStore(state => state.bootstrap);
  const heartbeat = useAuthStore(state => state.heartbeat);
  const hasSessionLock = useAuthStore(state => state.hasSessionLock);
  const status = useAuthStore(state => state.status);

  useEffect(() => {
    void bootstrap();
    void dabBootstrap();
    ensureSeededSpotifyTop50Playlist();
    void hydrateSpotifyTop50GlobalPlaylist();
  }, [bootstrap, dabBootstrap]);

  useEffect(() => {
    if (status !== 'authenticated' || !hasSessionLock) {
      return;
    }

    void hydrateSpotifyTop50GlobalPlaylist({ force: true });
    void heartbeat();
    void ensureOnboardingMirrorPlaylist();

    const interval = setInterval(() => {
      void heartbeat();
    }, 25_000);

    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        void heartbeat();
        void hydrateSpotifyTop50GlobalPlaylist({ force: true });
        void ensureOnboardingMirrorPlaylist();
      }
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [hasSessionLock, heartbeat, status]);

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

function RootLayoutNav({ isAppReady }: { isAppReady: boolean }) {
  const { theme, isDark } = useTheme();
  const authStatus = useAuthStore(state => state.status);
  const hasCompletedOnboarding = useOnboardingStore(state => state.hasCompletedOnboarding);
  const currentTrack = usePlayerStore(state => state.currentTrack);
  const isPlayerVisible = usePlayerStore(state => state.playerVisible);
  const pathname = usePathname();
  const rootNavigationState = useRootNavigationState();
  const canNavigate = isAppReady && !!rootNavigationState?.key;
  const shouldMountFullPlayer = isPlayerVisible || currentTrack != null;

  useEffect(() => {
    if (!canNavigate || authStatus === 'loading' || authStatus === 'idle') {
      return;
    }

    const task = InteractionManager.runAfterInteractions(() => {
      if (authStatus !== 'authenticated') {
        if (pathname !== '/auth') {
          router.navigate('/auth' as any);
        }
        return;
      }

      if (!hasCompletedOnboarding) {
        if (pathname !== '/onboarding') {
          router.navigate('/onboarding' as any);
        }
        return;
      }

      if (pathname === '/auth' || pathname === '/onboarding') {
        router.navigate('/');
      }
    });

    return () => {
      task.cancel();
    };
  }, [authStatus, canNavigate, hasCompletedOnboarding, pathname]);

  const basePaperTheme = isDark ? MD3DarkTheme : MD3LightTheme;
  const paperTheme = isDark
    ? {
      ...basePaperTheme,
      colors: {
        ...MD3DarkTheme.colors,
        primary: theme.colors.primary,
        primaryContainer: theme.colors.primaryContainer,
        secondary: theme.colors.secondary,
        secondaryContainer: theme.colors.secondaryContainer,
        background: theme.colors.background,
        surface: theme.colors.surface,
        surfaceVariant: theme.colors.surfaceVariant,
        error: theme.colors.error,
        onPrimary: theme.colors.onPrimary,
        onSecondary: theme.colors.onSecondary,
        onBackground: theme.colors.onBackground,
        onSurface: theme.colors.onSurface,
        onSurfaceVariant: theme.colors.onSurfaceVariant,
        outline: theme.colors.outline,
      },
      fonts: createPaperFonts(basePaperTheme.fonts),
    }
    : {
      ...basePaperTheme,
      colors: {
        ...MD3LightTheme.colors,
        primary: theme.colors.primary,
        primaryContainer: theme.colors.primaryContainer,
        secondary: theme.colors.secondary,
        secondaryContainer: theme.colors.secondaryContainer,
        background: theme.colors.background,
        surface: theme.colors.surface,
        surfaceVariant: theme.colors.surfaceVariant,
        error: theme.colors.error,
        onPrimary: theme.colors.onPrimary,
        onSecondary: theme.colors.onSecondary,
        onBackground: theme.colors.onBackground,
        onSurface: theme.colors.onSurface,
        onSurfaceVariant: theme.colors.onSurfaceVariant,
        outline: theme.colors.outline,
      },
      fonts: createPaperFonts(basePaperTheme.fonts),
    };

  return (
    <PaperProvider theme={paperTheme}>
      <NavigationThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <View style={styles.container}>
            <SessionBootstrap />
            <AndroidAutoCatalogBootstrap />
            <EqualizerBootstrap />
            <AudioSync />
            <Stack
              screenOptions={{
                headerShown: false,
                animation: 'fade_from_bottom',
              }}
            >
              <Stack.Screen name="auth" options={{ animation: 'fade', gestureEnabled: false }} />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen
                name="onboarding"
                options={{
                  headerShown: false,
                  animation: 'fade',
                  gestureEnabled: false,
                }}
              />
              <Stack.Screen name="artist" />
              <Stack.Screen name="album" />
              <Stack.Screen name="playlist" />
              <Stack.Screen
                name="playlist-create"
                options={{
                  presentation: 'fullScreenModal',
                  headerShown: false,
                  animation: 'slide_from_bottom',
                }}
              />
              <Stack.Screen name="tidal-artist" />
              <Stack.Screen name="tidal-album" />
              <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
              <Stack.Screen
                name="lyrics"
                options={{
                  presentation: 'fullScreenModal',
                  headerShown: false,
                  animation: 'slide_from_bottom',
                }}
              />
              <Stack.Screen name="equalizer" options={{ animation: 'slide_from_right' }} />
            </Stack>
            <ActionSheet />
            <ConfirmationModal />
            <GlobalNotification />
            <MiniPlayer />
            {shouldMountFullPlayer ? <FullPlayer /> : null}
          </View>
        </GestureHandlerRootView>
      </NavigationThemeProvider>
    </PaperProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

