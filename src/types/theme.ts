// Theme token types for StaySound
export interface ColorTokens {
    primary: string;
    primaryContainer: string;
    onPrimaryContainer: string;
    secondary: string;
    secondaryContainer: string;
    background: string;
    surface: string;
    surfaceVariant: string;
    error: string;
    onPrimary: string;
    onSecondary: string;
    onBackground: string;
    onSurface: string;
    onSurfaceVariant: string;
    onError: string;
    outline: string;
    shadow: string;
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
    };
    // Card styling (albums, artists)
    card: {
        aspectRatio: number; // 1 for square, 0.75 for portrait
        imageRadius: number;
        showShadow: boolean;
        titleSize: number;
        subtitleSize: number;
    };
    // Player styling
    player: {
        artworkRadius: number;
        controlsStyle: 'floating' | 'inline' | 'minimal';
        progressStyle: 'bar' | 'circular' | 'wave';
        showBlur: boolean;
        blurIntensity: number;
    };
    // Navigation/tabs
    navigation: {
        tabStyle: 'icons' | 'pills' | 'underline';
        headerStyle: 'large' | 'compact' | 'hidden';
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

export type ThemeStyle = 'minimal' | 'material3' | 'spotify' | 'custom';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeConfig {
    style: ThemeStyle;
    mode: ThemeMode;
    accentColor: string;
    dynamicColors: boolean;
    customTheme?: Theme;
}
