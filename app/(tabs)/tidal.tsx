import NativeTidalScreen, { hasNativeTidal } from '@/src/features/tidal/screens/NativeTidalScreen';
import TidalScreen from '@/src/features/tidal/screens/TidalScreen';

export default hasNativeTidal ? NativeTidalScreen : TidalScreen;
