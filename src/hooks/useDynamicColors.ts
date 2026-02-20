/**
 * useDynamicColors - Hook to extract and use colors from album artwork
 */

import { useEffect, useMemo, useState } from 'react';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import { AlbumColors, getImageColors } from '../services/colorExtractor';

const DEFAULT_COLORS: AlbumColors = {
    primary: '#1DB954',
    secondary: '#191414',
    background: '#121212',
    text: '#FFFFFF',
    onPrimary: '#FFFFFF',
    onSurface: '#FFFFFF',
    accent: '#1DB954',
    isDark: true,
};

export function useDynamicColors(imageUri: string | undefined) {
    const [rawColors, setRawColors] = useState<AlbumColors>(DEFAULT_COLORS);
    const [isLoading, setIsLoading] = useState(false);

    // Shared values for smooth transitions
    const primary = useSharedValue(DEFAULT_COLORS.primary);
    const secondary = useSharedValue(DEFAULT_COLORS.secondary);
    const background = useSharedValue(DEFAULT_COLORS.background);
    const accent = useSharedValue(DEFAULT_COLORS.accent);
    const text = useSharedValue(DEFAULT_COLORS.text);
    const onPrimary = useSharedValue(DEFAULT_COLORS.onPrimary);
    const onSurface = useSharedValue(DEFAULT_COLORS.onSurface);

    const animated = useMemo(() => ({
        primary,
        secondary,
        background,
        accent,
        text,
        onPrimary,
        onSurface,
    }), [accent, background, onPrimary, onSurface, primary, secondary, text]);

    useEffect(() => {
        if (!imageUri) {
            setRawColors(DEFAULT_COLORS);
            return;
        }

        let cancelled = false;
        setIsLoading(true);

        getImageColors(imageUri)
            .then((extracted) => {
                if (!cancelled) {
                    setRawColors(extracted);
                    setIsLoading(false);

                    // Animate shared values
                    const config = { duration: 600 };
                    primary.value = withTiming(extracted.primary, config);
                    secondary.value = withTiming(extracted.secondary, config);
                    background.value = withTiming(extracted.background, config);
                    accent.value = withTiming(extracted.accent, config);
                    text.value = withTiming(extracted.text, config);
                    onPrimary.value = withTiming(extracted.onPrimary, config);
                    onSurface.value = withTiming(extracted.onSurface, config);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setRawColors(DEFAULT_COLORS);
                    setIsLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [imageUri]);

    return {
        colors: rawColors, // Keep backward compatibility
        isLoading,
        animated,
    };
}
