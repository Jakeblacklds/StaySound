import { usePlayerStore } from '@/src/stores';
import type { Track } from '@/src/types';
import React, { useCallback, useMemo } from 'react';

import { QueueOverlay, type QueueOverlayTrack } from './QueueOverlay';

type PlayerQueueOverlayLayerProps = {
  visible: boolean;
  currentTrackId: string;
  accentColor: string;
  textColor: string;
  backgroundColor: string;
  animStyle: any;
  onClose: () => void;
};

const QUEUE_LIMIT = 50;

function decorateQueueTrack(track: Track, index: number): QueueOverlayTrack {
  return {
    ...track,
    _queueKey: `${track.id}-${index}`,
    _originalIndex: index,
  };
}

export const PlayerQueueOverlayLayer = React.memo(function PlayerQueueOverlayLayer({
  visible,
  currentTrackId,
  accentColor,
  textColor,
  backgroundColor,
  animStyle,
  onClose,
}: PlayerQueueOverlayLayerProps) {
  const queue = usePlayerStore(state => state.queue);
  const queueIndex = usePlayerStore(state => state.queueIndex);
  const skipTo = usePlayerStore(state => state.skipTo);
  const removeFromQueue = usePlayerStore(state => state.removeFromQueue);
  const reorderQueue = usePlayerStore(state => state.reorderQueue);

  const resolvedCurrentIndex = useMemo(() => {
    if (!queue || queue.length === 0) {
      return -1;
    }

    if (queueIndex >= 0 && queueIndex < queue.length) {
      return queueIndex;
    }

    const trackIndex = queue.findIndex(track => track.id === currentTrackId);
    return trackIndex >= 0 ? trackIndex : 0;
  }, [currentTrackId, queue, queueIndex]);

  const currentQueueTrack = useMemo(() => {
    if (!visible || resolvedCurrentIndex < 0 || resolvedCurrentIndex >= queue.length) {
      return null;
    }

    return decorateQueueTrack(queue[resolvedCurrentIndex], resolvedCurrentIndex);
  }, [queue, resolvedCurrentIndex, visible]);

  const upcomingQueue = useMemo(() => {
    if (!visible || resolvedCurrentIndex < 0 || queue.length === 0) {
      return [];
    }

    return queue
      .slice(resolvedCurrentIndex + 1, resolvedCurrentIndex + 1 + QUEUE_LIMIT)
      .map((track, offset) => decorateQueueTrack(track, resolvedCurrentIndex + 1 + offset));
  }, [queue, resolvedCurrentIndex, visible]);

  const handleTrackPress = useCallback((item: QueueOverlayTrack) => {
    void skipTo(item._originalIndex);
    onClose();
  }, [onClose, skipTo]);

  const handleRemove = useCallback((item: QueueOverlayTrack) => {
    removeFromQueue(item._originalIndex);
  }, [removeFromQueue]);

  const handleReorder = useCallback((from: number, to: number) => {
    const baseIndex = resolvedCurrentIndex + 1;
    void reorderQueue(baseIndex + from, baseIndex + to);
  }, [reorderQueue, resolvedCurrentIndex]);

  if (!visible) {
    return null;
  }

  return (
    <QueueOverlay
      currentTrack={currentQueueTrack}
      upcomingQueue={upcomingQueue}
      accentColor={accentColor}
      textColor={textColor}
      backgroundColor={backgroundColor}
      animStyle={animStyle}
      onClose={onClose}
      onTrackPress={handleTrackPress}
      onRemove={handleRemove}
      onReorder={handleReorder}
    />
  );
});
