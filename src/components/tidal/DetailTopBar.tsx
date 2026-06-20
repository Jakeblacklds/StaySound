/**
 * DetailTopBar
 *
 * Floating back button that, as the screen scrolls past a threshold, blooms
 * into a glass top bar showing the screen title. Shared by every Tidal detail
 * screen (album / artist / playlist / genre).
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Animated, { SharedValue, interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typeScale, useTheme, withAlpha } from '@/src/theme';

interface DetailTopBarProps {
    title: string;
    scrollY: SharedValue<number>;
    /** Scroll offset at which the bar becomes fully opaque. Default 220. */
    threshold?: number;
    onBack: () => void;
}

export const DetailTopBar: React.FC<DetailTopBarProps> = ({
    title,
    scrollY,
    threshold = 220,
    onBack,
}) => {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();

    const barStyle = useAnimatedStyle(() => ({
        opacity: interpolate(scrollY.value, [threshold * 0.5, threshold], [0, 1], 'clamp'),
    }));

    const titleStyle = useAnimatedStyle(() => ({
        opacity: interpolate(scrollY.value, [threshold * 0.7, threshold], [0, 1], 'clamp'),
        transform: [{ translateY: interpolate(scrollY.value, [threshold * 0.7, threshold], [8, 0], 'clamp') }],
    }));

    return (
        <View style={[styles.wrap, { paddingTop: insets.top }]} pointerEvents="box-none">
            {/* Solid translucent bar that fades in on scroll. No live BlurView —
                blurring over the scrolling list underneath kills Android FPS. */}
            <Animated.View
                style={[
                    StyleSheet.absoluteFill,
                    {
                        backgroundColor: withAlpha(theme.colors.background, 'F0'),
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: withAlpha(theme.colors.outline, '40'),
                    },
                    barStyle,
                ]}
                pointerEvents="none"
            />

            <View style={styles.bar}>
                <Pressable hitSlop={16} onPress={onBack} style={styles.backButton}>
                    <Ionicons name="chevron-back" size={26} color="#FFFFFF" />
                </Pressable>
                <Animated.Text
                    numberOfLines={1}
                    style={[styles.title, { color: theme.colors.onBackground }, titleStyle]}
                >
                    {title}
                </Animated.Text>
                <View style={styles.backButton} />
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    wrap: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 30,
    },
    bar: {
        height: 52,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(0,0,0,0.28)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        ...typeScale.title,
        flex: 1,
        textAlign: 'center',
        marginHorizontal: 8,
    },
});
