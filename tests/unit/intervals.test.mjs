// v1.1.1 directed cross-tolerance (spec tests 1-9), on src/lib/intervals.js with fixed timestamps.
// The dashboard derives colour/countdown via statusFor(); these tests assert the same helper.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { intervalsFor, nextAllowed, statusFor, CROSS_TOLERANCE } from '../../src/lib/intervals.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 9, 12, 0, 0); // fixed "today"
const at = (daysAgo) => NOW - daysAgo * DAY;

const lsd = (ug, daysAgo) => ({ substance: 'lsd', total: ug, totalUnit: 'µg', startedAt: at(daysAgo) });
const psi = (g, daysAgo) => ({ substance: 'psilocybin', total: g, totalUnit: 'g', startedAt: at(daysAgo) });
const cb = (mg, daysAgo) => ({ substance: '2cb', total: mg, totalUnit: 'mg', startedAt: at(daysAgo) });
const mdma = (mg, daysAgo) => ({ substance: 'mdma', total: mg, totalUnit: 'mg', startedAt: at(daysAgo) });

const status = (target, lastBy) => statusFor(nextAllowed(target, lastBy), NOW);

describe('v1.1.1 directed cross-tolerance (intervals.js)', () => {
  test('1. 2C-B-only session 3 days ago -> green, "clear", no floor', () => {
    const lastBy = { '2cb': cb(10, 3) };
    assert.equal(nextAllowed('2cb', lastBy), null, '2C-B delays nothing, including itself');
    assert.deepEqual(status('2cb', lastBy), { color: 'green', countdown: 'clear', basis: 'no floor' });
  });

  test('2. LSD 150 µg 3 days ago, then 2C-B today -> 2C-B red, 3d, basis names LSD (LSD dose sets the window)', () => {
    // Before any 2C-B is logged the logic already applies LSD's window to a 2C-B target.
    const onlyLsd = { lsd: lsd(150, 3) };
    const n0 = nextAllowed('2cb', onlyLsd);
    assert.ok(n0, 'LSD delays a future 2C-B dose');
    assert.equal(n0.source, 'lsd');

    const lastBy = { lsd: lsd(150, 3), '2cb': cb(10, 0) };
    const next = nextAllowed('2cb', lastBy);
    assert.equal(next.basis, 'Cross-tolerance from LSD: 6 days (last 150 µg)');
    assert.equal(next.when, at(3) + 6 * DAY, 'window anchored on the LSD dose at T-3d, not on today\'s 2C-B dose');
    assert.deepEqual(status('2cb', lastBy), { color: 'red', countdown: '3d', basis: next.basis });
  });

  test('3. LSD 300 µg 3 days ago -> 2C-B red, remaining = live LSD window minus 3 days', () => {
    const lastBy = { lsd: lsd(300, 3), '2cb': cb(10, 0) };
    const liveWindow = intervalsFor(lsd(300, 3)); // read the live threshold rather than hardcoding 13/14 days
    assert.ok(liveWindow.minMs > 6 * DAY, 'a 300 µg dose uses the long LSD window');
    const expectedDays = Math.ceil((liveWindow.minMs - 3 * DAY) / DAY);
    const s = status('2cb', lastBy);
    assert.equal(s.color, 'red');
    assert.equal(s.countdown, `${expectedDays}d`);
    assert.equal(s.basis, `Cross-tolerance from LSD: ${liveWindow.basis}`);
    assert.match(s.basis, /300 µg/);
  });

  test('4. 2C-B 1 day ago, then LSD today -> LSD row uses LSD\'s own window only; nothing says "from 2C-B"', () => {
    const lastBy = { '2cb': cb(20, 1), lsd: lsd(100, 0) };
    const next = nextAllowed('lsd', lastBy);
    assert.equal(next.source, 'lsd');
    assert.equal(next.basis, 'LSD 6 days (last 100 µg)');
    assert.doesNotMatch(next.basis, /Cross-tolerance/);
    for (const target of ['lsd', 'psilocybin', '2cb', 'mdma', 'cannabis']) {
      const n = nextAllowed(target, { '2cb': cb(20, 1) });
      assert.equal(n, null, `a lone 2C-B dose must not delay ${target}`);
    }
  });

  test('5. Psilocybin 3.5 g 5 days ago -> 2C-B red, 9d, basis names Psilocybin', () => {
    const lastBy = { psilocybin: psi(3.5, 5), '2cb': cb(10, 0) };
    const s = status('2cb', lastBy);
    assert.equal(s.color, 'red');
    assert.equal(s.countdown, '9d');
    assert.equal(s.basis, 'Cross-tolerance from Psilocybin: 14 days (last 3.5 g)');
  });

  test('6. LSD 2 days ago AND psilocybin 1.5 g 10 days ago -> 2C-B basis names LSD (latest window wins)', () => {
    const lastBy = { lsd: lsd(100, 2), psilocybin: psi(1.5, 10), '2cb': cb(10, 0) };
    const next = nextAllowed('2cb', lastBy);
    assert.equal(next.source, 'lsd');
    assert.match(next.basis, /^Cross-tolerance from LSD: /);
    assert.equal(next.when, at(2) + 6 * DAY);
    assert.equal(status('2cb', lastBy).countdown, '4d');
  });

  test('7. dashboard regression: LSD 100 µg 2 days ago + psilocybin 1.5 g 20 days ago -> psilocybin RED, 4d', () => {
    const lastBy = { lsd: lsd(100, 2), psilocybin: psi(1.5, 20) };
    const s = status('psilocybin', lastBy);
    assert.equal(s.color, 'red', 'the LSD window applies to the next psilocybin dose');
    assert.equal(s.countdown, '4d');
    assert.equal(s.basis, 'Cross-tolerance from LSD: 6 days (last 100 µg)');
    // ...and the LSD row itself: own window, same countdown.
    assert.deepEqual(status('lsd', lastBy), { color: 'red', countdown: '4d', basis: 'LSD 6 days (last 100 µg)' });
  });

  test('8. CROSS_TOLERANCE["2cb"] is empty; intervalsFor(2cb) has no floor', () => {
    assert.deepEqual(CROSS_TOLERANCE['2cb'], []);
    assert.deepEqual([...CROSS_TOLERANCE.lsd].sort(), ['2cb', 'lsd', 'psilocybin']);
    assert.deepEqual([...CROSS_TOLERANCE.psilocybin].sort(), ['2cb', 'lsd', 'psilocybin']);
    const iv = intervalsFor({ substance: '2cb', total: 20, totalUnit: 'mg' });
    assert.equal(iv.minMs, 0);
    assert.equal(iv.recMs, 0);
    assert.equal(iv.basis, 'no floor');
  });

  test('9. interactions.js never says "cross-tolerance"', () => {
    const src = readFileSync(path.join(ROOT, 'src', 'lib', 'interactions.js'), 'utf8');
    assert.doesNotMatch(src, /cross-tolerance/i);
  });

  test('unchanged: MDMA own window, no cross entries; cannabis/DMT/Adderall no floor', () => {
    const lastBy = { mdma: mdma(100, 7), lsd: lsd(100, 1) };
    const next = nextAllowed('mdma', lastBy);
    assert.equal(next.source, 'mdma');
    assert.equal(next.basis, 'MDMA 8w min / 12w recommended');
    assert.equal(next.when, at(7) + 8 * 7 * DAY);
    assert.equal(next.whenRec, at(7) + 12 * 7 * DAY);
    assert.equal(status('mdma', lastBy).color, 'red');
    // yellow between min and recommended
    const s = statusFor(nextAllowed('mdma', { mdma: mdma(100, 9 * 7) }), NOW);
    assert.equal(s.color, 'yellow');
    assert.match(s.countdown, /^\d+d rec$/);
    // green past recommended
    assert.deepEqual(statusFor(nextAllowed('mdma', { mdma: mdma(100, 13 * 7) }), NOW).countdown, 'OK');
    for (const sub of ['cannabis', 'dmt', 'adderall']) {
      assert.equal(nextAllowed(sub, { [sub]: { substance: sub, total: 1, totalUnit: 'mg', startedAt: at(1) }, lsd: lsd(100, 0) }), null, `${sub} has no floor and is not delayed by LSD`);
    }
    // psilocybin floors unchanged
    assert.equal(intervalsFor(psi(1.5, 0)).minMs, 6 * DAY);
    assert.equal(intervalsFor(psi(3.5, 0)).minMs, 14 * DAY);
  });
});
