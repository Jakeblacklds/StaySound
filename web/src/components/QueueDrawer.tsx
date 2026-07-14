import { formatDuration } from '@staysound/services/metadataService';
import type { Track } from '@staysound/types/audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CloseIcon, PlayingBars } from './icons';

interface QueueDrawerProps {
  queue: Track[];
  currentIndex: number;
  isPlaying: boolean;
  onPlayIndex: (index: number) => void;
  onClose: () => void;
}

export function QueueDrawer({ queue, currentIndex, isPlaying, onPlayIndex, onClose }: QueueDrawerProps) {
  const [closing, setClosing] = useState(false);
  const activeRef = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, 200);
  }, [onClose]);

  // Scroll to active track on mount
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, []);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [handleClose]);

  return (
    <>
      <div className="queue-drawer-overlay" onClick={handleClose} />
      <aside className={`queue-drawer ${closing ? 'closing' : ''}`}>
        <div className="queue-header">
          <h3>Cola de reproducción</h3>
          <button onClick={handleClose} aria-label="Cerrar cola"><CloseIcon size={18} /></button>
        </div>
        <div className="queue-list">
          {queue.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              La cola está vacía. Reproduce una canción para empezar.
            </div>
          ) : (
            queue.map((track, index) => {
              const active = index === currentIndex;
              return (
                <button
                  key={`${track.id}-${index}`}
                  ref={active ? activeRef : undefined}
                  className={`queue-item ${active ? 'active' : ''}`}
                  onClick={() => onPlayIndex(index)}
                >
                  <span className="q-index">
                    {active ? <PlayingBars paused={!isPlaying} /> : index + 1}
                  </span>
                  <span className="q-thumb">
                    {track.artwork ? (
                      <img src={track.artwork} alt="" loading="lazy" />
                    ) : (
                      <span className="q-thumb-letter">
                        {track.title.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </span>
                  <span className="q-info">
                    <strong>{track.title}</strong>
                    <small>{track.artist}</small>
                  </span>
                  <span className="q-dur">{formatDuration(track.duration)}</span>
                </button>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}
