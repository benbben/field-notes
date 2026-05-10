import Dexie from 'dexie';

export const db = new Dexie('field-notes-db');

db.version(1).stores({
  // primary keys & secondary indexes
  sessions: 'id, started_at, created_at, updated_at',
  doses: 'id, session_id, substance, time_offset_min',
  strains: 'id, substance, name',
  batches: 'id, substance, vendor, acquired_date',
  meta: 'key',         // singletons: passcode_hash, salt, theme, persistedHandle, etc.
  backupCfg: 'key',    // github backup config
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
};

export const BACKUP = {
  CFG: 'github',  // {pat, owner, repo, path, branch}
  VERIFY: 'verify' // ciphertext block to confirm passphrase
};

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
