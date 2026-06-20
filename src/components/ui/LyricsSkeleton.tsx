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

type SkeletonWordSpec = {
    width: number;
};

type SkeletonPhraseSpec = {
    words: SkeletonWordSpec[];
    align: 'flex-start' | 'center';
    tone: 'past' | 'active' | 'next';
};

const SKELETON_PHRASES: SkeletonPhraseSpec[] = [
    {
        tone: 'past',
        align: 'flex-start',
        words: [{ width: 74 }, { width: 46 }, { width: 92 }],
    },
    {
        tone: 'past',
        align: 'flex-start',
        words: [{ width: 118 }, { width: 54 }],
    },
    {
        tone: 'active',
        align: 'flex-start',
        words: [{ width: 112 }, { width: 72 }, { width: 132 }, { width: 58 }],
    },
    {
        tone: 'active',
        align: 'flex-start',
        words: [{ width: 86 }, { width: 154 }, { width: 68 }],
    },
    {
        tone: 'next',
        align: 'flex-start',
        words: [{ width: 96 }, { width: 64 }, { width: 108 }],
    },
    {
        tone: 'next',
        align: 'flex-start',
        words: [{ width: 62 }, { width: 128 }],
    },
    {
        tone: 'past',
        align: 'flex-start',
        words: [{ width: 82 }, { width: 58 }, { width: 116 }],
    },
    {
        tone: 'next',
        align: 'flex-start',
        words: [{ width: 132 }, { width: 74 }],
    },
    {
        tone: 'past',
        align: 'flex-start',
        words: [{ width: 68 }, { width: 146 }, { width: 52 }],
    },
    {
        tone: 'next',
        align: 'flex-start',
        words: [{ width: 104 }, { width: 88 }, { width: 64 }],
    },
];

const PHRASE_STAGGER_MS = 130;
const WAVE_DURATION_MS = 1800;

function toneStyle(tone: SkeletonPhraseSpec['tone']) {
    switch (tone) {
        case 'active':
            return {
                height: 25,
                gap: 9,
                opacityMin: 0.34,
                opacityMax: 0.82,
                alphaMin: 0.18,
                alphaMax: 0.52,
            };
        case 'past':
            return {
                height: 18,
                gap: 7,
                opacityMin: 0.18,
                opacityMax: 0.34,
                alphaMin: 0.08,
                alphaMax: 0.2,
            };
        case 'next':
        default:
            return {
                height: 20,
                gap: 8,
                opacityMin: 0.22,
                opacityMax: 0.46,
                alphaMin: 0.1,
                alphaMax: 0.28,
            };
    }
}

function SkeletonPhrase({
    phrase,
    index,
    isDark,
}: {
    phrase: SkeletonPhraseSpec;
    index: number;
    isDark: boolean;
}) {
    const pulse = useSharedValue(0);
    const spec = toneStyle(phrase.tone);

    useEffect(() => {
        pulse.value = withDelay(
            index * PHRASE_STAGGER_MS,
            withRepeat(
                withSequence(
                    withTiming(1, {
                        duration: WAVE_DURATION_MS * 0.5,
                        easing: Easing.inOut(Easing.sin),
                    }),
                    withTiming(0, {
                        duration: WAVE_DURATION_MS * 0.5,
                        easing: Easing.inOut(Easing.sin),
                    })
                ),
                -1,
                false
            )
        );
    }, [index, pulse]);

    const phraseStyle = useAnimatedStyle(() => ({
        opacity: interpolate(pulse.value, [0, 1], [spec.opacityMin, spec.opacityMax]),
        transform: [
            {
                translateY: interpolate(
                    pulse.value,
                    [0, 1],
                    [phrase.tone === 'active' ? 3 : 1, 0]
                ),
            },
        ],
    }));

    const wordColor = isDark ? '#FFFFFF' : '#05070D';
    const backgroundColor = useAnimatedStyle(() => ({
        backgroundColor: isDark
            ? `rgba(255,255,255,${interpolate(pulse.value, [0, 1], [spec.alphaMin, spec.alphaMax])})`
            : `rgba(0,0,0,${interpolate(pulse.value, [0, 1], [spec.alphaMin, spec.alphaMax])})`,
    }));

    return (
        <Animated.View style={[styles.phrase, { alignSelf: phrase.align }, phraseStyle]}>
            <View style={[styles.wordsRow, { gap: spec.gap }]}>
                {phrase.words.map((word, wordIndex) => (
                    <Animated.View
                        key={`${index}-${wordIndex}`}
                        style={[
                            styles.word,
                            {
                                width: word.width,
                                height: spec.height,
                                borderRadius: Math.max(6, spec.height * 0.34),
                                shadowColor: wordColor,
                                shadowOpacity: phrase.tone === 'active' ? 0.16 : 0,
                                shadowRadius: phrase.tone === 'active' ? 10 : 0,
                                shadowOffset: { width: 0, height: 0 },
                            },
                            backgroundColor,
                        ]}
                    />
                ))}
            </View>
        </Animated.View>
    );
}

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
                        withTiming(1, { duration: 420, easing: Easing.out(Easing.quad) }),
                        withTiming(0, { duration: 420, easing: Easing.in(Easing.quad) }),
                        withTiming(0, { duration: 360 })
                    ),
                    -1,
                    false
                )
            );
        };

        dotAnim(dot1, 0);
        dotAnim(dot2, 220);
        dotAnim(dot3, 440);
    }, [dot1, dot2, dot3]);

    const d1Style = useAnimatedStyle(() => ({
        opacity: interpolate(dot1.value, [0, 1], [0.24, 1]),
        transform: [{ scale: interpolate(dot1.value, [0, 1], [0.72, 1]) }],
    }));
    const d2Style = useAnimatedStyle(() => ({
        opacity: interpolate(dot2.value, [0, 1], [0.24, 1]),
        transform: [{ scale: interpolate(dot2.value, [0, 1], [0.72, 1]) }],
    }));
    const d3Style = useAnimatedStyle(() => ({
        opacity: interpolate(dot3.value, [0, 1], [0.24, 1]),
        transform: [{ scale: interpolate(dot3.value, [0, 1], [0.72, 1]) }],
    }));

    return (
        <View style={styles.dotsRow}>
            <Animated.View style={[styles.dot, { backgroundColor: color }, d1Style]} />
            <Animated.View style={[styles.dot, { backgroundColor: color }, d2Style]} />
            <Animated.View style={[styles.dot, { backgroundColor: color }, d3Style]} />
        </View>
    );
}

export const LyricsSkeleton = ({ isDownloading = false }: { isDownloading?: boolean }) => {
    const { isDark } = useTheme();

    const labelColor = isDark ? 'rgba(255,255,255,0.56)' : 'rgba(0,0,0,0.48)';
    const dotColor = isDark ? 'rgba(255,255,255,0.68)' : 'rgba(0,0,0,0.54)';

    return (
        <Animated.View
            entering={FadeIn.duration(300).easing(Easing.out(Easing.quad))}
            style={styles.container}
        >
            <View style={styles.phrases}>
                {SKELETON_PHRASES.map((phrase, index) => (
                    <SkeletonPhrase
                        key={index}
                        phrase={phrase}
                        index={index}
                        isDark={isDark}
                    />
                ))}
            </View>

            <Animated.View
                entering={FadeIn.delay(180).duration(360)}
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
        paddingHorizontal: 30,
        paddingTop: 78,
        paddingBottom: 226,
        backgroundColor: 'transparent',
    },
    phrases: {
        width: '100%',
        gap: 17,
    },
    phrase: {
        maxWidth: '100%',
    },
    wordsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        rowGap: 10,
        alignItems: 'center',
        maxWidth: '100%',
    },
    word: {
        maxWidth: '100%',
    },
    statusContainer: {
        marginTop: 26,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
    },
    statusText: {
        fontSize: 11,
        lineHeight: 14,
        fontWeight: '600',
        letterSpacing: 0,
        textTransform: 'uppercase',
    },
    dotsRow: {
        flexDirection: 'row',
        gap: 4,
        alignItems: 'center',
        marginTop: 1,
    },
    dot: {
        width: 4,
        height: 4,
        borderRadius: 2,
    },
});
