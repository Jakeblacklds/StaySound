import NativeLibraryScreen, { hasNativeLibrary } from '@/src/features/library/NativeLibraryScreen';
import ReactLibraryScreen from '@/src/features/library/ReactLibraryScreen';

// Android APKs with the Kotlin module use the native screen. Other platforms and
// older binaries retain their existing implementation during the gradual migration.
export default hasNativeLibrary ? NativeLibraryScreen : ReactLibraryScreen;
