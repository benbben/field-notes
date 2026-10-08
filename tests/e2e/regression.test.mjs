// Field Notes v1 regression suite (Playwright + node:test). Requires BASE_URL (set by tests/run.mjs).
// Every test runs in a fresh browser context: empty IndexedDB, first-run passcode setup.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  launch, newPage, gotoApp, setPasscode, unlock, typeCode, addDose, openNewSession, setStartTime,
  fillSetTags, saveSession, waitForText, waitForAttribute, waitForServiceWorkerControl, poll, SEL, DAY
} from '../helpers/browser.mjs';

const CODE = '1234';
let browser;

describe('v1 regression', () => {
  before(async () => { browser = await launch(); });
  after(async () => { await browser?.close(); });

  async function freshApp(options) {
    const page = await newPage(browser, options);
    await gotoApp(page);
    return page;
  }
  const closePage = (page) => page.context().close();

  async function setupAndOpenNewSession(page) {
    await setPasscode(page, CODE);
    await page.waitForSelector(SEL.dashboard, { state: 'visible' });
    await openNewSession(page);
  }

  test('a. passcode gate: setup, keypad after reload, wrong code shows error, right code unlocks', async () => {
    const page = await freshApp();
    try {
      await page.waitForSelector(SEL.keypad, { state: 'visible' });
      assert.equal(await page.locator(SEL.dashboard).count(), 0, 'dashboard must not render before passcode setup');

      await setPasscode(page, CODE);
      await page.waitForSelector(SEL.dashboard, { state: 'visible' });

      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector(SEL.keypad, { state: 'visible' });
      assert.equal(await page.locator(SEL.dashboard).count(), 0, 'app must be locked after reload');

      await typeCode(page, '9999');
      const err = await waitForText(page.locator(SEL.lockError), /\S/);
      assert.ok(err.trim().length > 0, 'wrong passcode shows an error');
      assert.equal(await page.locator(SEL.dashboard).count(), 0, 'wrong passcode must not unlock');

      await unlock(page, CODE);
      await page.waitForSelector(SEL.dashboard, { state: 'visible' });
    } finally {
      await closePage(page);
    }
  });

  test('b. MDMA pressed calc: 1.5 units x 100 mg claimed -> "150 mg"', async () => {
    const page = await freshApp();
    try {
      await setupAndOpenNewSession(page);
      const calc = await addDose(page, 0, { substance: 'mdma', form: 'pressed', fields: { 'mdma-units': 1.5, 'mdma-mgper': 100 } });
      assert.match(calc, /150 mg/, `dose-calculated was: ${calc}`);
    } finally {
      await closePage(page);
    }
  });

  test('c. MDMA + Adderall warning appears in interactions', async () => {
    const page = await freshApp();
    try {
      await setupAndOpenNewSession(page);
      await addDose(page, 0, { substance: 'mdma', form: 'crystal', fields: { 'mdma-mg': 100 } });
      await addDose(page, 1, { substance: 'adderall', form: 'IR', fields: { amount: 10 } });
      const text = await waitForText(page.locator('[data-testid="interactions"]'), 'MDMA + Adderall');
      assert.match(text, /MDMA \+ Adderall/);
    } finally {
      await closePage(page);
    }
  });

  test('d. MDMA + psilocybin is named "hippy flip", never "candyflip"', async () => {
    const page = await freshApp();
    try {
      await setupAndOpenNewSession(page);
      await addDose(page, 0, { substance: 'mdma', form: 'crystal', fields: { 'mdma-mg': 100 } });
      await addDose(page, 1, { substance: 'psilocybin', fields: { 'psilo-amount': 1.5 } });
      const text = await waitForText(page.locator('[data-testid="interactions"]'), /hippy flip/i);
      assert.match(text, /hippy flip/i);
      assert.doesNotMatch(text, /candyflip/i);
    } finally {
      await closePage(page);
    }
  });

  test('e. psilocybin floors: 1.5 g 7 days ago -> green, 3.5 g 7 days ago -> red', async () => {
    async function statusDotClass(grams) {
      const page = await freshApp();
      try {
        await setupAndOpenNewSession(page);
        await setStartTime(page, Date.now() - 7 * DAY);
        await addDose(page, 0, { substance: 'psilocybin', fields: { 'psilo-amount': grams } });
        await saveSession(page);
        await page.click('[data-testid="tab-dashboard"]');
        const dot = page.locator('[data-testid="status-color-psilocybin"]');
        await dot.waitFor({ state: 'attached' });
        // `return await` matters: a bare `return promise` would run the finally (context close) first.
        return await waitForAttribute(dot, 'class', /\bdot-(green|yellow|red)\b/);
      } finally {
        await closePage(page);
      }
    }
    const low = await statusDotClass(1.5);
    assert.match(low, /\bdot-green\b/, `1.5 g: class was "${low}"`);
    const high = await statusDotClass(3.5);
    assert.match(high, /\bdot-red\b/, `3.5 g: class was "${high}"`);
  });

  test('f. persistence: session survives reload + unlock and shows in Sessions', async () => {
    const page = await freshApp();
    try {
      await setupAndOpenNewSession(page);
      await fillSetTags(page, 'regress-tag');
      await addDose(page, 0, { substance: 'mdma', form: 'crystal', fields: { 'mdma-mg': 100 } });
      await saveSession(page);

      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector(SEL.keypad, { state: 'visible' });
      await unlock(page, CODE);
      await page.click('[data-testid="tab-sessions"]');

      const rows = page.locator('[data-testid^="session-row-"]');
      await rows.first().waitFor({ state: 'visible' });
      const text = await poll(
        () => rows.first().textContent().then(t => t ?? ''),
        t => /MDMA/.test(t) && /100 mg/.test(t) && /regress-tag/.test(t),
        { message: 'session row did not show MDMA, 100 mg and the set tag' }
      );
      assert.match(text, /MDMA/);
      assert.match(text, /100 mg/);
      assert.match(text, /regress-tag/);
    } finally {
      await closePage(page);
    }
  });

  test('g. offline shell: service worker serves the app (keypad) with the network off', async () => {
    const page = await freshApp();
    const context = page.context();
    try {
      await setPasscode(page, CODE);
      await page.waitForSelector(SEL.dashboard, { state: 'visible' });
      await waitForServiceWorkerControl(page, { unlockCode: CODE });

      await context.setOffline(true);
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector(SEL.keypad, { state: 'visible' });
      assert.equal(await page.locator(SEL.keypad).count(), 1, 'keypad rendered from the SW cache while offline');
    } finally {
      await context.setOffline(false).catch(() => {});
      await closePage(page);
    }
  });
});
