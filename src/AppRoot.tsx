/// <reference types="expo/types/metro-require" />
import { ExpoRoot } from 'expo-router';
export default function AppRoot() {
    const context = require.context('../app');
    return <ExpoRoot context={context} />;
}
