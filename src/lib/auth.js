import { db, getMeta, setMeta, META } from '../db/db.js';
import { hashPasscode, verifyPasscode } from './crypto.js';

const AUTOLOCK_MS = 2 * 60 * 1000;

let unlockedAt = 0;

export function isUnlocked() {
  return unlockedAt > 0 && Date.now() - unlockedAt < AUTOLOCK_MS;
}
export function markUnlocked() {
  unlockedAt = Date.now();
}
export function lock() {
  unlockedAt = 0;
}
export function touch() {
  // Keep alive while user interacts
  if (unlockedAt > 0) unlockedAt = Date.now();
}

export async function hasPasscode() {
  const v = await getMeta(META.PASSCODE);
  return !!v;
}

export async function getPasscodeLength() {
  return (await getMeta(META.PASSCODE_LENGTH)) || 4;
}

export async function setPasscode(passcode) {
  if (!/^\d{4}$|^\d{6}$/.test(passcode)) {
    throw new Error('Passcode must be 4 or 6 digits');
  }
  const stored = await hashPasscode(passcode);
  await setMeta(META.PASSCODE, stored);
  await setMeta(META.PASSCODE_LENGTH, passcode.length);
  markUnlocked();
}

export async function tryUnlock(passcode) {
  const stored = await getMeta(META.PASSCODE);
  if (!stored) return false;
  const ok = await verifyPasscode(passcode, stored);
  if (ok) markUnlocked();
  return ok;
}

// Auto-lock background handling
export function installAutoLock(onLock) {
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
    } else {
      if (hiddenAt && Date.now() - hiddenAt > AUTOLOCK_MS) {
        lock();
        onLock?.();
      }
      hiddenAt = 0;
    }
  });
  // Also check periodically (in case of long-foreground inactivity)
  setInterval(() => {
    if (unlockedAt > 0 && Date.now() - unlockedAt > AUTOLOCK_MS) {
      lock();
      onLock?.();
    }
  }, 15_000);
}
