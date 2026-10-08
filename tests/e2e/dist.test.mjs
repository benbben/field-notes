// Build-output guards. Lives under tests/e2e so tests/run.mjs runs it AFTER `vite build`
// (unit tests run before the build and must not read dist/). No browser needed.
//
//   dist-1. dist/index.html: apple-touch-icon link resolves under the base and the file exists in dist/
//   dist-2. dist/manifest.webmanifest: icons 192 any, 512 any, 512 maskable (icons/icon-512-maskable.png)
//   dist-3. dist/sw.js is a prompt-mode worker (SKIP_WAITING message handler, no unconditional skipWaiting)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const APPLE_TOUCH_HREF = 'icons/apple-touch-icon.png';
const linkTags = (html) => html.match(/<link\b[^>]*>/gi) ?? [];
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
const appleTouchLinks = (html) => linkTags(html).filter(t => /^apple-touch-icon$/i.test(attr(t, 'rel') ?? ''));

describe('build output (dist/)', () => {
  test('dist-1. dist/index.html: apple-touch-icon link resolves under the base and the file exists in dist/', () => {
    assert.ok(existsSync(path.join(ROOT, 'dist', 'index.html')), 'dist/index.html must exist (build first)');
    const html = read('dist/index.html');
    const manifest = JSON.parse(read('dist/manifest.webmanifest'));
    const base = manifest.scope ?? manifest.start_url ?? '/';
    assert.ok(base.startsWith('/') && base.endsWith('/'), `manifest scope/start_url must look like a base path, got ${JSON.stringify(base)}`);

    const links = appleTouchLinks(html);
    assert.equal(links.length, 1, `dist/index.html must have exactly one <link rel="apple-touch-icon">, found: ${links.join(' | ') || '(none)'}`);
    const href = attr(links[0], 'href');
    assert.ok(href, `apple-touch-icon link has an href: ${links[0]}`);
    // Resolve the href the way a browser would, against a page served at the base.
    const resolved = new URL(href, `http://example.test${base}`).pathname;
    assert.equal(resolved, `${base}${APPLE_TOUCH_HREF}`, `href ${JSON.stringify(href)} resolved against base ${base}`);
    const onDisk = path.join(ROOT, 'dist', ...APPLE_TOUCH_HREF.split('/'));
    assert.ok(existsSync(onDisk) && statSync(onDisk).size > 0, `dist/${APPLE_TOUCH_HREF} must exist in the build output`);
  });

  test('dist-2. dist/manifest.webmanifest: icons 192 any, 512 any, 512 maskable (icons/icon-512-maskable.png)', () => {
    const manifest = JSON.parse(read('dist/manifest.webmanifest'));
    assert.ok(Array.isArray(manifest.icons), 'manifest.icons is an array');
    const find = (sizes, purpose) => manifest.icons.find(i => i.sizes === sizes && (i.purpose ?? 'any') === purpose);
    const summary = JSON.stringify(manifest.icons);

    const i192 = find('192x192', 'any');
    assert.ok(i192, `manifest needs a 192x192 purpose=any icon; icons: ${summary}`);
    const i512 = find('512x512', 'any');
    assert.ok(i512, `manifest needs a 512x512 purpose=any icon; icons: ${summary}`);
    const mask = find('512x512', 'maskable');
    assert.ok(mask, `manifest needs a 512x512 purpose=maskable icon; icons: ${summary}`);
    assert.equal(mask.src, 'icons/icon-512-maskable.png');
    for (const icon of [i192, i512, mask]) {
      assert.equal(icon.type, 'image/png', `icon ${icon.src} type`);
      const onDisk = path.join(ROOT, 'dist', ...icon.src.replace(/^\//, '').split('/'));
      assert.ok(existsSync(onDisk) && statSync(onDisk).size > 0, `manifest icon ${icon.src} must exist in dist/`);
    }
    assert.equal(manifest.theme_color, '#0a0a0a');
    assert.equal(manifest.background_color, '#0a0a0a');
  });

  test('dist-3. dist/sw.js is a prompt-mode worker: skipWaiting only inside the SKIP_WAITING message handler', () => {
    const sw = read('dist/sw.js');
    assert.match(sw, /SKIP_WAITING/, 'prompt-mode worker must listen for the SKIP_WAITING message');
    const occurrences = sw.match(/skipWaiting\(\)/g) ?? [];
    assert.equal(occurrences.length, 1, `expected exactly one skipWaiting() call (inside the message handler), found ${occurrences.length}`);
    const at = sw.indexOf('skipWaiting()');
    const before = sw.slice(Math.max(0, at - 400), at);
    assert.match(before, /SKIP_WAITING/, 'the single skipWaiting() call must be guarded by the SKIP_WAITING message check');
    assert.doesNotMatch(sw, /^self\.skipWaiting\(\)/m, 'no unconditional top-level self.skipWaiting() (that would be autoUpdate mode)');
  });
});
