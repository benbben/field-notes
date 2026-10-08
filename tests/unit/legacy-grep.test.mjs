// 12. Legacy-field grep: after the v2 "single notes field" migration, the only file under src/ that may
// still mention the four legacy session text fields is src/db/migrations.js (it merges them), and
// src/db/db.js must keep the untouched v1 `db.version(1).stores({...})` block next to a `db.version(2)` block.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { V1_STORES } from '../helpers/db.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC_DIR = path.join(ROOT, 'src');
const LEGACY_RE = /reflection_|context_text/;
const ALLOWED = 'src/db/migrations.js';
const DB_FILE = 'src/db/db.js';

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

/** Every file under `dir`, recursively, sorted, as absolute paths. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

describe('12. legacy grep', () => {
  test('12. only src/db/migrations.js mentions reflection_* / context_text', () => {
    const files = walk(SRC_DIR);
    assert.ok(files.length > 0, 'src/ has files');

    const offenders = files
      .filter(abs => LEGACY_RE.test(readFileSync(abs, 'utf8')))
      .map(rel);

    const unexpected = offenders.filter(f => f !== ALLOWED);
    assert.deepEqual(
      offenders,
      [ALLOWED],
      `files under src/ matching ${LEGACY_RE}: ${offenders.length ? offenders.join(', ') : '(none)'}; ` +
      `unexpected offenders: ${unexpected.length ? unexpected.join(', ') : '(none)'}; ` +
      `${ALLOWED} ${offenders.includes(ALLOWED) ? 'matches as expected' : 'does NOT match (regex or walk broken?)'}`
    );
  });

  test('12. src/db/db.js keeps the exact v1 db.version(1).stores({...}) block and has a db.version(2) block', () => {
    const src = readFileSync(path.join(ROOT, DB_FILE), 'utf8');

    const v1Open = 'db.version(1).stores({';
    const start = src.indexOf(v1Open);
    assert.ok(start >= 0, `${DB_FILE} must contain the literal ${JSON.stringify(v1Open)}`);
    const end = src.indexOf('})', start + v1Open.length);
    assert.ok(end > start, 'db.version(1).stores({ block is closed');
    const block = src.slice(start + v1Open.length, end);

    // Each store line: `<name>: '<spec>',` optionally followed by a // comment.
    const lineRe = /^\s*([A-Za-z_]\w*)\s*:\s*'([^']*)'\s*,?\s*(?:\/\/.*)?$/;
    const stores = [];
    for (const line of block.split(/\r?\n/)) {
      const m = line.match(lineRe);
      if (m) stores.push([m[1], m[2]]);
    }
    const expected = Object.entries(V1_STORES);
    assert.equal(stores.length, 6, `six v1 store lines expected, parsed: ${JSON.stringify(stores)}`);
    assert.deepEqual(stores, expected, `v1 store lines must equal tests/helpers/db.mjs V1_STORES (name, spec and order)`);
    assert.deepEqual(Object.fromEntries(stores), { ...V1_STORES });

    const v2 = src.indexOf('db.version(2)');
    assert.ok(v2 >= 0, `${DB_FILE} must contain a db.version(2) block`);
    assert.ok(v2 > end, 'db.version(2) comes after the v1 block');
    assert.match(src.slice(v2), /^db\.version\(2\)[\s\S]*?\{/, 'db.version(2) opens a block');
  });
});
