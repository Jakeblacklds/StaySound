import { ComponentStyles, Theme } from '../../types/theme';
import { spacing, typography } from '../tokens';

const onyxComponents: ComponentStyles = {
    trackItem: {
        height: 56,
        artworkSize: 0,
        artworkRadius: 0,
        showDivider: true,
        dividerInset: 0,
        activeScale: 1.0,
        variant: 'minimal',
    },
    card: {
        aspectRatio: 1.2,
        imageRadius: 2,
        showShadow: false,
        titleSize: 13,
        subtitleSize: 11,
        variant: 'flat',
    },
    player: {
        artworkRadius: 4,
        controlsStyle: 'minimal',
        progressStyle: 'bar',
        showBlur: false,
        blurIntensity: 0,
        variant: 'compact',
        titleWeight: '300',
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
        tabStyle: 'icons',
        headerStyle: 'compact',
        activeIndicatorColor: '#FFFFFF',
    },
    global: {
        screenPadding: 24,
        itemSpacing: 0,
        borderWidth: 0.5,
        borderColor: '#333333',
        shadowStyle: 'none',
        buttonRadius: 0,
    }
};

export const onyxDark: Theme = {
    id: 'onyx-dark',
    name: 'Deep Onyx',
    mode: 'dark',
    colors: {
        primary: '#FFFFFF',
        primaryContainer: '#1A1A1A',
        onPrimaryContainer: '#FFFFFF',
        secondary: '#888888',
        secondaryContainer: '#121212',
        background: '#000000',
        surface: '#000000',
        surfaceVariant: '#080808',
        onPrimary: '#000000',
        onSecondary: '#FFFFFF',
        onBackground: '#FFFFFF',
        onSurface: '#FFFFFF',
        onSurfaceVariant: '#666666',
        error: '#FF0000',
        onError: '#FFFFFF',
        outline: '#222222',
        shadow: '#000000',
    },
    spacing,
    shapes: {
        borderRadius: {
            none: 0,
            sm: 1,
            md: 2,
            lg: 4,
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
        duration: {
            instant: 50,
            fast: 100,
            normal: 200,
            slow: 400,
        },
        easing: {
            standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
            decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
            accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
        },
    },
    typography: {
        ...typography,
        fontFamily: {
            regular: 'serif',
            medium: 'serif',
            bold: 'serif',
        },
    },
    components: onyxComponents,
};
