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
  onToggleShortcutHelp: () => void;
  getVolume: () => number;
}

/** The shortcut map, in the order it reads best on the help sheet. Kept beside
    the handler so a new shortcut cannot ship undocumented. */
export const KEYBOARD_SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Espacio', action: 'Reproducir o pausar' },
  { keys: '←  →', action: 'Retroceder o avanzar 5 segundos' },
  { keys: '⇧ ←  ⇧ →', action: 'Canción anterior o siguiente' },
  { keys: 'N  ·  P', action: 'Siguiente · anterior' },
  { keys: '↑  ↓', action: 'Subir o bajar el volumen' },
  { keys: 'M', action: 'Silenciar' },
  { keys: 'F', action: 'Abrir o cerrar el reproductor completo' },
  { keys: 'Q', action: 'Abrir o cerrar la cola' },
  { keys: '?', action: 'Mostrar esta lista' },
];

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  useEffect(() => {
    let savedVolume = 0;

    function handleKeyDown(event: KeyboardEvent) {
      // Don't intercept when user is typing in an input
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Matched on event.key, not event.code: "?" sits on a different physical
      // key across the US, Spanish and Latin American layouts this app is used
      // on, and only event.key reflects what the user actually typed.
      if (event.key === '?' && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        handlers.onToggleShortcutHelp();
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
