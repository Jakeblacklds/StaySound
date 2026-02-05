import { ComponentStyles, Theme } from '../../types/theme';
import { baseDarkColors, baseLightColors, motion, spacing, typography } from '../tokens';

// Minimal (Apple Music) component styles - Clean, spacious, elegant
const minimalComponents: ComponentStyles = {
    trackItem: {
        height: 64,
        artworkSize: 48,
        artworkRadius: 6,
        showDivider: true,
        dividerInset: 64,
        activeScale: 0.99,
    },
    card: {
        aspectRatio: 1,
        imageRadius: 8,
        showShadow: true,
        titleSize: 15,
        subtitleSize: 13,
    },
    player: {
        artworkRadius: 8,
        controlsStyle: 'minimal',
        progressStyle: 'bar',
        showBlur: true,
        blurIntensity: 100,
    },
    navigation: {
        tabStyle: 'underline',
        headerStyle: 'large',
    },
};

// Minimal theme - Apple Music inspired, clean and spacious
export const minimalDark: Theme = {
    id: 'minimal-dark',
    name: 'Minimal',
    mode: 'dark',
    colors: {
        ...baseDarkColors,
        primary: '#FA586A', // Apple Music red/pink
        primaryContainer: '#3A1A1F',
        onPrimaryContainer: '#FFFFFF',
        secondary: '#8E8E93',
        secondaryContainer: '#1C1C1E',
        background: '#000000',
        surface: '#1C1C1E',
        surfaceVariant: '#2C2C2E',
        onPrimary: '#FFFFFF',
        onSecondary: '#FFFFFF',
        onBackground: '#FFFFFF',
        onSurface: '#FFFFFF',
        onSurfaceVariant: '#8E8E93',
        outline: '#3A3A3C',
    },
    spacing: {
        ...spacing,
        md: 16,
        lg: 24,
    },
    shapes: {
        borderRadius: {
            none: 0,
            sm: 6,
            md: 10,
            lg: 14,
            xl: 20,
            full: 9999,
        },
        elevation: {
            none: 0,
            sm: 2,
            md: 4,
            lg: 8,
        },
    },
    motion: {
        ...motion,
        duration: {
            instant: 150,
            fast: 250,
            normal: 350,
            slow: 500,
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
            sm: 13,
            md: 15,
            lg: 17,
            xl: 22,
            xxl: 28,
            display: 34,
        },
    },
    components: minimalComponents,
};

export const minimalLight: Theme = {
    ...minimalDark,
    id: 'minimal-light',
    name: 'Minimal Light',
    mode: 'light',
    colors: {
        ...baseLightColors,
        primary: '#FA586A',
        primaryContainer: '#FFE5E8',
        onPrimaryContainer: '#FA586A',
        secondary: '#8E8E93',
        secondaryContainer: '#F2F2F7',
        background: '#FFFFFF',
        surface: '#F2F2F7',
        surfaceVariant: '#E5E5EA',
        onPrimary: '#FFFFFF',
        onSecondary: '#000000',
        onBackground: '#000000',
        onSurface: '#000000',
        onSurfaceVariant: '#3C3C43',
        outline: '#C6C6C8',
    },
    components: minimalComponents,
};
