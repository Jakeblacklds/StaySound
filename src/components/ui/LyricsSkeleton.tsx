import { useTheme } from '@/src/theme';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
    Easing,
    FadeIn,
    interpolate,
    type SharedValue,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withRepeat,
    withSequence,
    withTiming,
} from 'react-native-reanimated';

/**
 * LyricsSkeleton — Lyrics-style animated skeleton loader.
 *
 * Displays staggered, wave-pulsing placeholder bars that mimic
 * real lyric lines (varied widths). Each bar animates with an
 * independent staggered breathing effect, creating a living
 * "wave" that sweeps left-to-right across lines.
 *
 * Consistent with Apple Music / Spotify loading states.
 */

const SKELETON_LINES = [
    { width: '72%' },
    { width: '55%' },
    { width: '82%' },
    { width: '48%' },
    { width: '68%' },
    { width: '38%' },
    { width: '76%' },
    { width: '52%' },
    { width: '64%' },
    { width: '44%' },
];

const WAVE_DURATION = 1600;
const STAGGER_PER_LINE = 100; // ms between each line's wave peak

function SkeletonLine({
    widthPercent,
    index,
    isDark,
}: {
    widthPercent: string;
    index: number;
    isDark: boolean;
}) {
    const opacity = useSharedValue(0.3);

    useEffect(() => {
        // Each line starts its animation staggered, creating a ripple wave effect
        opacity.value = withDelay(
            index * STAGGER_PER_LINE,
            withRepeat(
                withSequence(
                    withTiming(1, {
                        duration: WAVE_DURATION * 0.5,
                        easing: Easing.inOut(Easing.sin),
                    }),
                    withTiming(0.3, {
                        duration: WAVE_DURATION * 0.5,
                        easing: Easing.inOut(Easing.sin),
                    })
                ),
                -1,
                false
            )
        );
    }, [index]);

    const animStyle = useAnimatedStyle(() => {
        // Interpolate opacity into a visible color shift
        const alpha = interpolate(opacity.value, [0.3, 1], [0.12, 0.45]);
        return {
            opacity: opacity.value,
            backgroundColor: isDark
                ? `rgba(255,255,255,${alpha})`
                : `rgba(0,0,0,${alpha})`,
        };
    });

    return (
        <Animated.View
            style={[
                styles.skeletonLine,
                animStyle,
                { width: widthPercent as any },
            ]}
        />
    );
}

// Animated dots for the status label: "Buscando letras..."
function AnimatedDots({ color }: { color: string }) {
    const dot1 = useSharedValue(0);
    const dot2 = useSharedValue(0);
    const dot3 = useSharedValue(0);

    useEffect(() => {
        const dotAnim = (sv: SharedValue<number>, delayMs: number) => {
            sv.value = withDelay(
                delayMs,
                withRepeat(
                    withSequence(
                        withTiming(1, { duration: 400, easing: Easing.out(Easing.quad) }),
                        withTiming(0, { duration: 400, easing: Easing.in(Easing.quad) }),
                        withTiming(0, { duration: 400 }) // pause
                    ),
                    -1,
                    false
                )
            );
        };

        dotAnim(dot1, 0);
        dotAnim(dot2, 280);
        dotAnim(dot3, 560);
    }, []);

    const d1Style = useAnimatedStyle(() => ({ opacity: interpolate(dot1.value, [0, 1], [0.25, 1]) }));
    const d2Style = useAnimatedStyle(() => ({ opacity: interpolate(dot2.value, [0, 1], [0.25, 1]) }));
    const d3Style = useAnimatedStyle(() => ({ opacity: interpolate(dot3.value, [0, 1], [0.25, 1]) }));

    return (
        <Animated.View style={styles.dotsRow}>
            <Animated.Text style={[styles.dot, d1Style, { color }]}>●</Animated.Text>
            <Animated.Text style={[styles.dot, d2Style, { color }]}>●</Animated.Text>
            <Animated.Text style={[styles.dot, d3Style, { color }]}>●</Animated.Text>
        </Animated.View>
    );
}

export const LyricsSkeleton = ({ isDownloading = false }: { isDownloading?: boolean }) => {
    const { isDark } = useTheme();

    const labelColor = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)';
    const dotColor = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.55)';

    return (
        <Animated.View
            entering={FadeIn.duration(320).easing(Easing.out(Easing.quad))}
            style={styles.container}
        >
            <View style={styles.linesContainer}>
                {SKELETON_LINES.map((line, index) => (
                    <SkeletonLine
                        key={index}
                        widthPercent={line.width}
                        index={index}
                        isDark={isDark}
                    />
                ))}
            </View>

            {/* Status label: always visible during loading, regardless of isDownloading */}
            <Animated.View
                entering={FadeIn.delay(200).duration(400)}
                style={styles.statusContainer}
            >
                <Animated.Text style={[styles.statusText, { color: labelColor }]}>
                    {isDownloading ? 'Descargando letras' : 'Buscando letras'}
                </Animated.Text>
                <AnimatedDots color={dotColor} />
            </Animated.View>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingHorizontal: 28,
        paddingTop: 80, // clear the header area
        backgroundColor: 'transparent',
    },
    linesContainer: {
        width: '100%',
        gap: 24,
    },
    skeletonLine: {
        height: 30,
        borderRadius: 10,
    },
    statusContainer: {
        marginTop: 40,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '600',
        letterSpacing: 1.8,
        textTransform: 'uppercase',
    },
    dotsRow: {
        flexDirection: 'row',
        gap: 3,
        alignItems: 'center',
        marginTop: 1,
    },
    dot: {
        fontSize: 6,
        lineHeight: 10,
    },
});
