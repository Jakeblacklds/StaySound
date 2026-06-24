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
    /**
     * Composition anchor. 'lyrics' (default) keeps the upper-middle reading band dim;
     * 'artwork' centers the breathing glow as a halo around the album cover (use with
     * `focusY`) and protects the lower transport band instead.
     */
    anchorMode?: 'lyrics' | 'artwork';
    /**
     * The medios+agudos treatment in 'artwork' mode (graves are unaffected):
     *  · 'columns'  — the diagonal stage-light rig (directional, energetic).
     *  · 'aurora'   — domain-warped curtains framing the bloom (ambient). [default]
     *  · 'caustics' — a liquid water-light web (ambient, "liquid").
     *  · 'waveformArc' — a discreet mid-frequency waveform hugging the album edge.
     * 'aurora'/'caustics' need AGSL (API 33+); older devices fall back to a soft mist.
     */
    spectrumTheme?: 'columns' | 'aurora' | 'caustics' | 'waveformArc' | 'refractionVeil';
    /** Vertical focus of the bright core, normalized [0,1] (e.g. the album-cover center). */
    focusY?: number;
    /** Album artwork diameter in React Native layout points, used by edge-anchored effects. */
    artworkSize?: number;
    /** Particle emission multiplier. 1 keeps the default density. */
    particleIntensity?: number;
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
