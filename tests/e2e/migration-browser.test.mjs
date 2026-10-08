// Spec 4b: the real-device migration path (Playwright + node:test). Requires BASE_URL (set by tests/run.mjs).
//
// A fresh browser context gets a NATIVE IndexedDB 'field-notes-db' shaped exactly like the database the v1
// app's Dexie wrote (built on the app origin via a non-app page, before the app ever runs). The v1.1 app is
// then loaded and must upgrade it in place: the passcode survives (lock screen in ENTER mode, no setup),
// sessions/doses survive, and the four legacy free-text fields are merged into `notes`.
//
// Version mapping (Dexie multiplies a declared version by 10 for the native IDBDatabase.version):
//   Dexie db.version(1)  ==  native version 10   <- what the v1 app wrote (what this test creates by hand)
//   Dexie db.version(2)  ==  native version 20   <- what v1.1 upgrades it to
// Native schema for the v1 spec 'id, a, b' is: object store { keyPath: 'id', autoIncrement: false } with one
// index per secondary key, named after its keyPath, { unique: false, multiEntry: false }. Dexie adds no
// internal stores. The schema below is derived from tests/helpers/db.mjs V1_STORES so it cannot drift.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { launch, newPage, gotoApp, unlock, waitForText, poll, BASE_URL, SEL } from '../helpers/browser.mjs';
import { resetIds, makeV1Session, makeDose, DOSE_PRESETS, V1_STORES, DB_NAME, BASE_TS, DAY } from '../helpers/db.mjs';
import { mergeLegacy, LEGACY_TEXT_FIELDS } from '../../src/db/migrations.js';
import { hashPasscode } from '../../src/lib/crypto.js';

const CODE = '1234';
const NATIVE_V1 = 10; // Dexie version(1)
const NATIVE_V2 = 20; // Dexie version(2)

let browser;

// ---------------------------------------------------------------- native schema from the Dexie v1 spec

/** 'id, a, b' -> { keyPath: 'id', indexes: ['a', 'b'] }. Only the plain syntax v1 uses is supported. */
function nativeSchemaFromDexieSpec(stores) {
  const out = {};
  for (const [name, spec] of Object.entries(stores)) {
    const parts = spec.split(',').map(s => s.trim()).filter(Boolean);
    for (const p of parts) {
      assert.match(p, /^[A-Za-z_][A-Za-z0-9_]*$/, `V1_STORES.${name} uses Dexie syntax this test does not model: "${spec}"`);
    }
    out[name] = { keyPath: parts[0], indexes: parts.slice(1) };
  }
  return out;
}

/** Create the native v1 database with `schema` and insert `rows` ({ store: [records] }). Closes it afterwards. */
function createNativeV1Db(page, { name, version, schema, rows }) {
  return page.evaluate(async ({ name, version, schema, rows }) => {
    let upgraded = false;
    const req = indexedDB.open(name, version);
    const dbh = await new Promise((resolve, reject) => {
      req.onupgradeneeded = (ev) => {
        upgraded = true;
        if (ev.oldVersion !== 0) {
          req.transaction.abort();
          reject(new Error(`expected an empty origin, found native version ${ev.oldVersion}`));
          return;
        }
        const d = req.result;
        for (const [store, { keyPath, indexes }] of Object.entries(schema)) {
          const os = d.createObjectStore(store, { keyPath, autoIncrement: false });
          for (const idx of indexes) os.createIndex(idx, idx, { unique: false, multiEntry: false });
        }
      };
      req.onblocked = () => reject(new Error('open blocked'));
      req.onerror = () => reject(req.error || new Error('open failed'));
      req.onsuccess = () => resolve(req.result);
    });
    try {
      if (!upgraded) throw new Error(`${name} already existed at native version ${dbh.version}`);
      await new Promise((resolve, reject) => {
        const tx = dbh.transaction(Object.keys(rows), 'readwrite');
        for (const [store, list] of Object.entries(rows)) {
          for (const r of list) tx.objectStore(store).add(r);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('write failed'));
        tx.onabort = () => reject(tx.error || new Error('write aborted'));
      });
      const stores = {};
      const tx = dbh.transaction(Array.from(dbh.objectStoreNames), 'readonly');
      for (const n of Array.from(dbh.objectStoreNames)) {
        const os = tx.objectStore(n);
        stores[n] = { keyPath: os.keyPath, indexes: Array.from(os.indexNames).sort() };
      }
      return { version: dbh.version, stores };
    } finally {
      dbh.close();
    }
  }, { name, version, schema, rows });
}

/** Raw read of the database as it is now: native version, store names, meta/sessions/doses rows. */
function readNativeDb(page, name) {
  return page.evaluate(async (name) => {
    const req = indexedDB.open(name); // no version: opens whatever exists, never upgrades
    const dbh = await new Promise((resolve, reject) => {
      req.onupgradeneeded = () => { req.transaction.abort(); reject(new Error(`${name} does not exist`)); };
      req.onerror = () => reject(req.error || new Error('open failed'));
      req.onsuccess = () => resolve(req.result);
    });
    try {
      const tx = dbh.transaction(['meta', 'sessions', 'doses'], 'readonly');
      const all = (store) => new Promise((resolve, reject) => {
        const r = tx.objectStore(store).getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const [meta, sessions, doses] = await Promise.all([all('meta'), all('sessions'), all('doses')]);
      return { version: dbh.version, stores: Array.from(dbh.objectStoreNames).sort(), meta, sessions, doses };
    } finally {
      dbh.close();
    }
  }, name);
}

// ---------------------------------------------------------------- fixtures

function buildFixture(passcodeHash) {
  resetIds();
  const at = (i) => BASE_TS + i * DAY;
  const mk = (i, legacyFields) => makeV1Session({
    started_at: at(i), created_at: at(i), updated_at: at(i), set_tags: [`fixture-${i}`], ...legacyFields,
  });
  const contextOnly = mk(0, {
    context_text: 'Quiet evening at home, candles lit.',
    reflection_in_moment: '', reflection_day_after: '', reflection_post: '',
  });
  const allFour = mk(1, {
    context_text: 'Forest walk with two close friends.',
    reflection_in_moment: 'Waves of warmth; music felt tactile.',
    reflection_day_after: 'Slept well, mild afterglow.',
    reflection_post: 'Journaled and called a friend.',
  });
  const empty = mk(2, { context_text: '', reflection_in_moment: '', reflection_day_after: '', reflection_post: '' });
  const sessions = [contextOnly, allFour, empty];
  const doses = [
    makeDose(allFour.id),                                   // MDMA crystal 100 mg
    makeDose(contextOnly.id, DOSE_PRESETS.psilocybin),      // psilocybin 1.5 g
    makeDose(empty.id, DOSE_PRESETS.lsdTab),                // LSD tab
  ];
  const meta = [
    { key: 'passcode', value: passcodeHash },
    { key: 'passcode_len', value: 4 },
    { key: 'onboarded', value: true },
  ];
  return { sessions, doses, meta, contextOnly, allFour, empty };
}

// ---------------------------------------------------------------- test

describe('migration (browser): native v1 database upgraded in place by the v1.1 app', () => {
  before(async () => { browser = await launch(); });
  after(async () => { await browser?.close(); });

  test('4b. migration: v1 IndexedDB (native 10) -> app unlocks with the old passcode, data survives, notes merged, native 20', { timeout: 90_000 }, async () => {
    const page = await newPage(browser);
    const context = page.context();
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()}`); });

    try {
      const passcodeHash = await hashPasscode(CODE);
      const fix = buildFixture(passcodeHash);
      const expectedNotes = Object.fromEntries(fix.sessions.map(s => [s.id, mergeLegacy(s)]));
      // Sanity of the fixture itself: the merged text really exercises all four fields.
      assert.equal(expectedNotes[fix.contextOnly.id], fix.contextOnly.context_text);
      assert.equal(expectedNotes[fix.empty.id], '');
      assert.equal(
        expectedNotes[fix.allFour.id],
        `${fix.allFour.context_text}\n\nIn the moment:\n${fix.allFour.reflection_in_moment}\n\nDay after:\n${fix.allFour.reflection_day_after}\n\nPost-integration:\n${fix.allFour.reflection_post}`
      );

      // 1. Build the v1 database on the app origin WITHOUT running the app (manifest is a same-origin, non-app URL).
      await page.goto(BASE_URL + 'manifest.webmanifest', { waitUntil: 'load' });
      assert.equal(new URL(page.url()).origin, new URL(BASE_URL).origin);
      assert.equal(await page.locator(SEL.keypad).count(), 0, 'the app must not be running yet');

      const schema = nativeSchemaFromDexieSpec(V1_STORES);
      const created = await createNativeV1Db(page, {
        name: DB_NAME,
        version: NATIVE_V1,
        schema,
        rows: { sessions: fix.sessions, doses: fix.doses, meta: fix.meta },
      });
      assert.equal(created.version, NATIVE_V1, 'v1 database created at native version 10');
      assert.deepEqual(Object.keys(created.stores).sort(), Object.keys(V1_STORES).sort());
      for (const [store, { keyPath, indexes }] of Object.entries(schema)) {
        assert.deepEqual(created.stores[store], { keyPath, indexes: [...indexes].sort() }, `native schema of ${store}`);
      }

      // 2. First launch of the app against that database: ENTER mode, old passcode works, no setup.
      await gotoApp(page);
      await page.waitForSelector(SEL.keypad, { state: 'visible' });
      assert.equal(await page.locator('[data-testid="lock-shell"]').count(), 1, 'app starts locked');
      assert.equal(await page.locator('[data-testid="length-choice"]').count(), 0, 'lock screen must be in ENTER mode (no length choice)');
      assert.equal(await page.getByText('Enter passcode', { exact: true }).count(), 1, 'lock screen heading is "Enter passcode"');
      assert.equal(await page.locator('[data-testid="passcode-dots"] > *').count(), 4, 'passcode_len 4 survived');
      assert.equal(await page.locator(SEL.dashboard).count(), 0);

      await unlock(page, CODE);
      await page.waitForSelector('[data-testid="app-shell"]', { state: 'visible' });
      await page.waitForSelector(SEL.dashboard, { state: 'visible' });
      assert.equal(await page.locator(SEL.lockError).count(), 0, 'no lock error after unlocking with the migrated passcode');
      assert.equal(await page.locator('[data-testid="length-choice"]').count(), 0);

      // 3. Dashboard lists the migrated substances with their labels.
      for (const [sub, label] of [['mdma', 'MDMA'], ['psilocybin', 'Psilocybin'], ['lsd', 'LSD']]) {
        const text = await waitForText(page.locator(`[data-testid="status-label-${sub}"]`), label);
        assert.equal(text.trim(), label, `status-label-${sub}`);
      }
      assert.equal(await page.locator('[data-testid^="status-"]:not([data-testid^="status-label-"]):not([data-testid^="status-basis-"]):not([data-testid^="status-color-"])').count(), 3, 'exactly three substance status cards');
      for (const s of fix.sessions) {
        await page.locator(`[data-testid="recent-${s.id}"]`).waitFor({ state: 'visible' });
      }

      // 4. Sessions tab shows the three migrated sessions (onboarded meta survived too: no Welcome overlay).
      await page.click('[data-testid="tab-sessions"]');
      await page.waitForSelector('[data-testid="sessions-view"]', { state: 'visible' });
      const rows = page.locator('[data-testid^="session-row-"]');
      await poll(() => rows.count(), n => n === 3, { message: 'Sessions tab did not show 3 rows' });
      for (const s of fix.sessions) {
        assert.equal(await page.locator(`[data-testid="session-row-${s.id}"]`).count(), 1, `row for session ${s.id}`);
      }
      assert.equal(await page.locator('[data-testid="welcome"]').count(), 0, 'onboarded meta row survived: no Welcome overlay');

      // 5. Session detail: notes === mergeLegacy(record) for the all-four session, context text for the context-only one.
      async function openDetailNotes(id, expected) {
        await page.click(`[data-testid="session-open-${id}"]`);
        await page.waitForSelector('[data-testid="session-detail"]', { state: 'visible' });
        const textarea = page.locator('[data-testid="detail-notes"]');
        await textarea.waitFor({ state: 'visible' });
        const value = await poll(() => textarea.inputValue(), v => v === expected, {
          message: `detail-notes for session ${id} did not equal the merged legacy text`,
        });
        assert.equal(value, expected);
        await page.click('[data-testid="detail-back"]');
        await page.waitForSelector('[data-testid="sessions-view"]', { state: 'visible' });
      }
      await openDetailNotes(fix.allFour.id, expectedNotes[fix.allFour.id]);
      await openDetailNotes(fix.contextOnly.id, fix.contextOnly.context_text);
      await openDetailNotes(fix.empty.id, '');

      // 6. Raw IndexedDB read-back: native version 20, meta.schema_version 2, records migrated, meta untouched.
      const after = await readNativeDb(page, DB_NAME);
      assert.equal(after.version, NATIVE_V2, 'Dexie version(2) is native version 20');
      assert.deepEqual(after.stores, Object.keys(V1_STORES).sort(), 'no stores added or dropped');

      const metaByKey = Object.fromEntries(after.meta.map(r => [r.key, r.value]));
      assert.equal(metaByKey.schema_version, 2, 'meta.schema_version stamped');
      assert.deepEqual(metaByKey.passcode, passcodeHash, 'passcode hash untouched');
      assert.equal(metaByKey.passcode_len, 4);
      assert.equal(metaByKey.onboarded, true);

      assert.equal(after.sessions.length, 3);
      const byId = new Map(fix.sessions.map(s => [s.id, s]));
      for (const row of after.sessions) {
        const original = byId.get(row.id);
        assert.ok(original, `unexpected session ${row.id}`);
        assert.equal(row.notes, expectedNotes[row.id], `notes of session ${row.id}`);
        for (const k of LEGACY_TEXT_FIELDS) assert.ok(!(k in row), `session ${row.id} still has ${k}`);
        const { context_text, reflection_in_moment, reflection_day_after, reflection_post, ...rest } = original;
        assert.deepEqual(row, { ...rest, notes: expectedNotes[row.id] }, `all other fields of session ${row.id} survived`);
      }
      const sortById = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      assert.deepEqual([...after.doses].sort(sortById), [...fix.doses].sort(sortById), 'doses byte-identical');
    } catch (err) {
      if (consoleErrors.length) err.message += `\n\nbrowser errors:\n${consoleErrors.join('\n')}`;
      throw err;
    } finally {
      await context.close();
    }
  });
});
