import React, { useEffect } from 'react';
import { GestureResponderEvent, Pressable, StyleSheet, View } from 'react-native';
import Animated, { 
    useAnimatedStyle, 
    useSharedValue, 
    withSpring, 
    withTiming, 
    Easing,
    interpolate,
    Extrapolate,
    useAnimatedProps,
    withRepeat,
    withSequence,
    cancelAnimation
} from 'react-native-reanimated';
import { CustomIcon } from './CustomIcon';
import { useTheme } from '@/src/theme';
import { Text } from 'react-native-paper';

interface DownloadAnimatedButtonProps {
    status: 'idle' | 'downloading' | 'done' | 'error';
    progress?: number;
    onPress: (event: GestureResponderEvent) => void;
    size?: number;
}

const AnimatedCustomIcon = Animated.createAnimatedComponent(CustomIcon);

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
    
    // Pulse for downloading state
    const pulse = useSharedValue(1);

    useEffect(() => {
        // Handle opacity transitions between states
        opacityIdle.value = withTiming(status === 'idle' ? 1 : 0, { duration: 250 });
        opacityDownloading.value = withTiming(status === 'downloading' ? 1 : 0, { duration: 250 });
        opacityDone.value = withTiming(status === 'done' ? 1 : 0, { duration: 350 });
        opacityError.value = withTiming(status === 'error' ? 1 : 0, { duration: 250 });

        if (status === 'downloading') {
            pulse.value = withRepeat(
                withSequence(
                    withTiming(1.15, { duration: 800, easing: Easing.inOut(Easing.ease) }),
                    withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) })
                ),
                -1,
                true
            );
            progressRotation.value = withRepeat(
                withTiming(360, { duration: 2000, easing: Easing.linear }),
                -1
            );
        } else {
            cancelAnimation(pulse);
            pulse.value = withSpring(1);
            cancelAnimation(progressRotation);
        }
    }, [status]);

    const handlePressIn = () => {
        scale.value = withSpring(0.85, { damping: 10, stiffness: 300 });
    };

    const handlePressOut = () => {
        scale.value = withSpring(1, { damping: 10, stiffness: 300 });
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
        borderWidth: 1.5,
        borderColor: theme.colors.primary,
        borderTopColor: 'transparent',
    }));

    const doneIconStyle = useAnimatedStyle(() => ({
        opacity: opacityDone.value,
        transform: [
            { scale: interpolate(opacityDone.value, [0, 0.5, 1], [0.5, 1.2, 1], Extrapolate.CLAMP) },
            { rotate: `${interpolate(opacityDone.value, [0, 1], [-15, 0])}deg` }
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
            onPress={onPress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            hitSlop={12}
            style={styles.container}
        >
            <Animated.View style={[styles.inner, { width: size + 12, height: size + 12 }, animatedContainerStyle]}>
                
                {/* IDLE STATE */}
                <Animated.View style={idleIconStyle}>
                    <CustomIcon 
                        name="Descargar" 
                        size={size} 
                        color={theme.colors.onSurfaceVariant} 
                        style={{ opacity: 0.7 }}
                    />
                </Animated.View>

                {/* DOWNLOADING STATE */}
                <Animated.View style={downloadingContainerStyle}>
                    <Animated.View style={progressRingStyle} />
                    <View style={[StyleSheet.absoluteFillObject, styles.center]}>
                        <Text style={[styles.progressText, { color: theme.colors.primary }]}>
                            {Math.round(progress * 100)}
                        </Text>
                    </View>
                </Animated.View>

                {/* DONE STATE */}
                <Animated.View style={doneIconStyle}>
                    <CustomIcon 
                        name="Checkmark" 
                        size={size + 2} 
                        color={theme.colors.primary} 
                    />
                </Animated.View>

                {/* ERROR STATE */}
                <Animated.View style={errorIconStyle}>
                    <CustomIcon 
                        name="Descargar" 
                        size={size} 
                        color={theme.colors.error} 
                    />
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
    }
});
