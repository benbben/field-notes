// Field Notes v1.1 NOTES group (spec 11a-11e): the single `notes` field on NewSession / SessionDetail,
// detail autosave (400 ms debounce, flush on Back and on blur), notes-only search and the Edit route.
// Requires BASE_URL (set by tests/run.mjs). Every test runs in a fresh browser context
// (empty IndexedDB, first-run passcode setup) and closes it in `finally`.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  launch, newPage, gotoApp, setPasscode, unlock, addDose, openNewSession, fillSetTags, saveSession,
  waitForText, poll, SEL, DEFAULT_TIMEOUT
} from '../helpers/browser.mjs';

const CODE = '1234';
const NOTES_A = 'Rooftop, two friends, ambient set, went well';
const AUTOSAVE_MS = 400;           // spec: SessionDetail autosave debounce
const SAVED_WITHIN_MS = 2000;      // spec: "Saved" must appear within ~2 s of the last keystroke
const SAVED_NOT_BEFORE_MS = 300;   // spec: ... and not before 300 ms (generous tolerance on the 400 ms debounce)
const FLUSH_ATTEMPTS = 3;          // retries for the "act within the debounce window" steps of 11c
const SEARCH_PLACEHOLDER = 'Search notes…';                     // "Search notes…"
const LEGACY_CONTEXT_PLACEHOLDER = "What's going on around this session?";
const LEGACY_REFLECTION_HEADING = 'Reflection — in the moment'; // "Reflection — in the moment"
const LEGACY_AVAILABLE_TEXT = 'Available 18h';
const LEGACY_FIELDS = ['context_text', 'reflection_in_moment', 'reflection_day_after', 'reflection_post'];

const S = {
  sessionsView: '[data-testid="sessions-view"]',
  searchText: '[data-testid="search-text"]',
  rows: '[data-testid^="session-row-"]',
  sessionDetail: '[data-testid="session-detail"]',
  detailNotes: '[data-testid="detail-notes"]',
  notesSaved: '[data-testid="notes-saved"]',
  detailBack: '[data-testid="detail-back"]',
  detailEdit: '[data-testid="detail-edit"]',
  detailDoses: '[data-testid="detail-doses"]',
  newNotes: '[data-testid="new-notes"]',
  main: '[data-testid="main"]',
};
const rowSel = (id) => `[data-testid="session-row-${id}"]`;
const openSel = (id) => `[data-testid="session-open-${id}"]`;

let browser;

describe('v1.1 notes', () => {
  before(async () => { browser = await launch(); });
  after(async () => { await browser?.close(); });

  /** Fresh context -> app -> passcode set up -> dashboard visible. */
  async function freshApp() {
    const page = await newPage(browser);
    await gotoApp(page);
    await setPasscode(page, CODE);
    await page.waitForSelector(SEL.dashboard, { state: 'visible' });
    return page;
  }
  const closePage = (page) => page.context().close();

  /** Ids of the rows currently rendered in the Sessions list (newest first). */
  const rowIds = (page) =>
    page.locator(S.rows).evaluateAll(els => els.map(el => el.getAttribute('data-testid').slice('session-row-'.length)));

  /**
   * New session: MDMA crystal 100 mg + notes (+ optional set tags), Save. Save lands on the Sessions tab;
   * returns the id of the row that was not in `known` (and adds it).
   */
  async function createSession(page, { notes, setTags = '', known = new Set() }) {
    await openNewSession(page);
    if (setTags) await fillSetTags(page, setTags);
    const calc = await addDose(page, 0, { substance: 'mdma', form: 'crystal', fields: { 'mdma-mg': 100 } });
    assert.match(calc, /100 mg/, `dose-calculated was: ${calc}`);
    await page.locator(S.newNotes).fill(notes);
    await saveSession(page);
    await page.waitForSelector(S.sessionsView, { state: 'visible' });
    const ids = await poll(
      () => rowIds(page),
      ids => ids.some(i => !known.has(i)),
      { timeout: DEFAULT_TIMEOUT, message: 'new session row did not appear in the Sessions list' }
    );
    const id = ids.find(i => !known.has(i));
    known.add(id);
    return id;
  }

  /** Open the detail of session `id` (via the Sessions tab if needed); returns the detail-notes locator. */
  async function openDetail(page, id) {
    const view = page.locator(S.sessionsView);
    if (!(await view.isVisible())) {
      await page.click('[data-testid="tab-sessions"]');
      await view.waitFor({ state: 'visible' });
    }
    await page.click(openSel(id));
    await page.waitForSelector(S.sessionDetail, { state: 'visible' });
    const ta = page.locator(S.detailNotes);
    await ta.waitFor({ state: 'visible' });
    return ta;
  }

  /** Back to the Sessions list from a detail. */
  async function goBack(page) {
    await page.click(S.detailBack);
    await page.waitForSelector(S.sessionsView, { state: 'visible' });
  }

  async function reloadAndUnlock(page) {
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector(SEL.keypad, { state: 'visible' });
    await unlock(page, CODE);
  }

  /** Poll detail-notes until its value equals `expected`; returns the value. */
  const waitForNotesValue = (ta, expected) =>
    poll(() => ta.inputValue(), v => v === expected,
      { timeout: DEFAULT_TIMEOUT, message: `detail-notes did not become ${JSON.stringify(expected)}` });

  /** Read a session record straight from the app's IndexedDB (Dexie 'field-notes-db', store 'sessions'). */
  function readSessionFromDb(page, id) {
    return page.evaluate((sid) => new Promise((resolve, reject) => {
      const req = indexedDB.open('field-notes-db');
      req.onerror = () => reject(req.error || new Error('indexedDB.open failed'));
      req.onblocked = () => reject(new Error('indexedDB.open blocked'));
      req.onsuccess = () => {
        const db = req.result;
        try {
          const get = db.transaction('sessions', 'readonly').objectStore('sessions').get(sid);
          get.onsuccess = () => { db.close(); resolve(get.result ?? null); };
          get.onerror = () => { db.close(); reject(get.error); };
        } catch (e) { db.close(); reject(e); }
      };
    }), id);
  }

  test('11a. new session with MDMA crystal 100 mg + notes saves; Sessions row opens a detail with those notes', async () => {
    const page = await freshApp();
    try {
      const id = await createSession(page, { notes: NOTES_A });
      assert.match(id, /^[0-9a-f]{32}$/, `session id from the row testid: ${id}`);
      await page.locator(rowSel(id)).waitFor({ state: 'visible' });

      const ta = await openDetail(page, id);
      assert.equal(await waitForNotesValue(ta, NOTES_A), NOTES_A);
      assert.equal(await page.locator(S.detailNotes).count(), 1, 'exactly one notes textarea in the detail');
    } finally {
      await closePage(page);
    }
  });

  test('11b. detail autosave: "Saved" after the 400 ms debounce (not before 300 ms, within 2 s); value survives reload', async (t) => {
    const page = await freshApp();
    try {
      const id = await createSession(page, { notes: NOTES_A });
      const ta = await openDetail(page, id);
      const saved = page.locator(S.notesSaved);
      assert.equal(((await saved.textContent()) ?? '').trim(), '', 'notes-saved is empty before any autosave');

      // (1) Debounce: one fresh keystroke -> "Saved" must appear after >= ~400 ms and within 2 s.
      await ta.click();
      await page.keyboard.press('Control+End');
      const t0 = Date.now();
      await page.keyboard.type('.');
      const savedText = await waitForText(saved, 'Saved', { timeout: SAVED_WITHIN_MS, interval: 10 });
      const elapsed = Date.now() - t0;
      t.diagnostic(`11b: "Saved" appeared ${elapsed} ms after a single keystroke (debounce ${AUTOSAVE_MS} ms)`);
      assert.equal(savedText.trim(), 'Saved');
      assert.ok(elapsed >= SAVED_NOT_BEFORE_MS,
        `"Saved" appeared ${elapsed} ms after the keystroke; expected >= ${SAVED_NOT_BEFORE_MS} ms (debounce ${AUTOSAVE_MS} ms)`);
      assert.ok(elapsed <= SAVED_WITHIN_MS,
        `"Saved" appeared ${elapsed} ms after the keystroke; expected <= ${SAVED_WITHIN_MS} ms`);
      const afterKey = await ta.inputValue();
      assert.equal(afterKey.length, NOTES_A.length + 1, `one character was typed: ${JSON.stringify(afterKey)}`);
      assert.ok(afterKey.includes('.'), `typed character present: ${JSON.stringify(afterKey)}`);

      // (2) An additional sentence via fill(). "Saved" is sticky after the first autosave, so wait for the
      //     autosave to land in the DB (no blur, no Back: nothing else can flush) before reloading.
      const NOTES_B = `${NOTES_A}. Came down gently, slept well.`;
      const tFill = Date.now();
      await ta.fill(NOTES_B);
      const rec = await poll(
        () => readSessionFromDb(page, id),
        r => r != null && r.notes === NOTES_B,
        { timeout: SAVED_WITHIN_MS + 1000, interval: 20, message: 'autosave did not persist the full notes text' }
      );
      const persistedAfter = Date.now() - tFill;
      t.diagnostic(`11b: full text autosaved to IndexedDB ${persistedAfter} ms after fill()`);
      assert.equal(rec.notes, NOTES_B);
      assert.ok(persistedAfter >= SAVED_NOT_BEFORE_MS, `autosave of the full text persisted after ${persistedAfter} ms (debounced)`);

      // (3) Reload (no React unmount, so only the autosave could have written it), unlock, reopen.
      await reloadAndUnlock(page);
      const ta2 = await openDetail(page, id);
      assert.equal(await waitForNotesValue(ta2, NOTES_B), NOTES_B);
    } finally {
      await closePage(page);
    }
  });

  test('11c. flush on Back (within 400 ms, no wait for "Saved") and flush on blur -> text persisted', async (t) => {
    const page = await freshApp();
    try {
      const id = await createSession(page, { notes: NOTES_A });

      // --- Back: type and press Back inside the debounce window (retry if the machine was too slow to prove it).
      let backText;
      for (let attempt = 1; ; attempt++) {
        const ta = await openDetail(page, id);
        const text = `${NOTES_A}. Back-flush ${attempt}.`;
        const t0 = Date.now();
        await ta.fill(text);
        await page.click(S.detailBack);
        const elapsed = Date.now() - t0;
        await page.waitForSelector(S.sessionsView, { state: 'visible' });
        t.diagnostic(`11c: attempt ${attempt}: fill + Back took ${elapsed} ms (window ${AUTOSAVE_MS} ms)`);
        if (elapsed < AUTOSAVE_MS) { backText = text; break; }
        assert.ok(attempt < FLUSH_ATTEMPTS,
          `could not type and press Back within ${AUTOSAVE_MS} ms in ${FLUSH_ATTEMPTS} attempts (last took ${elapsed} ms)`);
      }
      const ta1 = await openDetail(page, id);
      assert.equal(await waitForNotesValue(ta1, backText), backText, 'text typed right before Back was flushed');
      await goBack(page);

      // --- Blur: type, click elsewhere (the doses card); "Saved" must show before the debounce could have fired.
      let blurText;
      for (let attempt = 1; ; attempt++) {
        const ta = await openDetail(page, id);
        const saved = page.locator(S.notesSaved);
        assert.equal(((await saved.textContent()) ?? '').trim(), '', 'fresh detail mount shows no "Saved" yet');
        const text = `${backText} Blur-flush ${attempt}.`;
        const t0 = Date.now();
        await ta.fill(text);
        await page.click(S.detailDoses);
        await waitForText(saved, 'Saved', { timeout: SAVED_WITHIN_MS, interval: 10 });
        const elapsed = Date.now() - t0;
        t.diagnostic(`11c: attempt ${attempt}: fill + blur -> "Saved" after ${elapsed} ms (window ${AUTOSAVE_MS} ms)`);
        if (elapsed < AUTOSAVE_MS) { blurText = text; break; }
        assert.ok(attempt < FLUSH_ATTEMPTS,
          `blur flush not provable within ${AUTOSAVE_MS} ms in ${FLUSH_ATTEMPTS} attempts (last "Saved" after ${elapsed} ms)`);
        await goBack(page);
      }
      // Reopen -> the detail loads the record fresh from the DB.
      await goBack(page);
      const ta2 = await openDetail(page, id);
      assert.equal(await waitForNotesValue(ta2, blurText), blurText, 'text typed before blur was flushed');
      const rec = await readSessionFromDb(page, id);
      assert.equal(rec?.notes, blurText, 'DB record carries the blurred text');
    } finally {
      await closePage(page);
    }
  });

  test('11d. search: notes only ("ambient" lists, "zzz-nomatch" none, a set-tag term does not match); placeholder', async () => {
    const page = await freshApp();
    try {
      const known = new Set();
      const idA = await createSession(page, { notes: NOTES_A, known });
      const NOTES_T = 'Quiet night in, early sleep';
      const idT = await createSession(page, { notes: NOTES_T, setTags: 'tagonlyterm', known });
      assert.notEqual(idA, idT);

      const view = page.locator(S.sessionsView);
      const search = page.locator(S.searchText);
      const rows = page.locator(S.rows);
      assert.equal(await search.getAttribute('placeholder'), SEARCH_PLACEHOLDER);

      // Both rows listed before any search; the tag really is rendered on the second session's row.
      await poll(() => rows.count(), n => n === 2, { timeout: DEFAULT_TIMEOUT, message: 'two session rows expected' });
      const tagRow = (await page.locator(rowSel(idT)).textContent()) ?? '';
      assert.match(tagRow, /tagonlyterm/, 'set tag rendered on its row');

      await search.fill('ambient');
      await poll(() => rowIds(page), ids => ids.length === 1 && ids[0] === idA,
        { timeout: DEFAULT_TIMEOUT, message: '"ambient" should list exactly the session whose notes contain it' });
      assert.doesNotMatch((await view.textContent()) ?? '', /No sessions match\./);

      await search.fill('zzz-nomatch');
      await poll(() => rows.count(), n => n === 0, { timeout: DEFAULT_TIMEOUT, message: '"zzz-nomatch" should list no sessions' });
      await waitForText(view, 'No sessions match.');

      // Notes-only: a term that exists only in a set tag must not match.
      await search.fill('tagonlyterm');
      await poll(() => rows.count(), n => n === 0, { timeout: DEFAULT_TIMEOUT, message: 'tag-only term must not match (notes-only search)' });
      await waitForText(view, 'No sessions match.');

      // Case-insensitive notes match for the tagged session; clearing the search restores both rows.
      await search.fill('quiet');
      await poll(() => rowIds(page), ids => ids.length === 1 && ids[0] === idT,
        { timeout: DEFAULT_TIMEOUT, message: '"quiet" should list exactly the tagged session' });
      await search.fill('');
      await poll(() => rows.count(), n => n === 2, { timeout: DEFAULT_TIMEOUT, message: 'clearing the search lists both sessions' });
    } finally {
      await closePage(page);
    }
  });

  test('11e. edit route keeps notes: new-notes prefilled, saved change shows in the detail; legacy Context/Reflection UI is gone', async () => {
    const page = await freshApp();
    try {
      const id = await createSession(page, { notes: NOTES_A });
      const ta = await openDetail(page, id);
      await waitForNotesValue(ta, NOTES_A);

      // Legacy v1 text UI must not exist in the detail view.
      const detail = page.locator(S.sessionDetail);
      assert.equal(await page.locator(`[placeholder="${LEGACY_CONTEXT_PLACEHOLDER}"]`).count(), 0, 'no legacy Context textarea');
      const detailText = (await detail.textContent()) ?? '';
      assert.ok(!detailText.includes(LEGACY_REFLECTION_HEADING), `detail must not contain ${JSON.stringify(LEGACY_REFLECTION_HEADING)}`);
      assert.ok(!detailText.includes(LEGACY_AVAILABLE_TEXT), `detail must not contain ${JSON.stringify(LEGACY_AVAILABLE_TEXT)}`);
      assert.equal(await detail.locator('textarea').count(), 1, 'the detail has exactly one textarea (detail-notes)');

      // Edit: new-notes is prefilled with the notes.
      await page.click(S.detailEdit);
      await page.waitForSelector(SEL.newSession, { state: 'visible' });
      const newNotes = page.locator(S.newNotes);
      assert.equal(
        await poll(() => newNotes.inputValue(), v => v === NOTES_A, { timeout: DEFAULT_TIMEOUT, message: 'new-notes not prefilled' }),
        NOTES_A
      );
      assert.equal(await page.locator(`[placeholder="${LEGACY_CONTEXT_PLACEHOLDER}"]`).count(), 0, 'no legacy Context textarea in the edit form');
      const mainText = (await page.locator(S.main).textContent()) ?? '';
      assert.ok(!mainText.includes(LEGACY_REFLECTION_HEADING) && !mainText.includes(LEGACY_AVAILABLE_TEXT), 'no legacy Reflection UI in the edit form');

      // Change and Save; the saved text is what the detail shows afterwards.
      const NOTES_E = 'Edited: rooftop, ambient set, calm and clear.';
      await newNotes.fill(NOTES_E);
      await saveSession(page);
      // Save on the edit route returns to the previous tab (Sessions); openDetail handles either landing.
      const ta2 = await openDetail(page, id);
      assert.equal(await waitForNotesValue(ta2, NOTES_E), NOTES_E);
      const rec = await readSessionFromDb(page, id);
      assert.equal(rec?.notes, NOTES_E, 'DB record carries the edited notes');
      for (const k of LEGACY_FIELDS) {
        assert.ok(!(k in (rec ?? {})), `v2 record must not carry legacy field ${k}`);
      }
    } finally {
      await closePage(page);
    }
  });
});
