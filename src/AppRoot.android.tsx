import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MD3DarkTheme, MD3LightTheme, PaperProvider } from 'react-native-paper';
import { useFonts } from 'expo-font';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as SplashScreen from 'expo-splash-screen';
import { AppBootstraps } from './bootstrap/AppBootstraps';
import { ThemeProvider, useTheme, createPaperFonts } from './theme';
import { useLibraryStore, useOnboardingStore, usePlayerStore, useSettingsStore } from './stores';
import { NativeGlobalOverlays } from './features/shell/NativeGlobalOverlays';
import { AndroidFullPlayer } from './components/player/AndroidFullPlayer';
import NativeHome from './features/home/NativeHomeScreen';
import NativeLibrary from './features/library/NativeLibraryScreen';
import NativeSearch from './features/tidal/screens/NativeTidalScreen';
import NativePlaylist from './features/playlists/NativePlaylistScreen';
import NativeSettings from './features/settings/NativeSettingsScreen';
import NativeEqualizer from './features/settings/NativeEqualizerScreen';
import NativeDetail from './features/details/NativeDetailScreen';
import NativeOnboarding from './features/onboarding/NativeOnboardingScreen';
import NativeShellRoute from './features/shell/NativeShellRoute';
import TidalArtist from '../app/tidal-artist/[id]';
import TidalAlbum from '../app/tidal-album/[id]';
import TidalPlaylist from '../app/tidal-playlist/[id]';
import TidalGenre from '../app/tidal-genre/[id]';
import { useI18n } from './i18n';
import { receiveNavigationSnapshot, RouteContext, useNavigationSnapshot, setNativePlayerVisible, requestNavigationSnapshot,
    type NavigationSnapshot, type RouteEntry } from './navigation/navigation.android';

interface HostProps extends ViewProps {
    ready: boolean; onboardingRequired: boolean; playerExpanded: boolean; bottomInset: number;
    sideInsets: { top: number; left: number; right: number };
    appearance: Record<string, string>; labels: Record<string, string>;
    onState: (event: NativeSyntheticEvent<{ snapshot: string }>) => void;
}
const Host = requireNativeViewManager<HostProps>('StaySoundNavigation');
const Slot = requireNativeViewManager<ViewProps & { entryKey: string }>('StaySoundNavigationSlot');

// This factory binds existing service adapters. It never computes a stack or chooses a destination.
function ServiceAdapter({ entry }: { entry: RouteEntry }) {
    const id = entry.arguments.id ?? '';
    switch (entry.path) {
        case '/': return <NativeHome />;
        case '/library': return <NativeLibrary />;
        case '/tidal': return <NativeSearch />;
        case '/playlists': return <NativePlaylist screen="list" />;
        case '/playlist-create': return <NativePlaylist screen="create" />;
        case '/playlist/[id]': return <NativePlaylist screen="detail" id={id} />;
        case '/settings': return <NativeSettings />;
        case '/artist/[id]': return <NativeDetail kind="artist" id={id} />;
        case '/album/[id]': return <NativeDetail kind="album" id={id} />;
        case '/tidal-artist/[id]': return <TidalArtist />;
        case '/tidal-album/[id]': return <TidalAlbum />;
        case '/tidal-playlist/[id]': return <TidalPlaylist />;
        case '/tidal-genre/[id]': return <TidalGenre />;
        case '/equalizer': return <NativeEqualizer />;
        case '/onboarding': return <NativeOnboarding />;
        case '/lyrics': return <NativeShellRoute kind="lyrics" />;
        case '/modal': return <NativeShellRoute kind="modal" />;
        case '/player': return null; // The existing Kotlin player is hosted above the route content.
        default: return null;
    }
}
let projectingPlayer = false;
function onState({ nativeEvent }: NativeSyntheticEvent<{ snapshot: string }>) {
    const value: NavigationSnapshot = JSON.parse(nativeEvent.snapshot);
    // Player visibility remains a compatibility projection for the audio/store adapters.
    projectingPlayer = true;
    usePlayerStore.getState().setPlayerVisible(value.current.path === '/player');
    projectingPlayer = false;
    receiveNavigationSnapshot(value);
}
function AndroidContent() {
    const { theme, isDark, config } = useTheme();
    const { t } = useI18n();
    const insets = useSafeAreaInsets();
    const state = useNavigationSnapshot();
    useEffect(() => { requestNavigationSnapshot(); }, []);
    const libraryReady = useLibraryStore(s => s._hasHydrated);
    const settingsReady = useSettingsStore(s => s._hasHydrated);
    const onboardingReady = useOnboardingStore(s => s._hasHydrated);
    const completed = useOnboardingStore(s => s.hasCompletedOnboarding);
    const track = usePlayerStore(s => s.currentTrack);
    const visible = usePlayerStore(s => s.playerVisible);
    const [fontsLoaded, fontError] = useFonts({ SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'), ...FontAwesome.font });
    const ready = libraryReady && settingsReady && onboardingReady && (fontsLoaded || !!fontError);
    useEffect(() => { if (ready && state) void SplashScreen.hideAsync(); }, [ready, !!state]);
    useEffect(() => usePlayerStore.subscribe((next, previous) => {
        if (!projectingPlayer && next.playerVisible !== previous.playerVisible) setNativePlayerVisible(next.playerVisible);
    }), []);
    const base = isDark ? MD3DarkTheme : MD3LightTheme;
    const paper = useMemo(() => ({ ...base, colors: { ...base.colors, ...theme.colors }, fonts: createPaperFonts(base.fonts) }), [base, theme.colors]);
    const appearance = useMemo(() => ({ ...theme.colors, dark: String(isDark), motion: config.lightweightMode ? 'off' : 'on' }), [theme.colors, isDark, config.lightweightMode]);
    const path = state?.current.path;
    return <PaperProvider theme={paper}>
        <View style={styles.fill}>
            <AppBootstraps isAppReady={ready} />
            <Host style={styles.fill} ready={ready} onboardingRequired={!completed} playerExpanded={visible}
                appearance={appearance} bottomInset={insets.bottom} sideInsets={{ top: insets.top, left: insets.left, right: insets.right }}
                labels={{ '/': t('tabs.home'), '/library': t('tabs.library'), '/tidal': 'Buscar', '/playlists': t('tabs.playlists'), '/settings': t('tabs.settings') }} onState={onState}>
                {ready ? state?.entries.filter(entry => entry.path !== '/player').map(entry => <Slot key={entry.key} entryKey={entry.key} style={styles.fill}>
                    <RouteContext.Provider value={{ entry, focused: entry.key === state.current.key }}>
                        <ServiceAdapter entry={entry} />
                    </RouteContext.Provider>
                </Slot>) : null}
            </Host>
            {ready && track && path !== '/onboarding' && path !== '/lyrics' && path !== '/modal' ? <AndroidFullPlayer /> : null}
            <NativeGlobalOverlays />
        </View>
    </PaperProvider>;
}
export default function AndroidAppRoot() {
    return <GestureHandlerRootView style={styles.fill}><SafeAreaProvider><ThemeProvider><AndroidContent /></ThemeProvider></SafeAreaProvider></GestureHandlerRootView>;
}
const styles = StyleSheet.create({ fill: { flex: 1 } });
