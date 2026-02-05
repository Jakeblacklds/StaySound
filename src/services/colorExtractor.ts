/**
 * ColorExtractor - Extract dominant colors from album artwork
 * 
 * Uses react-native-image-colors to get palette colors for dynamic theming.
 */

import { getColors, ImageColorsResult } from 'react-native-image-colors';

export interface AlbumColors {
    primary: string;
    secondary: string;
    background: string;
    text: string;
    accent: string;
    isDark: boolean;
}

// Default colors when extraction fails
const DEFAULT_COLORS: AlbumColors = {
    primary: '#1DB954',
    secondary: '#191414',
    background: '#121212',
    text: '#FFFFFF',
    accent: '#1DB954',
    isDark: true,
};

/**
 * Calculate relative luminance of a hex color
 */
function getLuminance(hex: string): number {
    const rgb = hexToRgb(hex);
    if (!rgb) return 0;

    const [r, g, b] = [rgb.r, rgb.g, rgb.b].map(c => {
        c = c / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Convert hex to RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

/**
 * Determine if a color is dark
 */
function isColorDark(hex: string): boolean {
    return getLuminance(hex) < 0.5;
}

/**
 * Adjust color brightness
 */
function adjustBrightness(hex: string, factor: number): string {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;

    const adjust = (c: number) => Math.min(255, Math.max(0, Math.round(c * factor)));

    return `#${[rgb.r, rgb.g, rgb.b]
        .map(c => adjust(c).toString(16).padStart(2, '0'))
        .join('')}`;
}

/**
 * Get contrasting text color
 */
function getContrastingTextColor(bgColor: string): string {
    return isColorDark(bgColor) ? '#FFFFFF' : '#000000';
}

/**
 * Extract colors from an image URI
 */
export async function extractColorsFromImage(imageUri: string): Promise<AlbumColors> {
    try {
        if (!imageUri) {
            return DEFAULT_COLORS;
        }

        const result = await getColors(imageUri, {
            fallback: '#121212',
            cache: true,
            key: imageUri,
        });

        return processColorResult(result);
    } catch (error) {
        console.warn('[ColorExtractor] Failed to extract colors:', error);
        return DEFAULT_COLORS;
    }
}

/**
 * Process the color extraction result based on platform
 */
function processColorResult(result: ImageColorsResult): AlbumColors {
    let primary = DEFAULT_COLORS.primary;
    let secondary = DEFAULT_COLORS.secondary;
    let background = DEFAULT_COLORS.background;

    if (result.platform === 'android') {
        primary = result.vibrant || result.dominant || DEFAULT_COLORS.primary;
        secondary = result.darkVibrant || result.muted || DEFAULT_COLORS.secondary;
        background = result.darkMuted || result.dominant || DEFAULT_COLORS.background;
    } else if (result.platform === 'ios') {
        primary = result.primary || DEFAULT_COLORS.primary;
        secondary = result.secondary || DEFAULT_COLORS.secondary;
        background = result.background || DEFAULT_COLORS.background;
    }

    // Ensure background is dark enough for readability
    const bgLuminance = getLuminance(background);
    if (bgLuminance > 0.4) {
        background = adjustBrightness(background, 0.3);
    }

    const isDark = isColorDark(background);
    const text = getContrastingTextColor(background);

    // Create a vibrant accent color
    const accent = primary;

    return {
        primary,
        secondary,
        background,
        text,
        accent,
        isDark,
    };
}

/**
 * Create a gradient-friendly color pair
 */
export function createGradientColors(colors: AlbumColors): [string, string] {
    return [
        colors.background,
        adjustBrightness(colors.background, 0.6),
    ];
}

/**
 * Cache for extracted colors to avoid re-extraction
 */
const colorCache = new Map<string, AlbumColors>();

/**
 * Get colors with caching
 */
export async function getImageColors(imageUri: string): Promise<AlbumColors> {
    if (!imageUri) {
        return DEFAULT_COLORS;
    }

    // Check cache first
    const cached = colorCache.get(imageUri);
    if (cached) {
        return cached;
    }

    // Extract colors
    const colors = await extractColorsFromImage(imageUri);

    // Cache the result
    colorCache.set(imageUri, colors);

    // Limit cache size
    if (colorCache.size > 50) {
        const firstKey = colorCache.keys().next().value;
        if (firstKey) colorCache.delete(firstKey);
    }

    return colors;
}

/**
 * Clear the color cache
 */
export function clearColorCache(): void {
    colorCache.clear();
}
