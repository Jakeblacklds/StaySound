import { hasNativeAndroidShell } from '@/modules/android-shell/src';
import NativeShellRoute from '@/src/features/shell/NativeShellRoute';
import ReactModalScreen from '@/src/features/shell/ReactModalScreen';

export default function ModalScreen() {
    return hasNativeAndroidShell ? <NativeShellRoute kind="modal" /> : <ReactModalScreen />;
}
