// Field Notes v1.1 layout / iPhone safe-area suite (Playwright + node:test). Requires BASE_URL (set by tests/run.mjs).
// Every test runs in a fresh browser context at an iPhone viewport with the safe-area variables forced on <html>
// (--sat: 59px notch, --sab: 34px home indicator) by helpers.newPage({ insets }). Spec items 1 and 2 are run
// once per viewport (402x874 and 390x844), so there are four test() blocks.
//
//  1. unlocked shell: nav sits above the home indicator and never moves when <main> scrolls, every tab button is
//     tappable inside the viewport, views start below the notch, no horizontal scroll, Welcome and the update chip
//     are inside the viewport.
//  2. lock screen (setup mode, then enter mode after a reload): keypad below the notch and inside the viewport,
//     keys fill/clear passcode dots, no nav.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { launch, newPage, gotoApp, setPasscode, typeCode, poll, SEL, DEFAULT_TIMEOUT } from '../helpers/browser.mjs';

const CODE = '1234';
const INSETS = { top: 59, bottom: 34 };
const VIEWPORTS = [
  { width: 402, height: 874 }, // iPhone 15 Pro / 16 class
  { width: 390, height: 844 }, // iPhone 12-14 class
];
// Sub-pixel tolerance for bounding-box edge comparisons (Chromium lays out in 1/64 px units).
const EPS = 0.5;
const MIN_TAB_HEIGHT = 48;
const TABS = [
  { id: 'dashboard', view: 'dashboard' },
  { id: 'sessions', view: 'sessions-view' },
  { id: 'new', view: 'new-session' },
  { id: 'settings', view: 'settings-view' },
];
const KEYS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'back'];

const T = (id) => `[data-testid="${id}"]`;
const vpName = (vp) => `${vp.width}x${vp.height}`;

let browser;

// ---------------------------------------------------------------- measurement helpers

/** Bounding box (CSS px, viewport-relative) of the element with this testid, with right/bottom precomputed. */
async function getBox(page, testid) {
  const b = await page.locator(T(testid)).boundingBox();
  assert.ok(b, `${testid}: no bounding box (not rendered or not visible)`);
  return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.x + b.width, bottom: b.y + b.height };
}

function fmt(b) {
  return `x=${b.x} y=${b.y} w=${b.width} h=${b.height} right=${b.right} bottom=${b.bottom}`;
}

/** The box must be fully inside the viewport: x>=0, right<=width, y>=0, bottom<=height. */
function assertInsideViewport(b, vp, label) {
  assert.ok(b.x >= -EPS, `${label}: left edge ${b.x} < 0 (${fmt(b)})`);
  assert.ok(b.y >= -EPS, `${label}: top edge ${b.y} < 0 (${fmt(b)})`);
  assert.ok(b.right <= vp.width + EPS, `${label}: right edge ${b.right} > viewport width ${vp.width} (${fmt(b)})`);
  assert.ok(b.bottom <= vp.height + EPS, `${label}: bottom edge ${b.bottom} > viewport height ${vp.height} (${fmt(b)})`);
}

function assertSameBox(a, b, label) {
  for (const k of ['x', 'y', 'width', 'height']) {
    assert.ok(Math.abs(a[k] - b[k]) <= EPS, `${label}: ${k} changed from ${a[k]} to ${b[k]} (before ${fmt(a)}; after ${fmt(b)})`);
  }
}

/** Guard: the simulated insets must be in effect before any layout assertion means anything. */
async function assertSafeAreaVars(page) {
  const vars = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { sat: cs.getPropertyValue('--sat').trim(), sab: cs.getPropertyValue('--sab').trim() };
  });
  assert.equal(vars.sat, '59px', '--sat must be 59px on <html> before asserting layout');
  assert.equal(vars.sab, '34px', '--sab must be 34px on <html> before asserting layout');
}

async function computedStyle(page, testid, prop) {
  return page.locator(T(testid)).evaluate((el, p) => getComputedStyle(el)[p], prop);
}

async function assertNoHorizontalScroll(page, label) {
  const m = await page.evaluate(() => {
    const main = document.querySelector('[data-testid="main"]');
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
      mainScrollWidth: main ? main.scrollWidth : null,
      mainClientWidth: main ? main.clientWidth : null,
    };
  });
  assert.ok(m.docScrollWidth <= m.docClientWidth, `${label}: documentElement scrolls horizontally (${JSON.stringify(m)})`);
  assert.ok(m.bodyScrollWidth <= m.innerWidth, `${label}: body wider than the window (${JSON.stringify(m)})`);
  assert.notEqual(m.mainScrollWidth, null, `${label}: [data-testid="main"] not found`);
  assert.ok(m.mainScrollWidth <= m.mainClientWidth, `${label}: <main> scrolls horizontally (${JSON.stringify(m)})`);
}

/** Class list of each passcode dot (children of data-testid="passcode-dots"). */
async function dotClasses(page) {
  return page.locator(T('passcode-dots')).evaluate(el => Array.from(el.children).map(c => c.className));
}
const isFilled = (cls) => /\bbg-accent\b/.test(cls);

/** Shared box checks for the lock screen; `mode` is only used in messages. */
async function checkLockScreen(page, vp, mode) {
  const label = `lock(${mode})`;
  await page.waitForSelector(SEL.keypad, { state: 'visible' });
  assert.equal(await page.locator(T('lock-shell')).count(), 1, `${label}: lock-shell must be rendered`);
  assert.equal(await page.locator(T('app-shell')).count(), 0, `${label}: app-shell must not be rendered while locked`);
  assert.equal(await page.locator(SEL.tabs).count(), 0, `${label}: nav must be absent on the lock screen`);

  assert.equal(await computedStyle(page, 'main', 'paddingTop'), '59px', `${label}: main padding-top must equal --sat`);

  const keypad = await getBox(page, 'keypad');
  assertInsideViewport(keypad, vp, `${label} keypad`);
  assert.ok(keypad.y >= 59 - EPS, `${label}: keypad top ${keypad.y} is under the notch (< 59) (${fmt(keypad)})`);
  for (const k of KEYS) {
    assertInsideViewport(await getBox(page, `key-${k}`), vp, `${label} key-${k}`);
  }

  // key-1 fills exactly the first dot; key-back clears it again.
  const before = await dotClasses(page);
  assert.ok(before.length >= 4, `${label}: expected at least 4 passcode dots, got ${before.length}`);
  assert.ok(before.every(c => !isFilled(c)), `${label}: dots must start empty (${before.join(' | ')})`);

  await page.click(T('key-1'));
  const afterKey = await poll(() => dotClasses(page), cls => isFilled(cls[0]), { message: `${label}: first dot did not fill after key-1` });
  assert.ok(afterKey.slice(1).every(c => !isFilled(c)), `${label}: only the first dot may be filled after one digit (${afterKey.join(' | ')})`);
  // The layout re-flows once a digit is entered (setup mode hides the length choice): keys must still be reachable.
  assertInsideViewport(await getBox(page, 'keypad'), vp, `${label} keypad after key-1`);
  for (const k of KEYS) {
    assertInsideViewport(await getBox(page, `key-${k}`), vp, `${label} key-${k} after key-1`);
  }

  await page.click(T('key-back'));
  await poll(() => dotClasses(page), cls => cls.every(c => !isFilled(c)), { message: `${label}: key-back did not clear the dot` });
  assert.equal(await page.locator(SEL.lockError).evaluate(el => el.textContent.trim()), '', `${label}: no error after key-1 / key-back`);
}

// ---------------------------------------------------------------- suite

describe('v1.1 layout: iPhone safe areas', () => {
  before(async () => { browser = await launch(); });
  after(async () => { await browser?.close(); });

  for (const vp of VIEWPORTS) {
    const name = vpName(vp);

    test(`1. ${name}: unlocked shell honors --sat/--sab, tabs are tappable and switch views, nav is fixed, chip and welcome inside the viewport`, async () => {
      const page = await newPage(browser, { viewport: vp, insets: INSETS });
      try {
        await gotoApp(page);
        await assertSafeAreaVars(page);

        // First-run passcode setup; measure the Welcome overlay before dismissing it.
        await typeCode(page, CODE); // "Create passcode"
        await typeCode(page, CODE); // "Confirm passcode"
        await page.waitForSelector(SEL.tabs, { state: 'visible' });
        const dismiss = page.locator(SEL.welcomeDismiss);
        await dismiss.waitFor({ state: 'visible' });
        assert.equal(await page.locator(T('welcome')).count(), 1, 'welcome overlay shown on first run');
        assertInsideViewport(await getBox(page, 'welcome-dismiss'), vp, 'welcome-dismiss');
        await dismiss.click();
        await dismiss.waitFor({ state: 'hidden' });
        await page.waitForSelector(SEL.dashboard, { state: 'visible' });
        assert.equal(await page.locator(T('app-shell')).count(), 1, 'app-shell rendered once unlocked');

        // Nav: above the home indicator, padded by --sab, every tab fully inside the viewport and >= 48px tall.
        const nav = await getBox(page, 'tabs');
        assert.ok(nav.bottom <= vp.height + EPS, `nav bottom ${nav.bottom} > viewport height ${vp.height} (${fmt(nav)})`);
        assert.equal(await computedStyle(page, 'tabs', 'paddingBottom'), '34px', 'nav padding-bottom must equal --sab');
        for (const t of TABS) {
          const b = await getBox(page, `tab-${t.id}`);
          assertInsideViewport(b, vp, `tab-${t.id}`);
          assert.ok(b.height >= MIN_TAB_HEIGHT - EPS, `tab-${t.id}: height ${b.height} < ${MIN_TAB_HEIGHT} (${fmt(b)})`);
          assert.ok(b.bottom <= nav.bottom + EPS, `tab-${t.id}: extends below the nav (${fmt(b)} vs nav ${fmt(nav)})`);
        }

        // Main content starts below the notch.
        assert.equal(await computedStyle(page, 'main', 'paddingTop'), '59px', 'main padding-top must equal --sat');
        const dash = await getBox(page, 'dashboard');
        assert.ok(dash.y >= 59 - EPS, `dashboard container top ${dash.y} is under the notch (< 59) (${fmt(dash)})`);

        await assertNoHorizontalScroll(page, 'dashboard');

        // Each tab switches the view; aria-current="page" follows the active tab (tab-new never gets it and
        // leaves the previously active tab current).
        let current = 'dashboard';
        for (const t of TABS) {
          await page.click(T(`tab-${t.id}`));
          await page.waitForSelector(T(t.view), { state: 'visible' });
          if (t.id !== 'new') current = t.id;
          for (const u of TABS) {
            const expected = u.id === current ? 'page' : null;
            await poll(
              () => page.locator(T(`tab-${u.id}`)).getAttribute('aria-current'),
              v => v === expected,
              { message: `after clicking tab-${t.id}, tab-${u.id} aria-current should be ${expected}` }
            );
          }
          for (const other of TABS) {
            if (other.view === t.view) continue;
            assert.equal(await page.locator(T(other.view)).count(), 0, `after clicking tab-${t.id}, ${other.view} must not be rendered`);
          }
          const vb = await getBox(page, t.view);
          assert.ok(vb.y >= 59 - EPS, `${t.view} container top ${vb.y} is under the notch (< 59) (${fmt(vb)})`);
          await assertNoHorizontalScroll(page, t.view);
        }

        // The nav does not move when <main> scrolls, and the Save button is never hidden under it.
        await page.click(T('tab-new'));
        await page.waitForSelector(T('new-session'), { state: 'visible' });
        await page.waitForSelector(SEL.saveSession, { state: 'visible' });
        const navBefore = await getBox(page, 'tabs');
        const scroll = await page.locator(T('main')).evaluate(el => {
          el.scrollTop = el.scrollHeight;
          return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
        });
        assert.ok(scroll.scrollHeight > scroll.clientHeight, `New session form should be taller than <main> so it scrolls (${JSON.stringify(scroll)})`);
        assert.ok(scroll.scrollTop > 0, `<main> did not scroll (${JSON.stringify(scroll)})`);
        const navAfter = await getBox(page, 'tabs');
        assertSameBox(navBefore, navAfter, 'nav moved when main scrolled');
        assert.ok(navAfter.bottom <= vp.height + EPS, `nav bottom ${navAfter.bottom} > viewport height after scrolling (${fmt(navAfter)})`);
        const save = await getBox(page, 'save-session');
        assertInsideViewport(save, vp, 'save-session (main scrolled to bottom)');
        assert.ok(save.bottom <= navAfter.y + EPS, `save-session is hidden under the nav: button ${fmt(save)} vs nav ${fmt(navAfter)}`);
        const cancel = await getBox(page, 'cancel-session');
        assert.ok(cancel.bottom <= navAfter.y + EPS, `cancel-session is hidden under the nav: button ${fmt(cancel)} vs nav ${fmt(navAfter)}`);
        await assertNoHorizontalScroll(page, 'new-session scrolled');

        // Update chip: dirty form + pending update -> chip under the notch, inside the viewport.
        await page.locator(T('new-notes')).fill('layout check');
        await page.waitForFunction(() => !!(window.__fieldNotes && window.__fieldNotes.updates), null, { timeout: DEFAULT_TIMEOUT });
        await poll(
          () => page.evaluate(() => window.__fieldNotes.updates.state()),
          s => s.dirty === true,
          { message: 'typing in new-notes did not mark the form dirty' }
        );
        assert.equal(await page.locator(T('update-chip')).count(), 0, 'chip must not show before an update is pending');
        await page.evaluate(() => window.__fieldNotes.updates.simulateUpdateReady());
        const chipLoc = page.locator(T('update-chip'));
        await chipLoc.waitFor({ state: 'visible' });
        const chip = await getBox(page, 'update-chip');
        assert.ok(chip.y >= 59 - EPS, `update-chip top ${chip.y} is under the notch (< 59) (${fmt(chip)})`);
        assertInsideViewport(chip, vp, 'update-chip');
        assert.ok(chip.width > 0 && chip.height > 0, `update-chip has no size (${fmt(chip)})`);

        // Cancel closes the form; the chip disappears with the dirty form and the shell shows a tab view again.
        // (Which tab Cancel lands on is not a layout concern: v1.1 currently always goes to Sessions, see app_issues.)
        await page.click(T('cancel-session'));
        await poll(() => page.locator(T('new-session')).count(), n => n === 0, { message: 'New session form did not close on Cancel' });
        await page.waitForSelector(`${T('dashboard')}, ${T('sessions-view')}, ${T('settings-view')}`, { state: 'visible' });
        assert.equal(await page.locator(T('app-shell')).count(), 1, 'app-shell still rendered after Cancel');
        await poll(() => chipLoc.count(), n => n === 0, { message: 'update chip did not go away after Cancel' });
        const finalState = await page.evaluate(() => window.__fieldNotes.updates.state());
        assert.equal(finalState.dirty, false, 'no dirty form after Cancel');
        assert.equal(finalState.applyCount, 1, 'the pending update applied once the dirty form was left');
      } finally {
        await page.context().close();
      }
    });

    test(`2. ${name}: lock screen keypad sits below the notch and inside the viewport (setup mode, then enter mode after reload)`, async () => {
      const page = await newPage(browser, { viewport: vp, insets: INSETS });
      try {
        await gotoApp(page);
        await assertSafeAreaVars(page);
        assert.equal(await page.locator(T('length-choice')).count(), 1, 'setup mode shows the length choice before any digit');
        await checkLockScreen(page, vp, 'setup');
        await assertNoHorizontalScroll(page, 'lock(setup)');

        await setPasscode(page, CODE);
        await page.waitForSelector(SEL.dashboard, { state: 'visible' });

        await page.reload({ waitUntil: 'load' });
        await page.waitForSelector(SEL.keypad, { state: 'visible' });
        await assertSafeAreaVars(page);
        assert.equal(await page.locator(T('length-choice')).count(), 0, 'enter mode has no length choice');
        await checkLockScreen(page, vp, 'enter');
        await assertNoHorizontalScroll(page, 'lock(enter)');
      } finally {
        await page.context().close();
      }
    });
  }
});
