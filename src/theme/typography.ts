import { Platform, TextStyle } from 'react-native';

const systemFont = Platform.select({
    ios: 'System',
    android: 'sans-serif',
    default: 'System',
}) ?? 'System';

const mediumSystemFont = Platform.select({
    ios: 'System',
    android: 'sans-serif-medium',
    default: 'System',
}) ?? systemFont;

export const fontFamilies = {
    regular: systemFont,
    medium: mediumSystemFont,
    bold: mediumSystemFont,
    mono: Platform.select({
        ios: 'SpaceMono',
        android: 'monospace',
        default: 'monospace',
    }) ?? 'monospace',
};

export const fontWeights = {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
} as const;

type FontWeightToken = typeof fontWeights[keyof typeof fontWeights];

type TypeScaleStyle = TextStyle & {
    fontFamily: string;
    fontSize: number;
    fontWeight: FontWeightToken;
    lineHeight: number;
    letterSpacing: number;
};

function textStyle(
    fontSize: number,
    lineHeight: number,
    fontWeight: FontWeightToken,
    fontFamily: string,
    letterSpacing = 0
): TypeScaleStyle {
    return {
        fontFamily,
        fontSize,
        fontWeight,
        lineHeight,
        letterSpacing,
    };
}

export const typeScale = {
    micro: textStyle(11, 14, fontWeights.semibold, fontFamilies.medium, 0.4),
    label: textStyle(12, 16, fontWeights.semibold, fontFamilies.medium, 0.15),
    caption: textStyle(13, 18, fontWeights.medium, fontFamilies.regular, 0.05),
    body: textStyle(14, 20, fontWeights.regular, fontFamilies.regular),
    bodyStrong: textStyle(14, 20, fontWeights.medium, fontFamilies.medium),
    title: textStyle(16, 22, fontWeights.semibold, fontFamilies.medium, -0.15),
    titleLarge: textStyle(20, 26, fontWeights.bold, fontFamilies.bold, -0.35),
    headline: textStyle(24, 30, fontWeights.bold, fontFamilies.bold, -0.55),
    screenTitle: textStyle(32, 38, fontWeights.bold, fontFamilies.bold, -0.8),
    hero: textStyle(40, 46, fontWeights.bold, fontFamilies.bold, -1.1),
};

type PaperFontVariant = {
    fontFamily?: string;
    fontWeight?: string | number;
    letterSpacing?: number;
    lineHeight?: number;
    fontSize?: number;
};

export function createPaperFonts<T extends Record<string, PaperFontVariant>>(baseFonts: T): T {
    return {
        ...baseFonts,
        displayLarge: { ...baseFonts.displayLarge, ...typeScale.hero },
        displayMedium: {
            ...baseFonts.displayMedium,
            ...textStyle(36, 42, fontWeights.bold, fontFamilies.bold, -1),
        },
        displaySmall: { ...baseFonts.displaySmall, ...typeScale.screenTitle },
        headlineLarge: {
            ...baseFonts.headlineLarge,
            ...textStyle(28, 34, fontWeights.bold, fontFamilies.bold, -0.7),
        },
        headlineMedium: { ...baseFonts.headlineMedium, ...typeScale.screenTitle },
        headlineSmall: { ...baseFonts.headlineSmall, ...typeScale.headline },
        titleLarge: { ...baseFonts.titleLarge, ...typeScale.titleLarge },
        titleMedium: { ...baseFonts.titleMedium, ...typeScale.title },
        titleSmall: {
            ...baseFonts.titleSmall,
            ...textStyle(15, 20, fontWeights.semibold, fontFamilies.medium, -0.1),
        },
        labelLarge: {
            ...baseFonts.labelLarge,
            ...textStyle(14, 20, fontWeights.semibold, fontFamilies.medium, 0.1),
        },
        labelMedium: { ...baseFonts.labelMedium, ...typeScale.label },
        labelSmall: { ...baseFonts.labelSmall, ...typeScale.micro },
        bodyLarge: {
            ...baseFonts.bodyLarge,
            ...textStyle(16, 24, fontWeights.regular, fontFamilies.regular),
        },
        bodyMedium: { ...baseFonts.bodyMedium, ...typeScale.body },
        bodySmall: {
            ...baseFonts.bodySmall,
            ...textStyle(13, 18, fontWeights.regular, fontFamilies.regular, 0.05),
        },
    } as T;
}