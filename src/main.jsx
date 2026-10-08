import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './index.css';
import { ensureSeed } from './db/seed.js';
import { installUpdater } from './lib/updates.js';

ensureSeed().catch(err => console.error('seed failed', err));

if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist().catch(()=>{}); }).catch(()=>{});
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    import('virtual:pwa-register').then(({ registerSW }) => {
      installUpdater(registerSW);
    }).catch(()=>{});
  });
}
