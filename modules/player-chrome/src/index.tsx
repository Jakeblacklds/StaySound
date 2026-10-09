import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import { Platform, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import Animated from 'react-native-reanimated';

export interface ChromeAction { action: string; key?: string }
interface MiniProps extends ViewProps {
    track: Record<string, string>;
    labels: Record<string, string>;
    appearance: Record<string, string>;
    loading: boolean;
    paused: boolean;
    expansionProgress?: number;
    titleColor?: number;
    onAction: (event: NativeSyntheticEvent<ChromeAction>) => void;
}
interface NavigationProps extends ViewProps {
    items: Array<{ key: string; name: string; label: string }>;
    activeKey: string;
    appearance: Record<string, string>;
    surfaceColor?: number;
    shadeOpacity?: number;
    dark: boolean;
    onAction: (event: NativeSyntheticEvent<ChromeAction>) => void;
}

// An older binary receiving an OTA keeps its existing renderer until the APK is updated.
export const hasNativePlayerChrome = Platform.OS === 'android'
    && requireOptionalNativeModule('StaySoundMiniPlayer') !== null
    && requireOptionalNativeModule('StaySoundNavigationBar') !== null;
export const NativeMiniPlayerView = hasNativePlayerChrome
    ? Animated.createAnimatedComponent(requireNativeViewManager<MiniProps>('StaySoundMiniPlayer'))
    : null;
export const NativeNavigationBarView = hasNativePlayerChrome
    ? Animated.createAnimatedComponent(requireNativeViewManager<NavigationProps>('StaySoundNavigationBar'))
    : null;

export type FullPlayerAction = {
    action: string; trackId: string; id?: string; index?: number; from?: number; to?: number;
    revision?: string; position?: number; value?: string | number; enabled?: boolean; visible?: boolean; step?: number;
};
interface FullPlayerProps extends ViewProps {
    model: string;
    visible: boolean;
    blocked: boolean;
    backRequest: number;
    layoutConfig: Record<string, number>;
    positionMs?: number;
    palette: Record<string, string>;
    queue: string;
    lyrics: string;
    onAction: (event: NativeSyntheticEvent<FullPlayerAction>) => void;
    onTransition: (event: NativeSyntheticEvent<{ progress: number }>) => void;
}
export const hasNativeFullPlayer = hasNativePlayerChrome
    && requireOptionalNativeModule('StaySoundFullPlayer') !== null;
export const NativeFullPlayerView = hasNativeFullPlayer
    ? Animated.createAnimatedComponent(requireNativeViewManager<FullPlayerProps>('StaySoundFullPlayer'))
    : null;
