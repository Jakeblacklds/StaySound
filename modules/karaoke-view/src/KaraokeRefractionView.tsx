import { requireNativeViewManager } from 'expo-modules-core';
import * as React from 'react';
import { Platform, type ViewProps } from 'react-native';

export interface KaraokeRefractionViewProps extends ViewProps {
    /** Master on/off for the refraction veil. */
    enabled?: boolean;
    /** Whether audio is currently playing (advances the CD spin so the album flows under the veil). */
    isPlaying?: boolean;
    /** The album cover URI to refract (loaded + center-cropped + downscaled natively). */
    artworkUri?: string;
    /** Tint color (processColor-encoded int) — drives the luminous rim highlight in the album hue. */
    glowColor?: any;
    /** Arc centre angle in degrees (screen space: 0 = right/3 o'clock, -90 = up/12 o'clock). */
    arcCenterDeg?: number;
    /** Arc sweep in degrees (how much of the rim the veil wraps). */
    arcSweepDeg?: number;
    /** Arc soft-edge in degrees (how gently the veil fades into the clean side). */
    arcFeatherDeg?: number;
    /** Inner radius of the veil band as a fraction of the cover radius (where the glass begins). */
    bandInnerFrac?: number;
    /** Refraction displacement at the rim as a fraction of the cover radius (how hard it bends). */
    refractionStrength?: number;
    /** Chromatic dispersion amount, 0..0.4. */
    chroma?: number;
    /** Edge blur tap radius as a fraction of the cover radius (the soft glassy blur). */
    blur?: number;
    /** Specular rim thickness as a fraction of the cover radius. */
    rimWidth?: number;
    /** Veil presence, 0..1. */
    intensity?: number;
    /** Cover diameter ÷ view size (a small margin lets the rim breathe). */
    coverFrac?: number;
}

const NativeView = Platform.OS === 'android'
    ? requireNativeViewManager<KaraokeRefractionViewProps>('KaraokeRefractionView')
    : null;

/**
 * Apple-style liquid-glass veil hugging the album cover's curved edge over an arc. Place it over
 * the cover, sized to the same rect; it refracts the live cover content within the arc band and
 * leaves the rest of the cover untouched.
 */
export function KaraokeRefractionView(props: KaraokeRefractionViewProps) {
    if (!NativeView) return null;
    return <NativeView {...(props as any)} />;
}
