/**
 * albumSurface — tame the album-derived palette for dark surfaces.
 *
 * The extractor keeps backgrounds "true to the artwork", which is right for a
 * poster but too vivid for chrome: a saturated mid-lightness color as the app
 * surface makes lists, the dock and the player read as a colored wash instead
 * of a dark, cinematic room lit by the cover.
 *
 * `deepenAlbumBackground` CLAMPS saturation and lightness rather than scaling
 * them, so it is idempotent — applying it again (the theme deepens what the
 * player already deepened) is a no-op instead of a slow fade to black.
 */
import type { AlbumColors } from '../services/colorExtractor';
import { pickReadableColor } from './colorContrast';

export type DeepenOptions = {
    /** Upper bound for HSL saturation — keeps the hue, drops the neon. */
    maxSaturation?: number;
    /** Upper bound for HSL lightness — this is what makes it "darker". */
    maxLightness?: number;
    /** Floor so near-black artwork still has a hint of body. */
    minLightness?: number;
};

const DEFAULTS: Required<DeepenOptions> = {
    maxSaturation: 0.32,
    maxLightness: 0.13,
    minLightness: 0.045,
};

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i.exec(hex.trim());
    if (!match) return null;
    return {
        r: parseInt(match[1], 16),
        g: parseInt(match[2], 16),
        b: parseInt(match[3], 16),
    };
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            default: h = ((r - g) / d + 4) / 6; break;
        }
    }
    return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
    let r: number;
    let g: number;
    let b: number;
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p: number, q: number, t: number) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    const toByte = (c: number) =>
        Math.max(0, Math.min(255, Math.round(c * 255))).toString(16).padStart(2, '0');
    return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

/** Pull an album color down to a deep, low-chroma surface tone. */
export function deepenAlbumBackground(hex: string, options?: DeepenOptions): string {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;

    const { maxSaturation, maxLightness, minLightness } = { ...DEFAULTS, ...options };
    const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);

    // A washed-out artwork shouldn't gain chroma on the way down, so clamp only.
    const nextS = Math.min(s, maxSaturation);
    const nextL = Math.max(minLightness, Math.min(l, maxLightness));

    if (nextS === s && nextL === l) return hex;
    return hslToHex(h, nextS, nextL);
}

/**
 * Deepen a full album palette for a dark surface. `background` drives the
 * contrast colors, so `text`/`onSurface`/`isDark` are re-derived: a light
 * artwork used to hand us black text, which would be unreadable once the
 * surface itself goes dark.
 */
export function deepenAlbumPalette(colors: AlbumColors, options?: DeepenOptions): AlbumColors {
    const background = deepenAlbumBackground(colors.background, options);
    if (background === colors.background && colors.isDark) return colors;

    const onSurface = pickReadableColor(background, [colors.onSurface, '#FFFFFF', '#0B0D12']);

    return {
        ...colors,
        background,
        text: onSurface,
        onSurface,
        isDark: true,
    };
}
