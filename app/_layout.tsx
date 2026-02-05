import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { MD3DarkTheme, MD3LightTheme, PaperProvider } from 'react-native-paper';
import 'react-native-reanimated';

import { MiniPlayer } from '@/src/components/player';
import { AudioEngine, useAudioEngine } from '@/src/services';
import { usePlayerStore } from '@/src/stores';
import { ThemeProvider, useTheme } from '@/src/theme';

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

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
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



function RootLayoutNav() {
  const { theme, isDark } = useTheme();
  const pathname = usePathname();
  const { next, setLoading, setPosition, isPlaying: storeIsPlaying } = usePlayerStore();

  // Initialize the audio engine hook to set the global player instance
  const { status } = useAudioEngine();

  // Sync AudioEngine events to PlayerStore
  useEffect(() => {
    // Initialize TrackPlayer for media session
    import('@/src/services/trackPlayerService').then(m => m.initializeTrackPlayer());

    AudioEngine.initialize({
      onTrackEnd: () => {
        next();
      },
      onStateChange: (state) => {
        // We could sync more here, but most is handled by hooks
      },
      onError: (error) => {
        console.error('Audio Error:', error);
      }
    });
  }, [next]);

  // Update store loading/position state from engine status
  useEffect(() => {
    setLoading(status.isLoaded === false);
    setPosition((status.currentTime ?? 0) * 1000);
  }, [status.isLoaded, status.currentTime, setLoading, setPosition]);

  const isPlayerScreen = pathname === '/player';

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
        <View style={styles.container}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
            <Stack.Screen
              name="player"
              options={{
                presentation: 'fullScreenModal',
                headerShown: false,
                animation: 'slide_from_bottom',
              }}
            />
          </Stack>
          {!isPlayerScreen && <MiniPlayer />}
        </View>
      </NavigationThemeProvider>
    </PaperProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

