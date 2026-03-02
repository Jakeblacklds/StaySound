import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { MD3DarkTheme, MD3LightTheme, PaperProvider } from 'react-native-paper';
import 'react-native-reanimated';

import { FullPlayer, MiniPlayer } from '@/src/components/player';
import { ActionSheet, ConfirmationModal, GlobalNotification } from '@/src/components/ui';
import { useAudioEngine } from '@/src/services';
import { useLibraryStore, usePlayerStore, useSettingsStore } from '@/src/stores';
import { ThemeProvider, useTheme } from '@/src/theme';

function isTrackPlayerNotificationUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const normalized = url.toLowerCase();
  return normalized.includes('notification.click');
}

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  const _hasLibraryHydrated = useLibraryStore(state => state._hasHydrated);
  const _hasSettingsHydrated = useSettingsStore(state => state._hasHydrated);

  useEffect(() => {
    if (loaded && _hasLibraryHydrated && _hasSettingsHydrated) {
      SplashScreen.hideAsync();
    }
  }, [loaded, _hasLibraryHydrated, _hasSettingsHydrated]);

  // Emergency timeout to hide splash screen after 5 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      SplashScreen.hideAsync();
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  if (!loaded || !_hasLibraryHydrated || !_hasSettingsHydrated) {
    return null;
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <ThemeProvider>
        <RootLayoutNav />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}



function AudioSync() {
  const next = usePlayerStore(state => state.next);
  const setLoading = usePlayerStore(state => state.setLoading);
  const setPosition = usePlayerStore(state => state.setPosition);
  const updateFromEngine = usePlayerStore(state => state.updateFromEngine);

  // Initialize the audio engine hook - this sets up Track Player
  const audioState = useAudioEngine();

  // Sync AudioEngine state to PlayerStore
  useEffect(() => {
    // Initialize Database
    import('@/src/services/database').then(m => m.getDatabase());
  }, []);

  // Sync audio state to player store
  // BUG FIX: Initialize ref with current store state so we don't think "Old Track" from native 
  // is a "new change" if we already had a null/new track in store.
  const lastState = useRef({
    isPlaying: false,
    isLoading: false,
    position: 0,
    duration: 0,
    queueIndex: -1,
    trackId: usePlayerStore.getState().currentTrack?.id
  });

  useEffect(() => {
    const storeTrackId = usePlayerStore.getState().currentTrack?.id;

    // Only update store if meaningful changes occurred
    const hasMeaningfulChange =
      audioState.isPlaying !== lastState.current.isPlaying ||
      audioState.isLoading !== lastState.current.isLoading ||
      audioState.queueIndex !== lastState.current.queueIndex ||
      audioState.currentTrack?.id !== lastState.current.trackId ||
      Math.abs((audioState.duration ?? 0) - lastState.current.duration) > 1000 ||
      Math.abs((audioState.position ?? 0) - lastState.current.position) > 1000;

    if (hasMeaningfulChange) {
      updateFromEngine({
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
    }
  }, [audioState.isPlaying, audioState.isLoading, audioState.position, audioState.duration, audioState.currentTrack, audioState.queueIndex, updateFromEngine]);

  // Handle track end - skip to next
  useEffect(() => {
    if (audioState.duration > 0 && audioState.position >= audioState.duration - 100) {
      // Track ended, play next
      // Note: Track Player handles this automatically when in queue mode
    }
  }, [audioState.position, audioState.duration, next]);

  return null;
}

function RootLayoutNav() {
  const { theme, isDark } = useTheme();
  // MiniPlayer is now handled via overlay, so we don't need to hide it based on route

  useEffect(() => {
    const handleUrl = (url: string | null | undefined) => {
      if (!isTrackPlayerNotificationUrl(url)) return;

      const { currentTrack, setPlayerVisible } = usePlayerStore.getState();
      if (currentTrack != null) {
        setPlayerVisible(true);
      }

      router.replace('/');
    };

    Linking.getInitialURL()
      .then(handleUrl)
      .catch(() => {
        // Ignore malformed initial URLs
      });

    const subscription = Linking.addEventListener('url', ({ url }: { url: string }) => {
      handleUrl(url);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  // Create Paper theme from our tokens
  const paperTheme = isDark
    ? {
      ...MD3DarkTheme,
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
    }
    : {
      ...MD3LightTheme,
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
    };

  return (
    <PaperProvider theme={paperTheme}>
      <NavigationThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <View style={styles.container}>
            <AudioSync />
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="artist" options={{ headerShown: false }} />
              <Stack.Screen name="album" options={{ headerShown: false }} />
              <Stack.Screen name="playlist" options={{ headerShown: false }} />
              <Stack.Screen name="tidal-artist" options={{ headerShown: false }} />
              <Stack.Screen name="tidal-album" options={{ headerShown: false }} />
              <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
              <Stack.Screen
                name="lyrics"
                options={{
                  presentation: 'fullScreenModal',
                  headerShown: false,
                  animation: 'slide_from_bottom',
                }}
              />
            </Stack>
            <ActionSheet />
            <ConfirmationModal />
            <GlobalNotification />
            <MiniPlayer />
            <FullPlayer />
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
