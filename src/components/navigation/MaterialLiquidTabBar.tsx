import { CustomIcon, IconName } from '@/src/components/ui';
import { useAnimatedColors, useTheme } from '@/src/theme';
import { ColorTokens } from '@/src/types/theme';
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

// ─── Layout constants ─────────────────────────────────────────────────────────
const BAR_HEIGHT = 64;
const H_INSET = 12;
const PILL_W = 68;
const PILL_H = 36;
const ICON_SIZE = 28;
const LABEL_H = 14;
const ITEM_GAP = 3;
/** Top position of the pill — aligned with the iconArea, not the full button */
const PILL_TOP = Math.round((BAR_HEIGHT - (PILL_H + ITEM_GAP + LABEL_H)) / 2);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function hex(color: string, alpha: string) {
  return `${color}${alpha}`;
}

function getTabColors(colors: ColorTokens) {
  return {
    // Color del ícono activo: onPrimaryContainer siempre contrasta con el pill
    activeIcon: colors.onPrimaryContainer ?? colors.onPrimary,
    accent: colors.primary,
  };
}

// ─── Single tab item ──────────────────────────────────────────────────────────
type ItemProps = {
  label: string;
  icon: IconName;
  focused: boolean;
  /** onPrimaryContainer — guaranteed to contrast against the pill */
  activeIconColor: string;
  /** onSurfaceVariant — used for labels AND inactive icons */
  mutedColor: string;
  /** primary — for ripple */
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
      damping: 20,
      stiffness: 260,
      mass: 0.7,
    });
  }, [focused, sel]);

  const iconAnim = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(sel.value, [0, 1], [0, -1.5]) },
      { scale: interpolate(sel.value, [0, 1], [1, 1.06]) },
    ],
  }));

  const labelAnim = useAnimatedStyle(() => ({
    opacity: interpolate(sel.value, [0, 0.5, 1], [0.45, 0.65, 0.9]),
    transform: [{ translateY: interpolate(sel.value, [0, 1], [2, 0]) }],
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
      {/* Fixed-size box matches pill dimensions → icon always centred under pill */}
      <Animated.View style={[styles.iconArea, iconAnim]}>
        {focused ? (
          // Active icon: onPrimaryContainer always contrasts against the pill.
          // forceDynamicColor=false so we use the exact semantic color, not a
          // hue-shifted version that might blend into the primaryContainer pill.
          <CustomIcon
            name={icon}
            size={ICON_SIZE}
            color={activeIconColor}
            forceDynamicColor={false}
          />
        ) : (
          // Inactive icon: forceDynamicColor=true gives a nice album-tinted tint.
          // We pass onSurfaceVariant as the base so it always remains readable.
          <CustomIcon
            name={icon}
            size={ICON_SIZE}
            color={mutedColor}
            forceDynamicColor={true}
          />
        )}
      </Animated.View>

      {/* Label — always muted.
          The pill only covers the iconArea, NOT the label.
          Colouring the label with the accent makes it look disconnected and odd. */}
      <Animated.Text
        style={[styles.itemLabel, { color: mutedColor }, labelAnim]}
        numberOfLines={1}
      >
        {label}
      </Animated.Text>
    </Pressable>
  );
});

// ─── Main navbar ──────────────────────────────────────────────────────────────
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

  // ── Pill animation ────────────────────────────────────────────────────────
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

  // Pill background — tracks album dynamic color
  const pillBgStyle = useAnimatedStyle(() => ({
    backgroundColor: aC.primaryContainer?.value ?? theme.colors.primaryContainer,
  }));

  const navBgStyle = useAnimatedStyle(() => ({
    backgroundColor: aC.surface.value,
  }));

  // Resolved colors – read from theme (updated on every re-render when album color changes)
  const palette = getTabColors(theme.colors);

  return (
    <View style={[styles.outer, { height: BAR_HEIGHT + insets.bottom }]} pointerEvents="box-none">
      {/* Background */}
      <Animated.View style={[StyleSheet.absoluteFill, navBgStyle]} />

      {/* Top hair-line divider */}
      <View style={[styles.topDivider, { backgroundColor: hex(theme.colors.outline, '30') }]} />

      {/* Items row */}
      <View style={styles.itemsRow} onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}>
        {/* Sliding pill — absolute, behind icons */}
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

        {/* Tab items */}
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

          const iconName: IconName =
            route.name === 'index'
              ? 'Home'
              : route.name === 'library'
                ? 'Library'
                : route.name === 'playlists'
                  ? 'Playlist'
                  : route.name === 'tidal'
                    ? 'Descargar'
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

      {/* Safe-area spacer */}
      <View style={{ height: insets.bottom }} />
    </View>
  );
});

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    elevation: 8,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  topDivider: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
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
    gap: ITEM_GAP,
  },
  /** Fixed box matching PILL_W × PILL_H → icon always sits perfectly under the pill */
  iconArea: {
    width: PILL_W,
    height: PILL_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemLabel: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.1,
    textAlign: 'center',
  },
  pill: {
    position: 'absolute',
    top: PILL_TOP,
    left: 0,
    borderRadius: PILL_H / 2,
  },
});
