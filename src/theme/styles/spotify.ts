import { ComponentStyles, Theme } from '../../types/theme';
import { baseDarkColors, motion, spacing, typography } from '../tokens';

// Spotify component styles - Compact, card-heavy, minimal borders
const spotifyComponents: ComponentStyles = {
    trackItem: {
        height: 56,
        artworkSize: 40,
        artworkRadius: 4,
        showDivider: false,
        dividerInset: 0,
        activeScale: 0.98,
    },
    card: {
        aspectRatio: 1,
        imageRadius: 4,
        showShadow: false,
        titleSize: 14,
        subtitleSize: 11,
    },
    player: {
        artworkRadius: 4,
        controlsStyle: 'inline',
        progressStyle: 'bar',
        showBlur: false,
        blurIntensity: 0,
    },
    navigation: {
        tabStyle: 'icons',
        headerStyle: 'compact',
    },
};

// Spotify theme - Dark, card-based, vibrant green accent
export const spotifyDark: Theme = {
    id: 'spotify-dark',
    name: 'Spotify',
    mode: 'dark',
    colors: {
        ...baseDarkColors,
        primary: '#1DB954',
        primaryContainer: '#1A7A3E',
        onPrimaryContainer: '#FFFFFF',
        secondary: '#B3B3B3',
        secondaryContainer: '#282828',
        background: '#121212',
        surface: '#181818',
        surfaceVariant: '#282828',
        error: '#E91429',
        onPrimary: '#000000',
        onSecondary: '#000000',
        onBackground: '#FFFFFF',
        onSurface: '#FFFFFF',
        onSurfaceVariant: '#B3B3B3',
        outline: '#404040',
    },
    spacing: {
        ...spacing,
        md: 12,
        lg: 20,
    },
    shapes: {
        borderRadius: {
            none: 0,
            sm: 4,
            md: 4,
            lg: 8,
            xl: 8,
            full: 9999,
        },
        elevation: {
            none: 0,
            sm: 0,
            md: 0,
            lg: 0,
        },
    },
    motion: {
        ...motion,
        duration: {
            instant: 100,
            fast: 150,
            normal: 200,
            slow: 300,
        },
    },
    typography: {
        ...typography,
        fontFamily: {
            regular: 'System',
            medium: 'System',
            bold: 'System',
        },
        fontSize: {
            xs: 11,
            sm: 12,
            md: 14,
            lg: 16,
            xl: 20,
            xxl: 24,
            display: 48,
        },
    },
    components: spotifyComponents,
};

// Spotify only has dark mode, but we provide a "light" variant 
// that's still dark-ish but with lighter surfaces
export const spotifyLight: Theme = {
    ...spotifyDark,
    id: 'spotify-light',
    name: 'Spotify Light',
    mode: 'light',
    colors: {
        ...spotifyDark.colors,
        background: '#F8F8F8',
        surface: '#FFFFFF',
        surfaceVariant: '#F0F0F0',
        onBackground: '#191414',
        onSurface: '#191414',
        onSurfaceVariant: '#535353',
        outline: '#DFDFDF',
    },
    components: spotifyComponents,
};
