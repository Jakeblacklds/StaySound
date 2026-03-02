
import {
    argbFromHex,
    Hct,
    hexFromArgb,
    SchemeContent,
    SchemeExpressive,
    SchemeFidelity,
    SchemeFruitSalad,
    SchemeMonochrome,
    SchemeNeutral,
    SchemeRainbow,
    SchemeTonalSpot,
    SchemeVibrant
} from '@material/material-color-utilities';

export type SchemeVariant =
    | 'expressive'
    | 'tonal-spot'
    | 'vibrant'
    | 'rainbow'
    | 'fruit-salad'
    | 'fidelity'
    | 'content'
    | 'neutral'
    | 'monochrome';

export function generateM3Palette(seedColor: string, isDark: boolean, variant: SchemeVariant = 'expressive') {
    const seed = argbFromHex(seedColor);
    const hct = Hct.fromInt(seed);

    let scheme;
    switch (variant) {
        case 'expressive':
            scheme = new SchemeExpressive(hct, isDark, 0);
            break;
        case 'vibrant':
            scheme = new SchemeVibrant(hct, isDark, 0);
            break;
        case 'rainbow':
            scheme = new SchemeRainbow(hct, isDark, 0);
            break;
        case 'fruit-salad':
            scheme = new SchemeFruitSalad(hct, isDark, 0);
            break;
        case 'fidelity':
            scheme = new SchemeFidelity(hct, isDark, 0);
            break;
        case 'content':
            scheme = new SchemeContent(hct, isDark, 0);
            break;
        case 'neutral':
            scheme = new SchemeNeutral(hct, isDark, 0);
            break;
        case 'monochrome':
            scheme = new SchemeMonochrome(hct, isDark, 0);
            break;
        case 'tonal-spot':
        default:
            scheme = new SchemeTonalSpot(hct, isDark, 0);
            break;
    }

    return {
        primary: hexFromArgb(scheme.primary),
        onPrimary: hexFromArgb(scheme.onPrimary),
        primaryContainer: hexFromArgb(scheme.primaryContainer),
        onPrimaryContainer: hexFromArgb(scheme.onPrimaryContainer),
        secondary: hexFromArgb(scheme.secondary),
        onSecondary: hexFromArgb(scheme.onSecondary),
        secondaryContainer: hexFromArgb(scheme.secondaryContainer),
        onSecondaryContainer: hexFromArgb(scheme.onSecondaryContainer),
        tertiary: hexFromArgb(scheme.tertiary),
        onTertiary: hexFromArgb(scheme.onTertiary),
        tertiaryContainer: hexFromArgb(scheme.tertiaryContainer),
        onTertiaryContainer: hexFromArgb(scheme.onTertiaryContainer),
        error: hexFromArgb(scheme.error),
        onError: hexFromArgb(scheme.onError),
        errorContainer: hexFromArgb(scheme.errorContainer),
        onErrorContainer: hexFromArgb(scheme.onErrorContainer),
        background: hexFromArgb(scheme.background),
        onBackground: hexFromArgb(scheme.onBackground),
        surface: hexFromArgb(scheme.surface),
        onSurface: hexFromArgb(scheme.onSurface),
        surfaceVariant: hexFromArgb(scheme.surfaceVariant),
        onSurfaceVariant: hexFromArgb(scheme.onSurfaceVariant),
        outline: hexFromArgb(scheme.outline),
        outlineVariant: hexFromArgb(scheme.outlineVariant),
        shadow: hexFromArgb(scheme.shadow),
        scrim: hexFromArgb(scheme.scrim),
        inverseSurface: hexFromArgb(scheme.inverseSurface),
        inverseOnSurface: hexFromArgb(scheme.inverseOnSurface),
        inversePrimary: hexFromArgb(scheme.inversePrimary),
    };
}
