import { ComponentStyles, Theme } from '../../types/theme';
import { baseDarkColors, baseLightColors, spacing, typography } from '../tokens';

// Material 3 component styles - Expressive, rounded, dynamic
const material3Components: ComponentStyles = {
    trackItem: {
        height: 76,
        artworkSize: 58,
        artworkRadius: 14,
        showDivider: true,
        dividerInset: 78,
        activeScale: 0.97,
        variant: 'standard',
        layout: 'asymmetric',
    },
    card: {
        aspectRatio: 1,
        imageRadius: 18,
        showShadow: true,
        titleSize: 15,
        subtitleSize: 14,
        variant: 'standard',
        textAlign: 'left',
    },
    player: {
        artworkRadius: 28,
        controlsStyle: 'floating',
        progressStyle: 'bar',
        showBlur: true,
        blurIntensity: 80,
        variant: 'immersive',
        icons: {
            play: 'play',
            pause: 'pause',
            next: 'skip-next',
            previous: 'skip-previous',
            shuffle: 'shuffle',
            repeat: 'repeat',
            repeatOne: 'repeat-once',
            heart: 'heart',
            heartOutline: 'heart-outline',
        }
    },
    navigation: {
        tabStyle: 'pills',
        headerStyle: 'large',
        activeIndicatorColor: '#8AB4FF',
    },
    global: {
        screenPadding: 18,
        itemSpacing: 14,
        borderWidth: 0,
        borderColor: 'transparent',
        shadowStyle: 'soft',
        buttonRadius: 20,
        buttonPadding: 14,
    }
};

// Material 3 Expressive theme - Dynamic, bold, with emphasis on motion
export const material3Dark: Theme = {
    id: 'material3-dark',
    name: 'Material 3',
    mode: 'dark',
    colors: {
        ...baseDarkColors,
        primary: '#8AB4FF',
        primaryContainer: '#12315C',
        onPrimaryContainer: '#D8E6FF',
        secondary: '#7ED7C1',
        secondaryContainer: '#1A4C43',
        background: '#080B12',
        surface: '#101623',
        surfaceVariant: '#1A2335',
        onPrimary: '#001C3E',
        onSecondary: '#00382F',
        onBackground: '#E8EEF9',
        onSurface: '#E8EEF9',
        onSurfaceVariant: '#B5C1D8',
        outline: '#44506A',
        error: '#F2B8B5',
        onError: '#601410',
        shadow: 'rgba(6, 10, 20, 0.6)',
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
            normal: 320,
            slow: 560,
        },
        easing: {
            standard: 'cubic-bezier(0.2, 0.0, 0, 1.0)', // M3 Emphasized
            decelerate: 'cubic-bezier(0.0, 0.0, 0, 1.0)',
            accelerate: 'cubic-bezier(0.3, 0.0, 0.8, 0.15)',
        },
    },
    typography: {
        ...typography,
        fontSize: {
            xs: 11,
            sm: 13,
            md: 15,
            lg: 17,
            xl: 23,
            xxl: 30,
            display: 48,
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
        primary: '#2C5BA8',
        primaryContainer: '#D9E5FF',
        onPrimaryContainer: '#001B42',
        secondary: '#1F6F5F',
        secondaryContainer: '#CDEFE6',
        background: '#F6F8FD',
        surface: '#FCFDFF',
        surfaceVariant: '#E3E9F5',
        onPrimary: '#FFFFFF',
        onSecondary: '#FFFFFF',
        onBackground: '#101A2B',
        onSurface: '#101A2B',
        onSurfaceVariant: '#45536C',
        outline: '#6D7890',
        error: '#B3261E',
        onError: '#FFFFFF',
    },
    components: material3Components,
};
