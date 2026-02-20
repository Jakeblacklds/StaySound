import { ComponentStyles, Theme } from '../../types/theme';
import { spacing, typography } from '../tokens';

const cyberComponents: ComponentStyles = {
    trackItem: {
        height: 64,
        artworkSize: 48,
        artworkRadius: 2,
        showDivider: true,
        dividerInset: 0,
        activeScale: 0.98,
        variant: 'cyber',
        layout: 'horizontal',
        borderWidth: 1,
    },
    card: {
        aspectRatio: 1,
        imageRadius: 4,
        showShadow: true,
        titleSize: 14,
        subtitleSize: 12,
        variant: 'standard',
        textAlign: 'left',
    },
    player: {
        artworkRadius: 8,
        controlsStyle: 'inline',
        progressStyle: 'bar',
        showBlur: false,
        blurIntensity: 0,
        variant: 'cyber',
        titleWeight: '800',
        icons: {
            play: 'chevron-right',
            pause: 'minus',
            next: 'arrow-right-thick',
            previous: 'arrow-left-thick',
            shuffle: 'orbit-variant',
            repeat: 'refresh',
            repeatOne: 'numeric-1-box-outline',
            heart: 'fire',
            heartOutline: 'fire-off',
        }
    },
    navigation: {
        tabStyle: 'underline',
        headerStyle: 'compact',
        activeIndicatorColor: '#00FF9F',
    },
    global: {
        screenPadding: 16,
        itemSpacing: 12,
        borderWidth: 1,
        borderColor: '#00FF9F',
        shadowStyle: 'hard',
        buttonRadius: 0,
        buttonPadding: 12,
    }
};

export const cyberDark: Theme = {
    id: 'cyber-dark',
    name: 'Cyber Neon',
    mode: 'dark',
    colors: {
        primary: '#00FF9F',
        primaryContainer: 'rgba(0, 255, 159, 0.1)',
        onPrimaryContainer: '#00FF9F',
        secondary: '#D300C5',
        secondaryContainer: 'rgba(211, 0, 197, 0.1)',
        background: '#050505',
        surface: '#0A0A0A',
        surfaceVariant: '#151515',
        onPrimary: '#000000',
        onSecondary: '#FFFFFF',
        onBackground: '#FFFFFF',
        onSurface: '#FFFFFF',
        onSurfaceVariant: '#00FF9F',
        error: '#FF003C',
        onError: '#FFFFFF',
        outline: '#00FF9F',
        shadow: 'rgba(0, 255, 159, 0.5)',
    },
    spacing,
    shapes: {
        borderRadius: {
            none: 0,
            sm: 2,
            md: 4,
            lg: 6,
            xl: 8,
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
            instant: 50,
            fast: 150,
            normal: 300,
            slow: 500,
        },
        easing: {
            standard: 'steps(4)', // Glitchy feel
            decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
            accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
        },
    },
    typography: {
        ...typography,
        fontFamily: {
            regular: 'monospace',
            medium: 'monospace',
            bold: 'monospace',
        },
    },
    components: cyberComponents,
};
