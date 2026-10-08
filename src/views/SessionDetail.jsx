import { useCallback, useEffect, useRef, useState } from 'react';
import { loadSessionFull, updateSession } from '../state/store.js';
import { calcDose, labelFor } from '../lib/doses.js';
import { setDirty } from '../lib/updates.js';

const AUTOSAVE_MS = 400;
const DIRTY_KEY = 'detail-notes';

export default function SessionDetail({ id, onBack, onEdit }) {
  const [s, setS] = useState(null);
  const [notes, setNotes] = useState('');
  const [savedAt, setSavedAt] = useState(0);

  // Autosave bookkeeping lives in refs so flush() always sees the latest text.
  const latest = useRef('');
  const saved = useRef('');
  const timer = useRef(null);
  const focused = useRef(false);

  useEffect(() => {
    let alive = true;
    loadSessionFull(id).then(rec => {
      if (!alive) return;
      setS(rec);
      const n = rec?.notes || '';
      latest.current = n;
      saved.current = n;
      setNotes(n);
    });
    return () => { alive = false; };
  }, [id]);

  // Write pending text. The "dirty" flag (which defers app updates) is released only
  // once the text is saved AND the textarea is no longer focused, so an update can
  // never reload the page while the user is still in the Notes field.
  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (latest.current !== saved.current) {
      const v = latest.current;
      await updateSession(id, { notes: v });
      saved.current = v;
      setSavedAt(Date.now());
    }
    if (!focused.current && latest.current === saved.current) setDirty(DIRTY_KEY, false);
  }, [id]);

  // Flush on unmount (covers Back, Edit, tab switches and auto-lock) and release the dirty flag.
  useEffect(() => () => { focused.current = false; flush(); }, [flush]);

  const onNotesChange = (v) => {
    setNotes(v);
    latest.current = v;
    setDirty(DIRTY_KEY, true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { flush(); }, AUTOSAVE_MS);
  };
  const onFocus = () => { focused.current = true; setDirty(DIRTY_KEY, true); };
  const onBlur = () => { focused.current = false; flush(); };

  const back = async () => { await flush(); onBack(); };
  const edit = async () => { await flush(); onEdit(s.id); };

  if (!s) return <div className="p-6 text-ink-2">Loading…</div>;

  return (
    <div className="p-4 pb-8 max-w-md mx-auto space-y-4" data-testid="session-detail">
      <div className="flex items-center justify-between">
        <button className="btn-ghost" onClick={back} data-testid="detail-back">← Back</button>
        <button className="btn-secondary text-sm" onClick={edit} data-testid="detail-edit">Edit</button>
      </div>
      <div className="text-2xl font-medium">{new Date(s.started_at).toLocaleString()}</div>

      <section className="card space-y-2" data-testid="detail-doses">
        <div className="text-sm text-ink-2">Doses</div>
        {(s.doses || []).map(d => (
          <div key={d.id} className="flex justify-between text-sm">
            <span>{labelFor(d.substance)} {d.form ? `(${d.form})` : ''} {d.combo_type ? `· ${d.combo_type}` : ''}</span>
            <span className="text-accent">{calcDose(d).display}</span>
          </div>
        ))}
      </section>

      <section className="card space-y-1 text-sm">
        <div className="flex justify-between"><span className="text-ink-2">Empty stomach</span><span>{s.empty_stomach || '—'}</span></div>
        <div className="flex justify-between"><span className="text-ink-2">Source</span><span>{s.source_confidence || '—'}</span></div>
        {(s.set_tags?.length>0) && <div className="flex justify-between"><span className="text-ink-2">Set</span><span>{s.set_tags.join(', ')}</span></div>}
        {(s.setting_tags?.length>0) && <div className="flex justify-between"><span className="text-ink-2">Setting</span><span>{s.setting_tags.join(', ')}</span></div>}
      </section>

      <section className="card" data-testid="notes-card">
        <div className="flex items-baseline justify-between mb-1">
          <div className="text-sm text-ink-2">Notes</div>
          <div className="text-xs text-ink-3" data-testid="notes-saved" data-saved-at={savedAt || ''}>{savedAt ? 'Saved' : ''}</div>
        </div>
        <textarea
          className="field min-h-[160px]"
          value={notes}
          onChange={e => onNotesChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder="Anything about this session: setting, people, music, how it went."
          data-testid="detail-notes"
        />
      </section>
    </div>
  );
}
