import React, { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import DraggableFlatList, {
  ScaleDecorator,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import { IconButton, Text } from 'react-native-paper';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import type { Track } from '@/src/types';

export type QueueOverlayTrack = Track & {
  _queueKey: string;
  _originalIndex: number;
};

export function QueueItemDecorator({
  children,
  accentColor,
  isPressed,
}: {
  children: React.ReactNode;
  accentColor: string;
  isPressed: boolean;
}) {
  const activeAnim = useSharedValue(0);

  React.useEffect(() => {
    if (isPressed) {
      activeAnim.value = withSpring(1, { damping: 18, stiffness: 280, mass: 0.35 });
    } else {
      activeAnim.value = withTiming(0, { duration: 150 });
    }
  }, [isPressed, activeAnim]);

  const decoratorStyle = useAnimatedStyle(() => {
    const progress = activeAnim.value;
    return {
      transform: [{ scale: interpolate(progress, [0, 1], [1, 0.99]) }],
      backgroundColor: progress > 0.01 ? `${accentColor}12` : 'transparent',
      borderRadius: 14,
    };
  });

  return <Animated.View style={decoratorStyle}>{children}</Animated.View>;
}

const AnimatedBar = ({
  delay,
  accentColor,
  minHeight,
  maxHeight,
}: {
  delay: number;
  accentColor: string;
  minHeight: number;
  maxHeight: number;
}) => {
  const heightAnim = useSharedValue(minHeight);

  useEffect(() => {
    const timer = setTimeout(() => {
      heightAnim.value = withRepeat(
        withSequence(
          withTiming(maxHeight, { duration: 400 }),
          withTiming(minHeight, { duration: 400 }),
        ),
        -1,
        true,
      );
    }, delay);

    return () => clearTimeout(timer);
  }, [delay, heightAnim, maxHeight, minHeight]);

  const style = useAnimatedStyle(() => ({
    height: heightAnim.value,
    backgroundColor: accentColor,
  }));

  return <Animated.View style={[styles.playingBar, style]} />;
};

const PlayingIndicator = ({ accentColor }: { accentColor: string }) => (
  <View style={styles.playingIndicator}>
    <AnimatedBar delay={0} accentColor={accentColor} minHeight={4} maxHeight={12} />
    <AnimatedBar delay={150} accentColor={accentColor} minHeight={6} maxHeight={16} />
    <AnimatedBar delay={300} accentColor={accentColor} minHeight={4} maxHeight={14} />
  </View>
);

interface QueueRowProps {
  item: QueueOverlayTrack;
  isCurrent: boolean;
  isDragActive?: boolean;
  draggable?: boolean;
  accentColor: string;
  textColor: string;
  accentBg30: string;
  textColorB3: string;
  textColor80: string;
  onPress?: (item: QueueOverlayTrack) => void;
  onRemove?: (item: QueueOverlayTrack) => void;
  onDrag?: () => void;
}

const QueueRow = React.memo(function QueueRow({
  item,
  isCurrent,
  isDragActive = false,
  draggable = false,
  accentColor,
  textColor,
  accentBg30,
  textColorB3,
  textColor80,
  onPress,
  onRemove,
  onDrag,
}: QueueRowProps) {
  const [isPressed, setIsPressed] = React.useState(false);

  const triggerLightHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
  }, []);

  const handleRemovePress = useCallback(() => {
    if (!onRemove) {
      return;
    }
    onRemove(item);
  }, [item, onRemove]);

  const handleDragStart = useCallback(() => {
    triggerLightHaptic();
    onDrag?.();
  }, [onDrag, triggerLightHaptic]);

  return (
    <QueueItemDecorator accentColor={accentColor} isPressed={isPressed && !isDragActive}>
      <View style={styles.queueRowWrap}>
        <Animated.View
          style={[
            styles.queueRow,
            isCurrent && { backgroundColor: accentBg30 },
            isDragActive && styles.queueRowActive,
            isDragActive && { borderColor: `${accentColor}44`, backgroundColor: `${accentColor}16` },
          ]}
        >
          {isCurrent ? (
            <PlayingIndicator accentColor={accentColor} />
          ) : (
            <View style={styles.queueOrderWrap}>
              <Text style={[styles.queueOrderText, { color: textColor80 }]}>
                {item._originalIndex + 1}
              </Text>
            </View>
          )}

          <Pressable
            style={styles.queueTrackInfo}
            onPress={onPress ? () => onPress(item) : undefined}
            onPressIn={() => setIsPressed(true)}
            onPressOut={() => setIsPressed(false)}
            disabled={isDragActive}
          >
            <Text
              numberOfLines={1}
              style={[styles.queueTrackTitle, { color: isCurrent ? accentColor : textColor }]}
            >
              {item.title}
            </Text>
            <Text numberOfLines={1} style={[styles.queueTrackArtist, { color: textColorB3 }]}>
              {item.artist}
            </Text>
          </Pressable>

          {!isCurrent && onRemove ? (
            <Pressable
              style={styles.removeActionButtonInline}
              onPress={handleRemovePress}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <IconButton
                icon="trash-can-outline"
                size={18}
                iconColor="#FF4D4D"
                style={styles.queueIconButton}
              />
            </Pressable>
          ) : null}

          {!isCurrent && draggable && onDrag ? (
            <Pressable
              onLongPress={handleDragStart}
              delayLongPress={110}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.dragHandle}
            >
              <IconButton
                icon="drag"
                size={20}
                iconColor={isDragActive ? accentColor : textColor80}
                style={styles.queueIconButton}
              />
            </Pressable>
          ) : null}
        </Animated.View>
      </View>
    </QueueItemDecorator>
  );
});

interface QueueOverlayProps {
  currentTrack: QueueOverlayTrack | null;
  upcomingQueue: QueueOverlayTrack[];
  accentColor: string;
  textColor: string;
  backgroundColor: string;
  animStyle: any;
  onClose: () => void;
  onTrackPress: (item: QueueOverlayTrack) => void;
  onRemove: (item: QueueOverlayTrack) => void;
  onReorder: (from: number, to: number) => void;
}

export function QueueOverlay({
  currentTrack,
  upcomingQueue,
  accentColor,
  textColor,
  backgroundColor,
  animStyle,
  onClose,
  onTrackPress,
  onRemove,
  onReorder,
}: QueueOverlayProps) {
  const accentBg30 = React.useMemo(() => `${accentColor}20`, [accentColor]);
  const textColor80 = React.useMemo(() => `${textColor}80`, [textColor]);
  const textColorB3 = React.useMemo(() => `${textColor}B3`, [textColor]);

  const triggerSelectionHaptic = useCallback(() => {
    Haptics.selectionAsync().catch(() => { });
  }, []);

  const triggerSuccessHaptic = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => { });
  }, []);

  const handleReorder = useCallback((from: number, to: number) => {
    if (from === to) return;
    triggerSelectionHaptic();
    onReorder(from, to);
  }, [onReorder, triggerSelectionHaptic]);

  const handleRemove = useCallback((item: QueueOverlayTrack) => {
    triggerSuccessHaptic();
    onRemove(item);
  }, [onRemove, triggerSuccessHaptic]);

  const renderQueueItem = useCallback(({ item, drag, isActive }: RenderItemParams<QueueOverlayTrack>) => (
    <ScaleDecorator activeScale={1.02}>
      <QueueRow
        item={item}
        isCurrent={false}
        isDragActive={isActive}
        draggable
        accentColor={accentColor}
        textColor={textColor}
        accentBg30={accentBg30}
        textColorB3={textColorB3}
        textColor80={textColor80}
        onPress={onTrackPress}
        onRemove={handleRemove}
        onDrag={drag}
      />
    </ScaleDecorator>
  ), [accentBg30, accentColor, handleRemove, onTrackPress, textColor, textColor80, textColorB3]);

  return (
    <Animated.View style={[styles.queueOverlay, { backgroundColor }, animStyle]}>
      <View style={styles.queueHeader}>
        <View>
          <Text style={[styles.queueTitle, { color: textColor }]}>En cola</Text>
          <Text style={[styles.queueSubtitle, { color: textColor80 }]}>
            {upcomingQueue.length} siguientes
          </Text>
        </View>
        <IconButton icon="close" size={24} iconColor={textColor} onPress={onClose} />
      </View>

      {currentTrack ? (
        <>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: textColor80 }]}>Sonando ahora</Text>
          </View>
          <QueueRow
            item={currentTrack}
            isCurrent
            accentColor={accentColor}
            textColor={textColor}
            accentBg30={accentBg30}
            textColorB3={textColorB3}
            textColor80={textColor80}
          />
        </>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionLabel, { color: textColor80 }]}>A continuacion</Text>
      </View>

      <View style={styles.listContainer}>
        <DraggableFlatList
          data={upcomingQueue}
          keyExtractor={(item) => item._queueKey}
          renderItem={renderQueueItem}
          onDragEnd={({ from, to }) => handleReorder(from, to)}
          activationDistance={8}
          autoscrollSpeed={180}
          autoscrollThreshold={80}
          contentContainerStyle={styles.queueListContent}
          showsVerticalScrollIndicator={false}
          containerStyle={styles.queueListContainer}
          ListEmptyComponent={(
            <View style={styles.queueEmptyWrap}>
              <Text style={[styles.queueTrackArtist, { color: textColorB3 }]}>
                Nada despues de esta cancion
              </Text>
            </View>
          )}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  queueOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 56,
    bottom: 0,
    zIndex: 50,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 0,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 18,
  },
  queueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 2,
  },
  queueTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  queueSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 6,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  listContainer: {
    flex: 1,
  },
  queueListContainer: {
    flex: 1,
  },
  queueListContent: {
    paddingHorizontal: 10,
    paddingBottom: 32,
    paddingTop: 0,
  },
  queueRow: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 5,
    paddingLeft: 10,
    paddingRight: 2,
    marginHorizontal: 8,
    marginVertical: 1,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  queueRowWrap: {
    position: 'relative',
    marginHorizontal: 8,
    marginVertical: 1,
  },
  removeActionButtonInline: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,77,77,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  queueRowActive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.24,
    shadowRadius: 20,
    elevation: 12,
  },
  queueOrderWrap: {
    width: 24,
    alignItems: 'center',
    marginRight: 8,
  },
  queueOrderText: {
    fontSize: 11,
    fontWeight: '700',
  },
  queueTrackInfo: {
    flex: 1,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  queueTrackTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 3,
    letterSpacing: -0.1,
  },
  queueTrackArtist: {
    fontSize: 13,
  },
  queueIconButton: {
    margin: 0,
  },
  dragHandle: {
    justifyContent: 'center',
  },
  queueEmptyWrap: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  playingIndicator: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    width: 14,
    height: 16,
    marginRight: 10,
  },
  playingBar: {
    width: 3,
    borderRadius: 1.5,
  },
});
