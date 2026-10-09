/**
 * MaterialLiquidTabBar — polished navigation bar:
 *   - Bespoke line icons (see TabBarIcons) — no stock glyph fonts
 *   - Icons lift + light up on touch, and stay lifted while selected
 *   - Radial accent glow behind the active icon (real light, not a pill)
 *   - Spring pop when a tab becomes active
 *   - Android: inset capsule with a separately clipped material and lifted icons
 *   - Simulated frosted-glass base (album tint + sheen) + dynamic album art tint
 */
import { usePlayerStore } from '@/src/stores';
import { typeScale, useAnimatedColors, useTheme } from '@/src/theme';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { usePathname } from 'expo-router';
import React, { memo, useEffect, useMemo, useRef } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { TabBarIcon, TabIconName } from './TabBarIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_HEIGHT as BAR_HEIGHT, ANDROID_DOCK_INSET } from '../player/playerLayout';
import { hasNativePlayerChrome } from '@/modules/player-chrome/src';
import { AndroidNavigationBar } from './AndroidNavigationBar';

// Above this expansion the dock is sliding away under the player — drop the
// costly live blur and use an opaque album surface instead.
const BLUR_COLLAPSE_THRESHOLD = 0.12;
// How long to freeze the live blur (show opaque) after a route change so it
// doesn't render a stale, still-scrolling snapshot of the previous screen.
const NAV_FREEZE_MS = 320;

const IS_ANDROID = Platform.OS === 'android';
// Keep the existing player/content reservation; float the Android surface
// inside it so the mini player and expanded-player transition stay aligned.
const DOCK_HEIGHT = BAR_HEIGHT - 8;
const DOCK_INSET = ANDROID_DOCK_INSET;
const H_INSET = 12;
const ICON_SIZE = 26;
const GLOW_SIZE = IS_ANDROID ? 36 : 52;
const LABEL_HEIGHT = 13;
const ICON_LABEL_GAP = 5;
// Icon + label are laid out as one stack and centered as a group. Before, the
// icon was centered on its own and the label hung below it, which pushed the
// whole pair visually toward the bottom edge of the dock.
const CONTENT_HEIGHT = ICON_SIZE + ICON_LABEL_GAP + LABEL_HEIGHT;
// A hair above true center: the dock sits over the gesture inset, so optical
// center reads slightly high.
const CONTENT_TOP = Math.round((BAR_HEIGHT - CONTENT_HEIGHT) / 2) - 2;

// How far the icon rises when it becomes active, and the extra rise while held.
const SELECTED_LIFT = IS_ANDROID ? -1 : -7;
const PRESS_LIFT = IS_ANDROID ? -1 : -5;

const TAB_ICONS: Record<string, TabIconName> = {
  index: 'home',
  library: 'library',
  playlists: 'playlists',
  tidal: 'search',
};

/** Soft radial light behind the icon — a lamp, not a chip. */
const TabGlow = memo(function TabGlow({ id, color }: { id: string; color: string }) {
  const gradientId = `tabGlow-${id}`;
  return (
    <Svg width={GLOW_SIZE} height={GLOW_SIZE} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id={gradientId} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={0.62} />
          <Stop offset="0.42" stopColor={color} stopOpacity={0.24} />
          <Stop offset="0.75" stopColor={color} stopOpacity={0.07} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx="50" cy="50" r="50" fill={`url(#${gradientId})`} />
    </Svg>
  );
});

type ItemProps = {
  label: string;
  routeName: string;
  focused: boolean;
  mutedColor: string;
  accentColor: string;
  onPress: () => void;
  onLongPress: () => void;
};

const TabItem = memo(function TabItem({
  label,
  routeName,
  focused,
  mutedColor,
  accentColor,
  onPress,
  onLongPress,
}: ItemProps) {
  const sel = useSharedValue(focused ? 1 : 0);
  const popScale = useSharedValue(1);
  const pressAmt = useSharedValue(0);
  const prevFocused = useRef(focused);

  useEffect(() => {
    const becoming = focused && !prevFocused.current;
    prevFocused.current = focused;

    sel.value = withSpring(focused ? 1 : 0, {
      damping: 17,
      stiffness: 260,
      mass: 0.8,
    });

    if (becoming) {
      popScale.value = withSequence(
        withTiming(IS_ANDROID ? 1.04 : 1.3, { duration: 110, easing: Easing.out(Easing.quad) }),
        withSpring(1, { damping: IS_ANDROID ? 22 : 9, stiffness: 320, mass: 0.7 })
      );
    }
  }, [focused, popScale, sel]);

  const iconName = TAB_ICONS[routeName] ?? 'home';

  // Lift is the whole point of the gesture: it rises on touch and STAYS risen
  // while the tab is selected, so the press reads as picking the icon up.
  const iconWrapStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: sel.value * SELECTED_LIFT + pressAmt.value * PRESS_LIFT },
      { scale: popScale.value * (1 + sel.value * (IS_ANDROID ? 0.02 : 0.06) + pressAmt.value * (IS_ANDROID ? 0.03 : 0.12)) },
    ],
  }));

  // The glow trails the lift instead of matching it: the light pools on the
  // dock while the icon rises out of it (and it keeps the halo clear of the
  // dock's clipped top edge, which would otherwise slice it).
  const glowStyle = useAnimatedStyle(() => {
    const lift = sel.value * SELECTED_LIFT + pressAmt.value * PRESS_LIFT;
    return {
      opacity: Math.max(sel.value * 0.95, pressAmt.value) * (IS_ANDROID ? 0.28 : 1),
      transform: [
        { translateY: -lift * 0.55 },
        { scale: 0.55 + sel.value * 0.45 + pressAmt.value * 0.2 },
      ],
    };
  });

  const activeIconStyle = useAnimatedStyle(() => ({
    opacity: sel.value,
  }));

  const inactiveIconStyle = useAnimatedStyle(() => ({
    opacity: 1 - sel.value,
  }));

  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(sel.value, [0, 1], [mutedColor, accentColor]),
    opacity: interpolate(sel.value, [0, 1], [IS_ANDROID ? 0.9 : 0.62, 1]),
    transform: [{ translateY: interpolate(sel.value, [0, 1], [0, -1]) }],
  }));

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => {
        pressAmt.value = withTiming(1, { duration: 110, easing: Easing.out(Easing.cubic) });
      }}
      onPressOut={() => {
        // Bouncy release — the icon settles back down instead of snapping.
        pressAmt.value = withSpring(0, { damping: IS_ANDROID ? 22 : 11, stiffness: 320, mass: 0.7 });
      }}
      style={[styles.itemButton, IS_ANDROID && styles.androidItemButton]}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: focused }}
    >
      {/* Icon — lift + pop + glow. The glow rides along with the lift so the
          light stays attached to the icon. */}
      <Animated.View style={[styles.iconArea, iconWrapStyle]}>
        <Animated.View style={[styles.glow, glowStyle]} pointerEvents="none">
          <TabGlow id={routeName} color={accentColor} />
        </Animated.View>
        {/* Muted outline fades out */}
        <Animated.View style={inactiveIconStyle}>
          <TabBarIcon name={iconName} size={ICON_SIZE} color={mutedColor} />
        </Animated.View>
        {/* Accent copy — same geometry, lit from the inside — fades in */}
        <Animated.View style={[styles.iconOverlay, activeIconStyle]}>
          <TabBarIcon name={iconName} size={ICON_SIZE} color={accentColor} filled />
        </Animated.View>
      </Animated.View>

      <Animated.Text style={[styles.itemLabel, IS_ANDROID && styles.androidItemLabel, labelStyle]} numberOfLines={1}>
        {label}
      </Animated.Text>
    </Pressable>
  );
});

export const MaterialLiquidTabBar = memo(function MaterialLiquidTabBar(props: BottomTabBarProps) {
  return hasNativePlayerChrome ? <AndroidNavigationBar {...props} /> : <LegacyMaterialLiquidTabBar {...props} />;
});

const LegacyMaterialLiquidTabBar = memo(function LegacyMaterialLiquidTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const aC = useAnimatedColors();
  const expansion = usePlayerStore(s => s.expansion);
  const pathname = usePathname();

  // ---- Simulated frost (perf) ------------------------------------------
  // The dock used to run a live (dimezis) blur, costly on its own and doubly so
  // stacked under the mini player's own live blur — that pair caused the jank
  // and the seam between the two surfaces. We now fake the frost with the same
  // recipe as the mini: an album-tinted near-opaque surface + a static glass
  // sheen. Same tint on both → they read as one continuous pane. `forceSolid`
  // still pushes it opaque briefly on route changes so it never flashes the
  // incoming screen's content.
  const forceSolid = useSharedValue(0);

  useEffect(() => {
    forceSolid.value = 1;
    const t = setTimeout(() => {
      forceSolid.value = withTiming(0, { duration: 160 });
    }, NAV_FREEZE_MS);
    return () => clearTimeout(t);
  }, [pathname, forceSolid]);

  const visibleRoutes = useMemo(
    () => state.routes.filter((route) => {
      const options = descriptors[route.key]?.options;
      return (options as any)?.href !== null && route.name !== 'settings';
    }),
    [descriptors, state.routes],
  );

  const activeIdx = useMemo(() => {
    const activeKey = state.routes[state.index]?.key;
    return Math.max(0, visibleRoutes.findIndex((r) => r.key === activeKey));
  }, [state.index, state.routes, visibleRoutes]);

  // Album-hued frost base (replaces the live blur). Near-opaque and matched to
  // the mini player's tint (dark 0.90 / light 0.92) so the two surfaces read as
  // a single continuous pane of glass.
  const navTintStyle = useAnimatedStyle(() => {
    return {
      backgroundColor: aC.surface.value,
      opacity: 1,
    };
  });

  // Opaque album surface used whenever the live blur is off: it fades in as the
  // dock descends (matching the player turning opaque) and during a route-change
  // freeze. When fully collapsed + settled it is transparent so the frost shows.
  const navSolidStyle = useAnimatedStyle(() => {
    const ramp = interpolate(
      expansion?.value ?? 0,
      [0, BLUR_COLLAPSE_THRESHOLD],
      [0, 0.94],
      Extrapolation.CLAMP,
    );
    return {
      backgroundColor: aC.surface.value,
      opacity: Math.max(ramp, forceSolid.value * 0.94),
    };
  });

  // As the player expands, the WHOLE dock (frosted glass + icons) slides down
  // in perfect lockstep with the player's own bottom edge (same range, same
  // [0, 0.32] window — see FullPlayer's rootAnimatedStyle `bottom`). The dock's
  // top edge therefore stays glued to the player's bottom edge: no gap opens
  // between them and they never overlap, so the two frosted surfaces read as a
  // single continuous piece of glass sliding off-screen. No opacity fade — the
  // dock is fully off-screen by p=0.32, so it never needs to dissolve.
  const navExitStyle = useAnimatedStyle(() => {
    const p = expansion?.value ?? 0;
    return {
      transform: [{
        translateY: interpolate(
          p,
          [0, 0.32],
          [0, BAR_HEIGHT + insets.bottom],
          Extrapolation.CLAMP,
        ),
      }],
    };
  }, [insets.bottom, expansion]);

  const dockFrame = IS_ANDROID ? {
    left: Math.max(DOCK_INSET, insets.left + 8),
    right: Math.max(DOCK_INSET, insets.right + 8),
    top: 4,
    height: DOCK_HEIGHT,
  } : undefined;

  return (
    <View
      style={[styles.outer, IS_ANDROID && styles.androidOuter, { height: BAR_HEIGHT + insets.bottom }]}
      pointerEvents="box-none"
    >
      {/* Frosted glass dock (blur + dynamic tint). Descends together with the
          icons as the player expands. */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          IS_ANDROID && styles.androidSurface,
          dockFrame,
          navExitStyle,
        ]}
        pointerEvents="none"
      >
        {/* Album-tinted frost base (replaces the costly live blur) */}
        <Animated.View style={[StyleSheet.absoluteFill, navTintStyle]} />
        {/* Glass sheen — static. The dock is the BOTTOM of the combined pane,
            so its top stays clear (continuous with the mini's faded-out bottom)
            and it carries only a faint grounding shade toward its lower edge. */}
        <LinearGradient
          style={StyleSheet.absoluteFill}
          colors={
            isDark
              ? ['rgba(0,0,0,0)', 'rgba(0,0,0,0.06)']
              : ['rgba(0,0,0,0)', 'rgba(0,0,0,0.03)']
          }
          locations={[0.25, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          pointerEvents="none"
        />
        {/* Opaque ramp as the dock slides under the expanding player */}
        <Animated.View style={[StyleSheet.absoluteFill, navSolidStyle]} />
      </Animated.View>

      <Animated.View style={[
        IS_ANDROID && styles.androidContent,
        dockFrame,
        navExitStyle,
      ]}>
        <View
          style={[styles.itemsRow, IS_ANDROID && styles.androidItemsRow]}
        >
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

            const onPress = () => {
              // A tab that actually changes screen deserves a firmer thump than
              // re-tapping the one you're already on.
              Haptics.impactAsync(
                IS_ANDROID || focused
                  ? Haptics.ImpactFeedbackStyle.Light
                  : Haptics.ImpactFeedbackStyle.Medium,
              );
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
                  routeName={route.name}
                  focused={focused}
                  mutedColor={theme.colors.onSurfaceVariant}
                  accentColor={theme.colors.primary}
                  onPress={onPress}
                  onLongPress={onLongPress}
                />
              </View>
            );
          })}
        </View>
      </Animated.View>
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
  },
  // Clip only the material, allowing the selected icon to rise naturally.
  androidOuter: {
    overflow: 'visible',
  },
  androidItemButton: {
    paddingTop: Math.round((DOCK_HEIGHT - ICON_SIZE - ICON_LABEL_GAP - typeScale.micro.lineHeight) / 2),
  },
  androidSurface: {
    bottom: undefined,
    borderRadius: DOCK_HEIGHT / 2,
    overflow: 'hidden',
  },
  androidContent: {
    position: 'absolute',
  },
  androidItemsRow: {
    height: DOCK_HEIGHT,
    paddingHorizontal: 8,
  },
  androidItemLabel: {
    ...typeScale.micro,
    letterSpacing: 0.1,
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
    justifyContent: 'flex-start',
    paddingTop: CONTENT_TOP,
    overflow: 'visible',
  },
  iconArea: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    top: (ICON_SIZE - GLOW_SIZE) / 2,
    left: (ICON_SIZE - GLOW_SIZE) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemLabel: {
    fontFamily: 'StaySound',
    fontSize: 10.5,
    lineHeight: LABEL_HEIGHT,
    marginTop: ICON_LABEL_GAP,
    maxWidth: 76,
    letterSpacing: 0.1,
    textAlign: 'center',
    fontWeight: '500',
  },
});
