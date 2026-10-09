import { hasNativeAndroidShell } from '@/modules/android-shell/src';
import { NativeGlobalOverlays } from '@/src/features/shell/NativeGlobalOverlays';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { router, Stack, usePathname, useRootNavigationState } from 'expo-router';
import { useEffect } from 'react';
import { InteractionManager, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { MD3DarkTheme, MD3LightTheme, PaperProvider } from 'react-native-paper';
import 'react-native-reanimated';

import { AppBootstraps } from '@/src/bootstrap/AppBootstraps';
import { FullPlayer } from '@/src/components/player';
import { WebAmbientBackground } from '@/src/components/backgrounds/WebAmbientBackground';
import { ActionSheet, ConfirmationModal, GlobalNotification } from '@/src/components/ui';
import { useLibraryStore, useOnboardingStore, usePlayerStore, useSettingsStore } from '@/src/stores';
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
  const isAppReady =
    loaded &&
    _hasLibraryHydrated &&
    _hasSettingsHydrated &&
    _hasOnboardingHydrated;

  return (
    <GestureHandlerRootView style={styles.container}>
      <ThemeProvider>
        <RootLayoutNav isAppReady={isAppReady} />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function RootLayoutNav({ isAppReady }: { isAppReady: boolean }) {
  const { theme, isDark } = useTheme();
  const hasCompletedOnboarding = useOnboardingStore(state => state.hasCompletedOnboarding);
  const currentTrack = usePlayerStore(state => state.currentTrack);
  const isPlayerVisible = usePlayerStore(state => state.playerVisible);
  const pathname = usePathname();
  const rootNavigationState = useRootNavigationState();
  const canNavigate = isAppReady && !!rootNavigationState?.key;
  const shouldMountFullPlayer = (isPlayerVisible || currentTrack != null)
    && !(hasNativeAndroidShell && (pathname === '/lyrics' || pathname === '/modal'));

  useEffect(() => {
    if (!canNavigate) {
      return;
    }

    const task = InteractionManager.runAfterInteractions(() => {
      if (!hasCompletedOnboarding) {
        if (pathname !== '/onboarding') {
          router.navigate('/onboarding' as any);
        }
        return;
      }

      if (pathname === '/onboarding') {
        router.navigate('/');
      }
    });

    return () => {
      task.cancel();
    };
  }, [canNavigate, hasCompletedOnboarding, pathname]);

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
            <AppBootstraps isAppReady={isAppReady} />
            <WebAmbientBackground />
            <Stack
              screenOptions={{
                headerShown: false,
                animation: 'fade_from_bottom',
                contentStyle: styles.transparentScene,
              }}
            >
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
            {!hasNativeAndroidShell ? <>
              <ActionSheet />
              <ConfirmationModal />
              <GlobalNotification />
            </> : null}

            {shouldMountFullPlayer ? <FullPlayer /> : null}
            {hasNativeAndroidShell ? <NativeGlobalOverlays /> : null}
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
  transparentScene: {
    backgroundColor: 'transparent',
  },
});

