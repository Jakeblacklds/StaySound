import { useTheme } from '@/src/theme';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
    Easing,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming
} from 'react-native-reanimated';

interface SkeletonProps {
    width?: number | string;
    height: number;
    borderRadius?: number;
    style?: ViewStyle;
}

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

export const Skeleton = ({ width = '100%', height, borderRadius = 8, style }: SkeletonProps) => {
    const { isDark } = useTheme();
    const pulseValue = useSharedValue(0.4);

    useEffect(() => {
        pulseValue.value = withRepeat(
            withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
            -1,
            true
        );
    }, [pulseValue]);

    const animatedStyle = useAnimatedStyle(() => {
        return {
            opacity: pulseValue.value,
        };
    });

    const baseColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)';
    const highlightColor = isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.08)';

    return (
        <View
            style={[
                styles.container,
                { width: width as any, height, borderRadius, backgroundColor: baseColor },
                style,
            ]}
        >
            <Animated.View
                style={[
                    StyleSheet.absoluteFill,
                    animatedStyle,
                    { backgroundColor: highlightColor }
                ]}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        overflow: 'hidden',
    },
});
