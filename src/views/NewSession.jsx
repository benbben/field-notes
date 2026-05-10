import { useMemo, useState } from 'react';
import DoseForm from '../components/DoseForm.jsx';
import { checkInteractions } from '../lib/interactions.js';
import { createSession, updateSession, replaceDoses } from '../state/store.js';
import { cryptoId } from '../db/seed.js';

export default function NewSession({ onDone, initial }) {
  const [startedAt, setStartedAt] = useState(initial?.started_at || Date.now());
  const [setTags, setSetTags] = useState((initial?.set_tags || []).join(', '));
  const [settingTags, setSettingTags] = useState((initial?.setting_tags || []).join(', '));
  const [emptyStomach, setEmptyStomach] = useState(initial?.empty_stomach || 'no');
  const [sourceConfidence, setSourceConfidence] = useState(initial?.source_confidence || 'unknown');
  const [contextText, setContextText] = useState(initial?.context_text || '');
  const [reflectionMoment, setReflectionMoment] = useState(initial?.reflection_in_moment || '');
  const [doses, setDoses] = useState(initial?.doses?.length ? initial.doses : [{ id: cryptoId(), substance: '', combo_type: 'first', time_offset_min: 0 }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const warnings = useMemo(() => {
    if (doses.length < 2) return [];
    return checkInteractions(doses.map(d => d.substance));
  }, [doses]);

  const setDose = (idx, next) => {
    const arr = [...doses]; arr[idx] = next; setDoses(arr);
  };
  const addDose = () => setDoses([...doses, { id: cryptoId(), substance: '', combo_type: 'sequential', time_offset_min: 0 }]);
  const removeDose = (idx) => setDoses(doses.filter((_, i) => i !== idx));

  const localDateValue = (ts) => {
    const d = new Date(ts);
    const pad = n => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const save = async () => {
    setError('');
    if (doses.length === 0) { setError('Add at least one dose.'); return; }
    if (doses.some(d => !d.substance)) { setError('Each dose needs a substance.'); return; }
    setSaving(true);
    try {
      const session = {
        started_at: startedAt,
        set_tags: setTags.split(',').map(s => s.trim()).filter(Boolean),
        setting_tags: settingTags.split(',').map(s => s.trim()).filter(Boolean),
        empty_stomach: emptyStomach,
        source_confidence: sourceConfidence,
        context_text: contextText,
        reflection_in_moment: reflectionMoment,
        doses
      };
      let id;
      if (initial?.id) {
        await updateSession(initial.id, session);
        await replaceDoses(initial.id, doses);
        id = initial.id;
      } else {
        id = await createSession(session);
      }
      onDone?.(id);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 space-y-4 pb-32 max-w-md mx-auto" data-testid="new-session">
      <div className="text-2xl font-medium">{initial?.id ? 'Edit session' : 'New session'}</div>

      <div>
        <label className="label">Start time</label>
        <input
          className="field"
          type="datetime-local"
          value={localDateValue(startedAt)}
          onChange={e => setStartedAt(new Date(e.target.value).getTime())}
          data-testid="start-time"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Set tags</label>
          <input className="field" value={setTags} onChange={e => setSetTags(e.target.value)} placeholder="e.g. tired, focused" />
        </div>
        <div>
          <label className="label">Setting tags</label>
          <input className="field" value={settingTags} onChange={e => setSettingTags(e.target.value)} placeholder="e.g. home, alone" />
        </div>
      </div>

      <div>
        <label className="label">Empty stomach</label>
        <div className="flex gap-2">
          {['no','partial','yes'].map(o =>
            <button key={o} className={`tag ${emptyStomach===o ? 'tag-active':''}`} onClick={() => setEmptyStomach(o)}>{o}</button>
          )}
        </div>
      </div>

      <div>
        <label className="label">Source confidence</label>
        <div className="flex gap-2">
          {[['tested','tested'],['trusted','trusted'],['unknown','unknown']].map(([id,label]) =>
            <button key={id} className={`tag ${sourceConfidence===id ? 'tag-active':''}`} onClick={() => setSourceConfidence(id)}>{label}</button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-base font-medium">Doses</div>
          <button className="btn-secondary text-sm" onClick={addDose} data-testid="add-dose">+ Add dose</button>
        </div>
        {doses.map((d, i) => (
          <DoseForm key={d.id} value={d} onChange={n => setDose(i, n)} onRemove={() => removeDose(i)} isFirst={i===0} />
        ))}
      </div>

      {warnings.length > 0 && (
        <div className="card border-warn/40 bg-warn/10" data-testid="interactions">
          <div className="text-warn font-medium mb-2">Interaction notes</div>
          <ul className="space-y-2">
            {warnings.map((w, i) => (
              <li key={i} className="text-sm">
                <div className="font-medium text-ink-0">{w.title}</div>
                <div className="text-ink-2">{w.body}</div>
              </li>
            ))}
          </ul>
          <div className="text-xs text-ink-3 mt-3">Informational. These warnings do not block saving.</div>
        </div>
      )}

      <div>
        <label className="label">Context</label>
        <textarea className="field min-h-[80px]" value={contextText} onChange={e => setContextText(e.target.value)} placeholder="What's going on around this session?" />
      </div>

      <div>
        <label className="label">Reflection — in the moment</label>
        <textarea className="field min-h-[80px]" value={reflectionMoment} onChange={e => setReflectionMoment(e.target.value)} placeholder="How are you feeling right now?" />
      </div>

      {error && <div className="text-bad text-sm" data-testid="save-error">{error}</div>}

      <div className="flex gap-2">
        <button className="btn-ghost flex-1" onClick={() => onDone?.(null)}>Cancel</button>
        <button className="btn-primary flex-1" onClick={save} disabled={saving} data-testid="save-session">
          {saving ? 'Saving…' : 'Save session'}
        </button>
      </div>
    </div>
  );
}
