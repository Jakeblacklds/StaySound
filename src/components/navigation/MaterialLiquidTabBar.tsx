/**
 * MaterialLiquidTabBar — polished navigation bar:
 *   - Ionicons filled ↔ outline crossfade on selection
 *   - Spring pop when a tab becomes active
 *   - Press-scale touch feedback (no ripple)
 *   - Liquid pill with squish-stretch spring
 *   - BlurView frosted-glass base + dynamic album art tint
 */
import { useDynamicColors } from '@/src/hooks';
import { usePlayerStore } from '@/src/stores';
import { typeScale, useAnimatedColors, usePerformanceProfile, useTheme } from '@/src/theme';
import { ColorTokens } from '@/src/types/theme';
import { mixHexColors, pickReadableColor } from '@/src/utils/colorContrast';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_HEIGHT as BAR_HEIGHT } from '../player/playerLayout';

const H_INSET = 12;
const PILL_W = 54;
const PILL_H = 34;
const ICON_SIZE = 25;
const LABEL_RISE = 10;
const BAR_CONTENT_OFFSET = -2;
const PILL_TOP = Math.round((BAR_HEIGHT - PILL_H) / 2);
const LABEL_TOP = PILL_TOP + PILL_H + 3;

const TAB_ICONS = {
  index:     { filled: 'home' as const,          outline: 'home-outline' as const },
  library:   { filled: 'albums' as const,        outline: 'albums-outline' as const },
  playlists: { filled: 'musical-notes' as const, outline: 'musical-notes-outline' as const },
  tidal:     { filled: 'search' as const,        outline: 'search-outline' as const },
  settings:  { filled: 'settings' as const,      outline: 'settings-outline' as const },
} as const;

function getTabColors(colors: ColorTokens) {
  const activeIcon = pickReadableColor(colors.primaryContainer, [
    colors.onPrimaryContainer,
    colors.onPrimary,
    colors.onSurface,
    colors.onBackground,
  ]);
  return { activeIcon, accent: colors.primary };
}

type ItemProps = {
  label: string;
  routeName: string;
  focused: boolean;
  activeIconColor: string;
  mutedColor: string;
  accentColor: string;
  onPress: () => void;
  onLongPress: () => void;
};

const TabItem = memo(function TabItem({
  label,
  routeName,
  focused,
  activeIconColor,
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
      damping: 22,
      stiffness: 300,
      mass: 0.8,
    });

    if (becoming) {
      popScale.value = withSequence(
        withTiming(1.22, { duration: 88, easing: Easing.out(Easing.quad) }),
        withSpring(1, { damping: 8, stiffness: 380, mass: 0.65 })
      );
    }
  }, [focused, popScale, sel]);

  const icons = (TAB_ICONS as Record<string, { filled: string; outline: string }>)[routeName] ?? TAB_ICONS.index;

  const iconWrapStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(sel.value, [0, 1], [0, -2]) },
      { scale: popScale.value * interpolate(pressAmt.value, [0, 1], [1, 0.80]) },
    ],
  }));

  const activeIconStyle = useAnimatedStyle(() => ({
    opacity: sel.value,
  }));

  const inactiveIconStyle = useAnimatedStyle(() => ({
    opacity: 1 - sel.value,
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sel.value, [0, 0.28, 1], [0, 0, 1]),
    transform: [
      { translateY: interpolate(sel.value, [0, 1], [LABEL_RISE, 0]) },
      { scale: interpolate(sel.value, [0, 1], [0.84, 1]) },
    ],
  }));

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => {
        pressAmt.value = withTiming(1, { duration: 75, easing: Easing.out(Easing.quad) });
      }}
      onPressOut={() => {
        pressAmt.value = withSpring(0, { damping: 12, stiffness: 450, mass: 0.7 });
      }}
      style={styles.itemButton}
      android_ripple={{ color: `${accentColor}18`, borderless: true, radius: 30 }}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
    >
      {/* Icon — pop scale + vertical lift + press squish */}
      <Animated.View style={[styles.iconArea, iconWrapStyle]}>
        {/* Outline icon fades out */}
        <Animated.View style={inactiveIconStyle}>
          <Ionicons name={icons.outline as any} size={ICON_SIZE} color={mutedColor} />
        </Animated.View>
        {/* Filled icon fades in, absolutely overlaid */}
        <Animated.View style={[styles.iconOverlay, activeIconStyle]}>
          <Ionicons name={icons.filled as any} size={ICON_SIZE} color={activeIconColor} />
        </Animated.View>
      </Animated.View>

      {/* Label springs up from below */}
      <Animated.Text
        style={[styles.itemLabel, { color: mutedColor }, labelStyle]}
        numberOfLines={1}
      >
        {label}
      </Animated.Text>
    </Pressable>
  );
});

export const MaterialLiquidTabBar = memo(function MaterialLiquidTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const performanceProfile = usePerformanceProfile();
  const aC = useAnimatedColors();
  const expansion = usePlayerStore(s => s.expansion);
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const pendingTrackPreview = usePlayerStore(s => s.pendingTrackPreview);
  const [barWidth, setBarWidth] = useState(0);

  const navArtworkUri =
    pendingTrackPreview?.artwork || currentTrack?.artwork || currentTrack?.artworkThumb;
  const { colors: albumColors, animated: navAnimColors } = useDynamicColors(navArtworkUri, {
    enabled: performanceProfile.enableDynamicColors,
  });

  const shouldUseThemeColors = !performanceProfile.enableDynamicColors;
  const navPlayerColors = shouldUseThemeColors
    ? {
        primary: theme.colors.primary,
        secondary: theme.colors.secondary,
        background: theme.colors.background,
        text: theme.colors.onSurface,
        onPrimary: theme.colors.onPrimary,
        onSurface: theme.colors.onSurface,
        accent: theme.colors.primary,
        isDark,
      }
    : albumColors;

  const navSurfaceColor = useMemo(() => {
    if (shouldUseThemeColors) return theme.colors.surface;
    return mixHexColors(
      theme.colors.surface,
      navPlayerColors.background || theme.colors.surface,
      isDark ? 1.0 : 0.25
    );
  }, [isDark, navPlayerColors.background, shouldUseThemeColors, theme.colors.surface]);

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

  const slotWidth =
    barWidth > 0 ? (barWidth - H_INSET * 2) / Math.max(visibleRoutes.length, 1) : 0;

  const pillX = useSharedValue(0);
  const stretch = useSharedValue(0);

  useEffect(() => {
    if (slotWidth <= 0) return;
    const target = H_INSET + activeIdx * slotWidth + (slotWidth - PILL_W) / 2;
    const delta = Math.abs(target - pillX.value);
    const energy = Math.min(delta / Math.max(slotWidth, 1), 1);

    stretch.value = energy * 0.9;
    pillX.value = withSpring(target, { damping: 24, stiffness: 220, mass: 0.9 });
    stretch.value = withTiming(0, { duration: 520, easing: Easing.out(Easing.cubic) });
  }, [activeIdx, slotWidth, pillX, stretch]);

  const pillTransformStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: pillX.value },
      { scaleX: interpolate(stretch.value, [0, 1], [1, 1.22]) },
      { scaleY: interpolate(stretch.value, [0, 1], [1, 0.82]) },
    ],
  }));

  const pillBgStyle = useAnimatedStyle(() => ({
    backgroundColor: aC.primaryContainer?.value ?? theme.colors.primaryContainer,
  }));

  // Semi-transparent tint so the BlurView bleeds through
  const navTintStyle = useAnimatedStyle(() => {
    const dynamicBackground = navAnimColors?.background?.value;
    return {
      backgroundColor: dynamicBackground || navSurfaceColor || aC.surface.value,
      opacity: 0.78,
    };
  });

  // Fade the whole frosted-glass dock out as the player expands, in sync with
  // the player's bottom edge sweeping down over the tab-bar region (both finish
  // at p=0.32). The remaining (uncovered) glass strip dissolves proportionally,
  // so the growing player glass is the only translucent layer — no double-glass
  // band / seam where the two surfaces used to overlap.
  const navGlassFadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(expansion?.value ?? 0, [0, 0.32], [1, 0], Extrapolation.CLAMP),
  }), [expansion]);

  const tabBarContentStyle = useAnimatedStyle(() => {
    const p = expansion?.value ?? 0;
    const travel = interpolate(
      p,
      [0, 0.06, 1],
      [0, BAR_HEIGHT + insets.bottom + 12, BAR_HEIGHT + insets.bottom + 12]
    );
    return { transform: [{ translateY: travel }] };
  }, [insets.bottom, expansion]);

  const palette = getTabColors(theme.colors);

  return (
    <View
      style={[styles.outer, { height: BAR_HEIGHT + insets.bottom }]}
      pointerEvents="box-none"
    >
      {/* Frosted glass dock (blur + dynamic tint). Fades out during player
          expansion so it never stacks with the player's glass. */}
      <Animated.View
        style={[StyleSheet.absoluteFill, navGlassFadeStyle]}
        pointerEvents="none"
      >
        {/* Frosted glass — blurs app content visible behind the bar */}
        <BlurView
          style={StyleSheet.absoluteFill}
          intensity={isDark ? 28 : 40}
          tint={isDark ? 'dark' : 'light'}
        />
        {/* Dynamic album art color tint over the blur */}
        <Animated.View style={[StyleSheet.absoluteFill, navTintStyle]} />
      </Animated.View>

      <Animated.View style={tabBarContentStyle}>
        <View
          style={styles.itemsRow}
          onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
        >
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

            const onPress = () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
  iconOverlay: {
    ...StyleSheet.absoluteFillObject,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 2,
  },
});
