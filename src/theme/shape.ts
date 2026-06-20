/**
 * Standalone radius tokens, mirroring theme.shapes.borderRadius.
 * Exposed separately so StyleSheet definitions can reference them without a
 * theme instance. Keep in sync with src/theme/styles/material3.ts.
 */
export const radius = {
    none: 0,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 28,
    full: 9999,
} as const;
