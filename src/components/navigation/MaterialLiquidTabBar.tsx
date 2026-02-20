import { useTheme } from '@/src/theme';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
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

const TAB_HEIGHT = 88;
const TAB_BOTTOM = 10;
const TAB_HORIZONTAL = 10;
const TAB_RADIUS = 24;
const TAB_ITEM_RADIUS = 16;
const DROP_WIDTH = 56;
const DROP_HEIGHT = 36;

function getRouteAccent(routeName: string, fallback: string) {
  switch (routeName) {
    case 'index':
      return '#7DB6FF';
    case 'library':
      return '#69D6B7';
    case 'playlists':
      return '#B8A6FF';
    case 'tidal':
      return '#68C8FF';
    case 'settings':
      return '#9AB1D9';
    default:
      return fallback;
  }
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
      <Animated.Text style={[styles.itemLabel, { color }, labelStyle]} numberOfLines={1}>
        {label}
      </Animated.Text>
    </Pressable>
  );
});

export const MaterialLiquidTabBar = memo(function MaterialLiquidTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { theme } = useTheme();
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

  const activeAccent = useMemo(() => {
    const currentRoute = visibleRoutes[activeVisibleIndex];
    return getRouteAccent(currentRoute?.name ?? '', theme.colors.primary);
  }, [activeVisibleIndex, theme.colors.primary, visibleRoutes]);

  const activeAccent85 = `${activeAccent}85`;
  const activeAccentC4 = `${activeAccent}C4`;

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
      damping: 16,
      stiffness: 180,
      mass: 0.88,
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
      { scaleX: interpolate(dropStretch.value, [0, 1], [1, 1.24]) },
      { scaleY: interpolate(dropStretch.value, [0, 1], [1, 0.86]) },
      { rotate: `${interpolate(dropStretch.value, [0, 1], [0, 7])}deg` },
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
    <View pointerEvents="box-none" style={styles.outer}>
      <View
        style={[
          styles.wrapper,
          {
            borderColor: withAlpha(theme.colors.outline, '7A'),
            shadowColor: theme.colors.shadow,
          },
        ]}
      >
        <LinearGradient
          colors={[
            withAlpha(theme.colors.surface, 'F4'),
            withAlpha(theme.colors.surfaceVariant, 'EE'),
            withAlpha(theme.colors.primaryContainer, 'E2'),
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0.9 }}
          style={StyleSheet.absoluteFill}
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
                {
                  width: DROP_WIDTH,
                  height: DROP_HEIGHT,
                  borderColor: withAlpha(activeAccent, '70'),
                  backgroundColor: withAlpha(theme.colors.primaryContainer, 'D0'),
                },
                accentColorStyle,
                dropStyle,
              ]}
            >
              <LinearGradient
                colors={[
                  withAlpha(theme.colors.primary, '2E'),
                  withAlpha(theme.colors.primaryContainer, '66'),
                  withAlpha(theme.colors.primary, '1F'),
                ]}
                start={{ x: 0.1, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <Animated.View style={[styles.prismaticLeft, prismaticLeftStyle]}>
                <LinearGradient
                  colors={[withAlpha(activeAccent, 'B3'), 'rgba(255,255,255,0)']}
                  start={{ x: 0, y: 0.2 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
              <Animated.View style={[styles.prismaticRight, prismaticRightStyle]}>
                <LinearGradient
                  colors={['rgba(125,233,255,0.62)', 'rgba(255,255,255,0)']}
                  start={{ x: 1, y: 0.2 }}
                  end={{ x: 0, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
              <Animated.View style={[StyleSheet.absoluteFill, lensDistortStyle]}>
                <BlurView
                  intensity={24}
                  tint="light"
                  style={StyleSheet.absoluteFill}
                  experimentalBlurMethod="dimezisBlurView"
                />
              </Animated.View>
              <Animated.View style={[styles.bottomRim, bottomRimStyle]}>
                <LinearGradient
                  colors={[withAlpha(activeAccent, '80'), withAlpha(activeAccent, '0A')]}
                  start={{ x: 0.5, y: 1 }}
                  end={{ x: 0.5, y: 0 }}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
              <Animated.View style={[styles.caustic, causticStyle]}>
                <LinearGradient
                  colors={['rgba(255,255,255,0.42)', 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0)']}
                  start={{ x: 0, y: 0.2 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
              <Animated.View style={[styles.reflection, reflectionStyle]}>
                <LinearGradient
                  colors={['rgba(255,255,255,0.65)', 'rgba(255,255,255,0.05)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0.9 }}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
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
                  activeColor={getRouteAccent(route.name, theme.colors.primary)}
                  inactiveColor={theme.colors.onSurfaceVariant}
                  onPress={onPress}
                  onLongPress={onLongPress}
                />
              </View>
            );
          })}
        </View>
      </View>
    </View>
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
