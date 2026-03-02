import { useAnimatedColors, useTheme } from '@/src/theme';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

import React, { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TAB_HEIGHT = 88;
const TAB_BOTTOM = 10;
const TAB_HORIZONTAL = 10;
const TAB_RADIUS = 24;
const TAB_ITEM_RADIUS = 16;
const DROP_WIDTH = 56;
const DROP_HEIGHT = 36;

import { ColorTokens } from '@/src/types/theme';

/**
 * Get the color role for the active tab's bubble/drop
 */
function getRouteTabColors(
  routeName: string,
  colors: ColorTokens
) {
  // Use primary roles for ALL active tabs to ensure absolute consistency.
  // This allows Dynamic Colors (album colors) to be the sole accent in the navbar.
  const isSettings = routeName === 'settings';

  return {
    pill: isSettings ? colors.surfaceVariant : colors.primaryContainer,
    icon: isSettings ? colors.onSurfaceVariant : (colors.onPrimaryContainer || colors.onPrimary),
    accent: colors.primary
  };
}

function withAlpha(color: string, alphaHex: string) {
  return `${color}${alphaHex}`;
}

type LiquidItemProps = {
  label: string;
  icon: string;
  focused: boolean;
  activeColor: string;
  inactiveColor: string;
  onPress: () => void;
  onLongPress: () => void;
};

const LiquidTabItem = memo(function LiquidTabItem({
  label,
  icon,
  focused,
  activeColor,
  inactiveColor,
  onPress,
  onLongPress,
}: LiquidItemProps) {
  const selected = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    selected.value = withSpring(focused ? 1 : 0, {
      damping: 14,
      stiffness: 220,
      mass: 0.8,
    });
  }, [focused, selected]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(selected.value, [0, 1], [0, -2]) },
      { scale: interpolate(selected.value, [0, 1], [1, 1.08]) },
      { rotate: `${interpolate(selected.value, [0, 1], [0, -4])}deg` },
    ],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(selected.value, [0, 1], [0.86, 1]),
    transform: [{ translateY: interpolate(selected.value, [0, 1], [0, -1]) }],
  }));

  const color = focused ? activeColor : inactiveColor;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.itemButton}
      android_ripple={{ color: withAlpha(activeColor, '22') }}
    >
      <Animated.View style={iconStyle}>
        <MaterialCommunityIcons name={icon as any} size={25} color={color} />
      </Animated.View>
      <Animated.Text style={[styles.itemLabel, { color: inactiveColor }, labelStyle]} numberOfLines={1}>
        {label}
      </Animated.Text>
    </Pressable>
  );
});

export const MaterialLiquidTabBar = memo(function MaterialLiquidTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const aC = useAnimatedColors(); // singleton animated shared values from ThemeProvider
  const [barWidth, setBarWidth] = useState(0);

  const visibleRoutes = useMemo(
    () => state.routes.filter((route) => (descriptors[route.key]?.options as any)?.href !== null),
    [descriptors, state.routes]
  );

  const activeVisibleIndex = useMemo(() => {
    const activeKey = state.routes[state.index]?.key;
    return Math.max(0, visibleRoutes.findIndex((route) => route.key === activeKey));
  }, [state.index, state.routes, visibleRoutes]);

  const slotWidth = barWidth > 0 ? barWidth / Math.max(visibleRoutes.length, 1) : 0;
  const dropX = useSharedValue(0);
  const dropStretch = useSharedValue(0);
  const dropDirection = useSharedValue(0);
  const dropEnergy = useSharedValue(0);

  // Animated versions of the accent color (derived from animated primary)
  const activeAccent = theme.colors.primary; // for non-animated uses
  const activeAccent85 = `${activeAccent}85`;
  const activeAccentC4 = `${activeAccent}C4`;

  // Animated style for the navbar background
  const animNavBg = useAnimatedStyle(() => ({
    backgroundColor: aC.surface.value,
  }));

  // Animated style for the drop fill and border
  const animDropStyle = useAnimatedStyle(() => ({
    backgroundColor: aC.primaryContainer.value,
    borderColor: `${aC.primary.value}70`,
  }));

  // Shimmer inside the drop pill — must be top-level (Rules of Hooks)
  const animDropShimmer = useAnimatedStyle(() => ({
    backgroundColor: `${aC.primary.value}20`,
    borderRadius: DROP_HEIGHT / 2,
  }));

  useEffect(() => {
    if (slotWidth <= 0) return;
    const targetX = activeVisibleIndex * slotWidth + (slotWidth - DROP_WIDTH) / 2;
    const delta = targetX - dropX.value;
    const distance = Math.abs(delta);
    const pulse = Math.min(distance / Math.max(slotWidth, 1), 1);
    dropDirection.value = delta === 0 ? 0 : delta > 0 ? 1 : -1;
    dropEnergy.value = pulse;

    dropStretch.value = pulse;
    dropX.value = withSpring(targetX, {
      damping: 18,
      stiffness: 150,
      mass: 0.6,
    });
    dropStretch.value = withTiming(0, {
      duration: 520,
      easing: Easing.out(Easing.exp),
    });
    dropEnergy.value = withTiming(0, {
      duration: 560,
      easing: Easing.out(Easing.exp),
    });
  }, [activeVisibleIndex, dropDirection, dropEnergy, dropStretch, dropX, slotWidth]);

  const dropStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dropX.value },
    ],
  }));

  const reflectionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dropStretch.value, [0, 1], [0.35, 0.65]),
    transform: [
      { translateX: interpolate(dropStretch.value, [0, 1], [0, 10]) },
      { skewX: `${interpolate(dropStretch.value, [0, 1], [0, 10])}deg` },
      { scaleX: interpolate(dropStretch.value, [0, 1], [1, 1.14]) },
    ],
  }));

  const lensDistortStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dropStretch.value, [0, 1], [0.36, 0.56]),
    transform: [
      { scaleX: interpolate(dropStretch.value, [0, 1], [1.06, 1.22]) },
      { scaleY: interpolate(dropStretch.value, [0, 1], [1.12, 0.9]) },
      { translateX: interpolate(dropStretch.value, [0, 1], [0, 6]) },
      { rotate: `${interpolate(dropStretch.value, [0, 1], [0, 5])}deg` },
    ],
  }));

  const causticStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dropStretch.value, [0, 1], [0.26, 0.58]),
    transform: [
      { translateX: interpolate(dropStretch.value, [0, 1], [0, 12]) },
      { skewX: `${interpolate(dropStretch.value, [0, 1], [0, 12])}deg` },
      { scaleX: interpolate(dropStretch.value, [0, 1], [1, 1.2]) },
    ],
  }));

  const prismaticLeftStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dropEnergy.value, [0, 1], [0.22, 0.58]),
    transform: [
      { translateX: interpolate(dropDirection.value, [-1, 0, 1], [-2, 0, 5]) },
      { scaleY: interpolate(dropStretch.value, [0, 1], [1, 1.15]) },
      { skewY: `${interpolate(dropStretch.value, [0, 1], [0, -8])}deg` },
    ],
  }));

  const prismaticRightStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dropEnergy.value, [0, 1], [0.18, 0.5]),
    transform: [
      { translateX: interpolate(dropDirection.value, [-1, 0, 1], [-5, 0, 2]) },
      { scaleY: interpolate(dropStretch.value, [0, 1], [1, 1.12]) },
      { skewY: `${interpolate(dropStretch.value, [0, 1], [0, 8])}deg` },
    ],
  }));

  const bottomRimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dropEnergy.value, [0, 1], [0.28, 0.66]),
    transform: [
      { scaleX: interpolate(dropStretch.value, [0, 1], [1, 1.18]) },
      { translateY: interpolate(dropStretch.value, [0, 1], [0, 1.5]) },
    ],
  }));

  const accentColorStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      dropStretch.value,
      [0, 1],
      [activeAccent85, activeAccentC4]
    ) as string,
    shadowColor: activeAccent,
  }));

  return (
    <View pointerEvents="box-none" style={[styles.outer, { bottom: insets.bottom + TAB_BOTTOM }]}>
      <View
        style={[
          styles.wrapper,
          {
            borderColor: withAlpha(theme.colors.outline, '7A'),
            shadowColor: theme.colors.shadow,
          },
        ]}
      >
        {/* Animated background gradient — responds to dynamic album colors */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, animNavBg, { borderRadius: TAB_RADIUS }]}
        />

        <View
          onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
          style={styles.itemsRow}
        >
          {slotWidth > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.drop,
                { width: DROP_WIDTH, height: DROP_HEIGHT },
                animDropStyle,
                dropStyle,
              ]}
            >
              {/* Inner shimmer overlay on top of the animated bg */}
              <Animated.View
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, animDropShimmer]}
              />
            </Animated.View>
          ) : null}

          {visibleRoutes.map((route, index) => {
            const descriptor = descriptors[route.key];
            const options = descriptor.options;
            const focused = index === activeVisibleIndex;
            const label =
              typeof options.tabBarLabel === 'string'
                ? options.tabBarLabel
                : typeof options.title === 'string'
                  ? options.title
                  : route.name;

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });

              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name, route.params);
              }
            };

            const onLongPress = () => {
              navigation.emit({
                type: 'tabLongPress',
                target: route.key,
              });
            };

            const iconName =
              route.name === 'index'
                ? focused ? 'home' : 'home-outline'
                : route.name === 'library'
                  ? focused ? 'music-box-multiple' : 'music-box-multiple-outline'
                  : route.name === 'playlists'
                    ? focused ? 'playlist-music' : 'playlist-music-outline'
                    : route.name === 'tidal'
                      ? focused ? 'music-circle' : 'music-circle-outline'
                      : focused ? 'cog' : 'cog-outline';

            return (
              <View key={route.key} style={styles.itemContainer}>
                <LiquidTabItem
                  label={label}
                  icon={iconName}
                  focused={focused}
                  activeColor={theme.colors.onPrimaryContainer || theme.colors.onPrimary}
                  inactiveColor={theme.colors.onSurfaceVariant}
                  onPress={onPress}
                  onLongPress={onLongPress}
                />
              </View>
            );
          })}
        </View>
      </View>
    </View >
  );
});

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
    left: TAB_HORIZONTAL,
    right: TAB_HORIZONTAL,
    bottom: TAB_BOTTOM,
  },
  wrapper: {
    height: TAB_HEIGHT,
    borderRadius: TAB_RADIUS,
    borderWidth: 1,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 10,
  },
  itemsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingTop: 8,
    paddingBottom: 8,
  },
  itemContainer: {
    flex: 1,
    zIndex: 2,
  },
  itemButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: TAB_ITEM_RADIUS,
    paddingVertical: 3,
    marginHorizontal: 2,
    overflow: 'hidden',
  },
  itemLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
    marginTop: 1,
  },
  drop: {
    position: 'absolute',
    top: 10,
    borderRadius: 20,
    borderWidth: 1,
    zIndex: 1,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  prismaticLeft: {
    position: 'absolute',
    left: -2,
    top: 4,
    bottom: 4,
    width: 12,
    borderRadius: 12,
    overflow: 'hidden',
  },
  prismaticRight: {
    position: 'absolute',
    right: -2,
    top: 4,
    bottom: 5,
    width: 12,
    borderRadius: 12,
    overflow: 'hidden',
  },
  bottomRim: {
    position: 'absolute',
    left: 5,
    right: 5,
    bottom: -1,
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  reflection: {
    position: 'absolute',
    top: 5,
    left: 7,
    width: 28,
    height: 14,
    borderRadius: 999,
    overflow: 'hidden',
  },
  caustic: {
    position: 'absolute',
    top: 4,
    left: 8,
    width: 36,
    height: 18,
    borderRadius: 999,
    overflow: 'hidden',
  },
});
