import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Base path resolution:
// 1. VITE_BASE env (explicit override; used by CI)
// 2. /<basename>/ where <basename> is auto-detected from VITE_REPO_NAME
//    (CI sets this from ${{ github.event.repository.name }}, ensuring forks "just work")
// 3. '/' for local dev
function resolveBase() {
  if (process.env.VITE_BASE) return process.env.VITE_BASE;
  const repo = process.env.VITE_REPO_NAME;
  if (repo) return `/${repo}/`;
  return '/';
}

const base = resolveBase();

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name: 'Field Notes',
        short_name: 'Field Notes',
        description: 'Personal journaling tool. Private.',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        orientation: 'portrait',
        scope: base,
        start_url: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webp}'],
        navigateFallback: base + 'index.html',
        navigateFallbackDenylist: [/^\/api\//]
      },
      devOptions: { enabled: false }
    })
  ],
  server: { host: '0.0.0.0', port: 5173 },
  preview: { host: '0.0.0.0', port: 4173 }
});
