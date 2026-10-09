// Soft interaction warnings — informational, never blocking.
// Spec lines:
// - MDMA + Adderall: cardiovascular + serotonergic stress, hyperthermia risk
// - MDMA + Cannabis: can intensify or destabilize
// - LSD + Cannabis: cannabis amplifies, can destabilize
// - Psilocybin + Cannabis: same
// - LSD + Psilocybin: synergistic
// - MDMA + LSD: candyflip, increased cardio load
// - MDMA + Psilocybin: hippy flip (NOT candyflip)
// - Any psychedelic + Adderall: anxiety, cardio strain
// - DMT + MDMA: serotonergic load
// - 2C-B + MDMA: combined cardiovascular and serotonergic load
// - 2C-B + LSD / Psilocybin: synergistic
// - 2C-B + Cannabis: cannabis amplifies, can destabilize
// - 2C-B + DMT: synergistic

import { labelFor } from './doses.js';

const PSYCHEDELICS = new Set(['lsd', 'psilocybin', 'dmt', '2cb']);

const PAIRS = [
  {
    a: 'mdma', b: 'adderall',
    title: 'MDMA + Adderall',
    body: 'Cardiovascular and serotonergic stress, hyperthermia risk.'
  },
  {
    a: 'mdma', b: 'cannabis',
    title: 'MDMA + Cannabis',
    body: 'Can intensify or destabilize the experience.'
  },
  {
    a: 'lsd', b: 'cannabis',
    title: 'LSD + Cannabis',
    body: 'Cannabis amplifies; can destabilize.'
  },
  {
    a: 'psilocybin', b: 'cannabis',
    title: 'Psilocybin + Cannabis',
    body: 'Cannabis amplifies; can destabilize.'
  },
  {
    a: 'lsd', b: 'psilocybin',
    title: 'LSD + Psilocybin',
    body: 'Synergistic; effects of each are amplified.'
  },
  {
    a: 'mdma', b: 'lsd',
    title: 'MDMA + LSD (candyflip)',
    body: 'Increased cardiovascular load.'
  },
  {
    a: 'mdma', b: 'psilocybin',
    title: 'MDMA + Psilocybin (hippy flip)',
    body: 'Combined load on cardiovascular and serotonergic systems.'
  },
  {
    a: 'dmt', b: 'mdma',
    title: 'DMT + MDMA',
    body: 'Serotonergic load.'
  },
  {
    a: '2cb', b: 'mdma',
    title: '2C-B + MDMA',
    body: 'Combined cardiovascular and serotonergic load.'
  },
  {
    a: '2cb', b: 'lsd',
    title: '2C-B + LSD',
    body: 'Synergistic; effects of each are amplified.'
  },
  {
    a: '2cb', b: 'psilocybin',
    title: '2C-B + Psilocybin',
    body: 'Synergistic; effects of each are amplified.'
  },
  {
    a: '2cb', b: 'cannabis',
    title: '2C-B + Cannabis',
    body: 'Cannabis amplifies; can destabilize.'
  },
  {
    a: '2cb', b: 'dmt',
    title: '2C-B + DMT',
    body: 'Synergistic; effects of each are amplified.'
  }
];

export function checkInteractions(substances) {
  const set = new Set(substances.map(s => (s || '').toLowerCase()));
  const warnings = [];
  for (const p of PAIRS) {
    if (set.has(p.a) && set.has(p.b)) warnings.push({ ...p });
  }
  // "any psychedelic + Adderall" — include if not already named explicitly
  if (set.has('adderall')) {
    for (const psy of PSYCHEDELICS) {
      if (set.has(psy)) {
        const named = warnings.find(w =>
          (w.a === psy && w.b === 'adderall') || (w.a === 'adderall' && w.b === psy)
        );
        if (!named) {
          warnings.push({
            a: psy, b: 'adderall',
            title: `${labelFor(psy)} + Adderall`,
            body: 'Increased anxiety and cardiovascular strain.'
          });
        }
      }
    }
  }
  // de-dup by title
  const seen = new Set();
  return warnings.filter(w => (seen.has(w.title) ? false : (seen.add(w.title), true)));
}
