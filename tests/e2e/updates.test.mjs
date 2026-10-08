// Field Notes v1.1 e2e: update mechanism + build id (spec items 13a-13d and 14).
// Playwright + node:test. Requires BASE_URL (set by tests/run.mjs). Every test runs in a fresh
// browser context (empty IndexedDB, first-run passcode setup) and closes it in `finally`.
//
// The app exposes window.__fieldNotes once the updater is installed (after the `load` event):
//   { version, updates: { state(), simulateUpdateReady(), check() } }
// simulateUpdateReady() goes through the same code path as a real "new service worker waiting"
// signal, with the real apply function. Without a waiting worker the apply is a harmless no-op,
// so these tests observe state().applyCount and prove that nothing reloads (window.__probe).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

import {
  launch, newPage, gotoApp, setPasscode, addDose, openNewSession, saveSession, waitForText, poll, SEL, DAY
} from '../helpers/browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CODE = '1234';
const T = 15_000;        // explicit timeout for ordinary polls / waits
const SW_T = 30_000;     // service-worker registration can be slow on a loaded machine
const MSG_T = 5_000;     // spec: settings-msg becomes non-empty within 5 s of clicking check-update

const U = {
  chip: '[data-testid="update-chip"]',
  newNotes: '[data-testid="new-notes"]',
  cancelSession: '[data-testid="cancel-session"]',
  sessionDetail: '[data-testid="session-detail"]',
  detailNotes: '[data-testid="detail-notes"]',
  notesSaved: '[data-testid="notes-saved"]',
  sessionOpenAny: '[data-testid^="session-open-"]',
  tabSettings: '[data-testid="tab-settings"]',
  settingsView: '[data-testid="settings-view"]',
  buildInfo: '[data-testid="build-info"]',
  buildVersion: '[data-testid="build-version"]',
  checkUpdate: '[data-testid="check-update"]',
  settingsMsg: '[data-testid="settings-msg"]',
};

let browser;

describe('v1.1 update mechanism + build id', () => {
  before(async () => { browser = await launch(); });
  after(async () => { await browser?.close(); });

  const closePage = (page) => page.context().close();

  /** Fresh context, passcode set up, dashboard visible. */
  async function freshUnlockedApp(options) {
    const page = await newPage(browser, options);
    await gotoApp(page);
    await setPasscode(page, CODE);
    await page.waitForSelector(SEL.dashboard, { state: 'visible', timeout: T });
    return page;
  }

  /** window.__fieldNotes is created when the updater is installed (after the load event). */
  async function waitForFieldNotes(page) {
    await page.waitForFunction(
      () => !!(window.__fieldNotes && window.__fieldNotes.updates && typeof window.__fieldNotes.updates.state === 'function'),
      null,
      { timeout: SW_T }
    );
  }

  /** ...and state().supported flips to true once the service-worker registration resolved. */
  async function waitForUpdaterReady(page) {
    await waitForFieldNotes(page);
    return poll(() => updState(page), s => s.supported === true, {
      timeout: SW_T,
      message: 'service worker registration never reached state().supported === true',
    });
  }

  const updState = (page) => page.evaluate(() => window.__fieldNotes.updates.state());
  const probe = (page) => page.evaluate(() => window.__probe);

  // ------------------------------------------------------------------ 13a

  test('13a. dirty NewSession: update is deferred (chip shown, no reload); Cancel applies it without a reload', async () => {
    const page = await freshUnlockedApp();
    try {
      await waitForUpdaterReady(page);
      await openNewSession(page);

      const notes = page.locator(U.newNotes);
      const typed = 'draft notes typed before the update arrived';
      await notes.fill(typed);
      const urlBefore = page.url();

      // Probe first, then simulate "new service worker waiting" through the real code path.
      const st = await page.evaluate(() => {
        window.__probe = 1;
        window.__fieldNotes.updates.simulateUpdateReady();
        return window.__fieldNotes.updates.state();
      });
      assert.equal(st.updateReady, true, 'updateReady after simulateUpdateReady()');
      assert.equal(st.dirty, true, 'typing into new-notes marks the form dirty');
      assert.ok(Array.isArray(st.dirtyKeys) && st.dirtyKeys.length >= 1, `dirtyKeys: ${JSON.stringify(st.dirtyKeys)}`);
      assert.equal(st.applyCount, 0, 'the update must NOT apply while the form is dirty');

      const chip = page.locator(U.chip);
      await chip.waitFor({ state: 'visible', timeout: T });
      const chipText = await waitForText(chip, 'Update ready', { timeout: T });
      assert.match(chipText, /Update ready/);

      // Spec'd 1 s wait: while the form is dirty nothing may reload or navigate.
      await page.waitForTimeout(1000);
      assert.equal(await probe(page), 1, 'window.__probe was lost: the page reloaded');
      assert.equal(page.url(), urlBefore, 'URL changed while the form was dirty');
      assert.equal(await notes.inputValue(), typed, 'typed text must survive the deferred update');
      const still = await updState(page);
      assert.equal(still.applyCount, 0);
      assert.equal(still.updateReady, true);
      assert.equal(still.dirty, true);
      assert.equal(await chip.count(), 1, 'chip stays while the form is dirty');

      // Leaving the form clears dirty -> the pending update applies (no-op apply, so no reload).
      await page.click(U.cancelSession);
      const after = await poll(() => updState(page), s => s.applyCount === 1 && s.updateReady === false, {
        timeout: T,
        message: 'update did not apply after Cancel (expected applyCount 1, updateReady false)',
      });
      assert.equal(after.dirty, false, 'form is no longer dirty after Cancel');
      await chip.waitFor({ state: 'detached', timeout: T });
      assert.equal(await chip.count(), 0, 'chip is gone once the update applied');
      assert.equal(await page.locator(SEL.newSession).count(), 0, 'New session form closed');
      assert.equal(await probe(page), 1, 'simulated apply must not reload (no waiting worker)');
      assert.equal(page.url(), urlBefore);
    } finally {
      await closePage(page);
    }
  });

  // ------------------------------------------------------------------ 13b

  test('13b. dirty detail notes: update is deferred while the field is focused; leaving the field applies it without leaving the view', async () => {
    const page = await freshUnlockedApp();
    try {
      await waitForUpdaterReady(page);

      // Create a session, then open it.
      await openNewSession(page);
      await addDose(page, 0, { substance: 'mdma', form: 'crystal', fields: { 'mdma-mg': 100 } });
      await saveSession(page);
      const open = page.locator(U.sessionOpenAny).first();
      await open.waitFor({ state: 'visible', timeout: T });
      await open.click();
      await page.waitForSelector(U.sessionDetail, { state: 'visible', timeout: T });
      const notes = page.locator(U.detailNotes);
      await notes.waitFor({ state: 'visible', timeout: T });
      const urlBefore = page.url();

      // Type through the real input path, then append one final character through React's own
      // change path (native value setter + input event) and simulate "update ready" in the SAME
      // task. This makes "immediately" deterministic: the 400 ms autosave timer is reset by the
      // last edit and cannot fire before simulateUpdateReady() runs, however loaded the machine is.
      const typed = 'detail notes typed before the update';
      await notes.fill(typed);
      const st = await page.evaluate((sel) => {
        const ta = document.querySelector(sel);
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, ta.value + '!');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        window.__probe = 1;
        window.__fieldNotes.updates.simulateUpdateReady();
        return window.__fieldNotes.updates.state();
      }, U.detailNotes);
      assert.equal(st.dirty, true, 'unsaved notes mark the detail view dirty');
      assert.equal(st.updateReady, true);
      assert.equal(st.applyCount, 0, 'the update must NOT apply while notes are unsaved');

      const chip = page.locator(U.chip);
      await chip.waitFor({ state: 'visible', timeout: T });
      assert.match((await chip.textContent()) ?? '', /Update ready/);

      // 400 ms debounce -> autosave flush -> "Saved". The textarea is still focused, so the
      // form still counts as "in use": the update must stay deferred and the chip visible.
      await waitForText(page.locator(U.notesSaved), 'Saved', { timeout: T });
      await page.waitForTimeout(300);
      const stillFocused = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), U.detailNotes);
      assert.equal(stillFocused, true, 'precondition: textarea keeps focus after the autosave');
      const afterSave = await updState(page);
      assert.equal(afterSave.applyCount, 0, 'autosave alone must not apply the update while the field is focused');
      assert.equal(afterSave.dirty, true, 'focused notes field keeps the form dirty');
      assert.equal(await chip.count(), 1, 'chip stays while the field is focused');

      // Leaving the field (blur) releases the form -> update applies, still on the detail view.
      await page.click(U.sessionDetail + ' [data-testid="detail-doses"]');
      const after = await poll(() => updState(page), s => s.applyCount === 1, {
        timeout: T,
        message: 'update did not apply after leaving the notes field (expected applyCount 1)',
      });
      assert.equal(after.updateReady, false);
      assert.equal(after.dirty, false, 'blur after save clears dirty');
      await chip.waitFor({ state: 'detached', timeout: T });
      assert.equal(await chip.count(), 0, 'chip disappears once the update applied');

      // Still on the detail view, nothing reloaded, text intact.
      assert.equal(await page.locator(U.sessionDetail).count(), 1, 'must stay on the session detail view');
      assert.equal(await notes.inputValue(), `${typed}!`, 'typed text must survive the apply');
      assert.equal(await probe(page), 1, 'window.__probe was lost: the page reloaded');
      assert.equal(page.url(), urlBefore);
    } finally {
      await closePage(page);
    }
  });

  // ------------------------------------------------------------------ 13c

  test('13c. no dirty form: update applies immediately, chip never appears; an untouched New session is not dirty', async () => {
    const page = await freshUnlockedApp();
    try {
      await waitForUpdaterReady(page);
      const chip = page.locator(U.chip);

      const idle = await updState(page);
      assert.equal(idle.dirty, false, 'dashboard is not dirty');
      assert.equal(idle.applyCount, 0);

      await page.evaluate(() => {
        window.__probe = 1;
        window.__fieldNotes.updates.simulateUpdateReady();
      });
      const s1 = await poll(() => updState(page), s => s.applyCount === 1, {
        timeout: T,
        message: 'update did not apply immediately on the dashboard (expected applyCount 1)',
      });
      assert.equal(s1.updateReady, false, 'nothing is pending after an immediate apply');
      assert.equal(s1.dirty, false);
      // Spec'd 500 ms wait: the chip must never show when no form is dirty.
      await page.waitForTimeout(500);
      assert.equal(await chip.count(), 0, 'update-chip must not render when no form is dirty');
      assert.equal(await probe(page), 1, 'simulated apply must not reload (no waiting worker)');

      // Opening New session WITHOUT typing is not dirty, so an update applies at once.
      await openNewSession(page);
      const s2 = await updState(page);
      assert.equal(s2.dirty, false, 'an untouched New session form is not dirty');
      assert.deepEqual(s2.dirtyKeys, []);

      await page.evaluate(() => window.__fieldNotes.updates.simulateUpdateReady());
      const s3 = await poll(() => updState(page), s => s.applyCount === 2, {
        timeout: T,
        message: 'update did not apply immediately on an untouched New session (expected applyCount 2)',
      });
      assert.equal(s3.updateReady, false);
      await page.waitForTimeout(500);
      assert.equal(await chip.count(), 0, 'update-chip must not render for an untouched form');
      assert.equal(await page.locator(SEL.newSession).count(), 1, 'still on the New session form');
      assert.equal(await probe(page), 1, 'no reload');
    } finally {
      await closePage(page);
    }
  });

  // ------------------------------------------------------------------ 13d

  test('13d. update checks on launch and on return to foreground; built SW is in prompt mode; manifest icons', async () => {
    const page = await newPage(browser);
    try {
      // Count ServiceWorkerRegistration.prototype.update() calls (keep calling the original).
      await page.addInitScript(() => {
        window.__updateCalls = 0;
        const proto = window.ServiceWorkerRegistration && window.ServiceWorkerRegistration.prototype;
        if (!proto || typeof proto.update !== 'function') return;
        const original = proto.update;
        proto.update = function update(...args) {
          window.__updateCalls += 1;
          return original.apply(this, args);
        };
      });
      await gotoApp(page);
      await setPasscode(page, CODE);
      await page.waitForSelector(SEL.dashboard, { state: 'visible', timeout: T });
      await waitForUpdaterReady(page);

      // Launch check.
      const launchCalls = await poll(() => page.evaluate(() => window.__updateCalls), n => n >= 1, {
        timeout: SW_T,
        message: 'launch update check (registration.update) was not observed',
      });
      assert.ok(launchCalls >= 1, `__updateCalls after launch: ${launchCalls}`);

      // Return to foreground.
      const before = await page.evaluate(() => window.__updateCalls);
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      const afterFg = await poll(() => page.evaluate(() => window.__updateCalls), n => n > before, {
        timeout: T,
        message: `foreground (visibilitychange) update check was not observed (stayed at ${before})`,
      });
      assert.ok(afterFg > before, `__updateCalls before ${before}, after visibilitychange ${afterFg}`);

      // Built service worker is in prompt mode: it only skips waiting on an explicit SKIP_WAITING message.
      const sw = readFileSync(path.join(ROOT, 'dist', 'sw.js'), 'utf8');
      assert.ok(sw.includes('SKIP_WAITING'), 'dist/sw.js must handle the SKIP_WAITING message');
      const occurrences = sw.match(/skipWaiting\(\)/g) || [];
      assert.equal(occurrences.length, 1, `expected exactly one skipWaiting() call in dist/sw.js, found ${occurrences.length}`);
      const idx = sw.indexOf('skipWaiting()');
      const handlerStart = Math.max(
        sw.lastIndexOf('addEventListener("message"', idx),
        sw.lastIndexOf("addEventListener('message'", idx)
      );
      assert.ok(handlerStart >= 0, 'skipWaiting() in dist/sw.js is not inside a "message" event handler (auto-update mode?)');
      const handlerBody = sw.slice(handlerStart + 'addEventListener('.length, idx);
      assert.ok(!handlerBody.includes('addEventListener('),
        'skipWaiting() is not inside the "message" handler (another listener starts in between)');
      assert.ok(handlerBody.includes('SKIP_WAITING'), 'the "message" handler must gate skipWaiting() on SKIP_WAITING');

      // Manifest lists the three icons with purposes any / any / maskable.
      const manifest = JSON.parse(readFileSync(path.join(ROOT, 'dist', 'manifest.webmanifest'), 'utf8'));
      assert.ok(Array.isArray(manifest.icons), 'manifest.icons must be an array');
      assert.equal(manifest.icons.length, 3, `manifest icons: ${JSON.stringify(manifest.icons)}`);
      assert.deepEqual(manifest.icons.map(i => i.purpose), ['any', 'any', 'maskable']);
      assert.deepEqual(manifest.icons.map(i => i.src), ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png']);
      assert.deepEqual(manifest.icons.map(i => i.sizes), ['192x192', '512x512', '512x512']);
      assert.ok(manifest.icons.every(i => i.type === 'image/png'), 'all manifest icons are image/png');
    } finally {
      await closePage(page);
    }
  });

  // ------------------------------------------------------------------ 14

  test('14. Settings build-version is "Build <git sha> · <date>", Check for update reports the latest version, __fieldNotes.version matches', async () => {
    const page = await freshUnlockedApp();
    try {
      await waitForUpdaterReady(page);
      await page.click(U.tabSettings);
      await page.waitForSelector(U.settingsView, { state: 'visible', timeout: T });

      const buildInfo = page.locator(U.buildInfo);
      await buildInfo.waitFor({ state: 'visible', timeout: T });
      const versionEl = buildInfo.locator(U.buildVersion);
      assert.equal(await versionEl.count(), 1, 'build-version lives inside build-info');
      const text = ((await versionEl.textContent()) ?? '').trim();
      const m = text.match(/^Build ([0-9a-f]{7,40}) · (\d{4}-\d{2}-\d{2})$/);
      assert.ok(m, `build-version text was "${text}"`);
      const [, sha, date] = m;

      // sha equals git's short sha of HEAD (whatever length git chooses).
      let gitSha;
      try {
        gitSha = execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      } catch (err) {
        assert.fail(`git rev-parse --short HEAD failed in ${ROOT}: ${err.message}`);
      }
      assert.match(gitSha, /^[0-9a-f]{7,40}$/, `git short sha was "${gitSha}"`);
      assert.equal(sha, gitSha, `built sha "${sha}" must equal git HEAD "${gitSha}"`);

      // date is today's UTC date, tolerating a midnight rollover between build and test.
      const shown = Date.parse(`${date}T00:00:00Z`);
      const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      assert.ok(Number.isFinite(shown), `build date "${date}" is not a valid date`);
      assert.ok(Math.abs(shown - today) <= DAY, `build date ${date} is not within one day of today (UTC)`);

      // Check for update sits next to the build id, in the same build-info container.
      const btn = buildInfo.locator(U.checkUpdate);
      assert.equal(await btn.count(), 1, 'check-update lives inside build-info');
      const msg = page.locator(U.settingsMsg);
      assert.equal(await msg.count(), 0, 'no settings message before clicking');
      const msgText = () => msg.count().then(c => (c ? msg.first().textContent({ timeout: 1000 }).then(t => t ?? '') : ''));

      await btn.click();
      const first = await poll(msgText, t => t.trim().length > 0, {
        timeout: MSG_T,
        message: 'settings-msg did not become non-empty within 5 s of clicking check-update',
      });
      assert.ok(first.trim().length > 0);
      const final = await poll(msgText, t => t.includes('You have the latest version'), {
        timeout: T,
        message: 'settings-msg never reported "You have the latest version"',
      });
      assert.equal(final.trim(), 'You have the latest version');

      // Debug handle exposes the same build id.
      const version = await page.evaluate(() => window.__fieldNotes.version);
      assert.equal(version, `${sha} · ${date}`);
      assert.equal(text, `Build ${version}`);
    } finally {
      await closePage(page);
    }
  });
});
