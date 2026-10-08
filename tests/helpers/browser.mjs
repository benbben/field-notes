// Playwright helpers for the Field Notes e2e suite (plain `playwright` library, no @playwright/test).
// Selector policy: data-testid only, plus visible text where no testid exists. Never placeholders.

import { chromium } from 'playwright';

export const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4173/';
export const DEFAULT_TIMEOUT = Number(process.env.E2E_TIMEOUT || 15_000);
export const DAY = 24 * 60 * 60 * 1000;

const SEL = {
  keypad: '[data-testid="keypad"]',
  tabs: '[data-testid="tabs"]',
  dashboard: '[data-testid="dashboard"]',
  welcomeDismiss: '[data-testid="welcome-dismiss"]',
  lockError: '[data-testid="lock-error"]',
  doseForm: '[data-testid="dose-form"]',
  addDose: '[data-testid="add-dose"]',
  saveSession: '[data-testid="save-session"]',
  saveError: '[data-testid="save-error"]',
  startTime: '[data-testid="start-time"]',
  newSession: '[data-testid="new-session"]',
};
export { SEL };

// ---------------------------------------------------------------- browser / page

export async function launch(options = {}) {
  return chromium.launch({ headless: true, ...options });
}

/** Run fn(browser) and always close the browser afterwards. */
export async function withBrowser(fn, launchOptions) {
  const browser = await launch(launchOptions);
  try {
    return await fn(browser);
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * New isolated context (fresh IndexedDB, fresh service-worker registration) + page.
 * viewport defaults to iPhone-ish 390x844 at deviceScaleFactor 2.
 * insets: { top, bottom } px -> sets --sat/--sab on <html> at document start (v1.1 safe-area CSS reads them).
 */
export async function newPage(browser, { viewport = { width: 390, height: 844 }, insets, ...contextOptions } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, ...contextOptions });
  if (insets) {
    await context.addInitScript(({ top, bottom }) => {
      const apply = (el) => {
        el.style.setProperty('--sat', `${top}px`);
        el.style.setProperty('--sab', `${bottom}px`);
      };
      if (document.documentElement) {
        apply(document.documentElement);
      } else {
        // <html> not parsed yet: apply as soon as it appears, before first paint.
        const mo = new MutationObserver(() => {
          if (document.documentElement) {
            apply(document.documentElement);
            mo.disconnect();
          }
        });
        mo.observe(document, { childList: true });
      }
    }, { top: insets.top ?? 0, bottom: insets.bottom ?? 0 });
  }
  const page = await context.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT * 2);
  return page;
}

/** Navigate to BASE_URL and wait for the keypad (lock screen) or the app shell (tabs). */
export async function gotoApp(page, { timeout = DEFAULT_TIMEOUT } = {}) {
  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.waitForSelector(`${SEL.keypad}, ${SEL.tabs}`, { state: 'visible', timeout });
  return page;
}

// ---------------------------------------------------------------- polling

/**
 * Poll fn() until predicate(value) is truthy. Rejects with the last value on timeout.
 * Use instead of fixed sleeps.
 */
export async function poll(fn, predicate, { timeout = DEFAULT_TIMEOUT, interval = 100, message = 'poll timed out' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  let lastErr;
  for (;;) {
    try {
      last = await fn();
      lastErr = undefined;
      if (predicate(last)) return last;
    } catch (err) {
      lastErr = err;
    }
    if (Date.now() >= deadline) {
      const detail = lastErr ? `last error: ${lastErr.message}` : `last value: ${JSON.stringify(last)}`;
      throw new Error(`${message} after ${timeout} ms (${detail})`);
    }
    await new Promise(r => setTimeout(r, interval));
  }
}

/** Wait until the locator's text contains `expected` (string or RegExp); returns the text. */
export async function waitForText(locator, expected, opts = {}) {
  const test = expected instanceof RegExp ? (t) => expected.test(t) : (t) => t.includes(expected);
  return poll(
    () => locator.textContent().then(t => t ?? ''),
    test,
    { message: `text ${expected} not found in ${locator}`, ...opts }
  );
}

/** Wait until an attribute matches (string or RegExp); returns the attribute value. */
export async function waitForAttribute(locator, name, expected, opts = {}) {
  const test = expected instanceof RegExp ? (v) => expected.test(v) : (v) => v.includes(expected);
  return poll(
    () => locator.getAttribute(name).then(v => v ?? ''),
    test,
    { message: `attribute ${name} ${expected} not found on ${locator}`, ...opts }
  );
}

// ---------------------------------------------------------------- passcode

/** Press the keypad digits of `code` one by one (no expectation about the outcome). */
export async function typeCode(page, code) {
  await page.waitForSelector(SEL.keypad, { state: 'visible' });
  for (const ch of String(code)) {
    await page.click(`[data-testid="key-${ch}"]`);
  }
}

/** Click "Got it" on the first-run Welcome overlay if it shows up within `timeout`. */
export async function dismissWelcome(page, { timeout = 1500 } = {}) {
  const btn = page.locator(SEL.welcomeDismiss);
  try {
    await btn.waitFor({ state: 'visible', timeout });
  } catch {
    return false;
  }
  await btn.click();
  await btn.waitFor({ state: 'hidden' });
  return true;
}

/** First-run flow: enter the code twice (create + confirm), then dismiss the Welcome overlay. */
export async function setPasscode(page, code = '1234') {
  await typeCode(page, code); // "Create passcode"
  await typeCode(page, code); // "Confirm passcode"
  await page.waitForSelector(SEL.tabs, { state: 'visible' });
  // Welcome appears right after the first unlock (it is only ever shown once).
  await dismissWelcome(page, { timeout: DEFAULT_TIMEOUT });
}

/** Enter flow: type the existing code and wait for the app shell. */
export async function unlock(page, code = '1234') {
  await typeCode(page, code);
  await page.waitForSelector(SEL.tabs, { state: 'visible' });
  // Tolerate a Welcome overlay (e.g. onboarding flag not yet persisted before a reload).
  await dismissWelcome(page, { timeout: 1000 });
}

// ---------------------------------------------------------------- new session / doses

/** Open the New Session form via the "New" tab (falls back to the dashboard button). */
export async function openNewSession(page) {
  const tabNew = page.locator('[data-testid="tab-new"]');
  if (await tabNew.count()) await tabNew.click();
  else await page.click('[data-testid="dashboard-new"]');
  await page.waitForSelector(SEL.doseForm, { state: 'visible' });
}

/**
 * Fill the N-th DoseForm (0-based) by testid and return the text of its data-testid="dose-calculated".
 *   substance: 'mdma' | 'psilocybin' | 'lsd' | 'cannabis' | 'dmt' | 'adderall' | 'custom'
 *   form:      value for data-testid="<substance>-form" (mdma-form, lsd-form, adderall-form, ...)
 *   fields:    { '<testid>': value } for number inputs (mdma-units, mdma-mgper, mdma-mg, psilo-amount,
 *              lsd-units, lsd-ugper, dose-offset) or selects (dose-combo).
 *              Special key 'amount' = the first non-offset number input in the form, for substances whose
 *              amount input has no testid in v1 (adderall, dmt, cannabis, custom).
 * Clicks "+ Add dose" until the N-th form exists.
 */
export async function addDose(page, index, { substance, form, fields = {} }) {
  const forms = page.locator(SEL.doseForm);
  while ((await forms.count()) <= index) {
    const before = await forms.count();
    await page.click(SEL.addDose);
    await poll(() => forms.count(), n => n > before, { message: 'dose form was not added' });
  }
  const f = forms.nth(index);
  await f.locator('[data-testid="dose-substance"]').selectOption(substance);
  if (form) await f.locator(`[data-testid="${substance}-form"]`).selectOption(form);

  for (const [key, value] of Object.entries(fields)) {
    const target = key === 'amount'
      ? f.locator('input[type="number"]:not([data-testid="dose-offset"])').first()
      : f.locator(`[data-testid="${key}"]`);
    const tag = await target.evaluate(el => el.tagName.toLowerCase());
    if (tag === 'select') await target.selectOption(String(value));
    else await target.fill(String(value));
  }

  const calc = f.locator('[data-testid="dose-calculated"]');
  if (Object.keys(fields).length === 0) return (await calc.count()) ? (await calc.textContent()) ?? '' : '';
  await calc.waitFor({ state: 'visible' });
  return (await calc.textContent()) ?? '';
}

/** yyyy-MM-ddTHH:mm in local time, the value format of <input type="datetime-local">. */
export function formatDateTimeLocal(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Set data-testid="start-time" (datetime-local) to `ts` via locator.fill('yyyy-MM-ddTHH:mm').
 * Verified against v1: Playwright's fill() on this React-controlled input does fire onChange
 * (the value survives a later re-render), so no native-setter workaround is needed.
 */
export async function setStartTime(page, ts) {
  const value = formatDateTimeLocal(ts);
  const input = page.locator(SEL.startTime);
  await input.fill(value);
  const got = await input.inputValue();
  if (got !== value) throw new Error(`start-time did not take: expected ${value}, got ${got}`);
  return value;
}

/** Set the "Set tags" input (comma separated). Prefers a testid; falls back to the visible label. */
export async function fillSetTags(page, text) {
  const byId = page.locator('[data-testid="set-tags"]');
  const input = (await byId.count())
    ? byId
    : page.locator('label:text-is("Set tags")').locator('xpath=following-sibling::input[1]');
  await input.fill(text);
}

/** Click Save and wait for the form to go away; throws if the app shows data-testid="save-error". */
export async function saveSession(page) {
  await page.click(SEL.saveSession);
  await poll(
    async () => ({
      formGone: (await page.locator(SEL.saveSession).count()) === 0,
      error: (await page.locator(SEL.saveError).count()) ? await page.locator(SEL.saveError).textContent() : ''
    }),
    r => r.formGone || r.error,
    { message: 'session form did not close after save' }
  ).then(r => { if (r.error) throw new Error(`save failed: ${r.error}`); });
}

// ---------------------------------------------------------------- service worker

/**
 * Resolve once a service worker is active for this page and controls it.
 * If the first registration did not claim the page, reload once and unlock with `unlockCode`.
 */
export async function waitForServiceWorkerControl(page, { unlockCode = '1234', timeout = 30_000 } = {}) {
  await page.waitForFunction(() => 'serviceWorker' in navigator, null, { timeout });
  await page.evaluate((ms) => Promise.race([
    navigator.serviceWorker.ready.then(() => true),
    new Promise((_, rej) => setTimeout(() => rej(new Error('serviceWorker.ready timed out')), ms))
  ]), timeout);
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  if (!controlled) {
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector(SEL.keypad, { state: 'visible' });
    await unlock(page, unlockCode);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout });
  }
}
