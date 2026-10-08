// Spec 4-7: v1 -> v2 schema migration of existing on-device data (Node, fake-indexeddb + the REAL
// src/db/db.js singleton, src/state/store.js and src/lib/backup.js).
//
// Mechanics (do not "simplify"):
//  - src/db/db.js exports a singleton `db` bound at construction to whatever globalThis.indexedDB was at
//    import time, so tests/helpers/db.mjs (which installs fake-indexeddb/auto) is imported FIRST, db.js is
//    imported ONCE (dynamically, in before()), and resetIndexedDB() is never called afterwards.
//  - Per-test isolation: close the singleton, Dexie.delete() the database, build the v1 database with the
//    inline v1 schema (openV1Db), close it, then db.open() the singleton. Dexie reopens a closed instance;
//    the version(2) upgrade runs during that open and db.on('ready') stamps meta.schema_version.
//  - Fixtures are deep-frozen; everything handed to the code under test is a structuredClone, so the
//    expectations are always computed from the pristine v1 records.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  setupFakeIndexedDB, openV1Db, deleteDb, resetIds, makeV1Session, makeDose, DOSE_PRESETS, makeStrain, makeBatch,
  DB_NAME, BASE_TS, DAY
} from '../helpers/db.mjs';
import {
  mergeLegacy, migrateSessionRecord, LEGACY_TEXT_FIELDS, EXPORT_SCHEMA_V1, EXPORT_SCHEMA_V2, SCHEMA_VERSION
} from '../../src/db/migrations.js';
import { hashPasscode, encryptJson, decryptJson } from '../../src/lib/crypto.js';

setupFakeIndexedDB();

// Loaded once, in before(): see "Mechanics" above.
let db;
let exportAll;
let importAll;
let restoreFromGitHub;

const PASSCODE = '1234';
const PASSPHRASE = 'correct horse';
const WS = '  \n\t ';
const STRAIN_NAMES = ['Penis Envy', 'Golden Teacher', 'Melmak', 'B+', 'Albino A+', 'Natal Super Strain', 'Tidal Wave'];
const DOSE_CYCLE = [
  {}, // makeDose default: MDMA crystal 100 mg
  DOSE_PRESETS.mdmaPressed,
  DOSE_PRESETS.psilocybin,
  DOSE_PRESETS.lsdTab,
  DOSE_PRESETS.adderallIR,
  DOSE_PRESETS.cannabisFlower,
];

// Literal expectations for two specific fixtures (spec 4).
const ALL_FOUR_INDEX = 8;
const ALL_FOUR_EXPECTED = 'c\n\nIn the moment:\nm\n\nDay after:\nd\n\nPost-integration:\np';
const REFLECTIONS_ONLY_INDEX = 7;
const REFLECTIONS_ONLY_EXPECTED = 'In the moment:\nm\n\nDay after:\nd\n\nPost-integration:\np';

// ---------------------------------------------------------------- fixtures

function legacy(context_text, reflection_in_moment, reflection_day_after, reflection_post) {
  return { context_text, reflection_in_moment, reflection_day_after, reflection_post };
}

function deepFreeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}

/** 25 v1 sessions. The index comments are referenced by the tests below. */
function buildV1Sessions() {
  const at = (i) => BASE_TS + i * DAY;
  const mk = (i, over) => makeV1Session({ started_at: at(i), created_at: at(i), updated_at: at(i) + 60_000, set_tags: [`fixture-${i}`], ...over });
  const absent = mk(10, {});
  for (const k of LEGACY_TEXT_FIELDS) delete absent[k];
  return [
    /* 0  */ mk(0, legacy('Context only.', '', '', '')),
    /* 1  */ mk(1, legacy('', 'Only in the moment.', '', '')),
    /* 2  */ mk(2, legacy('', '', 'Only day after.', '')),
    /* 3  */ mk(3, legacy('', '', '', 'Only post.')),
    /* 4  */ mk(4, legacy('', 'm4', 'd4', '')),
    /* 5  */ mk(5, legacy('', 'm5', '', 'p5')),
    /* 6  */ mk(6, legacy('', '', 'd6', 'p6')),
    /* 7  */ mk(7, legacy('', 'm', 'd', 'p')),            // reflections only, all three (literal check)
    /* 8  */ mk(8, legacy('c', 'm', 'd', 'p')),           // all four (literal check)
    /* 9  */ mk(9, legacy('', '', '', '')),               // all empty
    /* 10 */ absent,                                      // the four fields entirely absent
    /* 11 */ mk(11, legacy(WS, WS, WS, WS)),              // whitespace-only values
    /* 12 */ mk(12, { notes: 'Already migrated notes.', ...legacy('ctx12', 'm12', 'd12', 'p12') }), // notes present: kept, legacy appended
    /* 13 */ mk(13, legacy('c13', 'm13', '', '')),
    /* 14 */ mk(14, legacy('c14', '', 'd14', '')),
    /* 15 */ mk(15, legacy('c15', '', '', 'p15')),
    /* 16 */ mk(16, legacy('c16', 'm16', 'd16', '')),
    /* 17 */ mk(17, legacy('c17', 'm17', '', 'p17')),
    /* 18 */ mk(18, legacy('c18', '', 'd18', 'p18')),
    /* 19 */ mk(19, legacy('  padded context  ', '\n m19 \n', 'd19\t', ' p19')), // values are trimmed
    /* 20 */ mk(20, legacy('line one\nline two', 'inner\n\nblank line kept', '', '')), // inner newlines kept
    /* 21 */ mk(21, legacy(null, null, null, null)),      // nulls
    /* 22 */ mk(22, { notes: '', ...legacy('c22', '', '', 'p22') }), // empty notes does NOT win
    /* 23 */ mk(23, legacy(WS, 'm23', WS, '')),           // whitespace context + one reflection
    /* 24 */ mk(24, {
      ...legacy('Ünïcödé ✨ context', 'émotions', '', 'post ✓'),
      setting_tags: ['outdoors', 'friends'], empty_stomach: 'yes', source_confidence: 'unknown',
      experience: { onset_min: 45, peak_min: 120, duration_hr: 6, intensity_1_10: 8, body_load_1_10: 2, headspace_1_10: 9, effects_tags: ['visuals'], adverse_effects_text: 'jaw tension' },
    }),
  ];
}

/** 60 doses spread over all sessions and six substance/form variants. */
function buildV1Doses(sessions) {
  const combos = ['first', 'sequential', 'stacked'];
  return Array.from({ length: 60 }, (_, i) => makeDose(sessions[i % sessions.length].id, {
    ...DOSE_CYCLE[i % DOSE_CYCLE.length],
    time_offset_min: (i % 4) * 30,
    combo_type: combos[i % combos.length],
  }));
}

/** Deterministic v1 data set: 25 sessions, 60 doses, 7 strains, 3 batches, meta + backupCfg rows. Deep-frozen. */
async function buildFixture() {
  resetIds();
  const sessions = buildV1Sessions();
  const doses = buildV1Doses(sessions);
  const strains = STRAIN_NAMES.map(name => makeStrain({ name }));
  const batches = [
    makeBatch(),
    makeBatch({ substance: 'psilocybin', vendor: 'grower', acquired_date: BASE_TS - 30 * DAY, notes: 'dried' }),
    makeBatch({ substance: 'lsd', vendor: 'friend', acquired_date: BASE_TS - 2 * DAY }),
  ];
  const meta = [
    { key: 'passcode', value: await hashPasscode(PASSCODE) },
    { key: 'passcode_len', value: 4 },
    { key: 'theme', value: 'dark' },
    { key: 'onboarded', value: true },
  ];
  const backupCfg = [
    { key: 'github', value: { pat: 'ghp_test', owner: 'o', repo: 'r', path: 'backups/field-notes.json', branch: 'main' } },
  ];
  assert.equal(sessions.length, 25);
  assert.equal(doses.length, 60);
  assert.deepEqual([...new Set(doses.map(d => d.substance))].sort(), ['adderall', 'cannabis', 'lsd', 'mdma', 'psilocybin'], 'doses cover several substances');
  return deepFreeze({ sessions, doses, strains, batches, meta, backupCfg });
}

function v1Payload(fix) {
  return structuredClone({
    schema: EXPORT_SCHEMA_V1,
    sessions: fix.sessions, doses: fix.doses, strains: fix.strains, batches: fix.batches,
  });
}

// ---------------------------------------------------------------- db helpers

/** JSON.stringify of a table's rows sorted by primary key (byte-identity comparisons). */
async function snapshot(table) {
  const keyPath = table.schema.primKey.keyPath;
  const rows = await table.toArray();
  rows.sort((a, b) => (a[keyPath] < b[keyPath] ? -1 : a[keyPath] > b[keyPath] ? 1 : 0));
  return JSON.stringify(rows);
}

/** { tableName: rows[] } for every table of a Dexie instance (deepEqual comparisons). */
async function snapshotAll(dexie) {
  const out = {};
  for (const t of dexie.tables) out[t.name] = JSON.parse(await snapshot(t));
  return out;
}

/** Native IndexedDB version of the database (Dexie version x 10), via a raw open on the fake factory. */
function nativeVersion(name = DB_NAME) {
  return new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open(name);
    req.onupgradeneeded = () => { req.transaction.abort(); reject(new Error(`database ${name} does not exist`)); };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { const v = req.result.version; req.result.close(); resolve(v); };
  });
}

/** Close the singleton, drop the database, write the fixture with the inline v1 schema. Returns v1 snapshots. */
async function buildV1Database(fix) {
  db.close();
  await deleteDb();
  const v1 = await openV1Db();
  try {
    assert.equal(v1.verno, 1);
    await v1.sessions.bulkAdd(structuredClone(fix.sessions));
    await v1.doses.bulkAdd(structuredClone(fix.doses));
    await v1.strains.bulkAdd(structuredClone(fix.strains));
    await v1.batches.bulkAdd(structuredClone(fix.batches));
    await v1.meta.bulkAdd(structuredClone(fix.meta));
    await v1.backupCfg.bulkAdd(structuredClone(fix.backupCfg));
    const before = {
      sessions: await snapshot(v1.sessions),
      doses: await snapshot(v1.doses),
      strains: await snapshot(v1.strains),
      batches: await snapshot(v1.batches),
      meta: await snapshot(v1.meta),
      backupCfg: await snapshot(v1.backupCfg),
    };
    assert.equal(await nativeVersion(), 10, 'Dexie version(1) is native version 10');
    return before;
  } finally {
    v1.close();
  }
}

/** Close the singleton, drop the database and open the singleton on an empty origin (fresh v2 install). */
async function freshV2Db() {
  db.close();
  await deleteDb();
  await db.open();
  assert.equal(db.verno, 2);
  assert.equal(await db.sessions.count(), 0);
  assert.equal(await db.doses.count(), 0);
}

/** Every session row in the singleton equals the v2 shape of its original v1 fixture record. */
async function assertSessionsMigrated(fix, label) {
  const rows = await db.sessions.toArray();
  assert.equal(rows.length, fix.sessions.length, `${label}: session count`);
  const byId = new Map(fix.sessions.map(s => [s.id, s]));
  for (const row of rows) {
    const original = byId.get(row.id);
    const idx = fix.sessions.indexOf(original);
    assert.ok(original, `${label}: unexpected session ${row.id}`);
    assert.equal(typeof row.notes, 'string', `${label}: session #${idx} notes must be a string`);
    assert.equal(row.notes, mergeLegacy(original), `${label}: session #${idx} notes`);
    for (const k of LEGACY_TEXT_FIELDS) assert.ok(!(k in row), `${label}: session #${idx} still has ${k}`);
    // Every other field survives unchanged.
    assert.deepEqual(row, migrateSessionRecord(structuredClone(original)), `${label}: session #${idx} record`);
  }
}

// ---------------------------------------------------------------- tests

describe('migration: v1 -> v2 (Node, fake-indexeddb, real db.js singleton)', () => {
  before(async () => {
    ({ db } = await import('../../src/db/db.js'));
    ({ exportAll, importAll } = await import('../../src/state/store.js'));
    ({ restoreFromGitHub } = await import('../../src/lib/backup.js'));
    assert.equal(db.name, DB_NAME);
    assert.equal(SCHEMA_VERSION, 2);
  });

  after(async () => {
    db?.close();
    await deleteDb().catch(() => {});
  });

  test('4. migration: populated v1 DB opens at v2 with notes merged, legacy keys gone, everything else byte-identical', { timeout: 60_000 }, async () => {
    const fix = await buildFixture();
    const before = await buildV1Database(fix);

    await db.open();
    try {
      assert.equal(db.verno, 2);
      assert.equal(await nativeVersion(), 20, 'Dexie version(2) is native version 20');
      assert.equal(await db.sessions.count(), 25, 'session count unchanged');

      await assertSessionsMigrated(fix, 'upgrade');

      // Literal expectations.
      const get = (i) => db.sessions.get(fix.sessions[i].id);
      assert.equal((await get(ALL_FOUR_INDEX)).notes, ALL_FOUR_EXPECTED);
      const reflectionsOnly = (await get(REFLECTIONS_ONLY_INDEX)).notes;
      assert.equal(reflectionsOnly, REFLECTIONS_ONLY_EXPECTED);
      assert.ok(!reflectionsOnly.startsWith('\n'), 'reflections-only notes have no leading blank line');
      assert.equal((await get(0)).notes, 'Context only.');
      assert.equal((await get(1)).notes, 'In the moment:\nOnly in the moment.');
      assert.equal((await get(9)).notes, '', 'all-empty -> empty notes');
      assert.equal((await get(10)).notes, '', 'absent fields -> empty notes');
      assert.equal((await get(11)).notes, '', 'whitespace-only -> empty notes');
      assert.equal((await get(21)).notes, '', 'nulls -> empty notes');
      assert.equal((await get(12)).notes,
        'Already migrated notes.\n\nctx12\n\nIn the moment:\nm12\n\nDay after:\nd12\n\nPost-integration:\np12',
        'existing non-empty notes are kept first and legacy text is appended, never discarded');
      assert.equal((await get(22)).notes, 'c22\n\nPost-integration:\np22', 'empty notes do not win');
      assert.equal((await get(19)).notes, 'padded context\n\nIn the moment:\nm19\n\nDay after:\nd19\n\nPost-integration:\np19');
      assert.equal((await get(20)).notes, 'line one\nline two\n\nIn the moment:\ninner\n\nblank line kept');
      assert.equal((await get(23)).notes, 'In the moment:\nm23');
      assert.equal((await get(24)).notes, 'Ünïcödé ✨ context\n\nIn the moment:\némotions\n\nPost-integration:\npost ✓');

      // Other tables: byte-identical.
      assert.equal(await db.doses.count(), 60);
      assert.equal(await db.strains.count(), 7);
      assert.equal(await db.batches.count(), 3);
      assert.equal(await snapshot(db.doses), before.doses, 'doses byte-identical');
      assert.equal(await snapshot(db.strains), before.strains, 'strains byte-identical');
      assert.equal(await snapshot(db.batches), before.batches, 'batches byte-identical');
      assert.equal(await snapshot(db.backupCfg), before.backupCfg, 'backupCfg byte-identical');

      // meta: existing rows untouched, schema_version stamped.
      assert.deepEqual(await db.meta.get('passcode'), { key: 'passcode', value: fix.meta[0].value });
      assert.deepEqual(await db.meta.get('passcode_len'), { key: 'passcode_len', value: 4 });
      assert.deepEqual(await db.meta.get('schema_version'), { key: 'schema_version', value: 2 });
      const metaAfter = JSON.parse(await snapshot(db.meta)).filter(r => r.key !== 'schema_version');
      assert.deepEqual(metaAfter, JSON.parse(before.meta), 'meta rows other than schema_version are unchanged');
      assert.equal(await db.meta.count(), fix.meta.length + 1);
    } finally {
      db.close();
    }
  });

  test('5. idempotency: reopening the migrated DB changes nothing; migrateSessionRecord/mergeLegacy are stable', { timeout: 60_000 }, async () => {
    const fix = await buildFixture();
    await buildV1Database(fix);

    await db.open();
    try {
      const first = await snapshotAll(db);
      assert.equal(Object.keys(first).length, 6);
      assert.equal(first.sessions.length, 25);

      db.close();
      await db.open();
      assert.equal(db.verno, 2);
      assert.equal(await nativeVersion(), 20);
      const second = await snapshotAll(db);
      assert.deepEqual(second, first, 'second open leaves every table identical');

      db.close();
      await db.open();
      assert.deepEqual(await snapshotAll(db), first, 'third open leaves every table identical');
      await assertSessionsMigrated(fix, 'reopened');

      // Pure helpers on the fixtures.
      for (const original of fix.sessions) {
        const once = migrateSessionRecord(structuredClone(original));
        const twice = migrateSessionRecord(structuredClone(once));
        assert.deepEqual(twice, once);
        assert.equal(mergeLegacy(once), once.notes, 'mergeLegacy on a v2 record returns its notes unchanged');
        assert.equal(mergeLegacy(structuredClone(original)), once.notes);
      }
      for (const row of await db.sessions.toArray()) {
        assert.equal(mergeLegacy(row), row.notes);
        assert.deepEqual(migrateSessionRecord(structuredClone(row)), row);
      }
      // A v2 record with stray legacy text: notes are kept first and the legacy text is appended (never discarded).
      assert.equal(mergeLegacy({ notes: 'kept', context_text: 'stray ctx', reflection_post: 'stray post' }), 'kept\n\nstray ctx\n\nPost-integration:\nstray post');
      // ...and that is idempotent: once merged, a second pass changes nothing.
      const mixed = migrateSessionRecord({ notes: 'kept', context_text: 'stray ctx', reflection_post: 'stray post' });
      assert.deepEqual(migrateSessionRecord(structuredClone(mixed)), mixed);
    } finally {
      db.close();
    }
  });

  test('6. import: field-notes/1 is merged, field-notes/2 round-trips through exportAll, bad payloads are rejected and leave the DB untouched', { timeout: 60_000 }, async () => {
    const fix = await buildFixture();
    await freshV2Db();
    try {
      // (a) v1 payload -> merged sessions, no legacy keys, counts right.
      const r1 = await importAll(v1Payload(fix));
      assert.deepEqual(r1, { sessions: 25, doses: 60 });
      await assertSessionsMigrated(fix, 'importAll(v1)');
      assert.equal(await db.doses.count(), 60);
      assert.equal(await db.strains.count(), 7);
      assert.equal(await db.batches.count(), 3);
      assert.equal(JSON.stringify(structuredClone(fix.doses).sort((a, b) => (a.id < b.id ? -1 : 1))), await snapshot(db.doses));

      // (b) exportAll shape, then v2 round-trip into a fresh DB.
      const exp1 = await exportAll();
      assert.equal(exp1.schema, EXPORT_SCHEMA_V2);
      assert.equal(exp1.schema, 'field-notes/2');
      assert.equal(exp1.schema_version, 2);
      assert.equal(typeof exp1.exported_at, 'number');
      assert.equal(exp1.sessions.length, 25);
      assert.equal(exp1.doses.length, 60);
      assert.equal(exp1.strains.length, 7);
      assert.equal(exp1.batches.length, 3);
      for (const s of exp1.sessions) for (const k of LEGACY_TEXT_FIELDS) assert.ok(!(k in s), `exported session has ${k}`);

      await freshV2Db();
      const r2 = await importAll(structuredClone(exp1));
      assert.deepEqual(r2, { sessions: 25, doses: 60 });
      const exp2 = await exportAll();
      const strip = ({ exported_at, ...rest }) => rest;
      assert.deepEqual(strip(exp2), strip(exp1), 'export -> import -> export is lossless (ignoring exported_at)');
      await assertSessionsMigrated(fix, 'importAll(v2)');

      // (c) Rejections: Error naming the schema / saying unsupported; DB unchanged.
      const before = await snapshotAll(db);
      const cases = [
        { name: 'field-notes/3', payload: { schema: 'field-notes/3', sessions: [], doses: [] }, re: /unsupported[^]*field-notes\/3/i },
        { name: 'schema missing', payload: { sessions: structuredClone(fix.sessions), doses: structuredClone(fix.doses), strains: [], batches: [] }, re: /unsupported[^]*schema/i },
        { name: 'null', payload: null, re: /not a field notes export|unsupported/i },
        { name: 'string', payload: 'field-notes/2', re: /not a field notes export|unsupported/i },
        { name: '{}', payload: {}, re: /unsupported[^]*schema/i },
      ];
      for (const c of cases) {
        await assert.rejects(
          importAll(c.payload),
          (e) => e instanceof Error && c.re.test(e.message),
          `importAll(${c.name}) must reject with an Error matching ${c.re}`
        );
      }
      assert.deepEqual(await snapshotAll(db), before, 'rejected imports leave every table untouched');
      assert.equal(await db.sessions.count(), 25);
    } finally {
      db.close();
    }
  });

  test('7. encrypted backup: v1 payload round-trips via encryptJson/decryptJson and restoreFromGitHub; wrong passphrase -> BAD_PASSPHRASE, DB untouched', { timeout: 120_000 }, async () => {
    const fix = await buildFixture();
    const payload = v1Payload(fix);
    const realFetch = globalThis.fetch;

    const env = await encryptJson(payload, PASSPHRASE);
    assert.equal(env.v, 1);
    for (const k of ['salt', 'iv', 'ct']) assert.equal(typeof env[k], 'string', `envelope.${k}`);
    assert.ok(!JSON.stringify(env).includes('Context only.'), 'ciphertext does not contain plaintext');

    const data = await decryptJson(env, PASSPHRASE);
    assert.deepEqual(data, payload, 'decrypt(encrypt(x)) === x');

    await freshV2Db();
    try {
      // (a) decrypt + importAll -> merged notes present.
      const r = await importAll(data);
      assert.deepEqual(r, { sessions: 25, doses: 60 });
      await assertSessionsMigrated(fix, 'decryptJson+importAll');
      assert.equal((await db.sessions.get(fix.sessions[ALL_FOUR_INDEX].id)).notes, ALL_FOUR_EXPECTED);

      // (b) wrong passphrase -> BAD_PASSPHRASE, nothing written.
      const untouched = await snapshotAll(db);
      await assert.rejects(decryptJson(env, 'wrong'), (e) => e instanceof Error && e.code === 'BAD_PASSPHRASE');
      assert.deepEqual(await snapshotAll(db), untouched);

      // (c) the real restore path with a stubbed GitHub Contents API (base64 wrapped at 60 cols like GitHub).
      await freshV2Db();
      const calls = [];
      const ghBase64 = (text) => Buffer.from(text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n');
      globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), init });
        return { ok: true, status: 200, json: async () => ({ content: ghBase64(JSON.stringify(env)) }) };
      };
      const cfg = { owner: 'o', repo: 'r', path: 'p', branch: 'main', pat: 'x' };
      const res = await restoreFromGitHub(cfg, PASSPHRASE);
      assert.deepEqual(res, { count: 25 });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://api.github.com/repos/o/r/contents/p?ref=main');
      assert.equal(calls[0].init?.headers?.Authorization, 'Bearer x');
      await assertSessionsMigrated(fix, 'restoreFromGitHub');
      assert.equal(await db.doses.count(), 60);
      assert.equal(await db.strains.count(), 7);
      assert.equal(await db.batches.count(), 3);

      const restored = await snapshotAll(db);
      await assert.rejects(restoreFromGitHub(cfg, 'wrong'), (e) => e instanceof Error && e.code === 'BAD_PASSPHRASE');
      assert.equal(calls.length, 2, 'the wrong-passphrase attempt still fetched the backup');
      assert.deepEqual(await snapshotAll(db), restored, 'a failed restore leaves every table untouched');
    } finally {
      globalThis.fetch = realFetch;
      db.close();
    }
  });
});
