import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';
import { Platform } from 'react-native';

export interface NativeLibraryPlaybackSnapshot {
    trackId: string;
    queueIds: string[];
    linearIds: string[];
    index: number;
}
interface LibraryPlaybackModule {
    playQueue?: (tracks: string, startIndex: number, requestedAt: number) => Promise<void>;
    cancelPendingPlayback?: () => Promise<void>;
    addListener: (event: string, callback: (event: any) => void) => EventSubscription;
}

// Lazy, and feature-detected: old APKs may expose the view without playback APIs.
export function getNativeLibraryPlayback(): LibraryPlaybackModule | null {
    if (Platform.OS !== 'android') return null;
    const module = requireOptionalNativeModule<LibraryPlaybackModule>('StaySoundLibraryView');
    return typeof module?.playQueue === 'function' ? module : null;
}
