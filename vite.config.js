import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

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

// Build identifier shown in Settings: "<git short sha> · <YYYY-MM-DD>".
// GitHub Actions' checkout provides git; falls back to "dev" without it.
function buildVersion() {
  let sha = 'dev';
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev';
  } catch { /* not a git checkout */ }
  const date = new Date().toISOString().slice(0, 10);
  return `${sha} · ${date}`;
}

const base = resolveBase();

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion()),
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt': the new service worker waits until the app tells it to take over
      // (see src/lib/updates.js), so a reload never happens mid-entry.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/*.png'],
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
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // svg/png come in once via includeAssets above; listing them here too
        // would duplicate every icon in the precache manifest.
        globPatterns: ['**/*.{js,css,html,ico,webp}'],
        navigateFallback: base + 'index.html',
        navigateFallbackDenylist: [/^\/api\//]
      },
      devOptions: { enabled: false }
    })
  ],
  server: { host: '0.0.0.0', port: 5173 },
  preview: { host: '0.0.0.0', port: 4173 }
});
