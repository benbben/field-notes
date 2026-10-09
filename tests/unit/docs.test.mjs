// DOCS + REPO GUARDS (unit only). Reads repo files with node:fs and runs git / scripts via
// node:child_process, cwd = repo root. No DOM, no IndexedDB, no browser.
//
//   1. SETUP.md     (1a-1d)  iOS data-loss warning ordering, icon-refresh section, update line
//   2. CHANGELOG.md          standing schema rule + v1.1 heading
//   3. README.md             documents npm install / npm test, links SETUP.md
//   4. deploy.yml            verify-icons step before build, node 20
//   5. package.json          test script, dev deps, version
//   6. icons/PWA wiring (6a-6e) index.html, vite.config.js manifest, public/icons (dist/ checks: tests/e2e/dist.test.mjs)
//   7. scripts exist and parse (run.mjs executes verify-icons itself)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE_TIMEOUT = 10_000;   // tests that only read files
const PROCESS_TIMEOUT = 60_000; // tests that spawn git / node

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const lf = (s) => s.replace(/\r\n/g, '\n');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Slice a markdown section: from the heading line matching `headingRe` up to (not including) the next
 * heading of the same or a higher level. Returns { heading, body, lines } or throws if not found.
 */
function section(md, headingRe) {
  const lines = lf(md).split('\n');
  const start = lines.findIndex(l => /^#{1,6}\s/.test(l) && headingRe.test(l));
  if (start < 0) throw new Error(`no markdown heading matches ${headingRe}`);
  const level = lines[start].match(/^(#{1,6})\s/)[1].length;
  const stopRe = new RegExp(`^#{1,${level}}\\s`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (stopRe.test(lines[i])) { end = i; break; }
  }
  const bodyLines = lines.slice(start + 1, end);
  return { heading: lines[start], body: bodyLines.join('\n'), lines: bodyLines };
}

// ---------------------------------------------------------------- 1. SETUP.md

const IOS_WARNING = '**Deleting the home-screen app deletes its data on iOS. Export JSON from Settings first.**';
const REMOVE_RE = /Remove App|remove the home-screen app/i;
const UPDATE_LINE = 'The app updates itself on launch. Fully close and reopen it after a new version is published.';

describe('docs + repo guards', () => {
  test('1a. SETUP.md: "Blank page" section has the exact iOS warning line before the first Remove App', { timeout: FILE_TIMEOUT }, () => {
    const sec = section(read('SETUP.md'), /Blank page/i);
    assert.ok(sec.lines.some(l => l.trim() === IOS_WARNING),
      `section ${JSON.stringify(sec.heading)} must contain the exact line ${IOS_WARNING}`);
    const warnAt = sec.body.indexOf(IOS_WARNING);
    const removeAt = sec.body.search(REMOVE_RE);
    assert.ok(removeAt >= 0, `section ${JSON.stringify(sec.heading)} must mention ${REMOVE_RE} (the step the warning guards)`);
    assert.ok(warnAt >= 0 && warnAt < removeAt,
      `warning (index ${warnAt}) must come before the first ${REMOVE_RE} (index ${removeAt}) in section ${JSON.stringify(sec.heading)}`);
  });

  test('1b. SETUP.md: "I forgot my passcode" section has the exact iOS warning line before the first remove step', { timeout: FILE_TIMEOUT }, () => {
    const sec = section(read('SETUP.md'), /I forgot my passcode/i);
    assert.ok(sec.lines.some(l => l.trim() === IOS_WARNING),
      `section ${JSON.stringify(sec.heading)} must contain the exact line ${IOS_WARNING}`);
    const warnAt = sec.body.indexOf(IOS_WARNING);
    const removeAt = sec.body.search(REMOVE_RE);
    assert.ok(removeAt >= 0, `section ${JSON.stringify(sec.heading)} must mention ${REMOVE_RE} (the step the warning guards)`);
    assert.ok(warnAt >= 0 && warnAt < removeAt,
      `warning (index ${warnAt}) must come before the first ${REMOVE_RE} (index ${removeAt}) in section ${JSON.stringify(sec.heading)}`);
  });

  test('1c. SETUP.md: "Updating the app icon" section mentions export, delete/remove, Add to Home Screen, import in that order', { timeout: FILE_TIMEOUT }, () => {
    const sec = section(read('SETUP.md'), /^#{1,6}\s+Updating the app icon\s*$/i);
    const steps = [
      ['export', /\bexport\b/i],
      ['delete/remove', /\b(delete|remove)\b/i],
      ['Add to Home Screen', /Add to Home Screen/],
      ['import', /\bimport\b/i],
    ];
    const found = steps.map(([name, re]) => [name, sec.body.search(re)]);
    for (const [name, at] of found) assert.ok(at >= 0, `section must mention ${name}; body:\n${sec.body}`);
    for (let i = 1; i < found.length; i++) {
      const [prevName, prevAt] = found[i - 1];
      const [name, at] = found[i];
      assert.ok(prevAt < at,
        `${prevName} (index ${prevAt}) must come before ${name} (index ${at}); order found: ${found.map(([n, a]) => `${n}@${a}`).join(', ')}`);
    }
  });

  test('1d. SETUP.md: contains the "updates itself on launch" line', { timeout: FILE_TIMEOUT }, () => {
    const lines = lf(read('SETUP.md')).split('\n');
    assert.ok(lines.some(l => l.trim() === UPDATE_LINE), `SETUP.md must contain the line ${JSON.stringify(UPDATE_LINE)}`);
  });

  // ---------------------------------------------------------------- 2. CHANGELOG.md

  test('2. CHANGELOG.md: standing db.version rule sentence (backticks optional) and a v1.1 heading', { timeout: FILE_TIMEOUT }, () => {
    const md = lf(read('CHANGELOG.md'));
    const RULE = 'Never modify an existing `db.version(N)` block. Schema changes add `db.version(N+1)` with an `.upgrade()`. '
      + 'Every schema change ships with a populated-DB migration test.';
    // Each backtick becomes optional; runs of spaces tolerate wrapping.
    const ruleRe = new RegExp(RULE.split('`').map(escapeRe).join('`?').replace(/ /g, '\\s+'));
    assert.match(md, ruleRe, `CHANGELOG.md must contain the standing rule: ${RULE}`);
    assert.match(md, /^#{1,6}\s+v1\.1\b/m, 'CHANGELOG.md must have a "v1.1" heading');
  });

  // ---------------------------------------------------------------- 3. README.md

  test('3. README.md: documents npm install / npm test and still points at SETUP.md', { timeout: FILE_TIMEOUT }, () => {
    const md = lf(read('README.md'));
    assert.match(md, /^npm install$/m, 'README must show `npm install`');
    assert.match(md, /^npm test$/m, 'README must show `npm test`');
    assert.match(md, /SETUP\.md/, 'README must link to SETUP.md');
  });

  // ---------------------------------------------------------------- 4. deploy.yml

  test('4. deploy.yml: verify-icons step runs after npm install and before npm run build; node-version 20', { timeout: FILE_TIMEOUT }, () => {
    const lines = lf(read('.github/workflows/deploy.yml')).split('\n');
    const idx = (re) => lines.findIndex(l => re.test(l));
    const install = idx(/^\s*-?\s*run:\s*npm (install|ci)\b/);
    const verify = idx(/^\s*-?\s*run:\s*node scripts\/verify-icons\.mjs\s*$/);
    const build = idx(/^\s*-?\s*run:\s*npm run build\s*$/);
    assert.ok(verify >= 0, 'deploy.yml must have a step with `run: node scripts/verify-icons.mjs`');
    assert.ok(build >= 0, 'deploy.yml must have a step with `run: npm run build`');
    assert.ok(install >= 0, 'deploy.yml must have an `npm install` / `npm ci` step (sharp is needed by verify-icons)');
    assert.ok(install < verify, `npm install (line ${install + 1}) must come before verify-icons (line ${verify + 1})`);
    assert.ok(verify < build, `verify-icons (line ${verify + 1}) must come before npm run build (line ${build + 1})`);
    const nodeVersion = lines.find(l => /^\s*node-version:/.test(l));
    assert.ok(nodeVersion, 'deploy.yml must set node-version');
    assert.match(nodeVersion, /^\s*node-version:\s*['"]?20(?:\.x)?['"]?\s*$/, `node-version must be 20, got ${JSON.stringify(nodeVersion.trim())}`);
  });

  // ---------------------------------------------------------------- 5. package.json

  test('5. package.json: test script, devDependencies (sharp, playwright, fake-indexeddb), version 1.1.1', { timeout: FILE_TIMEOUT }, () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.scripts?.test, 'node tests/run.mjs');
    for (const dep of ['sharp', 'playwright', 'fake-indexeddb']) {
      assert.equal(typeof pkg.devDependencies?.[dep], 'string', `devDependencies must include ${dep}`);
      assert.ok(pkg.devDependencies[dep].length > 0, `devDependencies.${dep} must be a non-empty range`);
    }
    assert.equal(pkg.version, '1.1.1');
  });

  // ---------------------------------------------------------------- 6. icons / PWA wiring

  const APPLE_TOUCH_HREF = 'icons/apple-touch-icon.png';
  const linkTags = (html) => html.match(/<link\b[^>]*>/gi) ?? [];
  const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
  const appleTouchLinks = (html) => linkTags(html).filter(t => /^apple-touch-icon$/i.test(attr(t, 'rel') ?? ''));

  test('6a. index.html: apple-touch-icon link href is icons/apple-touch-icon.png', { timeout: FILE_TIMEOUT }, () => {
    const links = appleTouchLinks(read('index.html'));
    assert.equal(links.length, 1, `index.html must have exactly one <link rel="apple-touch-icon">, found: ${links.join(' | ') || '(none)'}`);
    assert.equal(attr(links[0], 'href'), APPLE_TOUCH_HREF, `tag was ${links[0]}`);
  });

  // 6b/6c (dist/index.html and dist/manifest.webmanifest) live in tests/e2e/dist.test.mjs,
  // which tests/run.mjs executes after `vite build`; unit tests must not depend on dist/.

  test('6b. vite.config.js: manifest declares 192 any, 512 any, 512 maskable icons', { timeout: FILE_TIMEOUT }, () => {
    const src = read('vite.config.js');
    assert.match(src, /src:\s*['"]icons\/icon-192\.png['"][^}]*purpose:\s*['"]any['"]/);
    assert.match(src, /src:\s*['"]icons\/icon-512\.png['"][^}]*purpose:\s*['"]any['"]/);
    assert.match(src, /src:\s*['"]icons\/icon-512-maskable\.png['"][^}]*purpose:\s*['"]maskable['"]/);
  });

  test('6d. public/icons: the four PNGs exist and start with the PNG signature', { timeout: FILE_TIMEOUT }, () => {
    const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (const name of ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png']) {
      const abs = path.join(ROOT, 'public', 'icons', name);
      assert.ok(existsSync(abs), `public/icons/${name} must exist`);
      const buf = readFileSync(abs);
      assert.ok(buf.length > PNG_SIG.length && buf.subarray(0, 8).equals(PNG_SIG), `public/icons/${name} must be a PNG (${buf.length} bytes)`);
    }
  });

  test('6e. vite.config.js: registerType prompt and includeAssets [favicon.svg, icons/*.png]', { timeout: FILE_TIMEOUT }, () => {
    const src = read('vite.config.js');
    assert.match(src, /registerType\s*:\s*['"]prompt['"]/, "vite.config.js must set registerType: 'prompt'");
    assert.match(src, /includeAssets\s*:\s*\[\s*['"]favicon\.svg['"]\s*,\s*['"]icons\/\*\.png['"]\s*,?\s*\]/,
      "vite.config.js must set includeAssets: ['favicon.svg', 'icons/*.png']");
  });

  // ---------------------------------------------------------------- 7. verify-icons.mjs

  // tests/run.mjs runs scripts/verify-icons.mjs itself as its first group and fails the suite on a
  // non-zero exit; here we only make sure the script (and its generator) are present and parse.
  test('7. scripts/verify-icons.mjs and scripts/make-icons.mjs exist and parse', { timeout: PROCESS_TIMEOUT }, () => {
    for (const rel of ['scripts/verify-icons.mjs', 'scripts/make-icons.mjs']) {
      const script = path.join(ROOT, rel);
      assert.ok(existsSync(script), `${rel} must exist`);
      const r = spawnSync(process.execPath, ['--check', script], { cwd: ROOT, encoding: 'utf8', timeout: 20_000, windowsHide: true });
      assert.equal(r.status, 0, `${rel} must parse: ${r.stderr}`);
    }
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.scripts?.['verify-icons'], 'node scripts/verify-icons.mjs');
    assert.equal(pkg.scripts?.icons, 'node scripts/make-icons.mjs');
  });
});
