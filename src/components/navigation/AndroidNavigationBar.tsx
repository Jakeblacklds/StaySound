import { NativeNavigationBarView, type ChromeAction } from '@/modules/player-chrome/src';
import { usePlayerStore } from '@/src/stores';
import { useAnimatedColors, useTheme } from '@/src/theme';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { usePathname } from 'expo-router';
import React, { memo, useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, View, type NativeSyntheticEvent } from 'react-native';
import Animated, { Extrapolation, interpolate, processColor, useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ANDROID_DOCK_INSET, TAB_BAR_HEIGHT } from '../player/playerLayout';

export const AndroidNavigationBar = memo(function AndroidNavigationBar({ state, descriptors, navigation }: BottomTabBarProps) {
    const { theme, isDark, config } = useTheme();
    const colors = useAnimatedColors();
    const expansion = usePlayerStore(s => s.expansion);
    const insets = useSafeAreaInsets();
    const pathname = usePathname();
    const forceSolid = useSharedValue(1);
    useEffect(() => {
        forceSolid.value = 1;
        const timer = setTimeout(() => { forceSolid.value = withTiming(0, { duration: 160 }); }, 320);
        return () => clearTimeout(timer);
    }, [pathname, forceSolid]);
    const visibleRoutes = useMemo(() => state.routes.filter(route =>
        (descriptors[route.key]?.options as { href?: unknown })?.href !== null && route.name !== 'settings',
    ), [state.routes, descriptors]);
    const items = useMemo(() => visibleRoutes.map(route => {
        const options = descriptors[route.key].options;
        return {
            key: route.key, name: route.name,
            label: typeof options.tabBarLabel === 'string' ? options.tabBarLabel : options.title ?? route.name,
        };
    }), [visibleRoutes, descriptors]);
    const appearance = useMemo(() => ({
        muted: theme.colors.onSurfaceVariant, accent: theme.colors.primary,
        motion: config.lightweightMode ? 'off' : 'on',
    }), [theme.colors.onSurfaceVariant, theme.colors.primary, config.lightweightMode]);
    const activeKey = state.routes[state.index]?.key ?? '';
    const onAction = useCallback(({ nativeEvent: event }: NativeSyntheticEvent<ChromeAction>) => {
        const route = visibleRoutes.find(item => item.key === event.key);
        if (!route) return;
        if (event.action === 'longPress') {
            navigation.emit({ type: 'tabLongPress', target: route.key });
        } else if (event.action === 'press') {
            const press = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (route.key !== activeKey && !press.defaultPrevented) navigation.navigate(route.name, route.params);
        }
    }, [visibleRoutes, navigation, activeKey]);
    const animatedProps = useAnimatedProps(() => ({
        surfaceColor: processColor(colors.surface.value) as number,
        shadeOpacity: 1 - Math.max(interpolate(expansion?.value ?? 0, [0, 0.12], [0, 0.94], Extrapolation.CLAMP), forceSolid.value * 0.94),
    }));
    const exitStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: interpolate(expansion?.value ?? 0, [0, 0.32],
            [0, TAB_BAR_HEIGHT + insets.bottom], Extrapolation.CLAMP) }],
    }), [expansion, insets.bottom]);
    if (!NativeNavigationBarView) return null;
    return (
        <View style={[styles.outer, { height: TAB_BAR_HEIGHT + insets.bottom }]} pointerEvents="box-none">
            <Animated.View style={[styles.dock, {
                left: Math.max(ANDROID_DOCK_INSET, insets.left + 8),
                right: Math.max(ANDROID_DOCK_INSET, insets.right + 8),
            }, exitStyle]}>
                <NativeNavigationBarView style={styles.fill} items={items} activeKey={activeKey}
                    appearance={appearance} dark={isDark} animatedProps={animatedProps} onAction={onAction} />
            </Animated.View>
        </View>
    );
});
const styles = StyleSheet.create({
    outer: { position: 'absolute', left: 0, right: 0, bottom: 0 },
    dock: { position: 'absolute', top: 4, height: TAB_BAR_HEIGHT - 8 },
    fill: { flex: 1 },
});
