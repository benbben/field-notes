import { useEffect, useMemo, useState } from 'react';
import { db } from '../db/db.js';
import { calcDose, labelFor } from '../lib/doses.js';
import { nextAllowed, statusFor } from '../lib/intervals.js';
import { useAllSessions } from '../state/store.js';

const DAY = 24*60*60*1000;

function formatDays(ms) {
  if (ms <= 0) return 'now';
  const d = ms / DAY;
  if (d < 1) {
    const h = Math.round(ms / (60*60*1000));
    return `${h}h`;
  }
  if (d < 30) return `${Math.round(d)}d`;
  return `${Math.round(d/30)}mo`;
}

export default function Dashboard({ goSession, goNew }) {
  const sessions = useAllSessions();
  const [allDoses, setAllDoses] = useState([]);

  useEffect(() => {
    db.doses.toArray().then(setAllDoses);
  }, [sessions]);

  const sessionMap = useMemo(() => {
    const m = new Map();
    (sessions || []).forEach(s => m.set(s.id, s));
    return m;
  }, [sessions]);

  const lastBy = useMemo(() => {
    const map = {};
    for (const d of allDoses) {
      const sub = (d.substance || '').toLowerCase();
      const sess = sessionMap.get(d.session_id);
      if (!sess) continue;
      const calc = calcDose(d);
      const startedAt = sess.started_at + (Number(d.time_offset_min)||0) * 60000;
      const cur = map[sub];
      if (!cur || cur.startedAt < startedAt) {
        map[sub] = { substance: sub, total: calc.total, totalUnit: calc.totalUnit, startedAt };
      }
    }
    return map;
  }, [allDoses, sessionMap]);

  if (sessions === null) return <div className="p-6 text-ink-2">Loading…</div>;

  const now = Date.now();
  const usedSubstances = Object.keys(lastBy);

  return (
    <div className="p-4 space-y-4 pb-8 max-w-md mx-auto" data-testid="dashboard">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-medium">Field Notes</h1>
        <span className="text-xs text-ink-3">{new Date().toLocaleDateString()}</span>
      </div>

      <button className="btn-primary w-full text-lg" onClick={goNew} data-testid="dashboard-new">+ New session</button>

      <section>
        <div className="text-sm text-ink-2 mb-2">Re-dose status</div>
        {usedSubstances.length === 0 && <div className="text-ink-3 text-sm">No sessions yet.</div>}
        <div className="space-y-2">
          {usedSubstances.map(sub => {
            const last = lastBy[sub];
            // Windows (own and cross-tolerance) come only from intervals.js.
            const status = statusFor(nextAllowed(sub, lastBy), now);
            const sinceMs = now - last.startedAt;
            return (
              <div key={sub} className="card flex items-center justify-between" data-testid={`status-${sub}`}>
                <div>
                  <div className="font-medium" data-testid={`status-label-${sub}`}>{labelFor(sub)}</div>
                  <div className="text-xs text-ink-2" data-testid={`status-basis-${sub}`}>
                    Last: {formatDays(sinceMs)} ago · {status.basis}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`dot dot-${status.color}`} data-testid={`status-color-${sub}`}></span>
                  <span className="text-xs text-ink-1" data-testid={`next-${sub}`}>{status.countdown}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="text-sm text-ink-2 mb-2">Recent sessions</div>
        <div className="space-y-2">
          {(sessions || []).slice(0, 10).map(s => (
            <button key={s.id} className="w-full text-left card hover:border-bg-3" onClick={() => goSession(s.id)} data-testid={`recent-${s.id}`}>
              <div className="flex justify-between">
                <div className="font-medium">
                  {(s.set_tags?.[0]) || formatRelative(s.started_at)}
                </div>
                <div className="text-xs text-ink-3">{new Date(s.started_at).toLocaleDateString()}</div>
              </div>
              <div className="text-xs text-ink-2 mt-1 truncate">
                {sessionDoseSummary(allDoses, s.id)}
              </div>
            </button>
          ))}
          {(sessions || []).length === 0 && <div className="text-ink-3 text-sm">Nothing yet.</div>}
        </div>
      </section>
    </div>
  );
}

function sessionDoseSummary(allDoses, sid) {
  const list = allDoses.filter(d => d.session_id === sid);
  if (list.length === 0) return '—';
  return list.map(d => {
    const c = calcDose(d);
    return `${labelFor(d.substance)} ${c.display}`;
  }).join(' · ');
}

function formatRelative(ts) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
