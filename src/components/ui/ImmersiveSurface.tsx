import { LinearGradient } from 'expo-linear-gradient';
import React, { type ReactNode } from 'react';
import {
    type StyleProp,
    StyleSheet,
    View,
    type ViewStyle,
} from 'react-native';

import { useTheme, withAlpha } from '@/src/theme';

type GlassSurfaceProps = {
    children?: ReactNode;
    style?: StyleProp<ViewStyle>;
    radius?: number;
    tone?: 'quiet' | 'regular' | 'strong';
    accentColor?: string;
};

/**
 * Cheap, scroll-safe glass used outside the full player. It mirrors the
 * player's layered chrome without stacking live BlurViews over long lists.
 */
export function ImmersiveGlass({
    children,
    style,
    radius = 26,
    tone = 'regular',
    accentColor,
}: GlassSurfaceProps) {
    const { theme, isDark } = useTheme();
    const alpha = tone === 'quiet'
        ? (isDark ? '54' : '70')
        : tone === 'strong'
            ? (isDark ? 'D6' : 'E8')
            : (isDark ? '9C' : 'C2');
    const borderAlpha = tone === 'quiet' ? '24' : tone === 'strong' ? '52' : '38';
    const tint = accentColor ?? theme.colors.primary;

    return (
        <View
            style={[
                styles.glass,
                {
                    borderRadius: radius,
                    backgroundColor: withAlpha(theme.colors.surface, alpha),
                    borderColor: withAlpha(theme.colors.outline, borderAlpha),
                },
                style,
            ]}
        >
            <LinearGradient
                pointerEvents="none"
                colors={[
                    withAlpha('#FFFFFF', isDark ? '14' : '52'),
                    withAlpha(tint, isDark ? '0C' : '10'),
                    'transparent',
                ]}
                locations={[0, 0.38, 1]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0.9, y: 1 }}
                style={StyleSheet.absoluteFill}
            />
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    glass: {
        overflow: 'hidden',
        borderWidth: StyleSheet.hairlineWidth,
    },
});
