import { ComponentStyles, Theme } from '../../types/theme';
import { spacing, typography } from '../tokens';

const auroraComponents: ComponentStyles = {
    trackItem: {
        height: 80,
        artworkSize: 52,
        artworkRadius: 10,
        showDivider: false,
        dividerInset: 0,
        activeScale: 0.97,
        variant: 'glass',
    },
    card: {
        aspectRatio: 1,
        imageRadius: 20,
        showShadow: false,
        titleSize: 15,
        subtitleSize: 13,
        variant: 'glass',
        textAlign: 'center',
    },
    player: {
        artworkRadius: 32,
        controlsStyle: 'floating',
        progressStyle: 'bar',
        showBlur: true,
        blurIntensity: 90,
        variant: 'aurora',
        titleWeight: '700',
        icons: {
            play: 'play',
            pause: 'pause',
            next: 'chevron-right',
            previous: 'chevron-left',
            shuffle: 'infinity',
            repeat: 'repeat-variant',
            repeatOne: 'repeat-once',
            heart: 'heart-outline',
            heartOutline: 'heart-outline',
        }
    },
    navigation: {
        tabStyle: 'pills',
        headerStyle: 'large',
        activeIndicatorColor: 'rgba(255,255,255,0.2)',
    },
    global: {
        screenPadding: 24,
        itemSpacing: 20,
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.15)',
        shadowStyle: 'soft',
        buttonRadius: 24,
        buttonPadding: 16,
    }
};

export const auroraDark: Theme = {
    id: 'aurora-dark',
    name: 'Aurora Glass',
    mode: 'dark',
    colors: {
        primary: '#A78BFA',
        primaryContainer: 'rgba(124, 58, 237, 0.3)',
        onPrimaryContainer: '#DDD6FE',
        secondary: '#60A5FA',
        secondaryContainer: 'rgba(37, 99, 235, 0.2)',
        background: '#0F172A',
        surface: 'rgba(30, 41, 59, 0.7)',
        surfaceVariant: 'rgba(51, 65, 85, 0.5)',
        onPrimary: '#FFFFFF',
        onSecondary: '#FFFFFF',
        onBackground: '#F1F5F9',
        onSurface: '#F1F5F9',
        onSurfaceVariant: '#94A3B8',
        error: '#F87171',
        onError: '#1E1B4B',
        outline: 'rgba(255,255,255,0.1)',
        shadow: 'rgba(0,0,0,0.5)',
    },
    spacing,
    shapes: {
        borderRadius: {
            none: 0,
            sm: 12,
            md: 18,
            lg: 24,
            xl: 32,
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
        duration: {
            instant: 100,
            fast: 250,
            normal: 500,
            slow: 800,
        },
        easing: {
            standard: 'cubic-bezier(0.34, 1.56, 0.64, 1)', // Bouncy
            decelerate: 'cubic-bezier(0.32, 1, 0.23, 1)',
            accelerate: 'cubic-bezier(0.5, 0, 0.75, 0)',
        },
    },
    typography: {
        ...typography,
        fontSize: {
            xs: 11,
            sm: 13,
            md: 15,
            lg: 17,
            xl: 24,
            xxl: 32,
            display: 48,
        },
    },
    components: auroraComponents,
};
