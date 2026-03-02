/**
 * LyricsView - Animated synchronized lyrics display
 * 
 * Featured-rich lyrics viewer with auto-scroll and line highlighting.
 */

import { getActiveLyricIndex } from '@/src/services';
import { usePlayerStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import type { KaraokeLyricsJSON } from '@/src/types';
import React, { useEffect, useMemo, useRef } from 'react';
import { Dimensions, FlatList, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import Animated, {
    FadeIn,
    FadeOut,
    useAnimatedStyle,
    withSpring,
    withTiming
} from 'react-native-reanimated';
import { LyricsSkeleton } from '../ui';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface LyricsLineProps {
    text: string;
    isActive: boolean;
    isPast: boolean;
    onPress: () => void;
}

interface ParsedLine {
    time: number;
    text: string;
}

interface LyricsViewProps {
    lyricsJson?: KaraokeLyricsJSON | null;
    isLoading?: boolean;
}

function buildLinesFromKaraokeJson(lyricsJson: KaraokeLyricsJSON | null | undefined): ParsedLine[] {
    if (!lyricsJson) return [];

    const lines: ParsedLine[] = [];
    let currentWords: string[] = [];
    let currentStartMs: number | null = null;

    for (const word of lyricsJson.lyrics) {
        if (currentStartMs === null) {
            currentStartMs = Math.max(0, Math.round(word.s * 1000));
        }

        if (word.w.trim().length > 0) {
            currentWords.push(word.w);
        }

        if (word.n) {
            const text = currentWords.join(' ').trim();
            if (text.length > 0 && currentStartMs !== null) {
                lines.push({ time: currentStartMs, text });
            }

            currentWords = [];
            currentStartMs = null;
        }
    }

    if (currentWords.length > 0 && currentStartMs !== null) {
        lines.push({
            time: currentStartMs,
            text: currentWords.join(' ').trim(),
        });
    }

    return lines;
}

const LyricLine = ({ text, isActive, isPast, onPress }: LyricsLineProps) => {
    const { theme } = useTheme();

    const animatedStyle = useAnimatedStyle(() => {
        return {
            opacity: withTiming(isActive ? 1 : isPast ? 0.5 : 0.3),
            transform: [
                { scale: withSpring(isActive ? 1.05 : 1) }
            ],
        };
    });

    return (
        <Pressable onPress={onPress}>
            <Animated.View style={[styles.lineHost, animatedStyle]}>
                <Text
                    variant={isActive ? "headlineSmall" : "titleLarge"}
                    style={[
                        styles.lineText,
                        {
                            color: isActive ? theme.colors.primary : theme.colors.onSurface,
                            fontWeight: isActive ? '700' : '500'
                        }
                    ]}
                >
                    {text}
                </Text>
            </Animated.View>
        </Pressable>
    );
};

export function LyricsView({ lyricsJson, isLoading = false }: LyricsViewProps) {
    const { theme } = useTheme();
    const position = usePlayerStore(s => s.position);
    const seek = usePlayerStore(s => s.seek);
    const flatListRef = useRef<FlatList>(null);

    const lines = useMemo(() => buildLinesFromKaraokeJson(lyricsJson), [lyricsJson]);

    const activeIndex = useMemo(() =>
        getActiveLyricIndex(lines, position),
        [lines, position]);

    useEffect(() => {
        if (activeIndex !== -1 && flatListRef.current) {
            flatListRef.current.scrollToIndex({
                index: activeIndex,
                animated: true,
                viewPosition: 0.3, // Keep active line near the top-middle
            });
        }
    }, [activeIndex]);

    const handleLinePress = (time: number) => {
        seek(time);
    };

    if (lines.length === 0) {
        return (
            <Animated.View
                entering={FadeIn.duration(400)}
                exiting={FadeOut.duration(400)}
                style={[styles.emptyContainer, isLoading && { justifyContent: 'flex-start', paddingTop: 60 }]}
            >
                {isLoading ? (
                    <LyricsSkeleton isDownloading={isLoading} />
                ) : (
                    <Text variant="titleMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                        No lyrics found for this track
                    </Text>
                )}
            </Animated.View>
        );
    }

    return (
        <Animated.View
            entering={FadeIn.duration(600)}
            style={styles.container}
        >
            <FlatList
                ref={flatListRef}
                data={lines}
                keyExtractor={(_, index) => index.toString()}
                renderItem={({ item, index }) => (
                    <LyricLine
                        text={item.text}
                        isActive={index === activeIndex}
                        isPast={index < activeIndex}
                        onPress={() => handleLinePress(item.time)}
                    />
                )}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                onScrollToIndexFailed={() => { }} // Handle edge cases
                getItemLayout={(_, index) => ({
                    length: 80, // Estimated line height
                    offset: 80 * index,
                    index,
                })}
            />
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    listContent: {
        paddingTop: SCREEN_HEIGHT / 4,
        paddingBottom: SCREEN_HEIGHT / 2,
        paddingHorizontal: 24,
    },
    lineHost: {
        minHeight: 60,
        marginVertical: 10,
        justifyContent: 'center',
    },
    lineText: {
        textAlign: 'left',
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
    }
});
