import { useMemo } from 'react';
import { useTheme } from './ThemeProvider';

export type ImageCachePolicy = 'none' | 'disk' | 'memory-disk';
export type PerformanceMode = 'normal' | 'lite';

export interface PerformanceProfile {
    mode: PerformanceMode;
    imageCachePolicyPrimary: ImageCachePolicy;
    imageCachePolicyList: ImageCachePolicy;
    imageCachePolicyOverlay: ImageCachePolicy;
    enableDynamicColors: boolean;
    enableAnimatedBackgrounds: boolean;
    enableBlurEffects: boolean;
    enableArtworkPreload: boolean;
    reducedListWindowing: boolean;
    releaseLyricsStateWhenHidden: boolean;
    queueContextLimit: number;
    artistMemoryCacheLimit: number;
}

export function getPerformanceProfile(lightweightMode: boolean, dynamicColorsEnabled: boolean): PerformanceProfile {
    if (lightweightMode) {
        return {
            mode: 'lite',
            imageCachePolicyPrimary: 'disk',
            imageCachePolicyList: 'disk',
            imageCachePolicyOverlay: 'none',
            enableDynamicColors: false,
            enableAnimatedBackgrounds: false,
            enableBlurEffects: false,
            enableArtworkPreload: false,
            reducedListWindowing: true,
            releaseLyricsStateWhenHidden: true,
            queueContextLimit: 420,
            artistMemoryCacheLimit: 40,
        };
    }

    return {
        mode: 'normal',
        imageCachePolicyPrimary: 'memory-disk',
        imageCachePolicyList: 'disk',
        imageCachePolicyOverlay: 'none',
        enableDynamicColors: dynamicColorsEnabled,
        enableAnimatedBackgrounds: true,
        enableBlurEffects: true,
        enableArtworkPreload: true,
        reducedListWindowing: false,
        releaseLyricsStateWhenHidden: true,
        queueContextLimit: 700,
        artistMemoryCacheLimit: 80,
    };
}

export function usePerformanceProfile(): PerformanceProfile {
    const { config } = useTheme();
    return useMemo(
        () => getPerformanceProfile(config.lightweightMode, config.dynamicColors),
        [config.dynamicColors, config.lightweightMode]
    );
}
