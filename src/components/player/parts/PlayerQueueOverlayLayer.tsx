import { usePlayerStore } from '@/src/stores';
import type { Track } from '@/src/types/audio';
import React, { useCallback, useState } from 'react';

import { QueueOverlay } from './QueueOverlay';

type PlayerQueueOverlayLayerProps = {
  visible: boolean;
  currentTrackId: string;
  accentColor: string;
  textColor: string;
  backgroundColor: string;
  animStyle: any;
  onClose: () => void;
};

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
  const skipTo = usePlayerStore(state => state.skipTo);
  const removeFromQueue = usePlayerStore(state => state.removeFromQueue);
  const [queueDraft, setQueueDraft] = useState(queue);
  const [visibleCount, setVisibleCount] = useState(25);

  React.useEffect(() => {
    if (visible) {
      setQueueDraft(queue);
      setVisibleCount(25);
    }
  }, [queue, visible]);

  const paginatedQueue = React.useMemo(() => queueDraft.slice(0, visibleCount), [queueDraft, visibleCount]);

  const loadMoreQueue = useCallback(() => {
    if (visibleCount < queueDraft.length) {
      setVisibleCount(prev => Math.min(prev + 25, queueDraft.length));
    }
  }, [queueDraft.length, visibleCount]);

  const handleQueueDragEnd = useCallback(({ data }: { data: Track[] }) => {
    const fullQueue = [...queueDraft];
    fullQueue.splice(0, data.length, ...data);
    const newIndex = fullQueue.findIndex(track => track.id === currentTrackId);
    if (newIndex < 0) return;
    setQueueDraft(fullQueue);
    usePlayerStore.setState({ queue: fullQueue, queueIndex: newIndex });
  }, [currentTrackId, queueDraft]);

  const handleTrackPress = useCallback((idx: number) => {
    void skipTo(idx);
    onClose();
  }, [onClose, skipTo]);

  if (!visible) {
    return null;
  }

  return (
    <QueueOverlay
      queue={paginatedQueue}
      currentTrackId={currentTrackId}
      accentColor={accentColor}
      textColor={textColor}
      backgroundColor={backgroundColor}
      animStyle={animStyle}
      onClose={onClose}
      onTrackPress={handleTrackPress}
      onRemove={removeFromQueue}
      onDragEnd={handleQueueDragEnd}
      loadMore={loadMoreQueue}
    />
  );
});
