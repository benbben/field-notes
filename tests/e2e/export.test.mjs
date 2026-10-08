// Field Notes v1.1 export / import suite (Playwright + node:test). Requires BASE_URL (set by tests/run.mjs).
//
// Spec group 15 (iOS-safe share):
//   15a share path       navigator.share() receives one application/json File, called synchronously in the tap
//   15b fallback path    no Web Share API -> <a download> of the same file
//   15c share cancelled  AbortError from navigator.share() -> "Export cancelled"
//   15d import           field-notes/1 (legacy text merged into notes), field-notes/2, unsupported schema, non-JSON
//
// Every test runs in a fresh browser context (empty IndexedDB, first-run passcode setup). The Web Share API
// is stubbed per context with context.addInitScript so the stub is installed before any app code runs.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  launch, newPage, gotoApp, setPasscode, openNewSession, addDose, saveSession, waitForText, poll,
  SEL, DEFAULT_TIMEOUT, DAY
} from '../helpers/browser.mjs';

const CODE = '1234';
const TEST_TIMEOUT = 90_000; // per test(); tests/run.mjs caps a test at 120 s
const FILE_NAME_RE = /^field-notes-\d{4}-\d{2}-\d{2}\.json$/;
const LEGACY_KEYS = ['context_text', 'reflection_in_moment', 'reflection_day_after', 'reflection_post'];

const T = {
  tabSettings: '[data-testid="tab-settings"]',
  tabSessions: '[data-testid="tab-sessions"]',
  settingsView: '[data-testid="settings-view"]',
  settingsMsg: '[data-testid="settings-msg"]',
  exportJson: '[data-testid="export-json"]',
  importLabel: '[data-testid="import-json-label"]',
  importInput: '[data-testid="import-json-input"]',
  sessionsView: '[data-testid="sessions-view"]',
  newNotes: '[data-testid="new-notes"]',
  detailNotes: '[data-testid="detail-notes"]',
  detailBack: '[data-testid="detail-back"]',
  sessionRow: (id) => `[data-testid="session-row-${id}"]`,
  sessionOpen: (id) => `[data-testid="session-open-${id}"]`,
};

// ---------------------------------------------------------------- import fixtures (inline, deterministic)

const BASE_TS = Date.UTC(2025, 0, 15, 20, 0, 0);
const ID = Object.freeze({
  v1Session: '0000000000000000000000000000a001',
  v1Dose: '0000000000000000000000000000a002',
  v2SessionA: '0000000000000000000000000000b001',
  v2DoseA: '0000000000000000000000000000b002',
  v2SessionB: '0000000000000000000000000000b003',
  v2DoseB: '0000000000000000000000000000b004',
});
const EXPERIENCE = Object.freeze({
  onset_min: 30, peak_min: 90, duration_hr: 4, intensity_1_10: 6, body_load_1_10: 3, headspace_1_10: 7,
  effects_tags: ['euphoria'], adverse_effects_text: '',
});

function mdmaDose(id, sessionId) {
  return {
    id, session_id: sessionId, substance: 'mdma', subtype: '', form: 'crystal', prep: '', amount: 100, unit: 'mg',
    claimed_potency: '', claimed_potency_unit: '', reagent: '', time_offset_min: 0, combo_type: 'first',
  };
}

/** Exactly what v1.0's exportAll() wrote: schema field-notes/1, no schema_version, four legacy text fields. */
const V1_PAYLOAD = {
  schema: 'field-notes/1',
  exported_at: BASE_TS + 60_000,
  sessions: [{
    id: ID.v1Session, started_at: BASE_TS, set_tags: ['legacy-set'], setting_tags: ['legacy-setting'],
    empty_stomach: 'partial', source_confidence: 'tested', experience: EXPERIENCE,
    context_text: 'legacy ctx', reflection_in_moment: 'legacy moment', reflection_day_after: '', reflection_post: '',
    created_at: BASE_TS, updated_at: BASE_TS,
  }],
  doses: [mdmaDose(ID.v1Dose, ID.v1Session)],
  strains: [],
  batches: [],
};
const V1_EXPECTED_NOTES = 'legacy ctx\n\nIn the moment:\nlegacy moment';

/** A v1.1 export: schema field-notes/2 with `notes`. Two sessions so its message differs from the v1 import's. */
const V2_PAYLOAD = {
  schema: 'field-notes/2',
  schema_version: 2,
  exported_at: BASE_TS + 3 * DAY,
  sessions: [
    {
      id: ID.v2SessionA, started_at: BASE_TS + DAY, set_tags: ['v2-a'], setting_tags: ['home'],
      empty_stomach: 'no', source_confidence: 'trusted', experience: EXPERIENCE, notes: 'v2 notes A',
      created_at: BASE_TS + DAY, updated_at: BASE_TS + DAY,
    },
    {
      id: ID.v2SessionB, started_at: BASE_TS + 2 * DAY, set_tags: ['v2-b'], setting_tags: ['outdoors'],
      empty_stomach: 'yes', source_confidence: 'unknown', experience: EXPERIENCE, notes: 'v2 notes B',
      created_at: BASE_TS + 2 * DAY, updated_at: BASE_TS + 2 * DAY,
    },
  ],
  doses: [mdmaDose(ID.v2DoseA, ID.v2SessionA), mdmaDose(ID.v2DoseB, ID.v2SessionB)],
  strains: [],
  batches: [],
};

/** Playwright file payload for locator.setInputFiles (in-memory, nothing written to disk). */
function jsonFile(name, obj) {
  return { name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(obj, null, 2), 'utf8') };
}

// ---------------------------------------------------------------- init scripts (serialized into the page)

/**
 * 15a: navigator.share / canShare stub + synchronicity probe.
 *
 * Safari only honours navigator.share() when it is called synchronously inside the tap's own task; an
 * awaited IndexedDB read or a timer in between loses the user activation. To prove the app does this we
 * arm two independent flags from a capture-phase click listener on `document`, which runs BEFORE React's
 * own root listener handles the same click:
 *
 *   __inClickDispatch  true from the capture listener until a bubble-phase listener on `window` (which
 *                      runs AFTER React's handler) clears it. share() entered while this is true was
 *                      called inside the click's dispatch: no other task (timer, IDB success event,
 *                      network) can run in the middle of an event dispatch.
 *   __clickTick        true from the capture listener until a setTimeout(0) scheduled by that same
 *                      listener clears it. This is the "same macrotask" check: share() entered after a
 *                      task boundary sees false. A microtask queued during the dispatch would still see
 *                      true, which is correct: that is not a task boundary and keeps Safari's activation.
 *
 * The stub records both flags in its synchronous prologue (before its first `await`), i.e. the state at
 * the exact moment the app invoked navigator.share(). __shareBeforeTimeout is the complementary check
 * from the timer's side: when the click's setTimeout(0) fires, had the stub already been invoked?
 * performance.now() is recorded on both sides so the ordering can be asserted too.
 */
function installShareStub() {
  window.__clickCount = 0;
  document.addEventListener('click', (ev) => {
    const el = ev.target;
    if (!(el instanceof Element) || !el.closest('[data-testid="export-json"]')) return;
    window.__clickCount += 1;
    window.__clickAt = performance.now();
    window.__inClickDispatch = true;
    window.__clickTick = true;
    window.__shareInvoked = false;
    window.__shareSync = null;
    window.__shareDuringDispatch = null;
    window.__shareBeforeTimeout = null;
    setTimeout(() => {
      window.__clickTick = false;
      window.__inClickDispatch = false; // belt and braces; the window listener below normally clears it
      window.__shareBeforeTimeout = window.__shareInvoked === true;
    }, 0);
  }, true);
  window.addEventListener('click', () => { window.__inClickDispatch = false; }, false);

  const share = async (data) => {
    // Synchronous prologue: runs inside the caller's task, before the first await.
    window.__shareInvoked = true;
    window.__shareAt = performance.now();
    window.__shareSync = window.__clickTick === true;
    window.__shareDuringDispatch = window.__inClickDispatch === true;
    const files = await Promise.all([...(data.files || [])].map(async (f) => ({ name: f.name, type: f.type, text: await f.text() })));
    window.__shared = { title: data.title, files };
  };
  window.__shareStub = share;
  Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true, writable: true });
}

/** 15b: no Web Share API at all (desktop browsers, Firefox, older Safari). */
function removeShareApi() {
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
}

/** 15c: the user dismisses the share sheet -> navigator.share() rejects with an AbortError. */
function installCancellingShareStub() {
  const share = async () => {
    const err = new Error('Share canceled');
    err.name = 'AbortError';
    throw err;
  };
  window.__shareStub = share;
  Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true, writable: true });
}

// ---------------------------------------------------------------- page helpers

/** Text of settings-msg, or '' (the element is only rendered while the message is non-empty). */
async function readMsg(page) {
  const loc = page.locator(T.settingsMsg);
  if ((await loc.count()) === 0) return '';
  return (await loc.textContent()) ?? '';
}

/** Poll until settings-msg differs from `previous` and matches `expected` (string or RegExp). */
function waitForNewMsg(page, previous, expected, opts = {}) {
  const ok = expected instanceof RegExp ? (t) => expected.test(t) : (t) => t.includes(expected);
  return poll(() => readMsg(page), t => t !== previous && ok(t),
    { message: `settings-msg did not become a new message matching ${expected}`, ...opts });
}

async function openSettings(page) {
  await page.click(T.tabSettings);
  await page.waitForSelector(T.settingsView, { state: 'visible' });
  await page.waitForSelector(T.exportJson, { state: 'visible' });
}

/** Create and save one session (MDMA crystal `mg`, optional notes). The app then shows the Sessions tab. */
async function createMdmaSession(page, { mg = 100, notes = '' } = {}) {
  await openNewSession(page);
  const calc = await addDose(page, 0, { substance: 'mdma', form: 'crystal', fields: { 'mdma-mg': mg } });
  assert.match(calc, new RegExp(`${mg} mg`), `dose-calculated was: ${calc}`);
  if (notes) await page.fill(T.newNotes, notes);
  await saveSession(page);
  await page.waitForSelector(T.sessionsView, { state: 'visible' });
}

/**
 * Tap "Export JSON" until the export actually starts. ImportExport prefetches the payload on mount so the
 * tap handler can call navigator.share() synchronously; if a tap beats that prefetch the app answers
 * "Preparing export - tap again in a moment" and does nothing else, so we tap again (bounded).
 * `started()` reports whether the export kicked off. Returns the number of taps used.
 */
async function tapExport(page, started, { attempts = 3 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    const before = await readMsg(page);
    await page.click(T.exportJson);
    const r = await poll(
      async () => ({ started: await started(), msg: await readMsg(page) }),
      r => r.started || (r.msg !== before && /Preparing export/.test(r.msg)),
      { message: 'export-json tap had no observable effect' }
    );
    if (r.started) return i;
  }
  throw new Error(`export-json answered "Preparing export" ${attempts} times in a row`);
}

/** Pick `file` in import-json-input, wait for a NEW settings-msg matching `expected`, and for the label to reset. */
async function importFile(page, file, expected) {
  const before = await readMsg(page);
  await page.locator(T.importInput).setInputFiles(file);
  const msg = await waitForNewMsg(page, before, expected);
  await waitForText(page.locator(T.importLabel), 'Import JSON'); // reads "Importing..." while busy
  return msg;
}

/** Open a session's detail from the Sessions tab and return the detail-notes textarea value once it equals `expected`. */
async function readDetailNotes(page, id, expected) {
  await page.click(T.tabSessions);
  await page.waitForSelector(T.sessionRow(id), { state: 'visible' });
  await page.click(T.sessionOpen(id));
  const notes = page.locator(T.detailNotes);
  await notes.waitFor({ state: 'visible' });
  const value = await poll(() => notes.inputValue(), v => v === expected,
    { message: `detail-notes of ${id} did not become ${JSON.stringify(expected)}` });
  await page.click(T.detailBack);
  await page.waitForSelector(T.sessionsView, { state: 'visible' });
  return value;
}

// ---------------------------------------------------------------- tests

let browser;

describe('v1.1 export / import (spec 15)', () => {
  before(async () => { browser = await launch(); });
  after(async () => { await browser?.close(); });

  test('15a. share path: navigator.share() gets one field-notes-<date>.json File, synchronously inside the tap', { timeout: TEST_TIMEOUT }, async () => {
    const page = await newPage(browser);
    const context = page.context();
    try {
      await context.addInitScript(installShareStub);
      await gotoApp(page);
      const stubbed = await page.evaluate(() =>
        navigator.share === window.__shareStub
        && typeof navigator.canShare === 'function'
        && navigator.canShare({ files: [] }) === true);
      assert.equal(stubbed, true, 'navigator.share must be the test stub');

      await setPasscode(page, CODE);
      await page.waitForSelector(SEL.dashboard, { state: 'visible' });
      await createMdmaSession(page, { mg: 100, notes: 'export-me' });
      await openSettings(page);

      await tapExport(page, () => page.evaluate(() => window.__shareInvoked === true));
      // Wait for the stub to finish reading the File AND for the click's setTimeout(0) to have fired.
      const shared = await poll(
        () => page.evaluate(() => (window.__shared && typeof window.__shareBeforeTimeout === 'boolean') ? window.__shared : null),
        v => v !== null,
        { message: 'navigator.share stub did not receive a payload' }
      );

      assert.equal(shared.title, 'Field Notes export');
      assert.equal(shared.files.length, 1, 'exactly one file is shared');
      const [file] = shared.files;
      assert.match(file.name, FILE_NAME_RE, `file name was ${file.name}`);
      assert.equal(file.type, 'application/json');

      const payload = JSON.parse(file.text);
      assert.equal(typeof payload, 'object');
      assert.ok(payload && !Array.isArray(payload), 'payload is a plain object');
      assert.equal(payload.schema, 'field-notes/2');
      assert.equal(payload.schema_version, 2);
      assert.ok(Number.isFinite(payload.exported_at), 'exported_at is a timestamp');
      for (const k of ['sessions', 'doses', 'strains', 'batches']) {
        assert.ok(Array.isArray(payload[k]), `${k} must be an array`);
      }
      assert.equal(payload.sessions.length, 1);
      const session = payload.sessions.find(s => s.notes === 'export-me');
      assert.ok(session, `no session with notes "export-me" in ${JSON.stringify(payload.sessions)}`);
      for (const k of LEGACY_KEYS) assert.equal(k in session, false, `legacy key ${k} must not be exported`);
      assert.equal(payload.doses.filter(d => d.session_id === session.id && d.substance === 'mdma').length, 1,
        'the MDMA dose of the exported session is in doses');

      const msg = await poll(() => readMsg(page), t => t.includes('Exported 1 sessions'),
        { message: 'settings-msg did not confirm the share export' });
      assert.match(msg, /Exported 1 sessions/);
      assert.doesNotMatch(msg, /download/, 'share path must not report a download');

      // Synchronicity proof (see installShareStub).
      const probe = await page.evaluate(() => ({
        clicks: window.__clickCount,
        invoked: window.__shareInvoked,
        sync: window.__shareSync,
        duringDispatch: window.__shareDuringDispatch,
        beforeTimeout: window.__shareBeforeTimeout,
        clickAt: window.__clickAt,
        shareAt: window.__shareAt,
      }));
      assert.equal(probe.invoked, true, 'navigator.share was invoked');
      assert.equal(probe.sync, true, `navigator.share() must run in the tap's own macrotask (export-json clicks: ${probe.clicks})`);
      assert.equal(probe.duringDispatch, true, 'navigator.share() must be entered while the click event is still being dispatched');
      assert.equal(probe.beforeTimeout, true, 'the setTimeout(0) armed by the click must find navigator.share() already invoked');
      assert.ok(Number.isFinite(probe.clickAt) && Number.isFinite(probe.shareAt), 'both timestamps recorded');
      assert.ok(probe.shareAt >= probe.clickAt, `share at ${probe.shareAt} ms precedes the click at ${probe.clickAt} ms`);
    } finally {
      await context.close();
    }
  });

  test('15b. fallback path: no Web Share API -> <a download> of field-notes-<date>.json', { timeout: TEST_TIMEOUT }, async () => {
    const page = await newPage(browser, { acceptDownloads: true });
    const context = page.context();
    try {
      await context.addInitScript(removeShareApi);
      await gotoApp(page);
      const removed = await page.evaluate(() => typeof navigator.share === 'undefined' && typeof navigator.canShare === 'undefined');
      assert.equal(removed, true, 'navigator.share and navigator.canShare must be undefined');

      await setPasscode(page, CODE);
      await page.waitForSelector(SEL.dashboard, { state: 'visible' });
      await createMdmaSession(page, { mg: 100, notes: 'download-me' });
      await openSettings(page);

      let download = null;
      const downloadPromise = page.waitForEvent('download', { timeout: DEFAULT_TIMEOUT }).then(d => (download = d));
      downloadPromise.catch(() => {}); // surfaced by the await below; only prevents an unhandled rejection
      await tapExport(page, () => download !== null);
      const dl = await downloadPromise;

      assert.match(dl.suggestedFilename(), FILE_NAME_RE, `suggested filename was ${dl.suggestedFilename()}`);
      const filePath = await dl.path();
      assert.ok(filePath, 'download must be saved to disk');
      const payload = JSON.parse(await readFile(filePath, 'utf8'));
      assert.equal(payload.schema, 'field-notes/2');
      assert.equal(payload.schema_version, 2);
      assert.equal(payload.sessions.length, 1);
      assert.equal(payload.sessions[0].notes, 'download-me');
      for (const k of LEGACY_KEYS) assert.equal(k in payload.sessions[0], false, `legacy key ${k} must not be exported`);

      const msg = await poll(() => readMsg(page), t => t.includes('Exported 1 sessions (download)'),
        { message: 'settings-msg did not confirm the download export with the "(download)" suffix' });
      assert.match(msg, /Exported 1 sessions \(download\)/, 'the app must report that it took the download path');
    } finally {
      await context.close();
    }
  });

  test('15c. share cancelled: AbortError from navigator.share() -> "Export cancelled"', { timeout: TEST_TIMEOUT }, async () => {
    const page = await newPage(browser);
    const context = page.context();
    try {
      await context.addInitScript(installCancellingShareStub);
      await gotoApp(page);
      const stubbed = await page.evaluate(() => navigator.share === window.__shareStub && navigator.canShare({ files: [] }) === true);
      assert.equal(stubbed, true, 'navigator.share must be the cancelling stub');

      await setPasscode(page, CODE);
      await page.waitForSelector(SEL.dashboard, { state: 'visible' });
      await openSettings(page);

      await tapExport(page, async () => /Export (cancelled|failed)/.test(await readMsg(page)));
      const msg = await readMsg(page);
      assert.match(msg, /Export cancelled/, `settings-msg was: ${msg}`);
      assert.doesNotMatch(msg, /failed/i, 'a dismissed share sheet is not a failure');
    } finally {
      await context.close();
    }
  });

  test('15d. import: accept attribute; field-notes/1 merges legacy text into notes; field-notes/2 works; bad schema and non-JSON fail cleanly', { timeout: TEST_TIMEOUT }, async () => {
    const page = await newPage(browser);
    const context = page.context();
    try {
      await gotoApp(page);
      await setPasscode(page, CODE);
      await page.waitForSelector(SEL.dashboard, { state: 'visible' });
      await openSettings(page);

      const input = page.locator(T.importInput);
      assert.equal(await input.getAttribute('type'), 'file');
      assert.equal(await input.getAttribute('accept'), '.json,application/json');

      // (i) field-notes/1: legacy context/reflection text is merged into `notes`.
      const msg1 = await importFile(page, jsonFile('field-notes-legacy.json', V1_PAYLOAD), 'Imported 1 sessions');
      assert.match(msg1, /Imported 1 sessions/);
      const notes1 = await readDetailNotes(page, ID.v1Session, V1_EXPECTED_NOTES);
      assert.equal(notes1, V1_EXPECTED_NOTES);
      const row1 = await waitForText(page.locator(T.sessionRow(ID.v1Session)), /MDMA/);
      assert.match(row1, /100 mg/, 'the v1 dose was imported with its session');
      await openSettings(page);

      // (ii) field-notes/2: imports as-is.
      const msg2 = await importFile(page, jsonFile('field-notes-2025-01-18.json', V2_PAYLOAD), 'Imported 2 sessions');
      assert.match(msg2, /Imported 2 sessions/);
      const notesA = await readDetailNotes(page, ID.v2SessionA, 'v2 notes A');
      assert.equal(notesA, 'v2 notes A');
      await page.waitForSelector(T.sessionRow(ID.v2SessionB), { state: 'visible' });
      await page.waitForSelector(T.sessionRow(ID.v1Session), { state: 'visible' }); // earlier import untouched
      await openSettings(page);

      // (iii) unsupported schema: rejected with a clear message, nothing imported.
      const msg3 = await importFile(page, jsonFile('future.json', { schema: 'field-notes/9' }), 'Import failed');
      assert.match(msg3, /Import failed/);
      assert.match(msg3, /Unsupported export schema/);

      // (iv) not JSON at all: rejected as a failed import.
      const msg4 = await importFile(page,
        { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('this is not json', 'utf8') },
        'Import failed');
      assert.match(msg4, /Import failed/);
      assert.doesNotMatch(msg4, /Unsupported export schema/, 'a fresh message, not the stale schema error');

      // Nothing from (iii)/(iv) leaked into the session list: still exactly the three imported sessions.
      await page.click(T.tabSessions);
      await page.waitForSelector(T.sessionRow(ID.v1Session), { state: 'visible' });
      assert.equal(await page.locator('[data-testid^="session-row-"]').count(), 3);
    } finally {
      await context.close();
    }
  });
});
