/**
 * KaraokeLyrics - Ultra-optimized 120fps lyrics renderer
 * 
 * Architecture:
 * 1. DIRECT ENGINE TIME: Uses positionShared directly as source of truth
 * 2. O(1) LINE LOOKUP: Pre-computed bucket table for instant line finding
 * 3. SINGLE CANVAS: No React re-renders, pure Skia drawing
 * 4. 120FPS READING: Reads engine time every frame for smooth highlight
 * 5. EXPONENTIAL SCROLL: Smooth damping without springs
 */
import {
    BlurMask,
    Canvas,
    Group,
    LinearGradient,
    Mask,
    RadialGradient,
    Rect,
    Text,
    useFont,
    vec
} from '@shopify/react-native-skia';
import React, { useEffect, useMemo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    Easing,
    Extrapolation,
    interpolate,
    useAnimatedStyle,
    useDerivedValue,
    useFrameCallback,
    useSharedValue,
    withTiming,
    type SharedValue,
} from 'react-native-reanimated';

import { usePlayerStore } from '@/src/stores';
import type { KaraokeLyricsJSON } from '@/src/types/karaokeTypes';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const FONT_PATH = require('@/assets/fonts/SpaceMono-Regular.ttf');
const FADE_HEIGHT = 100;
const MARGIN_LEFT = 50;
const MAX_LINE_WIDTH = SCREEN_WIDTH - 140;
const LINE_HEIGHT = 64;
const FONT_SIZE = 28;

// Scroll config
const SCROLL_DAMPING = 0.12;
const MANUAL_SCROLL_TIMEOUT_MS = 3000;

interface ProcessedLine {
    text: string;
    startSec: number;
    endSec: number;
    totalWidth: number;
    wordPositions: { x: number; endX: number; s: number; e: number }[];
    y: number;
}

interface PrecomputedData {
    lines: ProcessedLine[];
    lineAtTimeBuckets: Int16Array;
    maxBucketIndex: number;
    totalHeight: number;
}

interface KaraokeLyricsProps {
    lyricsJson: KaraokeLyricsJSON;
    height?: number;
    isVisible?: boolean;
}

export function KaraokeLyrics({
    lyricsJson,
    height = 300,
    isVisible = true
}: KaraokeLyricsProps) {
    const font = useFont(FONT_PATH, FONT_SIZE);

    // === DIRECT ENGINE TIME - Source of truth ===
    const positionShared = usePlayerStore(s => s.positionShared);

    // === VISIBILITY ANIMATION ===
    const opacity = useSharedValue(0);
    const scale = useSharedValue(0.95);

    useEffect(() => {
        if (isVisible) {
            opacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) });
            scale.value = withTiming(1, { duration: 250, easing: Easing.out(Easing.back(1.1)) });
        } else {
            opacity.value = withTiming(0, { duration: 150, easing: Easing.in(Easing.quad) });
            scale.value = withTiming(0.95, { duration: 150 });
        }
    }, [isVisible]);

    const containerStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ scale: scale.value }],
        pointerEvents: opacity.value > 0.5 ? 'auto' : 'none',
    }));

    // === SCROLL STATE ===
    const scrollY = useSharedValue(0);
    const targetScrollY = useSharedValue(0);
    const isManualScrolling = useSharedValue(false);
    const manualScrollEndTime = useSharedValue(0);
    const manualScrollOffset = useSharedValue(0);

    // === PRE-COMPUTE LYRICS DATA ===
    const precomputed = useMemo((): PrecomputedData | null => {
        if (!font) return null;

        const lines: ProcessedLine[] = [];
        let currentWords: typeof lyricsJson.lyrics = [];
        let currentY = 0;
        const spaceWidth = font.measureText(' ').width;

        const finalizeLine = (words: typeof lyricsJson.lyrics) => {
            if (words.length === 0) return;

            const text = words.map(w => w.w).join(' ');
            const wordPositions: ProcessedLine['wordPositions'] = [];
            let currentX = 0;

            for (let i = 0; i < words.length; i++) {
                const w = words[i];
                const wWidth = font.measureText(w.w).width;
                const sWidth = i < words.length - 1 ? spaceWidth : 0;
                wordPositions.push({
                    x: currentX,
                    endX: currentX + wWidth,
                    s: w.s,
                    e: w.e
                });
                currentX += wWidth + sWidth;
            }

            lines.push({
                text,
                startSec: words[0].s,
                endSec: words[words.length - 1].e,
                totalWidth: currentX,
                wordPositions,
                y: currentY,
            });

            currentY += LINE_HEIGHT;
        };

        let activeLineWidth = 0;

        for (const word of lyricsJson.lyrics) {
            const wordWidth = font.measureText(word.w).width;
            const wouldExceed = activeLineWidth + wordWidth > MAX_LINE_WIDTH;

            if (wouldExceed && currentWords.length > 0) {
                finalizeLine(currentWords);
                currentWords = [word];
                activeLineWidth = wordWidth + spaceWidth;
            } else {
                currentWords.push(word);
                activeLineWidth += wordWidth + spaceWidth;
            }

            if (word.n) {
                finalizeLine(currentWords);
                currentWords = [];
                activeLineWidth = 0;
            }
        }

        finalizeLine(currentWords);

        if (lines.length === 0) return null;

        // Build O(1) lookup table (10ms buckets)
        const lastLine = lines[lines.length - 1];
        const durationMs = Math.ceil(lastLine.endSec * 100) + 100;
        const lineAtTimeBuckets = new Int16Array(durationMs);
        lineAtTimeBuckets.fill(-1);

        for (let i = 0; i < lines.length; i++) {
            const startBucket = Math.floor(lines[i].startSec * 100);
            const endBucket = Math.min(Math.ceil(lines[i].endSec * 100), durationMs - 1);
            for (let b = startBucket; b <= endBucket; b++) {
                lineAtTimeBuckets[b] = i;
            }
        }

        // Fill gaps with previous line (for silences)
        let lastFilledLine = -1;
        for (let b = 0; b < durationMs; b++) {
            if (lineAtTimeBuckets[b] >= 0) {
                lastFilledLine = lineAtTimeBuckets[b];
            } else if (lastFilledLine >= 0) {
                lineAtTimeBuckets[b] = lastFilledLine;
            }
        }

        // Fill pre-lyrics buckets with line 0
        const firstLineStart = Math.floor(lines[0].startSec * 100);
        for (let b = 0; b < firstLineStart; b++) {
            lineAtTimeBuckets[b] = 0;
        }

        return {
            lines,
            lineAtTimeBuckets,
            maxBucketIndex: durationMs - 1,
            totalHeight: currentY,
        };
    }, [font, lyricsJson]);

    // === FRAME CALLBACK: Scroll only (highlight is derived) ===
    useFrameCallback((frameInfo) => {
        'worklet';
        if (!precomputed) return;

        const now = frameInfo.timestamp;

        // Manual scroll timeout check
        if (isManualScrolling.value && now > manualScrollEndTime.value) {
            isManualScrolling.value = false;
        }

        // Auto-scroll to current line (using REAL engine time)
        if (!isManualScrolling.value) {
            const currentMs = positionShared.value;
            const currentSec = currentMs / 1000;
            const bucketIndex = Math.min(
                Math.max(0, Math.floor(currentSec * 100)),
                precomputed.maxBucketIndex
            );
            const activeLineIndex = Math.max(0, precomputed.lineAtTimeBuckets[bucketIndex]);
            const activeLine = precomputed.lines[activeLineIndex];

            if (activeLine) {
                targetScrollY.value = -activeLine.y + height * 0.4;
            }
        }

        // Smooth scroll with exponential damping
        const scrollDiff = targetScrollY.value - scrollY.value;
        if (Math.abs(scrollDiff) > 0.5) {
            scrollY.value += scrollDiff * SCROLL_DAMPING;
        } else {
            scrollY.value = targetScrollY.value;
        }
    }, true);

    // === GESTURE: Manual Scroll ===
    const panGesture = Gesture.Pan()
        .onStart(() => {
            'worklet';
            isManualScrolling.value = true;
            manualScrollOffset.value = scrollY.value;
        })
        .onUpdate((event) => {
            'worklet';
            const newScrollY = manualScrollOffset.value + event.translationY;
            const minScroll = -((precomputed?.totalHeight || 0) - height * 0.5);
            const maxScroll = height * 0.4;
            targetScrollY.value = Math.min(maxScroll, Math.max(minScroll, newScrollY));
            scrollY.value = targetScrollY.value;
        })
        .onEnd((event) => {
            'worklet';
            manualScrollEndTime.value = Date.now() + MANUAL_SCROLL_TIMEOUT_MS;
            const velocity = event.velocityY;
            if (Math.abs(velocity) > 100) {
                const momentum = velocity * 0.1;
                const minScroll = -((precomputed?.totalHeight || 0) - height * 0.5);
                const maxScroll = height * 0.4;
                targetScrollY.value = Math.min(maxScroll, Math.max(minScroll, targetScrollY.value + momentum));
            }
        });

    const scrollTransform = useDerivedValue(() => [{ translateY: scrollY.value }]);

    if (!font || !precomputed || precomputed.lines.length === 0) {
        return <View style={[styles.container, { height }]} />;
    }

    return (
        <GestureDetector gesture={panGesture}>
            <Animated.View style={[styles.container, { height }, containerStyle]}>
                <Canvas style={{ flex: 1 }}>
                    <Group transform={scrollTransform}>
                        {precomputed.lines.map((line, index) => (
                            <OptimizedLyricLine
                                key={index}
                                line={line}
                                font={font}
                                positionShared={positionShared}
                                scrollY={scrollY}
                                viewHeight={height}
                            />
                        ))}
                    </Group>

                    {/* Top fog */}
                    <Rect x={0} y={0} width={SCREEN_WIDTH} height={FADE_HEIGHT}>
                        <LinearGradient
                            start={vec(0, 0)}
                            end={vec(0, FADE_HEIGHT)}
                            colors={['rgba(0,0,0,1)', 'rgba(0,0,0,0)']}
                        />
                    </Rect>
                    {/* Bottom fog */}
                    <Rect x={0} y={height - FADE_HEIGHT} width={SCREEN_WIDTH} height={FADE_HEIGHT}>
                        <LinearGradient
                            start={vec(0, height - FADE_HEIGHT)}
                            end={vec(0, height)}
                            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,1)']}
                        />
                    </Rect>
                </Canvas>
            </Animated.View>
        </GestureDetector>
    );
}

/**
 * OptimizedLyricLine - Uses REAL engine time for highlight
 * 
 * Key: positionShared is read in useDerivedValue, which runs every frame.
 * This gives us 120fps highlight updates with the REAL audio time.
 */
function OptimizedLyricLine({
    line,
    font,
    positionShared,
    scrollY,
    viewHeight,
}: {
    line: ProcessedLine;
    font: ReturnType<typeof useFont>;
    positionShared: SharedValue<number>;
    scrollY: SharedValue<number>;
    viewHeight: number;
}) {
    // Visibility culling - skip rendering off-screen lines
    const isVisible = useDerivedValue(() => {
        'worklet';
        const screenY = line.y + scrollY.value;
        return (screenY > -LINE_HEIGHT * 2 && screenY < viewHeight + LINE_HEIGHT) ? 1 : 0;
    });

    // REAL TIME from engine (read every frame via useDerivedValue)
    const currentTimeSec = useDerivedValue(() => {
        'worklet';
        return positionShared.value / 1000;
    });

    // Highlight width - calculated from REAL engine time
    const highlightWidth = useDerivedValue(() => {
        'worklet';
        const time = currentTimeSec.value;

        if (time < line.startSec) return 0;
        if (time > line.endSec) return line.totalWidth;

        const words = line.wordPositions;
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            if (time >= word.s && time <= word.e) {
                // Interpolate within the word for smooth highlight
                return interpolate(time, [word.s, word.e], [word.x, word.endX], Extrapolation.CLAMP);
            }
            if (time < word.s && i > 0) {
                // Between words - stay at end of previous word
                return words[i - 1].endX;
            }
        }
        return line.totalWidth;
    });

    // Base text opacity
    const baseOpacity = useDerivedValue(() => {
        'worklet';
        const time = currentTimeSec.value;
        if (time >= line.startSec && time <= line.endSec) return 1;
        if (time > line.endSec) return 0.25;
        return 0.4;
    });

    // Line scale for active line
    const lineTransform = useDerivedValue(() => {
        'worklet';
        const time = currentTimeSec.value;
        let lineScale = 1;

        if (time >= line.startSec && time <= line.endSec) {
            const t = time - line.startSec;
            lineScale = t < 0.3
                ? interpolate(t, [0, 0.15, 0.3], [1, 1.05, 1.03], Extrapolation.CLAMP)
                : 1.03;
        }

        return [{ translateY: line.y }, { scale: lineScale }];
    });

    // Feather width for the liquid feel (larger = more liquid)
    const FEATHER_WIDTH = 80; // More expansive for liquid feel

    // Mask logic for the liquid sweep effect
    const maskContent = useDerivedValue(() => {
        'worklet';
        const headX = MARGIN_LEFT + highlightWidth.value;
        const centerY = LINE_HEIGHT * 0.6;

        return (
            <Group>
                {/* Fully opaque body */}
                <Rect
                    x={0}
                    y={0}
                    width={Math.max(0, headX - FEATHER_WIDTH / 2)}
                    height={LINE_HEIGHT * 2}
                    color="white"
                />
                {/* Liquid feathered head - using Radial for a truly rounded flow head */}
                <Rect
                    x={headX - FEATHER_WIDTH * 2}
                    y={-LINE_HEIGHT}
                    width={FEATHER_WIDTH * 4}
                    height={LINE_HEIGHT * 4}
                >
                    <RadialGradient
                        c={vec(headX - FEATHER_WIDTH / 2, centerY)}
                        r={FEATHER_WIDTH * 2}
                        colors={['white', 'transparent']}
                    />
                </Rect>
            </Group>
        );
    });

    // Glow opacity - amplified and smoother
    const glowOpacity = useDerivedValue(() => {
        'worklet';
        const time = currentTimeSec.value;
        const start = line.startSec;
        const end = line.endSec;

        if (time < start - 0.3) return 0;
        if (time > end + 0.8) return 0; // Much longer linger for "liquid light"

        return interpolate(
            time,
            [start - 0.3, start, end, end + 0.8],
            [0, 0.5, 0.4, 0],
            Extrapolation.CLAMP
        );
    });

    return (
        <Group transform={lineTransform} opacity={isVisible}>
            {/* Base text (dimmed) */}
            <Text
                x={MARGIN_LEFT}
                y={LINE_HEIGHT * 0.6}
                text={line.text}
                font={font}
                color="#3a3a3a"
                opacity={baseOpacity}
            />

            {/* Premium Liquid Mask */}
            <Mask mask={maskContent.value}>
                {/* Visual content to be masked */}
                <Group>
                    {/* Leading Glow Light - Now with real BlurMask */}
                    <Text
                        x={MARGIN_LEFT}
                        y={LINE_HEIGHT * 0.6}
                        text={line.text}
                        font={font}
                        color="#FFFFFF"
                        opacity={glowOpacity}
                    >
                        <BlurMask blur={12} style="normal" />
                    </Text>

                    {/* Main highlight text */}
                    <Text
                        x={MARGIN_LEFT}
                        y={LINE_HEIGHT * 0.6}
                        text={line.text}
                        font={font}
                        color="#FFFFFF"
                    />
                </Group>
            </Mask>
        </Group>
    );
}

const styles = StyleSheet.create({
    container: {
        width: '100%',
        backgroundColor: '#000000',
    }
});
