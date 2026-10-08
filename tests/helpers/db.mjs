// Node-side IndexedDB helpers: fake-indexeddb + Dexie, with the v1 schema inlined so migration tests
// can build "old" databases without importing src/db/db.js (which may already be at a newer version).

import 'fake-indexeddb/auto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';

export const DB_NAME = 'field-notes-db';

/** Exact Dexie version(1) store spec from src/db/db.js (v1). Do not "fix" this; it is the migration baseline. */
export const V1_STORES = Object.freeze({
  sessions: 'id, started_at, created_at, updated_at',
  doses: 'id, session_id, substance, time_offset_min',
  strains: 'id, substance, name',
  batches: 'id, substance, vendor, acquired_date',
  meta: 'key',
  backupCfg: 'key',
});

/** Install a brand-new in-memory IDBFactory so the next open starts from an empty origin. */
export function resetIndexedDB() {
  const factory = new IDBFactory();
  globalThis.indexedDB = factory;
  globalThis.IDBKeyRange = IDBKeyRange;
  Dexie.dependencies.indexedDB = factory;
  Dexie.dependencies.IDBKeyRange = IDBKeyRange;
  return factory;
}

/**
 * Ensure fake-indexeddb is the IndexedDB implementation Dexie uses (the 'fake-indexeddb/auto' import
 * above already set the globals; this also wires Dexie.dependencies in case Dexie was imported first).
 * Returns { resetIndexedDB } for per-test isolation.
 */
export function setupFakeIndexedDB() {
  if (!globalThis.indexedDB) {
    resetIndexedDB();
  } else {
    Dexie.dependencies.indexedDB = globalThis.indexedDB;
    Dexie.dependencies.IDBKeyRange = globalThis.IDBKeyRange || IDBKeyRange;
  }
  return { resetIndexedDB };
}

/** Open a Dexie instance that declares ONLY version(1) with the inline v1 spec. */
export async function openV1Db(name = DB_NAME) {
  const db = new Dexie(name, {
    indexedDB: globalThis.indexedDB,
    IDBKeyRange: globalThis.IDBKeyRange || IDBKeyRange,
  });
  db.version(1).stores({ ...V1_STORES });
  await db.open();
  return db;
}

/** Close (if open) and delete a database by name. */
export async function deleteDb(name = DB_NAME) {
  await Dexie.delete(name);
}

// ---------------------------------------------------------------- deterministic ids / fixtures

let idCounter = 0;
/** Reset the deterministic id sequence (call in beforeEach for stable fixtures). */
export function resetIds(start = 0) {
  idCounter = start;
}
/** Next deterministic id: 32 lowercase hex chars, like the app's cryptoId() but sequential. */
export function nextId() {
  idCounter += 1;
  return idCounter.toString(16).padStart(32, '0');
}

export const DAY = 24 * 60 * 60 * 1000;
/** Fixed reference timestamp for fixtures: 2025-01-15T20:00:00Z. */
export const BASE_TS = Date.UTC(2025, 0, 15, 20, 0, 0);

/** A realistic v1 session record (store.js createSession shape). Override any field. */
export function makeV1Session(overrides = {}) {
  const id = overrides.id ?? nextId();
  const startedAt = overrides.started_at ?? BASE_TS;
  return {
    id,
    started_at: startedAt,
    set_tags: ['calm', 'curious'],
    setting_tags: ['home', 'alone'],
    empty_stomach: 'partial',
    source_confidence: 'tested',
    experience: {
      onset_min: 30,
      peak_min: 90,
      duration_hr: 4,
      intensity_1_10: 6,
      body_load_1_10: 3,
      headspace_1_10: 7,
      effects_tags: ['euphoria', 'visuals'],
      adverse_effects_text: '',
    },
    context_text: 'Quiet evening at home.',
    reflection_in_moment: 'Feeling open and settled.',
    reflection_day_after: '',
    reflection_post: '',
    created_at: startedAt,
    updated_at: startedAt,
    ...overrides,
  };
}

/** A realistic v1 dose record (DoseForm shape). Default: MDMA crystal 100 mg, first dose at t+0. */
export function makeDose(sessionId, overrides = {}) {
  return {
    id: nextId(),
    session_id: sessionId,
    substance: 'mdma',
    subtype: '',
    form: 'crystal',
    prep: '',
    amount: 100,
    unit: 'mg',
    claimed_potency: '',
    claimed_potency_unit: '',
    reagent: '',
    time_offset_min: 0,
    combo_type: 'first',
    ...overrides,
  };
}

/** Handy dose variants (spread into makeDose overrides). */
export const DOSE_PRESETS = Object.freeze({
  mdmaPressed: { substance: 'mdma', form: 'pressed', amount: 1.5, unit: 'units', claimed_potency: 100, claimed_potency_unit: 'mg' },
  psilocybin: { substance: 'psilocybin', form: '', prep: 'tea', amount: 1.5, unit: 'g', subtype: '' },
  lsdTab: { substance: 'lsd', form: 'tab', amount: 1, unit: 'units', claimed_potency: 100, claimed_potency_unit: 'µg' },
  adderallIR: { substance: 'adderall', form: 'IR', amount: 10, unit: 'mg' },
  cannabisFlower: { substance: 'cannabis', form: 'flower', subtype: 'Blue Dream', amount: 0.25, unit: 'g', thc_pct: 20 },
});

/** A v1 strain record (seeded psilocybin strain library shape). */
export function makeStrain(overrides = {}) {
  return { id: nextId(), substance: 'psilocybin', name: 'Golden Teacher', ...overrides };
}

/** A v1 batch record (never written by the v1 UI, but part of the export/import schema). */
export function makeBatch(overrides = {}) {
  return {
    id: nextId(),
    substance: 'mdma',
    vendor: 'unknown',
    acquired_date: BASE_TS - 7 * DAY,
    notes: '',
    ...overrides,
  };
}

export { Dexie, IDBFactory, IDBKeyRange };
