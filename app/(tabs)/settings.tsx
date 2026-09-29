import NativeSettingsScreen, { hasNativeSettings } from '@/src/features/settings/NativeSettingsScreen';
import ReactSettingsScreen from '@/src/features/settings/ReactSettingsScreen';

export default hasNativeSettings ? NativeSettingsScreen : ReactSettingsScreen;
