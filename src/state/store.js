import { useEffect, useState } from 'react';
import { db, BACKUP } from '../db/db.js';
import { cryptoId } from '../db/seed.js';

// Custom data-change emitter — Dexie 4 has no 'changes' event without
// the dexie-observable plugin, so we notify ourselves after mutations.
const bus = new EventTarget();
function notifyChange() { bus.dispatchEvent(new Event('change')); }
function onChange(fn) {
  bus.addEventListener('change', fn);
  return () => bus.removeEventListener('change', fn);
}

export function useAllSessions() {
  const [list, setList] = useState(null);
  useEffect(() => {
    let alive = true;
    const reload = async () => {
      try {
        const rows = await db.sessions.orderBy('started_at').reverse().toArray();
        if (alive) setList(rows);
      } catch (e) {
        console.error('useAllSessions reload failed', e);
        if (alive) setList([]);
      }
    };
    reload();
    const off = onChange(reload);
    return () => { alive = false; off(); };
  }, []);
  return list;
}

export async function loadSessionFull(id) {
  const session = await db.sessions.get(id);
  if (!session) return null;
  const doses = await db.doses.where({ session_id: id }).sortBy('time_offset_min');
  return { ...session, doses };
}

export async function createSession(partial) {
  const now = Date.now();
  const id = cryptoId();
  const session = {
    id,
    started_at: partial.started_at || now,
    set_tags: partial.set_tags || [],
    setting_tags: partial.setting_tags || [],
    empty_stomach: partial.empty_stomach || 'no',
    source_confidence: partial.source_confidence || 'unknown',
    experience: partial.experience || {
      onset_min: null, peak_min: null, duration_hr: null,
      intensity_1_10: null, body_load_1_10: null, headspace_1_10: null,
      effects_tags: [], adverse_effects_text: ''
    },
    context_text: partial.context_text || '',
    reflection_in_moment: partial.reflection_in_moment || '',
    reflection_day_after: partial.reflection_day_after || '',
    reflection_post: partial.reflection_post || '',
    created_at: now,
    updated_at: now,
  };
  await db.sessions.put(session);
  if (partial.doses && partial.doses.length) {
    const doses = partial.doses.map(d => ({
      ...d,
      id: d.id || cryptoId(),
      session_id: id,
    }));
    await db.doses.bulkPut(doses);
  }
  notifyChange();
  return id;
}

export async function updateSession(id, patch) {
  const cur = await db.sessions.get(id);
  if (!cur) return;
  const next = { ...cur, ...patch, updated_at: Date.now() };
  await db.sessions.put(next);
  notifyChange();
}

export async function replaceDoses(sessionId, doses) {
  await db.transaction('rw', db.doses, async () => {
    const existing = await db.doses.where({ session_id: sessionId }).toArray();
    if (existing.length) await db.doses.bulkDelete(existing.map(x => x.id));
    if (doses.length) {
      await db.doses.bulkPut(doses.map(d => ({
        ...d, id: d.id || cryptoId(), session_id: sessionId
      })));
    }
  });
  notifyChange();
}

export async function deleteSession(id) {
  await db.transaction('rw', db.sessions, db.doses, async () => {
    await db.doses.where({ session_id: id }).delete();
    await db.sessions.delete(id);
  });
  notifyChange();
}

export async function exportAll() {
  const [sessions, doses, strains, batches] = await Promise.all([
    db.sessions.toArray(),
    db.doses.toArray(),
    db.strains.toArray(),
    db.batches.toArray()
  ]);
  return {
    schema: 'field-notes/1',
    exported_at: Date.now(),
    sessions, doses, strains, batches
  };
}

export async function importAll(payload) {
  if (!payload || payload.schema !== 'field-notes/1') {
    throw new Error('Unsupported export schema');
  }
  await db.transaction('rw', db.sessions, db.doses, db.strains, db.batches, async () => {
    for (const s of payload.sessions || []) {
      const cur = await db.sessions.get(s.id);
      if (!cur || (s.updated_at || 0) >= (cur.updated_at || 0)) {
        await db.sessions.put(s);
      }
    }
    for (const d of payload.doses || []) {
      const cur = await db.doses.get(d.id);
      if (!cur) await db.doses.put(d);
    }
    for (const x of payload.strains || []) {
      const cur = await db.strains.get(x.id);
      if (!cur) await db.strains.put(x);
    }
    for (const b of payload.batches || []) {
      const cur = await db.batches.get(b.id);
      if (!cur) await db.batches.put(b);
    }
  });
  notifyChange();
}

export async function getBackupCfg() {
  const r = await db.backupCfg.get(BACKUP.CFG);
  return r ? r.value : null;
}
export async function setBackupCfg(cfg) {
  await db.backupCfg.put({ key: BACKUP.CFG, value: cfg });
}
