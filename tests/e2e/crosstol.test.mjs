// v1.1.1 directed cross-tolerance e2e (Playwright + node:test). Requires BASE_URL (set by tests/run.mjs).
// Dashboard scenarios 2-7 of the v1.1.1 spec. Scenario 1 (2C-B only -> green "clear", "no floor") lives in
// tests/e2e/twocb.test.mjs test 10; the Node-level equivalents live in tests/unit/intervals.test.mjs.
// Every test runs in a fresh browser context: empty IndexedDB, first-run passcode setup.
// Non-ASCII glyphs are written as escapes so the file is encoding-safe: µ = micro sign (U+00B5), the
// character src/lib/intervals.js renders in "(last 150 µg)".
//
// Timing and countdown arithmetic. "N days ago" sessions go through the datetime-local start-time input,
// which truncates to the minute, so started_at <= Date.now() - N*DAY by up to 59.999 s. The dashboard shows
// ceil((when - now) / DAY) with when = started_at + window, i.e. ceil(((W - N) * DAY - eps) / DAY) where
// 0 < eps < 1 day (the minute truncation plus the wall-clock seconds the test itself takes). That is exactly
// W - N, so an N-days-ago source dose with a W-day window always reads "(W-N)d": no off-by-one and no fake
// clock needed. "Today" sessions keep the form's default start time (now), so a W-day window reads "Wd".

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  launch, newPage, gotoApp, setPasscode, addDose, openNewSession, setStartTime, saveSession,
  poll, SEL, DAY
} from '../helpers/browser.mjs';
import { intervalsFor } from '../../src/lib/intervals.js';

const CODE = '1234';
const MICRO = 'µ';
const DOT_RE = /\bdot-(green|yellow|red)\b/;
let browser;

// Dose specs for helpers.addDose (one dose per session).
const LSD = (ug) => ({ substance: 'lsd', form: 'tab', fields: { 'lsd-units': 1, 'lsd-ugper': ug } });
const PSILO = (g) => ({ substance: 'psilocybin', fields: { 'psilo-amount': g } });
const TWO_CB = { substance: '2cb', form: 'hcl', fields: { '2cb-mg': 10 } };

// Expected basis strings, exactly as intervals.js builds them.
const lsdOwn = (ug) => `LSD 6 days (last ${ug} ${MICRO}g)`;
const lsdCross = (ug) => `Cross-tolerance from LSD: 6 days (last ${ug} ${MICRO}g)`;

describe('v1.1.1 cross-tolerance dashboard e2e', () => {
  before(async () => { browser = await launch(); });
  after(async () => { await browser?.close(); });

  async function freshApp(options) {
    const page = await newPage(browser, options);
    await gotoApp(page);
    await setPasscode(page, CODE);
    await page.waitForSelector(SEL.dashboard, { state: 'visible' });
    return page;
  }
  const closePage = (page) => page.context().close();

  /**
   * Log one single-dose session and wait for the Sessions view that follows Save.
   * daysAgo: start time = Date.now() - daysAgo*DAY via the start-time input; omit it for "today" (form default).
   * Returns the dose-calculated text.
   */
  async function logSession(page, dose, { daysAgo } = {}) {
    await openNewSession(page);
    if (daysAgo != null) await setStartTime(page, Date.now() - daysAgo * DAY);
    const calc = await addDose(page, 0, dose);
    await saveSession(page);
    await page.waitForSelector('[data-testid="sessions-view"]', { state: 'visible' });
    return calc;
  }

  async function gotoDashboard(page) {
    await page.click('[data-testid="tab-dashboard"]');
    await page.waitForSelector(SEL.dashboard, { state: 'visible' });
  }

  /** Current { dot, countdown, basis } of one Re-dose status row (empty strings while it is not rendered). */
  async function readRow(page, sub) {
    const cls = (await page.locator(`[data-testid="status-color-${sub}"]`).getAttribute('class')) ?? '';
    return {
      dot: cls.match(DOT_RE)?.[1] ?? '',
      countdown: ((await page.locator(`[data-testid="next-${sub}"]`).textContent()) ?? '').trim(),
      basis: (await page.locator(`[data-testid="status-basis-${sub}"]`).textContent()) ?? '',
    };
  }

  /**
   * Wait until the row for `sub` shows the expected dot colour, exact countdown text and basis substring.
   * The dashboard loads doses asynchronously after the session list updates, so the row is polled rather than
   * read once. On timeout the three plain assertions re-run on the last observed values so a wrong app fails
   * with expected-vs-actual, not a bare timeout. Returns the observed row for further assertions.
   */
  async function expectRow(page, sub, { dot, countdown, basis }) {
    await page.locator(`[data-testid="status-color-${sub}"]`).waitFor({ state: 'attached' });
    const matches = (r) => r.dot === dot && r.countdown === countdown && r.basis.includes(basis);
    let got;
    try {
      got = await poll(() => readRow(page, sub), matches, { message: `${sub} row did not reach ${JSON.stringify({ dot, countdown, basis })}` });
    } catch {
      got = await readRow(page, sub);
    }
    assert.equal(got.dot, dot, `${sub} dot colour (row: ${JSON.stringify(got)})`);
    assert.equal(got.countdown, countdown, `${sub} countdown (row: ${JSON.stringify(got)})`);
    assert.ok(got.basis.includes(basis), `${sub} basis "${got.basis}" must contain "${basis}"`);
    assert.ok(!got.basis.includes('2cb'), `${sub} basis must not leak the raw id "2cb": ${got.basis}`);
    return got;
  }

  async function rowCount(page, sub) {
    return page.locator(`[data-testid="status-${sub}"]`).count();
  }

  test('2. LSD 150 ug 3 days ago, 2C-B never used -> no 2C-B row; then 2C-B today -> red, 3d, "Cross-tolerance from LSD: 6 days (last 150 ug)"', async () => {
    const page = await freshApp();
    try {
      const calc = await logSession(page, LSD(150), { daysAgo: 3 });
      assert.match(calc, /150 /, `LSD calculated: ${calc}`);

      await gotoDashboard(page);
      // LSD row: its own window, 3 of 6 days left. A substance gets a row only once it has been logged,
      // so there is no 2C-B row yet even though LSD would already delay a 2C-B dose.
      await expectRow(page, 'lsd', { dot: 'red', countdown: '3d', basis: lsdOwn(150) });
      assert.equal(await rowCount(page, '2cb'), 0, 'no 2C-B row before 2C-B is logged');
      assert.equal(await page.locator('[data-testid="status-color-2cb"]').count(), 0);

      // Log 2C-B today: LSD's window applies to 2C-B, anchored on the LSD dose (3 days left), with the LSD
      // dose setting the length. 2C-B itself has no floor, so nothing is anchored on today's dose.
      const c2 = await logSession(page, TWO_CB);
      assert.match(c2, /10 mg/, `2C-B calculated: ${c2}`);
      await gotoDashboard(page);
      const row = await expectRow(page, '2cb', { dot: 'red', countdown: '3d', basis: lsdCross(150) });
      assert.doesNotMatch(row.basis, /2C-B 6 days|no floor/);
      // The LSD row is unaffected by the 2C-B dose.
      await expectRow(page, 'lsd', { dot: 'red', countdown: '3d', basis: lsdOwn(150) });
    } finally {
      await closePage(page);
    }
  });

  test('3. LSD 300 ug 3 days ago + 2C-B today -> 2C-B red, countdown = live LSD long window minus 3 days', async () => {
    // Read the live threshold from intervals.js rather than hardcoding 13 days.
    const live = intervalsFor({ substance: 'lsd', total: 300, totalUnit: `${MICRO}g` });
    assert.ok(live.minMs > 6 * DAY, 'a 300 ug dose uses the long LSD window');
    const expectedDays = Math.ceil((live.minMs - 3 * DAY) / DAY);
    const expected = `${expectedDays}d`;

    const page = await freshApp();
    try {
      const calc = await logSession(page, LSD(300), { daysAgo: 3 });
      assert.match(calc, /300 /, `LSD calculated: ${calc}`);
      await logSession(page, TWO_CB);

      await gotoDashboard(page);
      const row = await expectRow(page, '2cb', { dot: 'red', countdown: expected, basis: `Cross-tolerance from LSD: ${live.basis}` });
      assert.match(row.basis, /300 /, 'basis reports the 300 ug LSD dose');
      // LSD row: its own long window, same countdown.
      await expectRow(page, 'lsd', { dot: 'red', countdown: expected, basis: `LSD ${live.basis}` });
    } finally {
      await closePage(page);
    }
  });

  test('4. 2C-B 1 day ago, then LSD today -> LSD row is LSD\'s own window only; no "Cross-tolerance from 2C-B" anywhere', async () => {
    const page = await freshApp();
    try {
      await logSession(page, TWO_CB, { daysAgo: 1 });
      await logSession(page, LSD(100));

      await gotoDashboard(page);
      // LSD today: own 6-day window, full 6 days left. 2C-B never delays LSD.
      const lsd = await expectRow(page, 'lsd', { dot: 'red', countdown: '6d', basis: lsdOwn(100) });
      assert.doesNotMatch(lsd.basis, /Cross-tolerance/);
      // The direction is LSD -> 2C-B only: the 2C-B row inherits today's LSD window...
      await expectRow(page, '2cb', { dot: 'red', countdown: '6d', basis: lsdCross(100) });
      // ...and nothing on the page claims that 2C-B delays anything.
      const bodyText = await page.evaluate(() => document.body.textContent ?? '');
      assert.ok(bodyText.includes('Cross-tolerance from LSD'), 'sanity: body text read after the rows rendered');
      assert.ok(!bodyText.includes('Cross-tolerance from 2C-B'), 'body text must not contain "Cross-tolerance from 2C-B"');
      assert.ok(!bodyText.includes('Cross-tolerance from 2cb'), 'body text must not contain a raw-id variant either');
    } finally {
      await closePage(page);
    }
  });

  test('5. Psilocybin 3.5 g 5 days ago + 2C-B today -> 2C-B red, 9d, basis names Psilocybin (14-day window)', async () => {
    const page = await freshApp();
    try {
      const calc = await logSession(page, PSILO(3.5), { daysAgo: 5 });
      assert.match(calc, /3\.5 g/, `psilocybin calculated: ${calc}`);
      await logSession(page, TWO_CB);

      await gotoDashboard(page);
      const row = await expectRow(page, '2cb', { dot: 'red', countdown: '9d', basis: 'Cross-tolerance from Psilocybin: 14 days (last 3.5 g)' });
      assert.doesNotMatch(row.basis, /LSD/);
      // Psilocybin row: its own 14-day window, same countdown.
      await expectRow(page, 'psilocybin', { dot: 'red', countdown: '9d', basis: 'Psilocybin 14 days (last 3.5 g)' });
    } finally {
      await closePage(page);
    }
  });

  test('6. LSD 2 days ago AND psilocybin 1.5 g 10 days ago + 2C-B today -> 2C-B basis names LSD (latest window wins)', async () => {
    const page = await freshApp();
    try {
      // Psilocybin's 6-day window expired 4 days ago; LSD's 6-day window has 4 days left.
      await logSession(page, PSILO(1.5), { daysAgo: 10 });
      await logSession(page, LSD(100), { daysAgo: 2 });
      await logSession(page, TWO_CB);

      await gotoDashboard(page);
      const row = await expectRow(page, '2cb', { dot: 'red', countdown: '4d', basis: lsdCross(100) });
      assert.doesNotMatch(row.basis, /Psilocybin/, 'the expired psilocybin window must not be named');
      await expectRow(page, 'lsd', { dot: 'red', countdown: '4d', basis: lsdOwn(100) });
    } finally {
      await closePage(page);
    }
  });

  test('7. regression: LSD 100 ug 2 days ago + psilocybin 1.5 g 20 days ago -> psilocybin dot RED, 4d, basis names LSD', async () => {
    const page = await freshApp();
    try {
      await logSession(page, PSILO(1.5), { daysAgo: 20 });
      await logSession(page, LSD(100), { daysAgo: 2 });

      await gotoDashboard(page);
      // Psilocybin's own window expired 14 days ago, but the recent LSD dose delays the next psilocybin dose.
      const psi = await expectRow(page, 'psilocybin', { dot: 'red', countdown: '4d', basis: lsdCross(100) });
      assert.doesNotMatch(psi.basis, /Psilocybin 6 days/);
      // LSD row: own window, same countdown.
      await expectRow(page, 'lsd', { dot: 'red', countdown: '4d', basis: lsdOwn(100) });
      assert.equal(await rowCount(page, '2cb'), 0, 'no 2C-B row: 2C-B was never logged');
    } finally {
      await closePage(page);
    }
  });
});
