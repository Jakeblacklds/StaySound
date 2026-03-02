import { useTheme } from '@/src/theme';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
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
    const shimmerValue = useSharedValue(-1);

    useEffect(() => {
        shimmerValue.value = withRepeat(
            withTiming(1, { duration: 1500 }),
            -1,
            false
        );
    }, [shimmerValue]);

    const animatedStyle = useAnimatedStyle(() => {
        const translateX = interpolate(shimmerValue.value, [-1, 1], [-400, 400]);
        return {
            transform: [{ translateX }],
        };
    });

    const baseColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)';
    const highlightColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)';

    return (
        <View
            style={[
                styles.container,
                { width: width as any, height, borderRadius, backgroundColor: baseColor },
                style,
            ]}
        >
            <AnimatedLinearGradient
                colors={['transparent', highlightColor, 'transparent']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={[StyleSheet.absoluteFill, animatedStyle, { width: '250%' }]} // Increased width for wider shimmer effect (padding adjustment)
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        overflow: 'hidden',
    },
});
