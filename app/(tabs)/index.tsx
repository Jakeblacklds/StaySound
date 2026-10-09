import NativeHomeScreen, { hasNativeHome } from '@/src/features/home/NativeHomeScreen';
import ReactHomeScreen from '@/src/features/home/ReactHomeScreen';

// Only Android binaries containing the Kotlin module opt into the migration.
export default hasNativeHome ? NativeHomeScreen : ReactHomeScreen;
