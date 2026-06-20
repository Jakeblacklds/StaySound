import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect } from 'react';
import { GestureResponderEvent, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Animated, {
    cancelAnimation,
    Easing,
    Extrapolate,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withSequence,
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
    const progressRotation = useSharedValue(0);
    const opacityIdle = useSharedValue(status === 'idle' ? 1 : 0);
    const opacityDownloading = useSharedValue(status === 'downloading' ? 1 : 0);
    const opacityDone = useSharedValue(status === 'done' ? 1 : 0);
    const opacityError = useSharedValue(status === 'error' ? 1 : 0);
    const pulse = useSharedValue(1);

    useEffect(() => {
        opacityIdle.value = withTiming(status === 'idle' ? 1 : 0, { duration: 250 });
        opacityDownloading.value = withTiming(status === 'downloading' ? 1 : 0, { duration: 250 });
        opacityDone.value = withTiming(status === 'done' ? 1 : 0, { duration: 350 });
        opacityError.value = withTiming(status === 'error' ? 1 : 0, { duration: 250 });

        if (status === 'downloading') {
            pulse.value = withRepeat(
                withSequence(
                    withTiming(1.12, { duration: 800, easing: Easing.inOut(Easing.ease) }),
                    withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
                ),
                -1,
                true,
            );
            progressRotation.value = withRepeat(
                withTiming(360, { duration: 2000, easing: Easing.linear }),
                -1,
            );
        } else {
            cancelAnimation(pulse);
            pulse.value = withSpring(1);
            cancelAnimation(progressRotation);
        }

        // Celebratory haptic when a download lands.
        if (status === 'done') {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
    }, [status]);

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

    const idleIconStyle = useAnimatedStyle(() => ({
        opacity: opacityIdle.value,
        transform: [{ scale: opacityIdle.value }],
        position: 'absolute',
    }));

    const downloadingContainerStyle = useAnimatedStyle(() => ({
        opacity: opacityDownloading.value,
        transform: [{ scale: pulse.value }],
        position: 'absolute',
        alignItems: 'center',
        justifyContent: 'center',
    }));

    const progressRingStyle = useAnimatedStyle(() => ({
        transform: [{ rotate: `${progressRotation.value}deg` }],
        width: size + 8,
        height: size + 8,
        borderRadius: (size + 8) / 2,
        borderWidth: 2,
        borderColor: theme.colors.primary,
        borderTopColor: 'transparent',
    }));

    const doneIconStyle = useAnimatedStyle(() => ({
        opacity: opacityDone.value,
        transform: [
            { scale: interpolate(opacityDone.value, [0, 0.5, 1], [0.4, 1.25, 1], Extrapolate.CLAMP) },
            { rotate: `${interpolate(opacityDone.value, [0, 1], [-20, 0])}deg` },
        ],
        position: 'absolute',
    }));

    const errorIconStyle = useAnimatedStyle(() => ({
        opacity: opacityError.value,
        transform: [{ scale: opacityError.value }],
        position: 'absolute',
    }));

    return (
        <Pressable
            onPress={handlePress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            hitSlop={12}
            style={styles.container}
        >
            <Animated.View style={[styles.inner, { width: size + 12, height: size + 12 }, animatedContainerStyle]}>
                <Animated.View style={idleIconStyle}>
                    <Ionicons name="arrow-down-circle-outline" size={size + 4} color={theme.colors.onSurfaceVariant} />
                </Animated.View>

                <Animated.View style={downloadingContainerStyle}>
                    <Animated.View style={progressRingStyle} />
                    <View style={[StyleSheet.absoluteFillObject, styles.center]}>
                        <Text style={[styles.progressText, { color: theme.colors.primary }]}>
                            {Math.round(progress * 100)}
                        </Text>
                    </View>
                </Animated.View>

                <Animated.View style={doneIconStyle}>
                    <Ionicons name="checkmark-circle" size={size + 6} color={theme.colors.primary} />
                </Animated.View>

                <Animated.View style={errorIconStyle}>
                    <Ionicons name="alert-circle-outline" size={size + 4} color={theme.colors.error} />
                </Animated.View>
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
    },
    center: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
    },
    progressText: {
        fontSize: 7,
        fontWeight: '900',
    },
});
