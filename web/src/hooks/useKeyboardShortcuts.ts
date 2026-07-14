import { useEffect } from 'react';

interface KeyboardShortcutHandlers {
  onTogglePlayback: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeekForward: () => void;
  onSeekBackward: () => void;
  onVolumeUp: () => void;
  onVolumeDown: () => void;
  onToggleMute: () => void;
  onToggleFullPlayer: () => void;
  onToggleQueue: () => void;
  getVolume: () => number;
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  useEffect(() => {
    let savedVolume = 0;

    function handleKeyDown(event: KeyboardEvent) {
      // Don't intercept when user is typing in an input
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      switch (event.code) {
        case 'Space':
          event.preventDefault();
          handlers.onTogglePlayback();
          break;
        case 'ArrowRight':
          if (event.shiftKey) {
            handlers.onNext();
          } else {
            handlers.onSeekForward();
          }
          break;
        case 'ArrowLeft':
          if (event.shiftKey) {
            handlers.onPrevious();
          } else {
            handlers.onSeekBackward();
          }
          break;
        case 'ArrowUp':
          event.preventDefault();
          handlers.onVolumeUp();
          break;
        case 'ArrowDown':
          event.preventDefault();
          handlers.onVolumeDown();
          break;
        case 'KeyM':
          if (!event.metaKey && !event.ctrlKey) {
            const currentVol = handlers.getVolume();
            if (currentVol > 0) {
              savedVolume = currentVol;
            }
            handlers.onToggleMute();
          }
          break;
        case 'KeyF':
          if (!event.metaKey && !event.ctrlKey) {
            handlers.onToggleFullPlayer();
          }
          break;
        case 'KeyQ':
          if (!event.metaKey && !event.ctrlKey) {
            handlers.onToggleQueue();
          }
          break;
        case 'KeyN':
          if (!event.metaKey && !event.ctrlKey) {
            handlers.onNext();
          }
          break;
        case 'KeyP':
          if (!event.metaKey && !event.ctrlKey) {
            handlers.onPrevious();
          }
          break;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handlers]);
}
