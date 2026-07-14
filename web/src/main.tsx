import { Buffer } from 'buffer';
// @ts-ignore
window.Buffer = Buffer;

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('StaySound Web root element was not found.');
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
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
