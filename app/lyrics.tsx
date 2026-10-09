import { hasNativeAndroidShell } from '@/modules/android-shell/src';
import NativeShellRoute from '@/src/features/shell/NativeShellRoute';
import ReactLyricsScreen from '@/src/features/shell/ReactLyricsScreen';

export default function LyricsScreen() {
    return hasNativeAndroidShell ? <NativeShellRoute kind="lyrics" /> : <ReactLyricsScreen />;
}
