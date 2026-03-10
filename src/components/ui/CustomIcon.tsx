import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import * as Icons from './icons';
import { useTheme } from '@/src/theme';

export type IconName =
    | 'Ajustes'
    | 'Album'
    | 'Artista'
    | 'Canción'
    | 'Cola'
    | 'Descargar'
    | 'Home'
    | 'Library'
    | 'Lyrics'
    | 'Next'
    | 'Pause'
    | 'Play'
    | 'Playlist'
    | 'Previous'
    | 'Reciente'
    | 'Repetir 0'
    | 'Repetir 1'
    | 'Shuffle';

// Map icon names to their generated SVGR React Native components
const iconMap: Record<IconName, React.ElementType> = {
    'Ajustes': Icons.Ajustes,
    'Album': Icons.Album,
    'Artista': Icons.Artista,
    'Canción': Icons.Canción,
    'Cola': Icons.Cola,
    'Descargar': Icons.Descargar,
    'Home': Icons.Home,
    'Library': Icons.Library,
    'Lyrics': Icons.Lyrics,
    'Next': Icons.Next,
    'Pause': Icons.Pause,
    'Play': Icons.Play,
    'Playlist': Icons.Playlist,
    'Previous': Icons.Previous,
    'Reciente': Icons.Reciente,
    'Repetir 0': Icons.Repetir0,
    'Repetir 1': Icons.Repetir1,
    'Shuffle': Icons.Shuffle,
};

interface CustomIconProps {
    name: IconName;
    size?: number;
    // Optional incoming color; we enhance it with dynamic theme accenting.
    color?: string;
    forceDynamicColor?: boolean;
    style?: StyleProp<ViewStyle>;
}

type Rgb = { r: number; g: number; b: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const parseHexColor = (value: string): Rgb | null => {
    const hex = value.trim().replace('#', '');

    if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        if ([r, g, b].some(Number.isNaN)) return null;
        return { r, g, b };
    }

    if (hex.length === 6 || hex.length === 8) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        if ([r, g, b].some(Number.isNaN)) return null;
        return { r, g, b };
    }

    return null;
};

const parseRgbColor = (value: string): Rgb | null => {
    const match = value.trim().match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!match) return null;

    const r = clamp(Number(match[1]), 0, 255);
    const g = clamp(Number(match[2]), 0, 255);
    const b = clamp(Number(match[3]), 0, 255);
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b };
};

const parseColor = (value?: string): Rgb | null => {
    if (!value) return null;
    if (value.startsWith('#')) return parseHexColor(value);
    if (value.startsWith('rgb')) return parseRgbColor(value);
    return null;
};

const toHex = ({ r, g, b }: Rgb) => {
    const toHexByte = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
    return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
};

const mix = (from: Rgb, to: Rgb, amount: number): Rgb => {
    const t = clamp(amount, 0, 1);
    return {
        r: from.r + (to.r - from.r) * t,
        g: from.g + (to.g - from.g) * t,
        b: from.b + (to.b - from.b) * t,
    };
};

const colorSpread = ({ r, g, b }: Rgb) => Math.max(r, g, b) - Math.min(r, g, b);

const isNearMonochrome = (rgb: Rgb) => colorSpread(rgb) < 18;

const isNearWhiteOrBlack = (rgb: Rgb) => {
    const avg = (rgb.r + rgb.g + rgb.b) / 3;
    return avg > 245 || avg < 20;
};

const getDynamicIconColor = (inputColor: string | undefined, primary: string, forceDynamicColor = false) => {
    const baseColor = inputColor ?? primary;
    const base = parseColor(baseColor);
    const accent = parseColor(primary);

    if (!base || !accent) return baseColor;
    if (!forceDynamicColor && inputColor && isNearWhiteOrBlack(base)) return baseColor;
    if (forceDynamicColor && inputColor && isNearWhiteOrBlack(base)) return primary;

    const spread = colorSpread(base);
    const mixAmount = forceDynamicColor
        ? (isNearMonochrome(base) ? 0.72 : spread < 42 ? 0.5 : 0.26)
        : (isNearMonochrome(base) ? 0.62 : spread < 42 ? 0.35 : 0.18);
    return toHex(mix(base, accent, mixAmount));
};

export const CustomIcon: React.FC<CustomIconProps> = ({ name, size = 24, color, forceDynamicColor = false, style }) => {
    const { theme } = useTheme();
    const SvgComponent = iconMap[name];

    if (!SvgComponent) {
        console.warn(`Icon ${name} not found!`);
        return null;
    }

    const dynamicColor = getDynamicIconColor(color, theme.colors.primary, forceDynamicColor);

    return (
        <View style={style}>
            <SvgComponent width={size} height={size} color={dynamicColor} />
        </View>
    );
};
