import { useEffect, useMemo, useState } from 'react';
import { db } from '../db/db.js';
import { calcDose, SUBSTANCES } from '../lib/doses.js';
import { deleteSession, useAllSessions } from '../state/store.js';

export default function Sessions({ goSession }) {
  const sessions = useAllSessions();
  const [allDoses, setAllDoses] = useState([]);
  const [filterSub, setFilterSub] = useState('');
  const [search, setSearch] = useState('');
  const [confirmId, setConfirmId] = useState(null);

  useEffect(() => { db.doses.toArray().then(setAllDoses); }, [sessions]);

  const dosesById = useMemo(() => {
    const m = new Map();
    for (const d of allDoses) {
      if (!m.has(d.session_id)) m.set(d.session_id, []);
      m.get(d.session_id).push(d);
    }
    return m;
  }, [allDoses]);

  const filtered = useMemo(() => {
    return (sessions || []).filter(s => {
      if (filterSub) {
        const ds = dosesById.get(s.id) || [];
        if (!ds.some(d => (d.substance || '').toLowerCase() === filterSub)) return false;
      }
      if (search) {
        const text = [
          s.context_text, s.reflection_in_moment,
          s.reflection_day_after, s.reflection_post,
          ...(s.set_tags || []), ...(s.setting_tags || [])
        ].filter(Boolean).join(' ').toLowerCase();
        if (!text.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [sessions, dosesById, filterSub, search]);

  const onDelete = async (id) => {
    await deleteSession(id);
    setConfirmId(null);
  };

  return (
    <div className="p-4 space-y-3 pb-28 max-w-md mx-auto" data-testid="sessions-view">
      <h1 className="text-2xl font-medium">Sessions</h1>
      <div className="flex gap-2">
        <select className="field flex-1" value={filterSub} onChange={e => setFilterSub(e.target.value)} data-testid="filter-sub">
          <option value="">All substances</option>
          {SUBSTANCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      <input className="field" placeholder="Search context & reflection…" value={search} onChange={e => setSearch(e.target.value)} data-testid="search-text" />

      <div className="space-y-2">
        {filtered.map(s => (
          <div key={s.id} className="card" data-testid={`session-row-${s.id}`}>
            <div className="flex items-start justify-between">
              <button onClick={() => goSession(s.id)} className="flex-1 text-left">
                <div className="font-medium">{new Date(s.started_at).toLocaleString()}</div>
                <div className="text-xs text-ink-2 mt-1">
                  {(dosesById.get(s.id) || []).map(d => `${prettyName(d.substance)} ${calcDose(d).display}`).join(' · ') || '—'}
                </div>
                {(s.set_tags?.length || s.setting_tags?.length) ? (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(s.set_tags || []).map(t => <span key={'set'+t} className="tag">{t}</span>)}
                    {(s.setting_tags || []).map(t => <span key={'sp'+t} className="tag">{t}</span>)}
                  </div>
                ) : null}
              </button>
              <button className="text-bad text-xs ml-2" onClick={() => setConfirmId(s.id)} data-testid={`delete-${s.id}`}>Delete</button>
            </div>
            {confirmId === s.id && (
              <div className="mt-2 flex items-center justify-end gap-2 text-sm">
                <span className="text-ink-2">Confirm delete?</span>
                <button className="btn-ghost" onClick={() => setConfirmId(null)}>Cancel</button>
                <button className="btn-danger" onClick={() => onDelete(s.id)} data-testid={`confirm-delete-${s.id}`}>Delete</button>
              </div>
            )}
          </div>
        ))}
        {filtered.length === 0 && <div className="text-ink-3 text-sm">No sessions match.</div>}
      </div>
    </div>
  );
}

function prettyName(s) {
  if (s === 'lsd' || s === 'dmt') return s.toUpperCase();
  if (s === 'mdma') return 'MDMA';
  return (s || '').charAt(0).toUpperCase() + (s || '').slice(1);
}
