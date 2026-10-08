import Dexie from 'dexie';
import { migrateSessionRecord, SCHEMA_VERSION } from './migrations.js';

export const db = new Dexie('field-notes-db');

// RULE: never modify an existing db.version(N) block. Schema changes add
// db.version(N+1) with an .upgrade() and ship with a populated-DB migration test.

db.version(1).stores({
  // primary keys & secondary indexes
  sessions: 'id, started_at, created_at, updated_at',
  doses: 'id, session_id, substance, time_offset_min',
  strains: 'id, substance, name',
  batches: 'id, substance, vendor, acquired_date',
  meta: 'key',         // singletons: passcode_hash, salt, theme, persistedHandle, etc.
  backupCfg: 'key',    // github backup config
});

// v2: sessions gain `notes`; the four legacy free-text fields are merged into it
// and removed. Table/index spec is identical to v1.
db.version(2).stores({
  sessions: 'id, started_at, created_at, updated_at',
  doses: 'id, session_id, substance, time_offset_min',
  strains: 'id, substance, name',
  batches: 'id, substance, vendor, acquired_date',
  meta: 'key',
  backupCfg: 'key',
}).upgrade(async (tx) => {
  await tx.table('sessions').toCollection().modify((s) => { migrateSessionRecord(s); });
  await tx.table('meta').put({ key: 'schema_version', value: SCHEMA_VERSION });
});

export const META = {
  PASSCODE: 'passcode',
  PASSCODE_LENGTH: 'passcode_len',
  THEME: 'theme',
  LAST_UNLOCK: 'last_unlock',
  PERSIST_GRANTED: 'persist',
  ONBOARDED: 'onboarded',
  REMINDER_LAST: 'weekly_reminder_last',
  PASSPHRASE_KDF: 'passphrase_kdf', // {salt, iter} for backup passphrase verifier
  SCHEMA_VERSION: 'schema_version', // app-level schema version (see migrations.js)
};

export const BACKUP = {
  CFG: 'github',  // {pat, owner, repo, path, branch}
  VERIFY: 'verify' // ciphertext block to confirm passphrase
};

// Fresh installs skip the upgrade path, so stamp the schema version on every open.
// Never raise the stamp above what is stored by a newer build, and never let a
// failed stamp (e.g. quota) reject open(): the data is more important than the label.
db.on('ready', async () => {
  try {
    const cur = await db.meta.get(META.SCHEMA_VERSION);
    const have = cur && typeof cur.value === 'number' ? cur.value : 0;
    if (have < SCHEMA_VERSION) {
      await db.meta.put({ key: META.SCHEMA_VERSION, value: SCHEMA_VERSION });
    }
  } catch (e) {
    console.warn('schema_version stamp failed', e);
  }
}, true);

// helpers
export async function getMeta(key) {
  const r = await db.meta.get(key);
  return r ? r.value : undefined;
}
export async function setMeta(key, value) {
  await db.meta.put({ key, value });
}
export async function delMeta(key) {
  await db.meta.delete(key);
}
