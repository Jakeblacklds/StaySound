import { Buffer } from 'buffer';
// @ts-ignore
window.Buffer = Buffer;

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';
import './styles/circulo.css';
// Después de circulo.css a propósito: la pestaña de Descargas tiene su propio
// layout y necesita ganarle a las reglas genéricas de `.downloads-panel`.
import './styles/downloads.css';

// Tauri's transparent macOS window needs a genuinely transparent page root.
// Keep this opt-in so the regular website/PWA retains its opaque fallback.
const isTauriShell = '__TAURI_INTERNALS__' in window;
if (isTauriShell) {
  document.documentElement.classList.add('tauri-shell');
  if (/Macintosh|Mac OS X/i.test(navigator.userAgent)) {
    document.documentElement.classList.add('platform-macos');
  }
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('StaySound Web root element was not found.');
}

// am-lyrics starts its network lookup from connectedCallback(). React StrictMode
// intentionally mounts/unmounts components twice in development, which makes
// the custom element start the same lyrics lookup twice in the Tauri shell.
// Keep StrictMode for the regular web app, but avoid duplicate network work in
// the desktop webview.
createRoot(root).render(
  isTauriShell ? <App /> : (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  ),
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker.register('/sw-amazon.js')
      .then((reg) => {
        console.log('[StaySound SW] registered:', reg);

        const activateWaitingWorker = () => {
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
        };

        activateWaitingWorker();
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              worker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        reg.update().catch(() => undefined);
      })
      .catch((err) => console.error('[StaySound SW] registration failed:', err));
  });
}
