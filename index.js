/**
 * StaySound Entry Point
 *
 * This file registers the Track Player playback service for background audio.
 * It must be the entry point of the app to properly initialize the service.
 */

import { registerRootComponent } from 'expo';
import AppRoot from './src/AppRoot';
import TrackPlayer from 'react-native-track-player';

// Must be registered before anything else
TrackPlayer.registerPlaybackService(() => require('./src/services/trackPlayerEvents'));

// Metro selects the Kotlin host for Android and Expo Router for iOS/web.
export function App() {
    return <AppRoot />;
}

registerRootComponent(App);
