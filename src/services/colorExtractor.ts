/**
 * ColorExtractor - Extract dominant colors from album artwork
 * 
 * Uses react-native-image-colors to get palette colors for dynamic theming.
 */

import { getColors, ImageColorsResult } from 'react-native-image-colors';
import { FileSystemStorage } from './storage';

export interface AlbumColors {
    primary: string;
    secondary: string;
    background: string;
    text: string;           // Contrasting with background
    onPrimary: string;      // Contrasting with primary
    onSurface: string;      // Contrasting with background (explicit)
    accent: string;
    isDark: boolean;        // Is the background dark?
}

// Default colors when extraction fails
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
    return getLuminance(hex) < 0.45;
}

/**
 * Adjust color brightness
 * Handles pure black by adding a base offset when brightening
 */
function adjustBrightness(hex: string, factor: number): string {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;

    const adjust = (c: number) => {
        if (factor > 1) {
            // Brighten: ensure movement even from 0
            const offset = 30 * (factor - 1);
            return Math.min(255, Math.round(c * factor + offset));
        } else {
            // Darken
            return Math.min(255, Math.max(0, Math.round(c * factor)));
        }
    };

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
        // Try to get a non-black vibrant color first
        primary = result.vibrant && getLuminance(result.vibrant) > 0.01 ? result.vibrant :
            result.lightVibrant || result.dominant || DEFAULT_COLORS.primary;
        secondary = result.darkVibrant || result.muted || DEFAULT_COLORS.secondary;
        background = result.darkMuted || result.dominant || DEFAULT_COLORS.background;
    } else if (result.platform === 'ios') {
        primary = result.primary || DEFAULT_COLORS.primary;
        secondary = result.secondary || DEFAULT_COLORS.secondary;
        background = result.background || DEFAULT_COLORS.background;
    }

    // MANDATORY BACKGROUND DARKENING for immersive/glass look
    // This ensures that even if extraction is "bright", the player UI stays readable
    const bgLuminance = getLuminance(background);
    if (bgLuminance > 0.15) {
        background = adjustBrightness(background, 0.1); // Force very dark
    } else if (bgLuminance < 0.02) {
        background = '#0F0D13'; // Use a standard deep charcoal instead of pure black for cleaner visuals
    }

    // ENSURE PRIMARY COLOR CONTRAST AGAINST BACKGROUND
    // If primary is too dark and used on icons, it will be invisible.
    let primaryLum = getLuminance(primary);
    const bgLum = getLuminance(background);

    // If primary and background are both very dark (Delta < 0.1), boost primary
    if (Math.abs(primaryLum - bgLum) < 0.1) {
        if (bgLum < 0.5) {
            primary = adjustBrightness(primary, 4); // Brighten primary significantly
        } else {
            primary = adjustBrightness(primary, 0.4); // Darken primary if bg is light
        }
    }

    // Re-check luminance after adjustment
    primaryLum = getLuminance(primary);
    if (primaryLum < 0.15 && bgLum < 0.2) {
        // Absolute fallback if it's still too dark
        primary = '#BB86FC'; // Material Dark Purple as a pleasant fallback
    }

    const isDark = isColorDark(background);
    const text = getContrastingTextColor(background);
    const onPrimary = getContrastingTextColor(primary);
    const onSurface = getContrastingTextColor(background);

    // Create a vibrant accent color
    const accent = primary;

    return {
        primary,
        secondary,
        background,
        text,
        onPrimary,
        onSurface,
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
 * Generate a simple hash for cache key
 */
function generateCacheKey(uri: string): string {
    if (uri.startsWith('data:')) {
        let hash = 0;
        const sample = uri.slice(0, 1000) + uri.slice(-1000) + uri.length.toString();
        for (let i = 0; i < sample.length; i++) {
            const char = sample.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return `data_${Math.abs(hash).toString(16)}`;
    }
    return uri;
}

const colorCache = new Map<string, AlbumColors>();
const PERSISTED_COLOR_CACHE_KEY = 'staysound-image-colors';
const MAX_PERSISTED_COLOR_CACHE = 120;
let persistedColorCacheLoaded = false;
let persistedColorCachePromise: Promise<void> | null = null;
let persistColorCacheTimer: ReturnType<typeof setTimeout> | null = null;

function serializeColorCacheEntries(entries: Map<string, AlbumColors>) {
    return JSON.stringify(Array.from(entries.entries()));
}

async function ensurePersistedColorCacheLoaded() {
    if (persistedColorCacheLoaded) return;
    if (persistedColorCachePromise) return persistedColorCachePromise;

    persistedColorCachePromise = FileSystemStorage.getItem(PERSISTED_COLOR_CACHE_KEY)
        .then((raw) => {
            if (!raw) return;

            try {
                const parsed = JSON.parse(raw) as Array<[string, AlbumColors]>;
                if (!Array.isArray(parsed)) return;

                parsed.forEach((entry) => {
                    if (!Array.isArray(entry) || entry.length !== 2) return;
                    const [key, value] = entry;
                    if (typeof key !== 'string' || !value) return;
                    colorCache.set(key, value);
                });
            } catch (error) {
                console.warn('[ColorExtractor] Failed to parse persisted color cache:', error);
            }
        })
        .finally(() => {
            persistedColorCacheLoaded = true;
            persistedColorCachePromise = null;
        });

    return persistedColorCachePromise;
}

function trimColorCache() {
    while (colorCache.size > MAX_PERSISTED_COLOR_CACHE) {
        const oldestKey = colorCache.keys().next().value;
        if (!oldestKey) break;
        colorCache.delete(oldestKey);
    }
}

function schedulePersistedColorCacheWrite() {
    if (persistColorCacheTimer !== null) {
        clearTimeout(persistColorCacheTimer);
    }

    persistColorCacheTimer = setTimeout(() => {
        persistColorCacheTimer = null;
        trimColorCache();
        void FileSystemStorage.setItem(PERSISTED_COLOR_CACHE_KEY, serializeColorCacheEntries(colorCache));
    }, 250);
}

export async function getImageColors(imageUri: string): Promise<AlbumColors> {
    if (!imageUri) {
        return DEFAULT_COLORS;
    }

    await ensurePersistedColorCacheLoaded();

    const cacheKey = generateCacheKey(imageUri);
    const cached = colorCache.get(cacheKey);
    if (cached) {
        // Refresh recency so frequently used palettes stay persisted.
        colorCache.delete(cacheKey);
        colorCache.set(cacheKey, cached);
        return cached;
    }

    const colors = await extractColorsFromImage(imageUri);
    colorCache.set(cacheKey, colors);
    trimColorCache();
    schedulePersistedColorCacheWrite();

    return colors;
}

export function clearColorCache(): void {
    colorCache.clear();
    persistedColorCacheLoaded = true;
    if (persistColorCacheTimer !== null) {
        clearTimeout(persistColorCacheTimer);
        persistColorCacheTimer = null;
    }
    void FileSystemStorage.removeItem(PERSISTED_COLOR_CACHE_KEY);
}
