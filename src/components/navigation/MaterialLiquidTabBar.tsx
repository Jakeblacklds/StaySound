import { CustomIcon, IconName } from '@/src/components/ui';
import { typeScale, useAnimatedColors, useTheme } from '@/src/theme';
import { ColorTokens } from '@/src/types/theme';
import { pickReadableColor } from '@/src/utils/colorContrast';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React, { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const BAR_HEIGHT = 78;
const H_INSET = 12;
const PILL_W = 68;
const PILL_H = 36;
const ICON_SIZE = 28;
const LABEL_RISE = 18;
const BAR_CONTENT_OFFSET = -2;
const PILL_TOP = Math.round((BAR_HEIGHT - PILL_H) / 2);
const LABEL_TOP = PILL_TOP + PILL_H + 2;

function hex(color: string, alpha: string) {
  return `${color}${alpha}`;
}

function getTabColors(colors: ColorTokens) {
  const activeIcon = pickReadableColor(colors.primaryContainer, [
    colors.onPrimaryContainer,
    colors.onPrimary,
    colors.onSurface,
    colors.onBackground,
  ]);

  return {
    activeIcon,
    accent: colors.primary,
  };
}

type ItemProps = {
  label: string;
  icon: IconName | 'magnify';
  focused: boolean;
  activeIconColor: string;
  mutedColor: string;
  accentColor: string;
  onPress: () => void;
  onLongPress: () => void;
};

const TabItem = memo(function TabItem({
  label,
  icon,
  focused,
  activeIconColor,
  mutedColor,
  accentColor,
  onPress,
  onLongPress,
}: ItemProps) {
  const sel = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    sel.value = withSpring(focused ? 1 : 0, {
      damping: 17,
      stiffness: 250,
      mass: 0.72,
    });
  }, [focused, sel]);

  const iconAnim = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(sel.value, [0, 1], [0, -3]) },
      { scale: interpolate(sel.value, [0, 1], [1, 1.06]) },
    ],
  }));

  const labelAnim = useAnimatedStyle(() => ({
    opacity: interpolate(sel.value, [0, 0.18, 1], [0, 0, 1]),
    transform: [
      { translateY: interpolate(sel.value, [0, 1], [LABEL_RISE, 0]) },
      { scale: interpolate(sel.value, [0, 1], [0.92, 1]) },
    ],
  }));

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.itemButton}
      android_ripple={{ color: hex(accentColor, '20'), borderless: true, radius: 36 }}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
    >
      <Animated.Text
        style={[styles.itemLabel, { color: mutedColor }, labelAnim]}
        numberOfLines={1}
      >
        {label}
      </Animated.Text>

      <Animated.View style={[styles.iconArea, iconAnim]}>
        {icon === 'magnify' ? (
          <MaterialCommunityIcons
            name="magnify"
            size={ICON_SIZE}
            color={focused ? activeIconColor : mutedColor}
          />
        ) : focused ? (
          <CustomIcon
            name={icon as IconName}
            size={ICON_SIZE}
            color={activeIconColor}
            forceDynamicColor={false}
            preserveColor={true}
          />
        ) : (
          <CustomIcon
            name={icon as IconName}
            size={ICON_SIZE}
            color={mutedColor}
            forceDynamicColor={true}
          />
        )}
      </Animated.View>
    </Pressable>
  );
});

export const MaterialLiquidTabBar = memo(function MaterialLiquidTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const aC = useAnimatedColors();
  const [barWidth, setBarWidth] = useState(0);

  const visibleRoutes = useMemo(
    () =>
      state.routes.filter((route) => {
        const options = descriptors[route.key]?.options;
        return (options as any)?.href !== null && route.name !== 'settings';
      }),
    [descriptors, state.routes],
  );

  const activeIdx = useMemo(() => {
    const activeKey = state.routes[state.index]?.key;
    return Math.max(0, visibleRoutes.findIndex((r) => r.key === activeKey));
  }, [state.index, state.routes, visibleRoutes]);

  const slotWidth =
    barWidth > 0 ? (barWidth - H_INSET * 2) / Math.max(visibleRoutes.length, 1) : 0;
  const pillX = useSharedValue(0);
  const stretch = useSharedValue(0);

  useEffect(() => {
    if (slotWidth <= 0) return;
    const target = H_INSET + activeIdx * slotWidth + (slotWidth - PILL_W) / 2;
    const delta = Math.abs(target - pillX.value);
    const energy = Math.min(delta / Math.max(slotWidth, 1), 1);

    stretch.value = energy;
    pillX.value = withSpring(target, { damping: 26, stiffness: 200, mass: 1 });
    stretch.value = withTiming(0, { duration: 480, easing: Easing.out(Easing.cubic) });
  }, [activeIdx, slotWidth, pillX, stretch]);

  const pillTransformStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: pillX.value },
      { scaleX: interpolate(stretch.value, [0, 1], [1, 1.1]) },
      { scaleY: interpolate(stretch.value, [0, 1], [1, 0.9]) },
    ],
  }));

  const pillBgStyle = useAnimatedStyle(() => ({
    backgroundColor: aC.primaryContainer?.value ?? theme.colors.primaryContainer,
  }));

  const navBgStyle = useAnimatedStyle(() => ({
    backgroundColor: aC.surface.value,
  }));

  const palette = getTabColors(theme.colors);

  return (
    <View style={[styles.outer, { height: BAR_HEIGHT + insets.bottom }]} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, navBgStyle]} />

      <View style={styles.itemsRow} onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}>
        {slotWidth > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pill,
              { width: PILL_W, height: PILL_H },
              pillBgStyle,
              pillTransformStyle,
            ]}
          />
        )}

        {visibleRoutes.map((route, index) => {
          const descriptor = descriptors[route.key];
          const options = descriptor.options;
          const focused = index === activeIdx;

          const label =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : typeof options.title === 'string'
                ? options.title
                : route.name;

          const iconName: IconName | 'magnify' =
            route.name === 'index'
              ? 'Home'
              : route.name === 'library'
                ? 'Library'
                : route.name === 'playlists'
                ? 'Playlist'
                : route.name === 'tidal'
                    ? 'magnify'
                    : 'Ajustes';

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
            navigation.emit({ type: 'tabLongPress', target: route.key });
          };

          return (
            <View key={route.key} style={styles.itemContainer}>
              <TabItem
                label={label}
                icon={iconName}
                focused={focused}
                activeIconColor={palette.activeIcon}
                mutedColor={theme.colors.onSurfaceVariant}
                accentColor={palette.accent}
                onPress={onPress}
                onLongPress={onLongPress}
              />
            </View>
          );
        })}
      </View>

      <View style={{ height: insets.bottom }} />
    </View>
  );
});

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    elevation: 0,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
  },
  itemsRow: {
    height: BAR_HEIGHT,
    flexDirection: 'row',
    paddingHorizontal: H_INSET,
  },
  itemContainer: {
    flex: 1,
  },
  itemButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  iconArea: {
    width: PILL_W,
    height: PILL_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemLabel: {
    ...typeScale.micro,
    position: 'absolute',
    top: LABEL_TOP,
    maxWidth: PILL_W + 22,
    letterSpacing: 0.1,
    textAlign: 'center',
    fontWeight: '700',
  },
  pill: {
    position: 'absolute',
    top: PILL_TOP + BAR_CONTENT_OFFSET,
    left: 0,
    borderRadius: PILL_H / 2,
  },
});






