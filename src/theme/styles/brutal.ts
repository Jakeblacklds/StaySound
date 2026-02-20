import { ComponentStyles, Theme } from '../../types/theme';
import { spacing, typography } from '../tokens';

const brutalComponents: ComponentStyles = {
    trackItem: {
        height: 90,
        artworkSize: 64,
        artworkRadius: 0,
        showDivider: false,
        dividerInset: 0,
        activeScale: 0.95,
        variant: 'brutal',
        layout: 'horizontal',
        borderWidth: 3,
    },
    card: {
        aspectRatio: 1,
        imageRadius: 0,
        showShadow: true,
        titleSize: 18,
        subtitleSize: 14,
        variant: 'brutal',
        textAlign: 'left',
    },
    player: {
        artworkRadius: 0,
        controlsStyle: 'floating',
        progressStyle: 'bar',
        showBlur: false,
        blurIntensity: 0,
        variant: 'brutal',
        layoutTemplate: 'top-heavy',
        titleWeight: '900',
        icons: {
            play: 'play-box',
            pause: 'pause-box',
            next: 'step-forward',
            previous: 'step-backward',
            shuffle: 'shuffle-variant',
            repeat: 'repeat',
            repeatOne: 'repeat-once',
            heart: 'cards-heart',
            heartOutline: 'heart-outline',
        }
    },
    navigation: {
        tabStyle: 'brutal',
        headerStyle: 'large',
        activeIndicatorColor: '#FFDE03',
    },
    global: {
        screenPadding: 24,
        itemSpacing: 20,
        borderWidth: 4,
        borderColor: '#000000',
        shadowStyle: 'hard',
        buttonRadius: 0,
        buttonPadding: 16,
    }
};

export const brutalDark: Theme = {
    id: 'brutal-dark',
    name: 'Neo Brutalist',
    mode: 'dark',
    colors: {
        primary: '#FF4D00',
        primaryContainer: '#FF4D00',
        onPrimaryContainer: '#000000',
        secondary: '#00B8D9',
        secondaryContainer: '#00B8D9',
        background: '#F6F1E8',
        surface: '#FFF9EF',
        surfaceVariant: '#E9DEC8',
        onPrimary: '#000000',
        onSecondary: '#000000',
        onBackground: '#000000',
        onSurface: '#000000',
        onSurfaceVariant: '#000000',
        error: '#FF0000',
        onError: '#FFFFFF',
        outline: '#000000',
        shadow: '#000000',
    },
    spacing,
    shapes: {
        borderRadius: {
            none: 0,
            sm: 0,
            md: 0,
            lg: 0,
            xl: 0,
            full: 0,
        },
        elevation: {
            none: 0,
            sm: 4,
            md: 8,
            lg: 12,
        },
    },
    motion: {
        duration: {
            instant: 0,
            fast: 100,
            normal: 200,
            slow: 400,
        },
        easing: {
            standard: 'steps(2)', // Robotic/Brutal
            decelerate: 'linear',
            accelerate: 'linear',
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
            xs: 12,
            sm: 14,
            md: 16,
            lg: 18,
            xl: 26,
            xxl: 34,
            display: 52,
        },
    },
    components: brutalComponents,
};
