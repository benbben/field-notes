import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { ensureSeed } from './db/seed.js';

ensureSeed().catch(()=>{});

// Request persistent storage early — best-effort.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist(); });
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

// PWA SW registration — vite-plugin-pwa generates an injected register; do it manually for control.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    import('virtual:pwa-register').then(({ registerSW }) => {
      registerSW({ immediate: true });
    }).catch(()=>{});
  });
}
