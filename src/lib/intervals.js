// Re-dose interval logic
// MDMA: min 8 weeks, recommended 12 weeks
// LSD: last total claimed µg ≥200 → 13 days; else 6 days
// Psilocybin: last dose ≤1.5g → 6 days; else 14 days
// LSD ↔ Psilocybin cross-tolerance: apply longer of the two windows
// Cannabis, DMT, Adderall: no floor

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

// Returns { minMs, recMs, basis } for a given last-dose detail.
// detail: { substance, total, totalUnit }
export function intervalsFor(detail) {
  const sub = (detail.substance || '').toLowerCase();
  switch (sub) {
    case 'mdma':
      return { minMs: 8 * WEEK, recMs: 12 * WEEK, basis: '8w min / 12w recommended' };
    case 'lsd': {
      const ug = detail.totalUnit === 'µg' ? Number(detail.total) : 0;
      const days = ug >= 200 ? 13 : 6;
      return { minMs: days * DAY, recMs: days * DAY, basis: `${days} days (last ${ug} µg)` };
    }
    case 'psilocybin': {
      const g = Number(detail.total) || 0;
      const days = g <= 1.5 ? 6 : 14;
      return { minMs: days * DAY, recMs: days * DAY, basis: `${days} days (last ${g} g)` };
    }
    default:
      return { minMs: 0, recMs: 0, basis: 'no floor' };
  }
}

// Compute next-allowed time for a given substance, considering cross-tolerance with LSD ↔ Psilocybin.
export function nextAllowed(substance, lastBy) {
  const sub = (substance || '').toLowerCase();
  const own = lastBy[sub];
  let candidates = [];
  if (own) {
    const iv = intervalsFor(own);
    candidates.push({
      when: own.startedAt + iv.minMs,
      whenRec: own.startedAt + iv.recMs,
      basis: `${cap(sub)} ${iv.basis}`
    });
  }
  const crossSet = (sub === 'lsd' || sub === 'psilocybin')
    ? ['lsd','psilocybin'].filter(s => s !== sub)
    : [];
  for (const cs of crossSet) {
    const last = lastBy[cs];
    if (!last) continue;
    const iv = intervalsFor(last);
    candidates.push({
      when: last.startedAt + iv.minMs,
      whenRec: last.startedAt + iv.recMs,
      basis: `Cross-tolerance: ${cap(cs)} ${iv.basis}`
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a,b) => b.when - a.when);
  return candidates[0];
}

export function rankAgainstWindow(now, lastStart, intervals) {
  if (!lastStart) return { color: 'green', label: 'no prior dose' };
  const elapsed = now - lastStart;
  if (elapsed < intervals.minMs) return { color: 'red', label: 'under min interval' };
  if (elapsed < intervals.recMs) return { color: 'yellow', label: 'under recommended' };
  return { color: 'green', label: 'clear' };
}

function cap(s) {
  if (s === 'lsd' || s === 'dmt') return s.toUpperCase();
  if (s === 'mdma') return 'MDMA';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
