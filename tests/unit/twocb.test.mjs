// 2C-B group: pure lib checks (plain ESM imports, no DOM, no IndexedDB).
// Non-ASCII glyphs are written as escapes so the file is encoding-safe on every platform:
//   \u00d7 = multiplication sign (used by calcDose displays), \u00b5 = micro sign (as in micrograms).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { calcDose, labelFor, SUBSTANCES, FORMS } from '../../src/lib/doses.js';
import { checkInteractions } from '../../src/lib/interactions.js';
import { intervalsFor, nextAllowed, CROSS_TOLERANCE } from '../../src/lib/intervals.js';

const DAY = 24 * 60 * 60 * 1000;
const TIMES = '\u00d7';
const MICRO = '\u00b5';
// Fixed reference "now" so the interval maths is deterministic: 2025-01-15T20:00:00Z.
const NOW = Date.UTC(2025, 0, 15, 20, 0, 0);

describe('2C-B unit', () => {
  test('substances: SUBSTANCES order/label, labelFor names (case-insensitive), FORMS[2cb] ids+labels', () => {
    const ids = SUBSTANCES.map(s => s.id);
    const i2cb = ids.indexOf('2cb');
    assert.ok(i2cb > 0, `SUBSTANCES must contain '2cb' (ids: ${ids.join(',')})`);
    assert.equal(ids[i2cb - 1], 'lsd', `'2cb' must come immediately after 'lsd' (ids: ${ids.join(',')})`);
    assert.equal(ids[i2cb + 1], 'cannabis', `'2cb' must come immediately before 'cannabis' (ids: ${ids.join(',')})`);
    assert.equal(SUBSTANCES[i2cb].label, '2C-B');

    const expected = {
      '2cb': '2C-B',
      mdma: 'MDMA',
      lsd: 'LSD',
      dmt: 'DMT',
      psilocybin: 'Psilocybin',
      cannabis: 'Cannabis',
      adderall: 'Adderall',
      custom: 'Custom',
    };
    for (const [id, label] of Object.entries(expected)) {
      assert.equal(labelFor(id), label, `labelFor('${id}')`);
      assert.equal(labelFor(id.toUpperCase()), label, `labelFor('${id.toUpperCase()}') must be case-insensitive`);
    }
    assert.equal(labelFor('2Cb'), '2C-B', 'mixed case 2Cb');

    const forms = FORMS['2cb'];
    assert.ok(Array.isArray(forms), 'FORMS[2cb] must be an array');
    assert.deepEqual(
      forms.map(f => [f.id, f.label]),
      [
        ['hcl', 'HCl powder'],
        ['hbr', 'HBr powder'],
        ['pill', 'Pressed pill'],
        ['volumetric', 'Volumetric liquid'],
      ]
    );
  });

  test('calcDose: hcl/hbr plain mg, pill units x mg, volumetric mL x mg/mL, missing numbers -> 0', () => {
    const hcl = calcDose({ substance: '2cb', form: 'hcl', amount: 10 });
    assert.equal(hcl.total, 10);
    assert.equal(hcl.totalUnit, 'mg');
    assert.ok(hcl.display.includes('10 mg'), `hcl display was "${hcl.display}"`);

    const hbr = calcDose({ substance: '2cb', form: 'hbr', amount: 12.5 });
    assert.equal(hbr.total, 12.5);
    assert.equal(hbr.totalUnit, 'mg');
    assert.ok(hbr.display.includes('12.5 mg'), `hbr display was "${hbr.display}"`);

    const pill = calcDose({ substance: '2cb', form: 'pill', amount: 1.5, claimed_potency: 10 });
    assert.equal(pill.total, 15);
    assert.equal(pill.totalUnit, 'mg');
    assert.match(pill.display, new RegExp(`1\\.5 ${TIMES} 10 mg = 15 mg`), `pill display was "${pill.display}"`);

    const vol = calcDose({ substance: '2cb', form: 'volumetric', amount: 2.5, claimed_potency: 4 });
    assert.equal(vol.total, 10);
    assert.equal(vol.totalUnit, 'mg');
    assert.match(vol.display, new RegExp(`2\\.5 mL ${TIMES} 4 mg\\/mL = 10 mg`), `volumetric display was "${vol.display}"`);

    // Missing numbers must not throw and must yield a 0 total.
    for (const d of [
      { substance: '2cb', form: 'hcl' },
      { substance: '2cb', form: 'hbr', amount: '' },
      { substance: '2cb', form: 'pill' },
      { substance: '2cb', form: 'pill', amount: 1.5 },
      { substance: '2cb', form: 'volumetric' },
      { substance: '2cb', form: 'volumetric', amount: 2.5 },
      { substance: '2cb' },
      { substance: '2cb', form: 'hcl', amount: 'abc' },
    ]) {
      let r;
      assert.doesNotThrow(() => { r = calcDose(d); }, `calcDose(${JSON.stringify(d)}) threw`);
      assert.equal(r.total, 0, `calcDose(${JSON.stringify(d)}).total`);
      assert.equal(r.totalUnit, 'mg', `calcDose(${JSON.stringify(d)}).totalUnit`);
      assert.equal(typeof r.display, 'string');
    }
  });

  test('checkInteractions: 2C-B pairs with MDMA/LSD/Psilocybin/Cannabis/DMT, generic + Adderall once, no duplicate titles', () => {
    const titlesOf = (subs) => checkInteractions(subs).map(w => w.title);

    const pairs = [
      [['2cb', 'mdma'], '2C-B + MDMA'],
      [['2cb', 'lsd'], '2C-B + LSD'],
      [['2cb', 'psilocybin'], '2C-B + Psilocybin'],
      [['2cb', 'cannabis'], '2C-B + Cannabis'],
      [['2cb', 'dmt'], '2C-B + DMT'],
    ];
    for (const [subs, title] of pairs) {
      const titles = titlesOf(subs);
      assert.ok(titles.includes(title), `${JSON.stringify(subs)} -> expected "${title}" in [${titles.join(' | ')}]`);
      // Order of the input must not matter.
      assert.ok(titlesOf([...subs].reverse()).includes(title), `${JSON.stringify([...subs].reverse())} -> "${title}"`);
    }

    // Generic "any psychedelic + Adderall" path: no explicit 2C-B/Adderall pair exists, so the title is synthesised
    // from labelFor('2cb') and must appear exactly once.
    const add = titlesOf(['2cb', 'adderall']);
    assert.equal(add.filter(t => t === '2C-B + Adderall').length, 1, `titles: [${add.join(' | ')}]`);
    assert.ok(!add.some(t => /2cb/.test(t)), `generic title must use the display label, titles: [${add.join(' | ')}]`);

    const triple = titlesOf(['2cb', 'mdma', 'adderall']);
    assert.equal(new Set(triple).size, triple.length, `duplicate titles in [${triple.join(' | ')}]`);
    assert.ok(triple.includes('2C-B + MDMA'), `titles: [${triple.join(' | ')}]`);
    assert.ok(triple.includes('2C-B + Adderall'), `titles: [${triple.join(' | ')}]`);
    assert.ok(triple.includes('MDMA + Adderall'), `titles: [${triple.join(' | ')}]`);

    // Every warning carries a non-empty body string.
    for (const subs of [...pairs.map(p => p[0]), ['2cb', 'adderall'], ['2cb', 'mdma', 'adderall']]) {
      for (const w of checkInteractions(subs)) {
        assert.equal(typeof w.body, 'string', `${w.title} body must be a string`);
        assert.ok(w.body.trim().length > 0, `${w.title} body must be non-empty`);
        assert.equal(typeof w.title, 'string');
        assert.ok(w.title.trim().length > 0);
      }
    }
  });

  test('intervals: 2C-B 6 days min=rec, cross-tolerance with LSD/Psilocybin (longest window wins), none for MDMA', () => {
    const iv = intervalsFor({ substance: '2cb', total: 20, totalUnit: 'mg' });
    assert.equal(iv.minMs, 6 * DAY);
    assert.equal(iv.recMs, 6 * DAY);
    assert.equal(iv.minMs, iv.recMs);
    assert.equal(iv.basis, '6 days');

    // LSD with no own dose, 2C-B taken 3 days ago -> cross-tolerance window from 2C-B.
    const last2cb = { substance: '2cb', total: 20, totalUnit: 'mg', startedAt: NOW - 3 * DAY };
    const lsdNext = nextAllowed('lsd', { '2cb': last2cb });
    assert.ok(lsdNext, 'nextAllowed(lsd) must not be null when 2C-B was taken');
    assert.ok(lsdNext.basis.startsWith('Cross-tolerance: 2C-B'), `basis was "${lsdNext.basis}"`);
    assert.equal(lsdNext.when, last2cb.startedAt + 6 * DAY);
    assert.equal(lsdNext.whenRec, last2cb.startedAt + 6 * DAY);

    // 2C-B 5 days ago (own window ends at +1d) vs LSD 1 tab 100 ug 1 day ago (6-day window ends at +5d):
    // the later LSD window wins (longest-window-wins).
    const lastLsd = { substance: 'lsd', total: 100, totalUnit: `${MICRO}g`, startedAt: NOW - 1 * DAY };
    const own2cb = { substance: '2cb', total: 10, totalUnit: 'mg', startedAt: NOW - 5 * DAY };
    const twoCbNext = nextAllowed('2cb', { lsd: lastLsd, '2cb': own2cb });
    assert.ok(twoCbNext, 'nextAllowed(2cb) must not be null');
    assert.equal(twoCbNext.when, lastLsd.startedAt + 6 * DAY, `picked window ends at ${twoCbNext.when}, basis "${twoCbNext.basis}"`);
    assert.ok(twoCbNext.when > own2cb.startedAt + 6 * DAY, 'LSD window must end later than the own 2C-B window');
    assert.ok(twoCbNext.basis.startsWith('Cross-tolerance: LSD'), `basis was "${twoCbNext.basis}"`);

    // Psilocybin also cross-tolerates with 2C-B.
    const psiNext = nextAllowed('psilocybin', { '2cb': last2cb });
    assert.ok(psiNext, 'nextAllowed(psilocybin) must not be null when 2C-B was taken');
    assert.ok(psiNext.basis.startsWith('Cross-tolerance: 2C-B'), `basis was "${psiNext.basis}"`);
    assert.equal(psiNext.when, last2cb.startedAt + 6 * DAY);

    // MDMA has no cross-tolerance with 2C-B: nothing to report.
    assert.equal(nextAllowed('mdma', { '2cb': last2cb }), null);

    assert.deepEqual([...CROSS_TOLERANCE].sort(), ['2cb', 'lsd', 'psilocybin'].sort());
  });
});
