import { ComponentStyles, Theme } from '../../types/theme';
import { baseDarkColors, baseLightColors, spacing, typography } from '../tokens';

// Material 3 component styles - Expressive, rounded, dynamic
const material3Components: ComponentStyles = {
    trackItem: {
        height: 72,
        artworkSize: 56,
        artworkRadius: 12,
        showDivider: true,
        dividerInset: 72,
        activeScale: 0.95,
    },
    card: {
        aspectRatio: 1,
        imageRadius: 16,
        showShadow: true,
        titleSize: 16,
        subtitleSize: 14,
    },
    player: {
        artworkRadius: 28,
        controlsStyle: 'floating',
        progressStyle: 'bar',
        showBlur: true,
        blurIntensity: 80,
    },
    navigation: {
        tabStyle: 'pills',
        headerStyle: 'large',
    },
};

// Material 3 Expressive theme - Dynamic, bold, with emphasis on motion
export const material3Dark: Theme = {
    id: 'material3-dark',
    name: 'Material 3',
    mode: 'dark',
    colors: {
        ...baseDarkColors,
        primary: '#D0BCFF',
        primaryContainer: '#4F378B',
        onPrimaryContainer: '#EADDFF',
        secondary: '#CCC2DC',
        secondaryContainer: '#4A4458',
        background: '#0F0D13',
        surface: '#1D1B20',
        surfaceVariant: '#49454F',
        onPrimary: '#381E72',
        onSecondary: '#332D41',
        onBackground: '#E6E1E5',
        onSurface: '#E6E1E5',
        onSurfaceVariant: '#CAC4D0',
        outline: '#938F99',
        error: '#F2B8B5',
        onError: '#601410',
    },
    spacing,
    shapes: {
        borderRadius: {
            none: 0,
            sm: 8,
            md: 12,
            lg: 16,
            xl: 28,
            full: 9999,
        },
        elevation: {
            none: 0,
            sm: 1,
            md: 3,
            lg: 6,
        },
    },
    motion: {
        duration: {
            instant: 100,
            fast: 200,
            normal: 400,
            slow: 600,
        },
        easing: {
            standard: 'cubic-bezier(0.2, 0.0, 0, 1.0)',
            decelerate: 'cubic-bezier(0.0, 0.0, 0, 1.0)',
            accelerate: 'cubic-bezier(0.3, 0.0, 0.8, 0.15)',
        },
    },
    typography: {
        ...typography,
        fontSize: {
            xs: 11,
            sm: 12,
            md: 14,
            lg: 16,
            xl: 22,
            xxl: 28,
            display: 45,
        },
    },
    components: material3Components,
};

export const material3Light: Theme = {
    ...material3Dark,
    id: 'material3-light',
    name: 'Material 3 Light',
    mode: 'light',
    colors: {
        ...baseLightColors,
        primary: '#6750A4',
        primaryContainer: '#EADDFF',
        onPrimaryContainer: '#21005E',
        secondary: '#625B71',
        secondaryContainer: '#E8DEF8',
        background: '#FFFBFE',
        surface: '#FFFBFE',
        surfaceVariant: '#E7E0EC',
        onPrimary: '#FFFFFF',
        onSecondary: '#FFFFFF',
        onBackground: '#1C1B1F',
        onSurface: '#1C1B1F',
        onSurfaceVariant: '#49454F',
        outline: '#79747E',
        error: '#B3261E',
        onError: '#FFFFFF',
    },
    components: material3Components,
};
