/**
 * SegmentedTabs - Minimal text tabs with a single sliding underline.
 *
 * Tidal / Apple Music feel: no filled pills, no per-tab chrome. The active
 * label is bold + full-contrast, the rest are dimmed, and one accent underline
 * glides between them. The underline tracks each tab's measured frame, so it
 * always matches the label width regardless of font/locale.
 */

import { useTheme } from '@/src/theme';
import React, { useCallback, useEffect, useRef } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

export interface SegmentedTabItem<T extends string = string> {
    value: T;
    label: string;
}

interface SegmentedTabsProps<T extends string = string> {
    tabs: SegmentedTabItem<T>[];
    value: T;
    onChange: (value: T) => void;
    /** Underline + active-label accent. Defaults to theme primary. */
    accentColor?: string;
}

const GLIDE = { duration: 320, easing: Easing.bezier(0.22, 1, 0.36, 1) };

export function SegmentedTabs<T extends string = string>({
    tabs,
    value,
    onChange,
    accentColor,
}: SegmentedTabsProps<T>) {
    const { theme } = useTheme();
    const accent = accentColor ?? theme.colors.primary;

    const layouts = useRef<Record<string, { x: number; width: number }>>({});
    const indicatorX = useSharedValue(0);
    const indicatorW = useSharedValue(0);
    const ready = useSharedValue(0);

    const moveIndicator = useCallback(
        (target: string, animated: boolean) => {
            const layout = layouts.current[target];
            if (!layout) return;
            if (animated && ready.value === 1) {
                indicatorX.value = withTiming(layout.x, GLIDE);
                indicatorW.value = withTiming(layout.width, GLIDE);
            } else {
                indicatorX.value = layout.x;
                indicatorW.value = layout.width;
                ready.value = 1;
            }
        },
        [indicatorW, indicatorX, ready],
    );

    useEffect(() => {
        moveIndicator(value, true);
    }, [moveIndicator, value]);

    const handleLayout = useCallback(
        (tabValue: string) => (event: LayoutChangeEvent) => {
            const { x, width } = event.nativeEvent.layout;
            layouts.current[tabValue] = { x, width };
            if (tabValue === value) moveIndicator(value, false);
        },
        [moveIndicator, value],
    );

    const indicatorStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: indicatorX.value }],
        width: indicatorW.value,
        opacity: ready.value,
    }));

    return (
        <View style={styles.row}>
            {tabs.map(item => {
                const selected = item.value === value;
                return (
                    <Pressable
                        key={item.value}
                        onLayout={handleLayout(item.value)}
                        onPress={() => onChange(item.value)}
                        accessibilityRole="tab"
                        accessibilityState={{ selected }}
                        accessibilityLabel={item.label}
                        hitSlop={10}
                        style={styles.tab}
                    >
                        <Text
                            style={[
                                styles.label,
                                {
                                    color: selected ? accent : theme.colors.onSurfaceVariant,
                                    opacity: selected ? 1 : 0.62,
                                    fontFamily: selected
                                        ? theme.typography.fontFamily.bold
                                        : theme.typography.fontFamily.medium,
                                    fontWeight: selected ? '700' : '500',
                                },
                            ]}
                        >
                            {item.label}
                        </Text>
                    </Pressable>
                );
            })}
            <Animated.View
                pointerEvents="none"
                style={[styles.indicator, { backgroundColor: accent }, indicatorStyle]}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 18,
        position: 'relative',
        alignSelf: 'flex-start',
        padding: 0,
        backgroundColor: 'transparent',
    },
    tab: {
        paddingVertical: 10,
        paddingHorizontal: 0,
        zIndex: 1,
    },
    label: {
        fontSize: 14,
        lineHeight: 18,
        letterSpacing: -0.1,
    },
    indicator: {
        position: 'absolute',
        height: 2,
        bottom: 1,
        left: 0,
        borderRadius: 1,
    },
});

export default SegmentedTabs;
