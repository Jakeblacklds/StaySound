/**
 * ProgressSlider - Interactive progress bar with seek functionality
 */

import { formatDuration } from '@/src/services';
import { usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Text } from 'react-native-paper';
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useDerivedValue,
    useSharedValue,
    withDelay,
    withSpring,
    withTiming,
} from 'react-native-reanimated';

interface ProgressSliderProps {
    duration: number; // ms
    onSeek: (position: number) => void;
    showTime?: boolean;
    activeColor?: string;
    inactiveColor?: string;
    textColor?: string;
}

export function ProgressSlider({
    duration,
    onSeek,
    showTime = true,
    activeColor,
    inactiveColor,
    textColor,
}: ProgressSliderProps) {
    const { theme } = useTheme();
    const positionShared = usePlayerStore(s => s.positionShared);

    // Use provided colors or fall back to theme
    const colors = {
        active: activeColor || theme.colors.primary,
        inactive: inactiveColor || theme.colors.surfaceVariant,
        text: textColor || theme.colors.onSurfaceVariant,
    };

    const isDragging = useSharedValue(0); // 0 = false, 1 = true
    const dragProgress = useSharedValue(0);
    const sliderWidth = useSharedValue(0);
    const thumbScale = useSharedValue(1);

    const progress = useDerivedValue(() => {
        if (duration <= 0) return 0;
        return positionShared.value / duration;
    }, [duration, positionShared]);

    const handleSeek = useCallback((progressValue: number) => {
        const newPosition = Math.max(0, Math.min(1, progressValue)) * duration;
        onSeek(newPosition);
    }, [duration, onSeek]);

    const panGesture = Gesture.Pan()
        .onBegin((e) => {
            isDragging.value = 1;
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
            thumbScale.value = withSpring(1);
            runOnJS(handleSeek)(dragProgress.value);
            // We delay setting isDragging back to 0 by a small amount (150ms)
            // to allow the JS thread to process handleSeek and update positionShared
            // before the UI thread switches back to displaying the native position.
            // This prevents the "jumping" effect caused by bridge latency.
            isDragging.value = withDelay(150, withTiming(0, { duration: 0 }));
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
        const displayProgress = isDragging.value > 0 ? dragProgress.value : progress.value;
        return {
            width: sliderWidth.value * displayProgress,
        };
    });

    const thumbStyle = useAnimatedStyle(() => {
        const displayProgress = isDragging.value > 0 ? dragProgress.value : progress.value;
        return {
            left: sliderWidth.value * displayProgress,
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
                <TimeLabels duration={duration} color={colors.text} />
            )}
        </View>
    );
}

const TimeLabels = React.memo(({ duration, color }: { duration: number, color: string }) => {
    const positionSecond = usePlayerStore(s => Math.floor(s.position / 1000));
    return (
        <View style={styles.timeContainer}>
            <Text
                variant="labelSmall"
                style={{ color }}
            >
                {formatDuration(positionSecond * 1000)}
            </Text>
            <Text
                variant="labelSmall"
                style={{ color }}
            >
                {formatDuration(duration)}
            </Text>
        </View>
    );
});

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
