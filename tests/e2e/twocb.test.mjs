// 2C-B group e2e (Playwright + node:test). Requires BASE_URL (set by tests/run.mjs).
// Every test runs in a fresh browser context: empty IndexedDB, first-run passcode setup.
// Non-ASCII glyphs are written as escapes so the file is encoding-safe: \u00d7 = multiplication sign, \u00b5 = micro sign.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  launch, newPage, gotoApp, setPasscode, addDose, openNewSession, setStartTime, saveSession,
  waitForText, waitForAttribute, poll, SEL, DAY
} from '../helpers/browser.mjs';

const CODE = '1234';
const TIMES = '\u00d7';
let browser;

describe('2C-B e2e', () => {
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

  /** First session row on the Sessions view: { id, row } once it is visible. */
  async function firstSessionRow(page) {
    const rows = page.locator('[data-testid^="session-row-"]');
    await rows.first().waitFor({ state: 'visible' });
    const tid = await rows.first().getAttribute('data-testid');
    return { id: tid.replace(/^session-row-/, ''), row: rows.first() };
  }

  test('8. 2C-B dose form: hcl prefilled 10 mg (min=1 step=1), pill units x mg/pill, volumetric mL x mg/mL', async () => {
    const page = await freshApp();
    try {
      await setupAndOpenNewSession(page);
      const form = page.locator(SEL.doseForm).nth(0);
      const calc = form.locator('[data-testid="dose-calculated"]');

      await form.locator('[data-testid="dose-substance"]').selectOption('2cb');
      const formSel = form.locator('[data-testid="2cb-form"]');
      await formSel.waitFor({ state: 'visible' });

      // hcl: amount prefilled to 10 mg, editable, min="1" step="1".
      await formSel.selectOption('hcl');
      const mg = form.locator('[data-testid="2cb-mg"]');
      await mg.waitFor({ state: 'visible' });
      const prefilled = await poll(() => mg.inputValue(), v => v === '10', { message: '2cb-mg not prefilled with 10' });
      assert.equal(prefilled, '10');
      assert.equal(await mg.getAttribute('min'), '1', '2cb-mg min attribute');
      assert.equal(await mg.getAttribute('step'), '1', '2cb-mg step attribute');
      const hclText = await waitForText(calc, '10 mg');
      assert.match(hclText, /Calculated total:/);
      assert.match(hclText, /10 mg/);

      await mg.fill('12');
      const hcl12 = await waitForText(calc, '12 mg');
      assert.match(hcl12, /12 mg/);
      assert.doesNotMatch(hcl12, /10 mg/);

      // pill: claimed mg per pill prefilled to 10; 1.5 units -> 15 mg.
      await formSel.selectOption('pill');
      const mgper = form.locator('[data-testid="2cb-mgper"]');
      await mgper.waitFor({ state: 'visible' });
      const perPrefilled = await poll(() => mgper.inputValue(), v => v === '10', { message: '2cb-mgper not prefilled with 10' });
      assert.equal(perPrefilled, '10');
      assert.equal(await form.locator('[data-testid="2cb-mg"]').count(), 0, '2cb-mg must not render for pill');
      await form.locator('[data-testid="2cb-units"]').fill('1.5');
      const pillRe = new RegExp(`1\\.5 ${TIMES} 10 mg = 15 mg`);
      const pillText = await waitForText(calc, pillRe);
      assert.match(pillText, pillRe);

      // volumetric: 2.5 mL x 4 mg/mL -> 10 mg.
      await formSel.selectOption('volumetric');
      const ml = form.locator('[data-testid="2cb-ml"]');
      const conc = form.locator('[data-testid="2cb-conc"]');
      await ml.waitFor({ state: 'visible' });
      await conc.waitFor({ state: 'visible' });
      assert.equal(await form.locator('[data-testid="2cb-units"]').count(), 0, '2cb-units must not render for volumetric');
      await ml.fill('2.5');
      await conc.fill('4');
      const volRe = new RegExp(`2\\.5 mL ${TIMES} 4 mg\\/mL = 10 mg`);
      const volText = await waitForText(calc, volRe);
      assert.match(volText, volRe);
    } finally {
      await closePage(page);
    }
  });

  test('9. interactions 2C-B + MDMA / 2C-B + Adderall; label "2C-B" (never "2cb") in Sessions, detail, dashboard, interactions', async () => {
    const page = await freshApp();
    try {
      await setupAndOpenNewSession(page);
      const interactions = page.locator('[data-testid="interactions"]');

      // 2C-B hcl 10 mg + MDMA crystal 100 mg.
      const c0 = await addDose(page, 0, { substance: '2cb', form: 'hcl', fields: { '2cb-mg': 10 } });
      assert.match(c0, /10 mg/, `dose 0 calculated: ${c0}`);
      await addDose(page, 1, { substance: 'mdma', form: 'crystal', fields: { 'mdma-mg': 100 } });
      const mdmaText = await waitForText(interactions, '2C-B + MDMA');
      assert.match(mdmaText, /2C-B \+ MDMA/);

      // Swap the second dose for Adderall IR 10 mg: 2C-B + Adderall (generic psychedelic + Adderall path).
      await addDose(page, 1, { substance: 'adderall', form: 'IR', fields: { 'adderall-mg': 10 } });
      const addText = await poll(
        () => interactions.textContent().then(t => t ?? ''),
        t => t.includes('2C-B + Adderall') && !t.includes('2C-B + MDMA'),
        { message: 'interactions did not switch to 2C-B + Adderall' }
      );
      assert.match(addText, /2C-B \+ Adderall/);
      assert.doesNotMatch(addText, /2cb/, `interactions must use the display label, got: ${addText}`);

      // Back to 2C-B + MDMA for the saved session.
      await addDose(page, 1, { substance: 'mdma', form: 'crystal', fields: { 'mdma-mg': 100 } });
      const interactionsText = await poll(
        () => interactions.textContent().then(t => t ?? ''),
        t => t.includes('2C-B + MDMA') && !t.includes('Adderall'),
        { message: 'interactions did not switch back to 2C-B + MDMA' }
      );
      assert.match(interactionsText, /2C-B \+ MDMA/);

      await saveSession(page);

      // Sessions tab is shown after Save.
      await page.waitForSelector('[data-testid="sessions-view"]', { state: 'visible' });
      const { id, row } = await firstSessionRow(page);
      const rowText = await poll(
        () => row.textContent().then(t => t ?? ''),
        t => t.includes('2C-B') && t.includes('MDMA'),
        { message: 'session row did not show 2C-B and MDMA' }
      );
      assert.match(rowText, /2C-B 10 mg/);
      assert.match(rowText, /MDMA 100 mg/);

      // Session detail.
      await page.click(`[data-testid="session-open-${id}"]`);
      await page.waitForSelector('[data-testid="session-detail"]', { state: 'visible' });
      const detailText = await waitForText(page.locator('[data-testid="detail-doses"]'), '2C-B');
      assert.match(detailText, /2C-B/);
      assert.match(detailText, /10 mg/);
      assert.match(detailText, /MDMA/);

      // Dashboard re-dose status label.
      await page.click('[data-testid="tab-dashboard"]');
      const label = page.locator('[data-testid="status-label-2cb"]');
      await label.waitFor({ state: 'visible' });
      const labelText = await waitForText(label, '2C-B');
      assert.equal(labelText.trim(), '2C-B');
      assert.equal((await page.locator('[data-testid="status-label-mdma"]').textContent())?.trim(), 'MDMA');

      // Dashboard "Recent sessions" card (sessionDoseSummary -> labelFor).
      const recentText = await waitForText(page.locator(`[data-testid="recent-${id}"]`), '2C-B');
      assert.match(recentText, /2C-B 10 mg/);
      assert.match(recentText, /MDMA 100 mg/);

      // The raw id must never leak into any of these visible texts.
      for (const [name, text] of [
        ['sessions row', rowText],
        ['detail-doses', detailText],
        ['status-label-2cb', labelText],
        ['recent card', recentText],
        ['interactions', interactionsText],
      ]) {
        assert.ok(!text.includes('2cb'), `${name} must not contain the raw id "2cb": ${text}`);
      }
    } finally {
      await closePage(page);
    }
  });

  test('10. dashboard: 2C-B 3 days ago -> red "3d" (6 days); LSD 20 days ago -> basis cross-tolerance 2C-B, dot green; Sessions filter 2C-B', async () => {
    const page = await freshApp();
    try {
      await setupAndOpenNewSession(page);

      // Single 2C-B hcl 10 mg dose, started exactly 3 days ago.
      await setStartTime(page, Date.now() - 3 * DAY);
      const c0 = await addDose(page, 0, { substance: '2cb', form: 'hcl', fields: { '2cb-mg': 10 } });
      assert.match(c0, /10 mg/, `dose calculated: ${c0}`);
      await saveSession(page);
      await page.waitForSelector('[data-testid="sessions-view"]', { state: 'visible' });

      await page.click('[data-testid="tab-dashboard"]');
      const dot2cb = page.locator('[data-testid="status-color-2cb"]');
      await dot2cb.waitFor({ state: 'attached' });
      const dotClass = await waitForAttribute(dot2cb, 'class', /\bdot-(green|yellow|red)\b/);
      assert.match(dotClass, /\bdot-red\b/, `2C-B dot class was "${dotClass}"`);
      const next2cb = await waitForText(page.locator('[data-testid="next-2cb"]'), /\S/);
      assert.equal(next2cb.trim(), '3d');
      const basis2cb = await waitForText(page.locator('[data-testid="status-basis-2cb"]'), '6 days');
      assert.match(basis2cb, /6 days/);
      assert.match(basis2cb, /2C-B/);
      assert.ok(!basis2cb.includes('2cb'), `basis must not contain raw id: ${basis2cb}`);

      // Same context: LSD tab, 1 unit x 100 ug, started 20 days ago.
      await openNewSession(page);
      await setStartTime(page, Date.now() - 20 * DAY);
      const c1 = await addDose(page, 0, { substance: 'lsd', form: 'tab', fields: { 'lsd-units': 1, 'lsd-ugper': 100 } });
      assert.match(c1, /100 /, `LSD calculated: ${c1}`);
      await saveSession(page);
      await page.waitForSelector('[data-testid="sessions-view"]', { state: 'visible' });

      await page.click('[data-testid="tab-dashboard"]');
      const dotLsd = page.locator('[data-testid="status-color-lsd"]');
      await dotLsd.waitFor({ state: 'attached' });
      // The basis line comes from nextAllowed(), which applies LSD <-> 2C-B cross-tolerance: the 2C-B window
      // (3 days ago + 6 days = +3 days) ends later than LSD's own 6-day window (20 days ago, long expired),
      // so the longest window wins and the basis names 2C-B.
      const basisLsd = await waitForText(page.locator('[data-testid="status-basis-lsd"]'), 'Cross-tolerance: 2C-B');
      assert.match(basisLsd, /Cross-tolerance: 2C-B/);
      // The dot, however, reflects rankAgainstWindow() against LSD's OWN interval (intervalsFor(lastBy.lsd)):
      // 20 days elapsed > 6-day window -> green, regardless of the cross-tolerance basis shown beside it.
      const lsdClass = await waitForAttribute(dotLsd, 'class', /\bdot-(green|yellow|red)\b/);
      assert.match(lsdClass, /\bdot-green\b/, `LSD dot class was "${lsdClass}"`);
      const nextLsd = await waitForText(page.locator('[data-testid="next-lsd"]'), /\S/);
      assert.equal(nextLsd.trim(), 'OK', 'next-lsd reflects the own (expired) window');
      // The 2C-B card itself is unchanged by the LSD session.
      assert.match(await dot2cb.getAttribute('class'), /\bdot-red\b/);
      assert.equal((await page.locator('[data-testid="next-2cb"]').textContent())?.trim(), '3d');

      // Sessions filter: option value "2cb" labelled "2C-B" shows only the 2C-B session.
      await page.click('[data-testid="tab-sessions"]');
      const filter = page.locator('[data-testid="filter-sub"]');
      await filter.waitFor({ state: 'visible' });
      const rows = page.locator('[data-testid^="session-row-"]');
      await poll(() => rows.count(), n => n === 2, { message: 'expected 2 session rows before filtering' });
      const option = filter.locator('option[value="2cb"]');
      assert.equal(await option.count(), 1, 'filter-sub must have exactly one option with value "2cb"');
      assert.equal((await option.textContent())?.trim(), '2C-B');

      await filter.selectOption('2cb');
      assert.equal(await filter.inputValue(), '2cb');
      await poll(() => rows.count(), n => n === 1, { message: 'filter 2cb did not narrow to one row' });
      const filteredText = (await rows.first().textContent()) ?? '';
      assert.match(filteredText, /2C-B 10 mg/);
      assert.doesNotMatch(filteredText, /LSD/);
      assert.ok(!filteredText.includes('2cb'), `row must not contain raw id: ${filteredText}`);

      // Clearing the filter brings both rows back.
      await filter.selectOption('');
      await poll(() => rows.count(), n => n === 2, { message: 'clearing the filter did not restore both rows' });
    } finally {
      await closePage(page);
    }
  });
});
