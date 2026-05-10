// Web Crypto helpers for passcode hashing and AES-GCM encrypted backups.
// Passcode: PBKDF2-SHA256 200k iterations -> 32 bytes -> base64
// Backup passphrase: PBKDF2-SHA256 600k iterations -> AES-256 key, AES-GCM with random 12-byte IV.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function bytesToB64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function b64ToBytes(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(password, salt, iterations, length) {
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(password),
    { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey, length * 8
  );
  return new Uint8Array(bits);
}

// Passcode: store {salt, hash, iter}, verify by recomputing.
export async function hashPasscode(passcode) {
  const salt = randomBytes(16);
  const iter = 200_000;
  const hash = await pbkdf2(passcode, salt, iter, 32);
  return { salt: bytesToB64(salt), hash: bytesToB64(hash), iter };
}
export async function verifyPasscode(passcode, stored) {
  if (!stored) return false;
  const salt = b64ToBytes(stored.salt);
  const recomputed = await pbkdf2(passcode, salt, stored.iter, 32);
  const expected = b64ToBytes(stored.hash);
  return constTimeEq(recomputed, expected);
}
function constTimeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i=0;i<a.length;i++) r |= a[i] ^ b[i];
  return r === 0;
}

// Backup passphrase -> AES-GCM key
async function derivePassphraseKey(passphrase, salt, iterations = 600_000) {
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase),
    { name: 'PBKDF2' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Envelope: { v:1, salt, iter, iv, ct } all base64
export async function encryptJson(obj, passphrase) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const iter = 600_000;
  const key = await derivePassphraseKey(passphrase, salt, iter);
  const plaintext = enc.encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    v: 1,
    salt: bytesToB64(salt),
    iter,
    iv: bytesToB64(iv),
    ct: bytesToB64(new Uint8Array(ct))
  };
}

export async function decryptJson(env, passphrase) {
  if (!env || env.v !== 1) throw new Error('Unsupported backup format');
  const salt = b64ToBytes(env.salt);
  const iv = b64ToBytes(env.iv);
  const ct = b64ToBytes(env.ct);
  const key = await derivePassphraseKey(passphrase, salt, env.iter || 600_000);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  } catch (e) {
    const err = new Error('Wrong passphrase or corrupted backup');
    err.code = 'BAD_PASSPHRASE';
    throw err;
  }
  return JSON.parse(dec.decode(new Uint8Array(plain)));
}
