import React, { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import DraggableFlatList, { type RenderItemParams } from 'react-native-draggable-flatlist';
import { IconButton, Text } from 'react-native-paper';
import Animated, {
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';

// ─────────────────────────────────────────────────────────
// QueueItemDecorator
// ─────────────────────────────────────────────────────────
export function QueueItemDecorator({
    children,
    accentColor,
    isDragging,
}: {
    children: React.ReactNode;
    accentColor: string;
    isDragging: boolean;
}) {
    const activeAnim = useSharedValue(0);

    React.useEffect(() => {
        if (isDragging) {
            activeAnim.value = withSpring(1, {
                damping: 18,
                stiffness: 280,
                mass: 0.35,
            });
        } else {
            activeAnim.value = withTiming(0, { duration: 150 });
        }
    }, [isDragging]);

    const decoratorStyle = useAnimatedStyle(() => {
        const p = activeAnim.value;
        const scale = interpolate(p, [0, 1], [1, 1.04]);

        return {
            transform: [{ scale }],
            elevation: interpolate(p, [0, 1], [0, 12]),
            shadowColor: '#000',
            shadowOpacity: interpolate(p, [0, 1], [0, 0.3]),
            shadowRadius: interpolate(p, [0, 1], [0, 8]),
            shadowOffset: { width: 0, height: interpolate(p, [0, 1], [0, 4]) },
            backgroundColor: p > 0.01 ? accentColor + '1F' : 'transparent',
            borderRadius: 12,
            zIndex: isDragging ? 999 : 0,
        };
    }, [isDragging, accentColor]);

    return (
        <Animated.View style={decoratorStyle}>
            {children}
        </Animated.View>
    );
}

// ─────────────────────────────────────────────────────────
// QueueRow
// ─────────────────────────────────────────────────────────
interface QueueRowProps {
    item: { id: string; title: string; artist: string };
    index: number;
    isCurrent: boolean;
    accentColor: string;
    textColor: string;
    accentBg30: string;
    textColorB3: string;
    textColor80: string;
    textColor40: string;
    drag: () => void;
    onPress: (index: number) => void;
    onRemove: (index: number) => void;
}

const QueueRow = React.memo(function QueueRow({
    item, index, isCurrent, accentColor, textColor, accentBg30, textColorB3, textColor80, textColor40, drag, onPress, onRemove
}: QueueRowProps) {
    return (
        <QueueItemDecorator accentColor={accentColor} isDragging={false}>
            <Pressable
                style={({ pressed }) => [
                    styles.queueRow,
                    isCurrent && { backgroundColor: accentBg30 },
                    pressed && { opacity: 0.75 },
                ]}
                onPress={() => onPress(index)}
                onLongPress={drag}
                delayLongPress={150}
            >
                <View style={styles.queueTrackInfo}>
                    <Text numberOfLines={1} style={[styles.queueTrackTitle, { color: isCurrent ? accentColor : textColor }]}>
                        {item.title}
                    </Text>
                    <Text numberOfLines={1} style={[styles.queueTrackArtist, { color: textColorB3 }]}>
                        {item.artist}
                    </Text>
                </View>
                <View style={styles.queueDragHandle}>
                    <View style={[styles.queueDragLine, { backgroundColor: textColor40 }]} />
                    <View style={[styles.queueDragLine, { backgroundColor: textColor40 }]} />
                    <View style={[styles.queueDragLine, { backgroundColor: textColor40 }]} />
                </View>
                <IconButton
                    icon="close"
                    size={16}
                    iconColor={textColor80}
                    onPress={() => onRemove(index)}
                    style={styles.queueRemoveBtn}
                />
            </Pressable>
        </QueueItemDecorator>
    );
});

// ─────────────────────────────────────────────────────────
// QueueOverlay
// ─────────────────────────────────────────────────────────
interface QueueOverlayProps {
    queue: any[];
    currentTrackId?: string;
    accentColor: string;
    textColor: string;
    backgroundColor: string;
    animStyle: any;
    onClose: () => void;
    onTrackPress: (index: number) => void;
    onRemove: (index: number) => void;
    onDragEnd: (params: { data: any[] }) => void;
    loadMore: () => void;
}

export function QueueOverlay({
    queue,
    currentTrackId,
    accentColor,
    textColor,
    backgroundColor,
    animStyle,
    onClose,
    onTrackPress,
    onRemove,
    onDragEnd,
    loadMore
}: QueueOverlayProps) {
    const accentBg30 = React.useMemo(() => accentColor + '30', [accentColor]);
    const textColor80 = React.useMemo(() => textColor + '80', [textColor]);
    const textColorB3 = React.useMemo(() => textColor + 'B3', [textColor]);
    const textColor40 = React.useMemo(() => textColor + '40', [textColor]);

    const renderQueueItem = useCallback((params: RenderItemParams<any>) => {
        const { item, drag, isActive: isDragging, getIndex } = params;
        const index = getIndex() ?? 0;
        const isCurrent = item.id === currentTrackId;

        return (
            <QueueItemDecorator accentColor={accentColor} isDragging={isDragging}>
                <QueueRow
                    item={item}
                    index={index}
                    isCurrent={isCurrent}
                    accentColor={accentColor}
                    textColor={textColor}
                    accentBg30={accentBg30}
                    textColorB3={textColorB3}
                    textColor80={textColor80}
                    textColor40={textColor40}
                    drag={drag}
                    onPress={onTrackPress}
                    onRemove={onRemove}
                />
            </QueueItemDecorator>
        );
    }, [accentColor, textColor, currentTrackId, accentBg30, textColorB3, textColor80, textColor40, onTrackPress, onRemove]);

    return (
        <Animated.View style={[styles.queueOverlay, { backgroundColor }, animStyle]}>
            <View style={styles.queueHeader}>
                <Text style={[styles.queueTitle, { color: textColor }]}>Cola de reproducción</Text>
                <IconButton icon="close" size={22} iconColor={textColor} onPress={onClose} />
            </View>

            <DraggableFlatList
                data={queue}
                keyExtractor={(item) => item.id}
                renderItem={renderQueueItem}
                onDragEnd={onDragEnd}
                onEndReached={loadMore}
                onEndReachedThreshold={0.5}
                contentContainerStyle={styles.queueListContent}
                showsVerticalScrollIndicator={false}
                activationDistance={5}
                autoscrollSpeed={260}
                autoscrollThreshold={60}
                dragHitSlop={{ top: -2, bottom: -2, left: 0, right: 0 }}
                ListEmptyComponent={
                    <View style={styles.queueEmptyWrap}>
                        <Text style={[styles.queueTrackArtist, { color: textColorB3 }]}>No hay canciones en la cola</Text>
                    </View>
                }
                animationConfig={{
                    damping: 28,
                    stiffness: 380,
                    mass: 0.3,
                    overshootClamping: true,
                } as any}
            />
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    queueOverlay: {
        position: 'absolute',
        left: 10,
        right: 10,
        top: 74,
        bottom: 20,
        zIndex: 50,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.18)',
        overflow: 'hidden',
    },
    queueHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingTop: 8,
    },
    queueTitle: {
        fontSize: 16,
        fontWeight: '700',
    },
    queueListContent: {
        paddingHorizontal: 8,
        paddingBottom: 8,
    },
    queueRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 12,
        marginBottom: 4,
        paddingLeft: 12,
    },
    queueTrackInfo: {
        flex: 1,
        paddingVertical: 8,
    },
    queueTrackTitle: {
        fontSize: 14,
        fontWeight: '600',
    },
    queueTrackArtist: {
        fontSize: 12,
        marginTop: 2,
    },
    queueRemoveBtn: {
        margin: 0,
    },
    queueDragHandle: {
        width: 24,
        height: 24,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 3,
        marginRight: 2,
    },
    queueDragLine: {
        width: 14,
        height: 1.5,
        borderRadius: 1,
    },
    queueEmptyWrap: {
        paddingVertical: 24,
        alignItems: 'center',
    },
});
