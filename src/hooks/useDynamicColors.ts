/**
 * useDynamicColors - Hook to extract and use colors from album artwork
 */

import { useEffect, useState } from 'react';
import { AlbumColors, getImageColors } from '../services/colorExtractor';

const DEFAULT_COLORS: AlbumColors = {
    primary: '#1DB954',
    secondary: '#191414',
    background: '#121212',
    text: '#FFFFFF',
    accent: '#1DB954',
    isDark: true,
};

export function useDynamicColors(imageUri: string | undefined): {
    colors: AlbumColors;
    isLoading: boolean;
} {
    const [colors, setColors] = useState<AlbumColors>(DEFAULT_COLORS);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!imageUri) {
            setColors(DEFAULT_COLORS);
            return;
        }

        let cancelled = false;
        setIsLoading(true);

        getImageColors(imageUri)
            .then((extractedColors) => {
                if (!cancelled) {
                    setColors(extractedColors);
                    setIsLoading(false);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setColors(DEFAULT_COLORS);
                    setIsLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [imageUri]);

    return { colors, isLoading };
}
