/**
 * StaySound Entry Point
 * 
 * This file registers the Track Player playback service for background audio.
 * It must be the entry point of the app to properly initialize the service.
 */

import { registerRootComponent } from 'expo';
import { ExpoRoot } from 'expo-router';
import TrackPlayer from 'react-native-track-player';
import { PlaybackService } from './src/services/playbackService';

// Must be registered before anything else
TrackPlayer.registerPlaybackService(() => PlaybackService);

// Export the app with expo-router
export function App() {
    const ctx = require.context('./app');
    return <ExpoRoot context={ctx} />;
}

registerRootComponent(App);
