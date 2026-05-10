import { useEffect, useState } from 'react';
import { calcDose, FORMS, PREPS_PSILO, SUBSTANCES } from '../lib/doses.js';
import { db } from '../db/db.js';
import { cryptoId } from '../db/seed.js';

export default function DoseForm({ value, onChange, onRemove, isFirst }) {
  const v = value;
  const set = (patch) => onChange({ ...v, ...patch });
  const sub = (v.substance || '').toLowerCase();

  // Strain library for psilocybin
  const [strains, setStrains] = useState([]);
  useEffect(() => {
    if (sub === 'psilocybin') {
      db.strains.where({ substance: 'psilocybin' }).toArray().then(setStrains);
    }
  }, [sub]);

  const addStrain = async () => {
    const name = prompt('New strain name?');
    if (!name) return;
    const row = { id: cryptoId(), substance: 'psilocybin', name };
    await db.strains.put(row);
    setStrains(s => [...s, row]);
    set({ subtype: row.id });
  };

  const calc = calcDose(v);

  return (
    <div className="card space-y-3" data-testid="dose-form">
      <div className="flex items-center justify-between">
        <label className="label mb-0">Substance</label>
        <button className="text-bad text-sm" onClick={onRemove} data-testid="dose-remove">Remove</button>
      </div>
      <select className="field" value={v.substance || ''} onChange={e => set({ substance: e.target.value, form: '', amount: '', claimed_potency: '' })}
              data-testid="dose-substance">
        <option value="">Select…</option>
        {SUBSTANCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>

      {sub === 'psilocybin' && (
        <>
          <label className="label">Strain</label>
          <div className="flex gap-2">
            <select className="field flex-1" value={v.subtype || ''} onChange={e => set({ subtype: e.target.value })} data-testid="psilo-strain">
              <option value="">Select…</option>
              {strains.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="btn-secondary" onClick={addStrain}>+ Add</button>
          </div>
          <label className="label">Prep</label>
          <select className="field" value={v.prep || ''} onChange={e => set({ prep: e.target.value })}>
            <option value="">Select…</option>
            {PREPS_PSILO.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <NumField label="Amount (g)" step="0.1" value={v.amount} onChange={a => set({ amount: a, unit: 'g' })} testid="psilo-amount" />
        </>
      )}

      {sub === 'mdma' && (
        <>
          <label className="label">Form</label>
          <select className="field" value={v.form || ''} onChange={e => set({ form: e.target.value, amount: '', claimed_potency: '' })} data-testid="mdma-form">
            <option value="">Select…</option>
            {FORMS.mdma.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          {v.form === 'crystal' && (
            <NumField label="Amount (mg)" step="1" value={v.amount} onChange={a => set({ amount: a, unit: 'mg' })} testid="mdma-mg" />
          )}
          {(v.form === 'pressed' || v.form === 'capsule') && (
            <>
              <NumField label="Units" step="0.5" value={v.amount} onChange={a => set({ amount: a, unit: 'units' })} testid="mdma-units" />
              <NumField label="Claimed mg per unit" step="1" value={v.claimed_potency} onChange={p => set({ claimed_potency: p, claimed_potency_unit: 'mg' })} testid="mdma-mgper" />
            </>
          )}
          <label className="label">Reagent test result (optional)</label>
          <input className="field" value={v.reagent || ''} onChange={e => set({ reagent: e.target.value })} placeholder="e.g. Marquis: dark purple → black" />
        </>
      )}

      {sub === 'lsd' && (
        <>
          <label className="label">Form</label>
          <select className="field" value={v.form || ''} onChange={e => set({ form: e.target.value })} data-testid="lsd-form">
            <option value="">Select…</option>
            {FORMS.lsd.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <NumField label="Units" step="0.25" value={v.amount} onChange={a => set({ amount: a, unit: 'units' })} testid="lsd-units" />
          <NumField label="Claimed µg per unit" step="1" value={v.claimed_potency || 100} onChange={p => set({ claimed_potency: p, claimed_potency_unit: 'µg' })} testid="lsd-ugper" />
        </>
      )}

      {sub === 'cannabis' && (
        <>
          <label className="label">Form</label>
          <select className="field" value={v.form || ''} onChange={e => set({ form: e.target.value })} data-testid="cannabis-form">
            <option value="">Select…</option>
            {FORMS.cannabis.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <label className="label">Strain (free text)</label>
          <input className="field" value={v.subtype || ''} onChange={e => set({ subtype: e.target.value })} placeholder="e.g. Blue Dream" />
          {v.form === 'edible'
            ? <NumField label="Amount (mg THC)" step="1" value={v.amount} onChange={a => set({ amount: a, unit: 'mg' })} />
            : <NumField label="Amount (g)" step="0.05" value={v.amount} onChange={a => set({ amount: a, unit: 'g' })} />
          }
          <NumField label="THC % (optional)" step="0.1" value={v.thc_pct || ''} onChange={p => set({ thc_pct: p })} />
        </>
      )}

      {sub === 'dmt' && (
        <>
          <label className="label">Form</label>
          <select className="field" value={v.form || ''} onChange={e => set({ form: e.target.value })} data-testid="dmt-form">
            <option value="">Select…</option>
            {FORMS.dmt.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <NumField label="Amount (mg)" step="0.5" value={v.amount} onChange={a => set({ amount: a, unit: 'mg' })} />
        </>
      )}

      {sub === 'adderall' && (
        <>
          <label className="label">Form</label>
          <select className="field" value={v.form || ''} onChange={e => set({ form: e.target.value })} data-testid="adderall-form">
            <option value="">Select…</option>
            {FORMS.adderall.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <NumField label="Amount (mg)" step="1" value={v.amount} onChange={a => set({ amount: a, unit: 'mg' })} />
        </>
      )}

      {sub === 'custom' && (
        <>
          <label className="label">Substance name</label>
          <input className="field" value={v.subtype || ''} onChange={e => set({ subtype: e.target.value })} placeholder="e.g. Ketamine" />
          <NumField label="Amount" step="any" value={v.amount} onChange={a => set({ amount: a })} />
          <label className="label">Unit</label>
          <input className="field" value={v.unit || ''} onChange={e => set({ unit: e.target.value })} placeholder="mg / g / µg" />
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <NumField label="Time offset from start (min)" step="1" value={v.time_offset_min} onChange={t => set({ time_offset_min: t })} testid="dose-offset" />
        <div>
          <label className="label">Combo type</label>
          <select className="field" value={v.combo_type || (isFirst ? 'first' : 'sequential')} onChange={e => set({ combo_type: e.target.value })} data-testid="dose-combo">
            <option value="first">First</option>
            <option value="stacked">Stacked</option>
            <option value="sequential">Sequential</option>
            <option value="redose">Redose</option>
          </select>
        </div>
      </div>

      {sub && v.amount && (
        <div className="text-sm text-ink-1" data-testid="dose-calculated">
          Calculated total: <span className="text-accent font-medium">{calc.display}</span>
        </div>
      )}
    </div>
  );
}

function NumField({ label, value, onChange, step = '1', testid }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="field" type="number" step={step} value={value ?? ''}
             onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
             inputMode="decimal" data-testid={testid} />
    </div>
  );
}
