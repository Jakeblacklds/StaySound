/**
 * ProgressSlider - Interactive progress bar with seek functionality
 */

import { formatDuration } from '@/src/services';
import { useTheme } from '@/src/theme';
import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Text } from 'react-native-paper';
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

interface ProgressSliderProps {
    position: number; // ms
    duration: number; // ms
    onSeek: (position: number) => void;
    showTime?: boolean;
    activeColor?: string;
    inactiveColor?: string;
    textColor?: string;
}

export function ProgressSlider({
    position,
    duration,
    onSeek,
    showTime = true,
    activeColor,
    inactiveColor,
    textColor,
}: ProgressSliderProps) {
    const { theme } = useTheme();

    // Use provided colors or fall back to theme
    const colors = {
        active: activeColor || theme.colors.primary,
        inactive: inactiveColor || theme.colors.surfaceVariant,
        text: textColor || theme.colors.onSurfaceVariant,
    };

    const isDragging = useSharedValue(false);
    const dragProgress = useSharedValue(0);
    const sliderWidth = useSharedValue(0);
    const thumbScale = useSharedValue(1);

    const progress = duration > 0 ? position / duration : 0;

    const handleSeek = useCallback((progressValue: number) => {
        const newPosition = Math.max(0, Math.min(1, progressValue)) * duration;
        onSeek(newPosition);
    }, [duration, onSeek]);

    const panGesture = Gesture.Pan()
        .onBegin((e) => {
            isDragging.value = true;
            thumbScale.value = withSpring(1.5);
            if (sliderWidth.value > 0) {
                dragProgress.value = e.x / sliderWidth.value;
            }
        })
        .onUpdate((e) => {
            if (sliderWidth.value > 0) {
                dragProgress.value = Math.max(0, Math.min(1, e.x / sliderWidth.value));
            }
        })
        .onEnd(() => {
            isDragging.value = false;
            thumbScale.value = withSpring(1);
            runOnJS(handleSeek)(dragProgress.value);
        });

    const tapGesture = Gesture.Tap()
        .onEnd((e) => {
            if (sliderWidth.value > 0) {
                const tapProgress = e.x / sliderWidth.value;
                runOnJS(handleSeek)(tapProgress);
            }
        });

    const composedGesture = Gesture.Race(panGesture, tapGesture);

    const progressStyle = useAnimatedStyle(() => {
        const displayProgress = isDragging.value ? dragProgress.value : progress;
        return {
            width: `${displayProgress * 100}%`,
        };
    });

    const thumbStyle = useAnimatedStyle(() => {
        const displayProgress = isDragging.value ? dragProgress.value : progress;
        return {
            left: `${displayProgress * 100}%`,
            transform: [
                { translateX: -8 },
                { scale: thumbScale.value },
            ],
        };
    });

    return (
        <View style={styles.container}>
            <GestureDetector gesture={composedGesture}>
                <View
                    style={styles.sliderContainer}
                    onLayout={(e) => {
                        sliderWidth.value = e.nativeEvent.layout.width;
                    }}
                >
                    {/* Track background */}
                    <View style={[styles.track, { backgroundColor: colors.inactive }]}>
                        {/* Progress fill */}
                        <Animated.View
                            style={[
                                styles.progress,
                                { backgroundColor: colors.active },
                                progressStyle,
                            ]}
                        />
                    </View>

                    {/* Thumb */}
                    <Animated.View
                        style={[
                            styles.thumb,
                            { backgroundColor: colors.active },
                            thumbStyle,
                        ]}
                    />
                </View>
            </GestureDetector>

            {/* Time labels */}
            {showTime && (
                <View style={styles.timeContainer}>
                    <Text
                        variant="labelSmall"
                        style={{ color: colors.text }}
                    >
                        {formatDuration(position)}
                    </Text>
                    <Text
                        variant="labelSmall"
                        style={{ color: colors.text }}
                    >
                        {formatDuration(duration)}
                    </Text>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: '100%',
    },
    sliderContainer: {
        height: 40,
        justifyContent: 'center',
        paddingVertical: 16,
    },
    track: {
        height: 4,
        borderRadius: 2,
        overflow: 'hidden',
    },
    progress: {
        height: '100%',
        borderRadius: 2,
    },
    thumb: {
        position: 'absolute',
        width: 16,
        height: 16,
        borderRadius: 8,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
    },
    timeContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: -8,
    },
});
