// Theme token types for StaySound
export interface ColorTokens {
    // Primary
    primary: string;
    onPrimary: string;
    primaryContainer: string;
    onPrimaryContainer: string;
    // Secondary
    secondary: string;
    onSecondary: string;
    secondaryContainer: string;
    onSecondaryContainer?: string;
    // Tertiary (M3 — optional so non-M3 themes don't break)
    tertiary?: string;
    onTertiary?: string;
    tertiaryContainer?: string;
    onTertiaryContainer?: string;
    // Surfaces
    background: string;
    onBackground: string;
    surface: string;
    onSurface: string;
    surfaceVariant: string;
    onSurfaceVariant: string;
    // Error
    error: string;
    onError: string;
    errorContainer?: string;
    onErrorContainer?: string;
    // Outline
    outline: string;
    outlineVariant?: string;
    // Misc
    shadow: string;
    scrim?: string;
    inverseSurface?: string;
    inverseOnSurface?: string;
    inversePrimary?: string;
}

export interface SpacingTokens {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
}

export interface ShapeTokens {
    borderRadius: {
        none: number;
        sm: number;
        md: number;
        lg: number;
        xl: number;
        full: number;
    };
    elevation: {
        none: number;
        sm: number;
        md: number;
        lg: number;
    };
}

export interface MotionTokens {
    duration: {
        instant: number;
        fast: number;
        normal: number;
        slow: number;
    };
    easing: {
        standard: string;
        decelerate: string;
        accelerate: string;
    };
}

export interface TypographyTokens {
    fontFamily: {
        regular: string;
        medium: string;
        bold: string;
    };
    fontSize: {
        xs: number;
        sm: number;
        md: number;
        lg: number;
        xl: number;
        xxl: number;
        display: number;
    };
    lineHeight: {
        tight: number;
        normal: number;
        relaxed: number;
    };
}

// Component-specific styling tokens for visual differentiation
export interface ComponentStyles {
    // Track list item styling
    trackItem: {
        height: number;
        artworkSize: number;
        artworkRadius: number;
        showDivider: boolean;
        dividerInset: number;
        activeScale: number;
        variant: 'standard' | 'minimal' | 'brutal';
        layout?: 'horizontal' | 'vertical' | 'asymmetric';
        borderWidth?: number;
    };
    // Card styling (albums, artists)
    card: {
        aspectRatio: number;
        imageRadius: number;
        showShadow: boolean;
        titleSize: number;
        subtitleSize: number;
        variant: 'standard' | 'flat' | 'elevated' | 'brutal';
        textAlign?: 'left' | 'center';
    };
    // Player styling
    player: {
        artworkRadius: number;
        controlsStyle: 'floating' | 'inline' | 'minimal';
        progressStyle: 'bar' | 'circular' | 'wave';
        showBlur: boolean;
        blurIntensity: number;
        variant: 'immersive' | 'classic' | 'compact';
        layoutTemplate?: 'centered' | 'top-heavy' | 'bottom-controls' | 'split';
        titleWeight?: 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';
        icons: {
            play: string;
            pause: string;
            next: string;
            previous: string;
            shuffle: string;
            repeat: string;
            repeatOne: string;
            heart: string;
            heartOutline: string;
        };
    };
    // Navigation/tabs
    navigation: {
        tabStyle: 'icons' | 'pills' | 'underline';
        headerStyle: 'large' | 'compact' | 'hidden';
        activeIndicatorColor?: string;
    };
    // Global UI modifiers
    global: {
        screenPadding: number;
        itemSpacing: number;
        borderWidth: number;
        borderColor: string;
        shadowStyle?: 'soft' | 'hard' | 'none';
        buttonRadius: number;
        buttonPadding?: number;
    };
}

export interface Theme {
    id: string;
    name: string;
    mode: 'light' | 'dark';
    colors: ColorTokens;
    spacing: SpacingTokens;
    shapes: ShapeTokens;
    motion: MotionTokens;
    typography: TypographyTokens;
    components: ComponentStyles;
}

export type ThemeStyle = 'material3';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeConfig {
    style: ThemeStyle;
    mode: ThemeMode;
    accentColor: string;
    dynamicColors: boolean;
    schemeVariant?: string;
    customTheme?: Theme;
}
