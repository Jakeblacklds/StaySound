import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import { Platform, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import Animated from 'react-native-reanimated';

export type ShellAction = { kind: string; id: string; action: string; index?: number; position?: number };
interface OverlayProps extends ViewProps {
    snapshot: string;
    onAction: (event: NativeSyntheticEvent<ShellAction>) => void;
}
interface ScreenProps extends ViewProps {
    model: string;
    lyrics: string;
    active: boolean;
    positionMs?: number;
    topInset: number;
    bottomInset: number;
    onAction: (event: NativeSyntheticEvent<ShellAction>) => void;
}
export const hasNativeAndroidShell = Platform.OS === 'android'
    && requireOptionalNativeModule('StaySoundOverlayHost') !== null
    && requireOptionalNativeModule('StaySoundShellScreen') !== null;
export const NativeOverlayHost = hasNativeAndroidShell
    ? requireNativeViewManager<OverlayProps>('StaySoundOverlayHost') : null;
export const NativeShellScreen = hasNativeAndroidShell
    ? Animated.createAnimatedComponent(requireNativeViewManager<ScreenProps>('StaySoundShellScreen')) : null;
