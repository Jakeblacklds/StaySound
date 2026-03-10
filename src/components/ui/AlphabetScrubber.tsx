/**
 * AlphabetScrubber — High-performance A–Z index fast-scroll bar
 *
 * Performance architecture:
 *  • All position math runs on the UI thread — pure worklets
 *  • runOnJS (scroll + haptic) only fires on letter change, not every pixel
 *  • Letter highlight: single animated overlay cursor — NOT 27 individual animated views
 *  • Bubble pop-in: spring on X+scale, direct on Y (zero lag)
 *  • No withSpring inside per-letter callbacks — avoids 27 simultaneous UI-thread springs
 */

import { useTheme } from '@/src/theme';
import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Text as PaperText } from 'react-native-paper';
import type { SharedValue } from 'react-native-reanimated';
import Animated, {
    Extrapolation,
    interpolate,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
const LETTER_COUNT = LETTERS.length;

interface AlphabetScrubberProps {
    onLetterChange: (letter: string) => void;
}

const fireHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
};

// ─── Animated cursor highlight (single view — not per-letter) ─────────────────
interface CursorProps {
    activeIndex: SharedValue<number>;
    isActive: SharedValue<number>;
    containerHeight: SharedValue<number>;
    color: string;
}

function CursorHighlight({ activeIndex, isActive, containerHeight, color }: CursorProps) {
    const style = useAnimatedStyle(() => {
        const h = containerHeight.get();
        const idx = activeIndex.get();
        if (h === 0 || idx < 0) return { opacity: 0 };

        const letterHeight = h / LETTER_COUNT;
        const translateY = idx * letterHeight;

        return {
            opacity: withSpring(isActive.get(), { damping: 18, stiffness: 280 }),
            transform: [{ translateY }],
            height: letterHeight,
        };
    });

    return (
        <Animated.View
            style={[styles.cursor, { backgroundColor: color }, style]}
            pointerEvents="none"
        />
    );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function AlphabetScrubber({ onLetterChange }: AlphabetScrubberProps) {
    const { theme } = useTheme();

    const containerHeight = useSharedValue(0);
    const isActive = useSharedValue(0);
    const activeIndex = useSharedValue(-1);
    const fingerY = useSharedValue(0);

    const [bubbleLetter, setBubbleLetter] = React.useState<string | null>(null);
    const lastHapticAt = React.useRef(0);

    const emitLetterChange = useCallback((idx: number) => {
        const letter = LETTERS[idx];
        onLetterChange(letter);
        setBubbleLetter(letter);

        const now = Date.now();
        if (now - lastHapticAt.current >= 35) {
            lastHapticAt.current = now;
            fireHaptic();
        }
    }, [onLetterChange]);

    const handleLayout = useCallback(
        (e: LayoutChangeEvent) => {
            containerHeight.set(e.nativeEvent.layout.height);
        },
        [containerHeight],
    );

    // ─── Gesture (fully on UI thread) ────────────────────────────────────────
    const gesture = Gesture.Pan()
        .minDistance(0)
        .maxPointers(1)
        .onBegin((e) => {
            'worklet';
            isActive.set(withSpring(1, { damping: 16, stiffness: 320, mass: 0.5 }));
            const h = containerHeight.get();
            if (h === 0) return;
            fingerY.set(e.y);
            const idx = Math.max(0, Math.min(LETTER_COUNT - 1, Math.floor(e.y / (h / LETTER_COUNT))));
            activeIndex.set(idx);
            runOnJS(emitLetterChange)(idx);
        })
        .onChange((e) => {
            'worklet';
            const h = containerHeight.get();
            if (h === 0) return;
            fingerY.set(e.y);
            const idx = Math.max(0, Math.min(LETTER_COUNT - 1, Math.floor(e.y / (h / LETTER_COUNT))));
            if (activeIndex.get() !== idx) {
                activeIndex.set(idx);
                runOnJS(emitLetterChange)(idx);
            }
        })
        .onFinalize(() => {
            'worklet';
            isActive.set(withTiming(0, { duration: 200 }));
            activeIndex.set(-1);
            runOnJS(setBubbleLetter)(null);
        });

    // ─── Bar scale on activate ────────────────────────────────────────────────
    const barStyle = useAnimatedStyle(() => ({
        transform: [
            { scaleX: interpolate(isActive.get(), [0, 1], [1, 1.1], Extrapolation.CLAMP) },
        ],
    }));

    // ─── Bubble: direct Y, spring X+scale ─────────────────────────────────────
    const bubbleStyle = useAnimatedStyle(() => {
        const h = containerHeight.get();
        const idx = activeIndex.get();
        const lh = h / LETTER_COUNT;
        const slotCenter = idx >= 0 ? idx * lh + lh / 2 : fingerY.get();
        const translateY = slotCenter - 32;

        return {
            opacity: isActive.get(),
            transform: [
                { translateY },
                {
                    translateX: withSpring(
                        interpolate(isActive.get(), [0, 1], [28, 0], Extrapolation.CLAMP),
                        { damping: 20, stiffness: 380 },
                    ),
                },
                {
                    scale: withSpring(
                        interpolate(isActive.get(), [0, 1], [0.2, 1], Extrapolation.CLAMP),
                        { damping: 16, stiffness: 340 },
                    ),
                },
                { rotate: '-45deg' },
            ],
        };
    });

    return (
        <View style={styles.wrapper}>
            <GestureDetector gesture={gesture}>
                <Animated.View
                    style={[styles.container, barStyle]}
                    onLayout={handleLayout}
                >
                    {/* Static letter labels — no animated styles per letter */}
                    {LETTERS.map((letter) => (
                        <View key={letter} style={styles.letterContainer}>
                            <Text style={[styles.letter, { color: theme.colors.primary }]}>
                                {letter}
                            </Text>
                        </View>
                    ))}

                    {/* Single animated cursor overlay */}
                    <CursorHighlight
                        activeIndex={activeIndex}
                        isActive={isActive}
                        containerHeight={containerHeight}
                        color={theme.colors.primary + '30'}
                    />
                </Animated.View>
            </GestureDetector>

            {/* Floating directional bubble */}
            <Animated.View
                style={[
                    styles.bubble,
                    {
                        backgroundColor: theme.colors.primary,
                        shadowColor: (theme.colors as any).shadow ?? '#000',
                    },
                    bubbleStyle,
                ]}
                pointerEvents="none"
            >
                <PaperText style={[styles.bubbleText, { color: theme.colors.onPrimary }]}>
                    {bubbleLetter}
                </PaperText>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 110,
        width: 28,
        justifyContent: 'center',
        zIndex: 100,
    },
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 8,
        position: 'relative',
    },
    letterContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
    },
    letter: {
        fontSize: 10,
        fontWeight: '700',
        lineHeight: 12,
        opacity: 0.55,
    },
    // Single animated cursor — replaces 27 per-letter animated views
    cursor: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 8, // match paddingVertical
        borderRadius: 4,
    },
    bubble: {
        position: 'absolute',
        right: 40,
        top: 0,
        width: 64,
        height: 64,
        borderRadius: 32,
        borderBottomRightRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 12,
        shadowOffset: { width: -3, height: 5 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
    },
    bubbleText: {
        fontSize: 28,
        fontWeight: '900',
        transform: [{ rotate: '45deg' }],
    },
});
