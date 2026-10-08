// Proves the Node harness works: fake-indexeddb + Dexie with the inline v1 schema,
// and that the pure lib modules import without a DOM.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  setupFakeIndexedDB, openV1Db, deleteDb, resetIds, makeV1Session, makeDose, DOSE_PRESETS, V1_STORES, DB_NAME, DAY, BASE_TS
} from '../helpers/db.mjs';
import { calcDose } from '../../src/lib/doses.js';
import { intervalsFor } from '../../src/lib/intervals.js';
import { checkInteractions } from '../../src/lib/interactions.js';

const { resetIndexedDB } = setupFakeIndexedDB();

describe('node harness: fake-indexeddb + Dexie v1 schema', () => {
  beforeEach(() => {
    resetIndexedDB();
    resetIds();
  });

  test('opens a v1 DB, writes 3 sessions + 5 doses, reads them back, then deletes the DB', async () => {
    const db = await openV1Db();
    assert.equal(db.name, DB_NAME);
    assert.equal(db.verno, 1);
    assert.deepEqual(db.tables.map(t => t.name).sort(), Object.keys(V1_STORES).sort());

    const sessions = [
      makeV1Session(),
      makeV1Session({ started_at: BASE_TS + 3 * DAY, set_tags: ['focused'] }),
      makeV1Session({ started_at: BASE_TS + 10 * DAY, setting_tags: ['outdoors', 'friends'] }),
    ];
    const doses = [
      makeDose(sessions[0].id),
      makeDose(sessions[0].id, { ...DOSE_PRESETS.adderallIR, combo_type: 'sequential', time_offset_min: 60 }),
      makeDose(sessions[1].id, DOSE_PRESETS.psilocybin),
      makeDose(sessions[2].id, DOSE_PRESETS.lsdTab),
      makeDose(sessions[2].id, { ...DOSE_PRESETS.cannabisFlower, combo_type: 'stacked', time_offset_min: 120 }),
    ];
    assert.equal(sessions[0].id, '0'.repeat(31) + '1', 'ids are deterministic');

    await db.sessions.bulkAdd(sessions);
    await db.doses.bulkAdd(doses);

    assert.equal(await db.sessions.count(), 3);
    assert.equal(await db.doses.count(), 5);

    const newestFirst = await db.sessions.orderBy('started_at').reverse().toArray();
    assert.deepEqual(newestFirst.map(s => s.id), [sessions[2].id, sessions[1].id, sessions[0].id]);

    const forFirst = await db.doses.where({ session_id: sessions[0].id }).sortBy('time_offset_min');
    assert.deepEqual(forFirst.map(d => d.substance), ['mdma', 'adderall']);

    const psilo = await db.doses.where({ substance: 'psilocybin' }).toArray();
    assert.equal(psilo.length, 1);
    assert.equal(psilo[0].amount, 1.5);

    const round = await db.sessions.get(sessions[0].id);
    assert.deepEqual(round, sessions[0], 'session record round-trips unchanged');

    db.close();
    await deleteDb();

    const again = await openV1Db();
    assert.equal(await again.sessions.count(), 0, 'database was deleted');
    assert.equal(await again.doses.count(), 0);
    again.close();
  });

  test('resetIndexedDB() gives the next open an empty origin', async () => {
    const db = await openV1Db();
    await db.sessions.add(makeV1Session());
    assert.equal(await db.sessions.count(), 1);
    db.close();

    resetIndexedDB();

    const db2 = await openV1Db();
    assert.equal(await db2.sessions.count(), 0);
    db2.close();
  });
});

describe('pure lib modules (plain ESM, no DOM)', () => {
  test('calcDose: MDMA pressed 1.5 units x 100 mg -> 150 mg', () => {
    const r = calcDose({ substance: 'mdma', form: 'pressed', amount: 1.5, unit: 'units', claimed_potency: 100, claimed_potency_unit: 'mg' });
    assert.equal(r.total, 150);
    assert.equal(r.totalUnit, 'mg');
    assert.ok(r.display.includes('150 mg'), `display was ${r.display}`);
  });

  test('intervalsFor: psilocybin 1.5 g -> 6 days, 3.5 g -> 14 days', () => {
    assert.equal(intervalsFor({ substance: 'psilocybin', total: 1.5, totalUnit: 'g' }).minMs, 6 * DAY);
    assert.equal(intervalsFor({ substance: 'psilocybin', total: 3.5, totalUnit: 'g' }).minMs, 14 * DAY);
  });

  test('checkInteractions: hippy flip naming and MDMA + Adderall', () => {
    const hf = checkInteractions(['mdma', 'psilocybin']).map(w => w.title.toLowerCase());
    assert.ok(hf.some(t => t.includes('hippy flip')), `titles: ${hf.join(' | ')}`);
    assert.ok(!hf.some(t => t.includes('candyflip')), `titles: ${hf.join(' | ')}`);

    const ma = checkInteractions(['mdma', 'adderall']).map(w => w.title);
    assert.ok(ma.includes('MDMA + Adderall'), `titles: ${ma.join(' | ')}`);
  });
});
