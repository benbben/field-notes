import { useEffect, useState } from 'react';
import { loadSessionFull, updateSession } from '../state/store.js';
import { calcDose } from '../lib/doses.js';

const HOUR = 60*60*1000;
const DAY = 24*HOUR;

export default function SessionDetail({ id, onBack, onEdit }) {
  const [s, setS] = useState(null);
  const [reflectionMoment, setReflectionMoment] = useState('');
  const [reflectionDay, setReflectionDay] = useState('');
  const [reflectionPost, setReflectionPost] = useState('');

  useEffect(() => {
    loadSessionFull(id).then(rec => {
      setS(rec);
      if (rec) {
        setReflectionMoment(rec.reflection_in_moment || '');
        setReflectionDay(rec.reflection_day_after || '');
        setReflectionPost(rec.reflection_post || '');
      }
    });
  }, [id]);

  if (!s) return <div className="p-6 text-ink-2">Loading…</div>;

  const now = Date.now();
  const since = now - s.started_at;
  const dayAfterAvailable = since >= 18*HOUR;
  const postAvailable = since >= 7*DAY;

  const saveReflection = async (key, value, setter) => {
    setter(value);
    await updateSession(s.id, { [key]: value });
  };

  return (
    <div className="p-4 pb-28 max-w-md mx-auto space-y-4" data-testid="session-detail">
      <div className="flex items-center justify-between">
        <button className="btn-ghost" onClick={onBack}>← Back</button>
        <button className="btn-secondary text-sm" onClick={() => onEdit(s.id)}>Edit</button>
      </div>
      <div className="text-2xl font-medium">{new Date(s.started_at).toLocaleString()}</div>

      <section className="card space-y-2">
        <div className="text-sm text-ink-2">Doses</div>
        {(s.doses || []).map(d => (
          <div key={d.id} className="flex justify-between text-sm">
            <span>{prettyName(d.substance)} {d.form ? `(${d.form})` : ''} {d.combo_type ? `· ${d.combo_type}` : ''}</span>
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

      <section className="card">
        <div className="text-sm text-ink-2 mb-1">Context</div>
        <div className="whitespace-pre-wrap text-sm">{s.context_text || '—'}</div>
      </section>

      <section className="card">
        <div className="text-sm text-ink-2 mb-1">Reflection — in the moment</div>
        <textarea
          className="field"
          value={reflectionMoment}
          onChange={e => saveReflection('reflection_in_moment', e.target.value, setReflectionMoment)}
          placeholder="Always editable"
          data-testid="reflection-moment"
        />
      </section>

      <section className={`card ${!dayAfterAvailable ? 'opacity-50' : ''}`}>
        <div className="text-sm text-ink-2 mb-1">Reflection — day after</div>
        {!dayAfterAvailable ? (
          <div className="text-xs text-ink-3">Available 18h after session start.</div>
        ) : (
          <textarea
            className="field"
            value={reflectionDay}
            onChange={e => saveReflection('reflection_day_after', e.target.value, setReflectionDay)}
            data-testid="reflection-day"
          />
        )}
      </section>

      <section className={`card ${!postAvailable ? 'opacity-50' : ''}`}>
        <div className="text-sm text-ink-2 mb-1">Reflection — post-integration</div>
        {!postAvailable ? (
          <div className="text-xs text-ink-3">Available 7 days after session start.</div>
        ) : (
          <textarea
            className="field"
            value={reflectionPost}
            onChange={e => saveReflection('reflection_post', e.target.value, setReflectionPost)}
            data-testid="reflection-post"
          />
        )}
      </section>
    </div>
  );
}

function prettyName(s) {
  if (s === 'lsd' || s === 'dmt') return s.toUpperCase();
  if (s === 'mdma') return 'MDMA';
  return (s || '').charAt(0).toUpperCase() + (s || '').slice(1);
}
