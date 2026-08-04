import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect } from 'react';
import { GestureResponderEvent, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
    cancelAnimation,
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@/src/theme';

interface DownloadAnimatedButtonProps {
    status: 'idle' | 'downloading' | 'done' | 'error';
    progress?: number;
    onPress: (event: GestureResponderEvent) => void;
    size?: number;
}

export const DownloadAnimatedButton: React.FC<DownloadAnimatedButtonProps> = ({
    status,
    progress = 0,
    onPress,
    size = 22,
}) => {
    const { theme } = useTheme();
    const scale = useSharedValue(1);
    const fill = useSharedValue(status === 'done' ? 1 : status === 'error' ? 0.35 : 0);
    const shimmer = useSharedValue(-1);

    useEffect(() => {
        const nextFill = status === 'done'
            ? 1
            : status === 'downloading'
                ? Math.max(0.08, Math.min(0.94, progress))
                : status === 'error' ? 0.35 : 0;
        fill.value = withTiming(nextFill, { duration: 240, easing: Easing.out(Easing.cubic) });

        if (status === 'downloading') {
            shimmer.value = -1;
            shimmer.value = withRepeat(
                withTiming(1, { duration: 950, easing: Easing.linear }),
                -1,
                false,
            );
        } else {
            cancelAnimation(shimmer);
        }

        // Celebratory haptic when a download lands.
        if (status === 'done') {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
    }, [progress, status]);

    const handlePress = (event: GestureResponderEvent) => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress(event);
    };

    const handlePressIn = () => {
        scale.value = withSpring(0.82, { damping: 12, stiffness: 320 });
    };

    const handlePressOut = () => {
        scale.value = withSpring(1, { damping: 12, stiffness: 320 });
    };

    const animatedContainerStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    const fillStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: (1 - fill.value) * (size + 10) }],
    }));

    const shimmerStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: shimmer.value * (size + 18) }],
    }));

    return (
        <Pressable
            onPress={handlePress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            hitSlop={12}
            style={styles.container}
        >
            <Animated.View style={[styles.inner, { width: size + 10, height: size + 10, borderColor: theme.colors.outlineVariant }, animatedContainerStyle]}>
                {status !== 'idle' ? (
                    <Animated.View style={[styles.fill, { backgroundColor: status === 'error' ? theme.colors.error : theme.colors.primary }, fillStyle]}>
                        {status === 'downloading' ? <Animated.View style={[styles.shimmer, shimmerStyle]} /> : null}
                    </Animated.View>
                ) : null}
                <View style={styles.center}>
                    <Ionicons
                        name={status === 'done' ? 'checkmark' : status === 'error' ? 'alert' : 'arrow-down'}
                        size={size - 1}
                        color={status === 'idle' ? theme.colors.onSurfaceVariant : theme.colors.onPrimary}
                    />
                </View>
            </Animated.View>
        </Pressable>
    );
};

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    inner: {
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 9,
        overflow: 'hidden',
        backgroundColor: 'rgba(127,127,127,0.10)',
    },
    center: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
    },
    fill: {
        ...StyleSheet.absoluteFillObject,
        overflow: 'hidden',
    },
    shimmer: {
        position: 'absolute',
        top: -8,
        bottom: -8,
        width: '42%',
        backgroundColor: 'rgba(255,255,255,0.22)',
        transform: [{ skewX: '-18deg' }],
    },
});
