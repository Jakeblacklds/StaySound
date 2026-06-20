/**
 * TidalBottomSheet
 *
 * Prop-driven bottom sheet base for the Tidal redesign (mirror / quality /
 * settings). Mirrors the proven animation + gesture + BackHandler pattern from
 * src/components/ui/ActionSheet.tsx, but is fully controlled via props instead
 * of being wired to uiStore.
 */
import { BlurView } from 'expo-blur';
import React, { useCallback, useEffect } from 'react';
import { BackHandler, Dimensions, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Text } from 'react-native-paper';
import Animated, {
    Easing,
    interpolate,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, typeScale, usePerformanceProfile, useTheme, withAlpha } from '@/src/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAX_HEIGHT = SCREEN_HEIGHT * 0.78;

interface TidalBottomSheetProps {
    visible: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    children: React.ReactNode;
}

export const TidalBottomSheet: React.FC<TidalBottomSheetProps> = ({
    visible,
    onClose,
    title,
    subtitle,
    children,
}) => {
    const { theme, isDark } = useTheme();
    const perf = usePerformanceProfile();
    const insets = useSafeAreaInsets();
    const progress = useSharedValue(0);

    const handleClose = useCallback(() => {
        progress.value = withTiming(0, { duration: 240, easing: Easing.out(Easing.quad) }, (finished) => {
            if (finished) runOnJS(onClose)();
        });
    }, [onClose, progress]);

    useEffect(() => {
        if (visible) {
            progress.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
            const back = BackHandler.addEventListener('hardwareBackPress', () => {
                handleClose();
                return true;
            });
            return () => back.remove();
        }
    }, [visible, handleClose, progress]);

    const backdropStyle = useAnimatedStyle(() => ({
        opacity: progress.value,
        pointerEvents: progress.value > 0.1 ? 'auto' : 'none',
    }));

    const sheetStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: interpolate(progress.value, [0, 1], [MAX_HEIGHT, 0]) }],
    }));

    const panGesture = Gesture.Pan()
        .onUpdate((e) => {
            if (e.translationY > 0) {
                progress.value = Math.max(0, 1 - e.translationY / MAX_HEIGHT);
            }
        })
        .onEnd((e) => {
            if (e.translationY > 110 || e.velocityY > 520) {
                runOnJS(handleClose)();
            } else {
                progress.value = withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) });
            }
        });

    if (!visible) return null;

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <Animated.View style={[styles.backdrop, backdropStyle]}>
                <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
            </Animated.View>

            <GestureDetector gesture={panGesture}>
                <Animated.View
                    style={[
                        styles.sheet,
                        {
                            backgroundColor: perf.enableBlurEffects
                                ? withAlpha(theme.colors.surface, isDark ? '99' : 'CC')
                                : theme.colors.surface,
                            borderColor: withAlpha(theme.colors.outline, isDark ? '40' : '55'),
                            paddingBottom: insets.bottom + 16,
                            maxHeight: MAX_HEIGHT,
                        },
                        sheetStyle,
                    ]}
                >
                    {perf.enableBlurEffects ? (
                        <BlurView
                            intensity={48}
                            tint={isDark ? 'dark' : 'light'}
                            experimentalBlurMethod="dimezisBlurView"
                            style={StyleSheet.absoluteFill}
                        />
                    ) : null}

                    <View style={styles.handleWrap}>
                        <View style={[styles.handle, { backgroundColor: withAlpha(theme.colors.onSurfaceVariant, '55') }]} />
                    </View>

                    <View style={styles.header}>
                        <Text style={[styles.title, { color: theme.colors.onSurface }]}>{title}</Text>
                        {subtitle ? (
                            <Text style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>{subtitle}</Text>
                        ) : null}
                    </View>

                    <ScrollView
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={styles.body}
                        bounces={false}
                    >
                        {children}
                    </ScrollView>
                </Animated.View>
            </GestureDetector>
        </View>
    );
};

const styles = StyleSheet.create({
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.5)',
        zIndex: 1,
    },
    sheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        borderTopLeftRadius: radius.xl,
        borderTopRightRadius: radius.xl,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
        zIndex: 10,
        elevation: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
    },
    handleWrap: {
        width: '100%',
        height: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    handle: {
        width: 40,
        height: 5,
        borderRadius: 2.5,
    },
    header: {
        paddingHorizontal: 22,
        paddingBottom: 14,
        gap: 4,
    },
    title: {
        ...typeScale.titleLarge,
    },
    subtitle: {
        ...typeScale.caption,
    },
    body: {
        paddingHorizontal: 14,
        paddingBottom: 8,
    },
});
