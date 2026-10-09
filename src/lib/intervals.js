// Re-dose interval logic
// MDMA: min 8 weeks, recommended 12 weeks
// LSD: last total claimed µg ≥200 → 13 days; else 6 days
// Psilocybin: last dose ≤1.5g → 6 days; else 14 days
// 2C-B, Cannabis, DMT, Adderall: no floor
//
// Cross-tolerance is DIRECTIONAL (see CROSS_TOLERANCE below): a recent LSD or
// psilocybin dose delays the next LSD, psilocybin or 2C-B dose; 2C-B delays
// nothing, including itself. The window length is always the SOURCE
// substance's own dose-dependent window.
//
// Interval rules live only in this file; the dashboard never computes windows itself.

import { labelFor } from './doses.js';

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

// source (prior dose) -> targets whose next dose it delays.
// Reported, not clinically established. Source: psychonautwiki.org/wiki/2C-B (one-way, anecdotal).
export const CROSS_TOLERANCE = {
  lsd:        ['lsd', 'psilocybin', '2cb'],
  psilocybin: ['psilocybin', 'lsd', '2cb'],
  '2cb':      [],   // 2C-B delays nothing, including itself
};

// Returns { minMs, recMs, basis } for a given last-dose detail.
// detail: { substance, total, totalUnit }
export function intervalsFor(detail) {
  const sub = (detail.substance || '').toLowerCase();
  switch (sub) {
    case 'mdma':
      return { minMs: 8 * WEEK, recMs: 12 * WEEK, basis: '8w min / 12w recommended' };
    case 'lsd': {
      const ug = detail.totalUnit === 'µg' ? (Number(detail.total) || 0) : 0;
      const days = ug >= 200 ? 13 : 6;
      return { minMs: days * DAY, recMs: days * DAY, basis: `${days} days (last ${fmt(ug)} µg)` };
    }
    case 'psilocybin': {
      const g = Number(detail.total) || 0;
      const days = g <= 1.5 ? 6 : 14;
      return { minMs: days * DAY, recMs: days * DAY, basis: `${days} days (last ${fmt(g)} g)` };
    }
    default:
      return { minMs: 0, recMs: 0, basis: 'no floor' };
  }
}

// Trim float noise for display (1.1 × 100 µg is 110.00000000000001 in JS).
function fmt(n) {
  return Number((Number(n) || 0).toFixed(2)).toString();
}

function candidateFrom(source, target, last) {
  if (!last || !Number.isFinite(last.startedAt)) return null; // malformed entry: never out-sorts a real window
  const iv = intervalsFor(last);
  if (iv.minMs === 0 && iv.recMs === 0) return null; // nothing to wait for
  return {
    when: last.startedAt + iv.minMs,
    whenRec: last.startedAt + iv.recMs,
    source,
    basis: source === target
      ? `${labelFor(source)} ${iv.basis}`
      : `Cross-tolerance from ${labelFor(source)}: ${iv.basis}`,
  };
}

// Next-allowed time for `substance` given the latest dose per substance
// (lastBy[id] = { substance, total, totalUnit, startedAt }).
// Returns { when, whenRec, source, basis } for the latest applicable window,
// or null when no floor applies.
export function nextAllowed(substance, lastBy) {
  const target = (substance || '').toLowerCase();
  const candidates = [];
  if (Object.prototype.hasOwnProperty.call(CROSS_TOLERANCE, target)) {
    for (const [source, targets] of Object.entries(CROSS_TOLERANCE)) {
      if (!targets.includes(target)) continue;
      const last = lastBy[source];
      if (!last) continue;
      const c = candidateFrom(source, target, last);
      if (c) candidates.push(c);
    }
  } else {
    // Substances outside the table: own window only.
    const own = lastBy[target];
    if (own) {
      const c = candidateFrom(target, target, own);
      if (c) candidates.push(c);
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.when - a.when);
  return candidates[0];
}

// Dashboard colour and countdown for a nextAllowed() result.
//   now < when     -> red,    "<n>d"
//   now < whenRec  -> yellow, "<n>d rec"
//   otherwise      -> green,  "OK"   (null -> green, "clear")
export function statusFor(next, now = Date.now()) {
  if (!next) return { color: 'green', countdown: 'clear', basis: 'no floor' };
  if (now < next.when) {
    return { color: 'red', countdown: `${Math.ceil((next.when - now) / DAY)}d`, basis: next.basis };
  }
  if (now < next.whenRec) {
    return { color: 'yellow', countdown: `${Math.ceil((next.whenRec - now) / DAY)}d rec`, basis: next.basis };
  }
  return { color: 'green', countdown: 'OK', basis: next.basis };
}
