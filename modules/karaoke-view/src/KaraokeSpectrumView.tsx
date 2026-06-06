import { requireNativeViewManager } from 'expo-modules-core';
import * as React from 'react';
import { Platform, type ViewProps } from 'react-native';

export interface KaraokeSpectrumViewProps extends ViewProps {
    /** Master on/off for the spectrum capture + render */
    enabled?: boolean;
    /** Whether audio is currently playing (drives capture start/stop + idle mode) */
    isPlaying?: boolean;
    /** Optional explicit ExoPlayer audio session id. 0 → auto-resolve from prefs. */
    audioSessionId?: number;
    /** Delay applied to PCM frames before rendering, compensating output latency */
    renderDelayMs?: number;
    /** Tint color (processColor-encoded int) */
    glowColor?: any;
}

const NativeView = Platform.OS === 'android'
    ? requireNativeViewManager<KaraokeSpectrumViewProps>('KaraokeSpectrumView')
    : null;

/**
 * Standalone bottom audio-spectrum visualizer ("aurora"), positioned with regular
 * RN layout — typically pinned to the very bottom of the screen, behind the UI.
 */
export function KaraokeSpectrumView(props: KaraokeSpectrumViewProps) {
    if (!NativeView) return null;
    return <NativeView {...(props as any)} />;
}
