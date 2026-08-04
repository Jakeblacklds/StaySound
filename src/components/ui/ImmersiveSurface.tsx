import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { type ReactNode } from 'react';
import {
    Pressable,
    type StyleProp,
    StyleSheet,
    View,
    type ViewStyle,
} from 'react-native';
import { Text } from 'react-native-paper';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

import { typeScale, useTheme, withAlpha } from '@/src/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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

type HeadingProps = {
    kicker?: string;
    title: string;
    subtitle?: string;
    trailing?: ReactNode;
    style?: StyleProp<ViewStyle>;
};

export function ImmersiveHeading({ kicker, title, subtitle, trailing, style }: HeadingProps) {
    const { theme } = useTheme();

    return (
        <View style={[styles.heading, style]}>
            <View style={styles.headingCopy}>
                {kicker ? (
                    <Text style={[styles.kicker, { color: theme.colors.primary }]}>
                        {kicker.toUpperCase()}
                    </Text>
                ) : null}
                <Text numberOfLines={2} style={[styles.headingTitle, { color: theme.colors.onBackground }]}>
                    {title}
                </Text>
                {subtitle ? (
                    <Text numberOfLines={2} style={[styles.headingSubtitle, { color: theme.colors.onSurfaceVariant }]}>
                        {subtitle}
                    </Text>
                ) : null}
            </View>
            {trailing ? <View style={styles.headingTrailing}>{trailing}</View> : null}
        </View>
    );
}

type GlassIconButtonProps = {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    onPress: () => void;
    label: string;
    size?: number;
    accent?: boolean;
};

export function GlassIconButton({
    icon,
    onPress,
    label,
    size = 21,
    accent = false,
}: GlassIconButtonProps) {
    const { theme } = useTheme();
    const scale = useSharedValue(1);
    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    return (
        <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel={label}
            hitSlop={8}
            onPress={onPress}
            onPressIn={() => {
                scale.value = withSpring(0.88, { damping: 18, stiffness: 420 });
            }}
            onPressOut={() => {
                scale.value = withSpring(1, { damping: 16, stiffness: 320 });
            }}
            style={[
                styles.iconButton,
                {
                    backgroundColor: accent
                        ? withAlpha(theme.colors.primaryContainer, 'E0')
                        : withAlpha(theme.colors.surface, 'A8'),
                    borderColor: accent
                        ? withAlpha(theme.colors.primary, '62')
                        : withAlpha(theme.colors.outline, '38'),
                },
                animatedStyle,
            ]}
        >
            <Ionicons
                name={icon}
                size={size}
                color={accent ? theme.colors.onPrimaryContainer : theme.colors.onSurface}
            />
        </AnimatedPressable>
    );
}

const styles = StyleSheet.create({
    glass: {
        overflow: 'hidden',
        borderWidth: StyleSheet.hairlineWidth,
    },
    heading: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 16,
    },
    headingCopy: {
        flex: 1,
    },
    kicker: {
        ...typeScale.micro,
        fontWeight: '800',
        letterSpacing: 1.8,
        marginBottom: 6,
    },
    headingTitle: {
        ...typeScale.screenTitle,
        fontSize: 32,
        lineHeight: 36,
        fontWeight: '800',
        letterSpacing: -1.15,
    },
    headingSubtitle: {
        ...typeScale.body,
        marginTop: 6,
        opacity: 0.72,
        lineHeight: 20,
    },
    headingTrailing: {
        paddingBottom: 1,
    },
    iconButton: {
        width: 46,
        height: 46,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
    },
});
