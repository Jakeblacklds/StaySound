/**
 * KaraokeLyrics - Ultra-optimized 120fps lyrics renderer
 *
 * Animation technique mirrors binimum/apple-music-web-components:
 *  - Wipe:  narrow linear-gradient sweep — no rectangular mask artifacts
 *  - Glow:  BlurMask clipped to a small window around the wipe head so
 *           it stays localised and doesn't box-flood the full line
 *  - Colors: uses the dynamic theme accent via useTheme()
 */
import {
    BlurMask,
    Canvas,
    Group,
    LinearGradient,
    Mask,
    Rect,
    Text,
    useFont,
    vec,
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
import { useTheme } from '@/src/theme';
import type { KaraokeLyricsJSON } from '@/src/types/karaokeTypes';
import { ensureColorContrast, mixHexColors } from '@/src/utils/colorContrast';
import { LyricsSkeleton } from '../ui';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const FONT_PATH = require('@/assets/fonts/SpaceMono-Regular.ttf');
const FADE_HEIGHT = 100;
const MARGIN_LEFT = 50;
const MAX_LINE_WIDTH = SCREEN_WIDTH - 140;
const LINE_HEIGHT = 64;
const FONT_SIZE = 28;

/**
 * The "brush" feather width in px — must be narrow to avoid rectangular artifacts.
 * Binimum uses 0.5em ≈ 14px; we use 16px for a little more softness.
 */
const WIPE_FEATHER_PX = 16;

/**
 * Half-width of the glow window around the wipe head (in px).
 * Keeps the blur localised so it doesn't spill over inactive characters.
 */
const GLOW_WINDOW_HALF = 28;

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
    isVisible = true,
}: KaraokeLyricsProps) {
    const font = useFont(FONT_PATH, FONT_SIZE);
    const positionShared = usePlayerStore(s => s.positionShared);
    const { theme } = useTheme();

    // Dynamic accent color — flows from album palette when dynamic colors are on
    const accentColor = React.useMemo(
        () => ensureColorContrast(theme.colors.primary, '#06080F', { minRatio: 4.8, targetColor: '#FFFFFF' }),
        [theme.colors.primary]
    );
    const inactiveTextColor = React.useMemo(
        () => ensureColorContrast(
            mixHexColors('#FFFFFF', '#06080F', 0.5),
            '#06080F',
            { minRatio: 3.1, targetColor: '#FFFFFF' }
        ),
        []
    );
    const glowTextColor = React.useMemo(
        () => ensureColorContrast(
            mixHexColors(accentColor, '#FFFFFF', 0.22),
            '#06080F',
            { minRatio: 5.4, targetColor: '#FFFFFF' }
        ),
        [accentColor]
    );

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

        const foregroundLyrics = lyricsJson.lyrics.filter(word => !word.bg);
        const lines: ProcessedLine[] = [];
        let currentWords: typeof foregroundLyrics = [];
        let currentY = 0;
        const spaceWidth = font.measureText(' ').width;

        const finalizeLine = (words: typeof foregroundLyrics) => {
            if (words.length === 0) return;
            const text = words.map(w => `${w.w}${w.sp ? ' ' : ''}`).join('').trimEnd();
            const wordPositions: ProcessedLine['wordPositions'] = [];
            let currentX = 0;
            for (let i = 0; i < words.length; i++) {
                const w = words[i];
                const wWidth = font.measureText(w.w).width;
                const sWidth = w.sp ? spaceWidth : 0;
                wordPositions.push({ x: currentX, endX: currentX + wWidth, s: w.s, e: w.e });
                currentX += wWidth + sWidth;
            }
            lines.push({ text, startSec: words[0].s, endSec: words[words.length - 1].e, totalWidth: currentX, wordPositions, y: currentY });
            currentY += LINE_HEIGHT;
        };

        let activeLineWidth = 0;
        for (const word of foregroundLyrics) {
            const wordWidth = font.measureText(word.w).width;
            const wouldExceed = activeLineWidth + wordWidth > MAX_LINE_WIDTH;
            if (wouldExceed && currentWords.length > 0) {
                finalizeLine(currentWords);
                currentWords = [word];
                activeLineWidth = wordWidth + (word.sp ? spaceWidth : 0);
            } else {
                currentWords.push(word);
                activeLineWidth += wordWidth + (word.sp ? spaceWidth : 0);
            }
            if (word.n) {
                finalizeLine(currentWords);
                currentWords = [];
                activeLineWidth = 0;
            }
        }
        finalizeLine(currentWords);

        if (lines.length === 0) return null;

        const lastLine = lines[lines.length - 1];
        const durationMs = Math.ceil(lastLine.endSec * 100) + 100;
        const lineAtTimeBuckets = new Int16Array(durationMs);
        lineAtTimeBuckets.fill(-1);

        for (let i = 0; i < lines.length; i++) {
            const startBucket = Math.floor(lines[i].startSec * 100);
            const endBucket = Math.min(Math.ceil(lines[i].endSec * 100), durationMs - 1);
            for (let b = startBucket; b <= endBucket; b++) lineAtTimeBuckets[b] = i;
        }

        let lastFilledLine = -1;
        for (let b = 0; b < durationMs; b++) {
            if (lineAtTimeBuckets[b] >= 0) lastFilledLine = lineAtTimeBuckets[b];
            else if (lastFilledLine >= 0) lineAtTimeBuckets[b] = lastFilledLine;
        }

        const firstLineStart = Math.floor(lines[0].startSec * 100);
        for (let b = 0; b < firstLineStart; b++) lineAtTimeBuckets[b] = 0;

        return { lines, lineAtTimeBuckets, maxBucketIndex: durationMs - 1, totalHeight: currentY };
    }, [font, lyricsJson]);

    // === FRAME CALLBACK ===
    useFrameCallback(frameInfo => {
        'worklet';
        if (!precomputed) return;
        const now = frameInfo.timestamp;
        if (isManualScrolling.value && now > manualScrollEndTime.value) {
            isManualScrolling.value = false;
        }
        if (!isManualScrolling.value) {
            const currentSec = positionShared.value / 1000;
            const bucketIndex = Math.min(Math.max(0, Math.floor(currentSec * 100)), precomputed.maxBucketIndex);
            const activeLineIndex = Math.max(0, precomputed.lineAtTimeBuckets[bucketIndex]);
            const activeLine = precomputed.lines[activeLineIndex];
            if (activeLine) targetScrollY.value = -activeLine.y + height * 0.4;
        }
        const scrollDiff = targetScrollY.value - scrollY.value;
        if (Math.abs(scrollDiff) > 0.5) scrollY.value += scrollDiff * SCROLL_DAMPING;
        else scrollY.value = targetScrollY.value;
    }, true);

    // === GESTURE ===
    const panGesture = Gesture.Pan()
        .onStart(() => {
            'worklet';
            isManualScrolling.value = true;
            manualScrollOffset.value = scrollY.value;
        })
        .onUpdate(event => {
            'worklet';
            const newScrollY = manualScrollOffset.value + event.translationY;
            const minScroll = -((precomputed?.totalHeight || 0) - height * 0.5);
            const maxScroll = height * 0.4;
            targetScrollY.value = Math.min(maxScroll, Math.max(minScroll, newScrollY));
            scrollY.value = targetScrollY.value;
        })
        .onEnd(event => {
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
        return (
            <View style={[styles.container, { height, paddingTop: 40 }]}>
                <LyricsSkeleton isDownloading={true} />
            </View>
        );
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
                                accentColor={accentColor}
                                inactiveTextColor={inactiveTextColor}
                                glowTextColor={glowTextColor}
                            />
                        ))}
                    </Group>

                    {/* Top fog */}
                    <Rect x={0} y={0} width={SCREEN_WIDTH} height={FADE_HEIGHT}>
                        <LinearGradient start={vec(0, 0)} end={vec(0, FADE_HEIGHT)} colors={['rgba(0,0,0,0.95)', 'rgba(0,0,0,0)']} />
                    </Rect>
                    {/* Bottom fog */}
                    <Rect x={0} y={height - FADE_HEIGHT} width={SCREEN_WIDTH} height={FADE_HEIGHT}>
                        <LinearGradient start={vec(0, height - FADE_HEIGHT)} end={vec(0, height)} colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.95)']} />
                    </Rect>
                </Canvas>
            </Animated.View>
        </GestureDetector>
    );
}

/**
 * OptimizedLyricLine — binimum-accurate wipe + localised glow
 *
 * Wipe:
 *   Two-part mask — a solid white body for already-revealed text,
 *   followed by a short (WIPE_FEATHER_PX) LinearGradient edge that fades
 *   to transparent. No radial or boxy shape → no rectangular artifact.
 *
 * Glow:
 *   A separate Text with BlurMask, clipped by a narrow Mask window
 *   (±GLOW_WINDOW_HALF) around the wipe head. The clip window is a
 *   tiny LinearGradient rect so the glow light looks like it emanates
 *   only from the moving sweep front — exactly like binimum's
 *   `drop-shadow` on `.char` spans.
 *   The glow uses the dynamic theme accent colour so it blends with the
 *   frosted-glass album background instead of looking like a white wash.
 */
function OptimizedLyricLine({
    line,
    font,
    positionShared,
    scrollY,
    viewHeight,
    accentColor,
    inactiveTextColor,
    glowTextColor,
}: {
    line: ProcessedLine;
    font: ReturnType<typeof useFont>;
    positionShared: SharedValue<number>;
    scrollY: SharedValue<number>;
    viewHeight: number;
    accentColor: string;
    inactiveTextColor: string;
    glowTextColor: string;
}) {
    // Visibility culling
    const isVisible = useDerivedValue(() => {
        'worklet';
        const screenY = line.y + scrollY.value;
        return screenY > -LINE_HEIGHT * 2 && screenY < viewHeight + LINE_HEIGHT ? 1 : 0;
    });

    // Engine time
    const currentTimeSec = useDerivedValue(() => {
        'worklet';
        return positionShared.value / 1000;
    });

    // ── Wipe head position (px from text origin) ──────────────────────
    const wipeHeadX = useDerivedValue(() => {
        'worklet';
        const time = currentTimeSec.value;
        if (time < line.startSec) return 0;
        if (time >= line.endSec) return line.totalWidth + WIPE_FEATHER_PX;
        const words = line.wordPositions;
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            if (time >= word.s && time <= word.e) {
                return interpolate(time, [word.s, word.e], [word.x, word.endX], Extrapolation.CLAMP);
            }
            if (time < word.s && i > 0) return words[i - 1].endX;
        }
        return line.totalWidth;
    });

    // ── Mask: solid body + narrow feather edge ────────────────────────
    // No wide radial, no big rect — result looks like a moving paint brush.
    const wipeMask = useDerivedValue(() => {
        'worklet';
        const head = wipeHeadX.value;

        if (head <= 0) {
            // Nothing revealed yet — zero-width mask
            return <Rect x={MARGIN_LEFT} y={0} width={0} height={LINE_HEIGHT * 2} color="white" />;
        }

        const bodyRight = Math.max(MARGIN_LEFT, MARGIN_LEFT + head - WIPE_FEATHER_PX / 2);
        const featherLeft = bodyRight;
        const featherRight = featherLeft + WIPE_FEATHER_PX;

        return (
            <Group>
                {/* Solid already-highlighted body */}
                <Rect x={0} y={0} width={bodyRight} height={LINE_HEIGHT * 2} color="white" />
                {/* Narrow feathered brush edge — this is the only gradient */}
                <Rect x={featherLeft} y={0} width={WIPE_FEATHER_PX} height={LINE_HEIGHT * 2}>
                    <LinearGradient
                        start={vec(featherLeft, 0)}
                        end={vec(featherRight, 0)}
                        colors={['white', 'transparent']}
                    />
                </Rect>
            </Group>
        );
    });

    // ── Glow mask: tiny window around the wipe head ───────────────────
    // This constrains the BlurMask so it only glows near the sweep front.
    const glowMask = useDerivedValue(() => {
        'worklet';
        const head = MARGIN_LEFT + wipeHeadX.value;
        const left = Math.max(0, head - GLOW_WINDOW_HALF);
        const right = head + GLOW_WINDOW_HALF;
        const width = right - left;

        return (
            <Rect x={left} y={0} width={Math.max(0, width)} height={LINE_HEIGHT * 2}>
                <LinearGradient
                    start={vec(left, 0)}
                    end={vec(right, 0)}
                    colors={['transparent', 'white', 'white', 'transparent']}
                    positions={[0, 0.3, 0.7, 1]}
                />
            </Rect>
        );
    });

    // Glow opacity — ramps in with the line, fades after it ends
    const glowOpacity = useDerivedValue(() => {
        'worklet';
        const time = currentTimeSec.value;
        const { startSec, endSec } = line;
        if (time < startSec - 0.1 || time > endSec + 0.3) return 0;
        return interpolate(
            time,
            [startSec - 0.1, startSec + 0.1, endSec, endSec + 0.3],
            [0, 0.9, 0.75, 0],
            Extrapolation.CLAMP,
        );
    });

    // ── Inactive text opacity ─────────────────────────────────────────
    const baseOpacity = useDerivedValue(() => {
        'worklet';
        const time = currentTimeSec.value;
        if (time >= line.startSec && time <= line.endSec) return 1;
        if (time > line.endSec) return 0.22;
        return 0.35;
    });

    // ── Line scale — subtle, matches binimum's scale3d(0.93 → 1.001) ─
    const lineTransform = useDerivedValue(() => {
        'worklet';
        const time = currentTimeSec.value;
        let sc = 0.95;
        if (time >= line.startSec && time <= line.endSec) {
            const t = time - line.startSec;
            sc = t < 0.3
                ? interpolate(t, [0, 0.15, 0.3], [0.97, 1.02, 1.01], Extrapolation.CLAMP)
                : 1.01;
        } else if (time > line.endSec) {
            sc = 0.97;
        }
        return [{ translateY: line.y }, { scale: sc }];
    });

    const textY = LINE_HEIGHT * 0.72;

    return (
        <Group transform={lineTransform} opacity={isVisible}>
            {/* 1. Dimmed base text — visible but clearly inactive */}
            <Text
                x={MARGIN_LEFT}
                y={textY}
                text={line.text}
                font={font}
                color={inactiveTextColor}
                opacity={baseOpacity}
            />

            {/* 2. Glow — white shimmer at the sweep head */}
            <Mask mask={glowMask.value} clip={false}>
                <Group opacity={glowOpacity}>
                    <Text
                        x={MARGIN_LEFT}
                        y={textY}
                        text={line.text}
                        font={font}
                        color={glowTextColor}
                    >
                        <BlurMask blur={5} style="normal" />
                    </Text>
                </Group>
            </Mask>

            {/* 3. Wipe — pure white, maximum contrast against the dark overlay */}
            <Mask mask={wipeMask.value}>
                <Text
                    x={MARGIN_LEFT}
                    y={textY}
                    text={line.text}
                    font={font}
                    color={accentColor}
                />
            </Mask>
        </Group>
    );
}

const styles = StyleSheet.create({
    container: {
        width: '100%',
        backgroundColor: 'transparent',
    },
});
