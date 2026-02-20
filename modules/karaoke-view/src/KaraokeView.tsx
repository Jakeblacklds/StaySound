import { requireNativeViewManager } from 'expo-modules-core';
import * as React from 'react';
import { Platform, View } from 'react-native';
import type { KaraokeViewProps } from './KaraokeView.types';

// Only available on Android
const NativeView = Platform.OS === 'android'
    ? requireNativeViewManager<KaraokeViewProps>('KaraokeView')
    : null;

/**
 * Native Kotlin karaoke lyrics view
 * 
 * Features:
 * - 120fps rendering via Android Canvas
 * - Word-by-word highlight with glow effect
 * - Smooth auto-scroll with exponential damping
 * - O(1) line lookup for precise timing
 * 
 * @example
 * ```tsx
 * <KaraokeView
 *   style={{ flex: 1 }}
 *   lyrics={lyricsJson.lyrics}
 *   currentTimeMs={position}
 *   onLineChange={({ nativeEvent }) => console.log(nativeEvent.lineIndex)}
 * />
 * ```
 */
export function KaraokeView(props: KaraokeViewProps) {
    if (!NativeView) {
        // Fallback for iOS or web - show placeholder
        return (
            <View
                style={[props.style, { backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }]}
            >
                {/* Could show a JS fallback here */}
            </View>
        );
    }

    return <NativeView {...props} />;
}
