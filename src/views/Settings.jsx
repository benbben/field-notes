import { useEffect, useState } from 'react';
import { db, getMeta, setMeta, META } from '../db/db.js';
import { hashPasscode } from '../lib/crypto.js';
import { setPasscode, hasPasscode, tryUnlock } from '../lib/auth.js';
import { exportAll, importAll, getBackupCfg, setBackupCfg } from '../state/store.js';
import { backupToGitHub, ghPing, restoreFromGitHub } from '../lib/backup.js';

export default function Settings({ onLock }) {
  const [theme, setTheme] = useState('dark');
  const [persisted, setPersisted] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    (async () => {
      setTheme((await getMeta(META.THEME)) || 'dark');
      const p = await navigator.storage?.persisted?.();
      setPersisted(!!p);
    })();
  }, []);

  const setThemeAnd = async (t) => {
    setTheme(t);
    await setMeta(META.THEME, t);
    document.documentElement.classList.toggle('light', t === 'light');
  };

  return (
    <div className="p-4 space-y-4 pb-28 max-w-md mx-auto" data-testid="settings-view">
      <h1 className="text-2xl font-medium">Settings</h1>

      <section className="card space-y-3">
        <div className="text-sm text-ink-2">Appearance</div>
        <div className="flex gap-2">
          <button className={`tag ${theme==='dark'?'tag-active':''}`} onClick={() => setThemeAnd('dark')}>Dark</button>
          <button className={`tag ${theme==='light'?'tag-active':''}`} onClick={() => setThemeAnd('light')}>Light</button>
        </div>
      </section>

      <section className="card space-y-2">
        <div className="text-sm text-ink-2">Storage</div>
        <div className="text-sm">Persistent storage: {persisted ? <span className="text-ok">granted</span> : <span className="text-warn">not yet</span>}</div>
        <button className="btn-secondary" onClick={async () => {
          const p = await navigator.storage?.persist?.();
          setPersisted(!!p);
        }}>Request persistent</button>
      </section>

      <ChangePasscode onMsg={setMsg} />

      <section className="card space-y-2">
        <div className="text-sm text-ink-2">Lock</div>
        <button className="btn-secondary w-full" onClick={onLock} data-testid="lock-now">Lock now</button>
      </section>

      <ImportExport onMsg={setMsg} />
      <GitHubBackup onMsg={setMsg} />

      {msg && <div className="text-sm text-ink-1" data-testid="settings-msg">{msg}</div>}
    </div>
  );
}

function ChangePasscode({ onMsg }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const change = async () => {
    if (!await tryUnlock(current)) { onMsg('Current passcode incorrect'); return; }
    if (!/^\d{4}$|^\d{6}$/.test(next)) { onMsg('New passcode must be 4 or 6 digits'); return; }
    await setPasscode(next);
    onMsg('Passcode updated');
    setCurrent(''); setNext('');
  };
  return (
    <section className="card space-y-2">
      <div className="text-sm text-ink-2">Change passcode</div>
      <input className="field" placeholder="Current" type="password" inputMode="numeric" value={current} onChange={e => setCurrent(e.target.value)} />
      <input className="field" placeholder="New (4 or 6 digits)" type="password" inputMode="numeric" value={next} onChange={e => setNext(e.target.value)} />
      <button className="btn-secondary" onClick={change}>Update</button>
    </section>
  );
}

function ImportExport({ onMsg }) {
  const [importing, setImporting] = useState(false);
  const exportNow = async () => {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `field-notes-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    onMsg(`Exported ${data.sessions.length} sessions`);
  };
  const onPick = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setImporting(true);
    try {
      const text = await f.text();
      const obj = JSON.parse(text);
      await importAll(obj);
      onMsg(`Imported ${obj.sessions?.length || 0} sessions`);
    } catch (err) {
      onMsg(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };
  return (
    <section className="card space-y-2">
      <div className="text-sm text-ink-2">Backup — local file</div>
      <div className="flex gap-2">
        <button className="btn-secondary flex-1" onClick={exportNow} data-testid="export-json">Export JSON</button>
        <label className="btn-secondary flex-1 text-center cursor-pointer" data-testid="import-json-label">
          {importing ? 'Importing…' : 'Import JSON'}
          <input type="file" className="hidden" accept="application/json" onChange={onPick} data-testid="import-json-input" />
        </label>
      </div>
    </section>
  );
}

function GitHubBackup({ onMsg }) {
  const [cfg, setCfg] = useState({ pat: '', owner: '', repo: '', path: 'field-notes-backup.json', branch: 'main' });
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getBackupCfg().then(saved => { if (saved) setCfg({ pat: '', ...saved }); });
  }, []);

  const update = (k, v) => setCfg(c => ({ ...c, [k]: v }));

  const saveCfg = async () => {
    await setBackupCfg({ ...cfg }); // includes pat
    onMsg('Backup config saved');
  };

  const test = async () => {
    setBusy(true);
    try { const r = await ghPing(cfg); onMsg(`Connected to ${r.full_name} (${r.private?'private':'public'})`); }
    catch (e) { onMsg(`Test failed: ${e.message}`); }
    finally { setBusy(false); }
  };

  const backup = async () => {
    if (!passphrase) { onMsg('Passphrase required'); return; }
    setBusy(true);
    try { await backupToGitHub(cfg, passphrase); onMsg('Backup committed.'); }
    catch (e) { onMsg(`Backup failed: ${e.message}`); }
    finally { setBusy(false); }
  };

  const restore = async () => {
    if (!passphrase) { onMsg('Passphrase required'); return; }
    setBusy(true);
    try { const r = await restoreFromGitHub(cfg, passphrase); onMsg(`Restored ${r.count} sessions.`); }
    catch (e) {
      if (e.code === 'BAD_PASSPHRASE') onMsg('Passphrase incorrect or backup corrupted.');
      else onMsg(`Restore failed: ${e.message}`);
    }
    finally { setBusy(false); }
  };

  return (
    <section className="card space-y-2" data-testid="gh-backup">
      <div className="text-sm text-ink-2">Encrypted GitHub backup</div>
      <div className="text-xs text-bad">Forgetting the passphrase makes this backup permanently unrecoverable.</div>
      <input className="field" placeholder="GitHub Personal Access Token" type="password" value={cfg.pat || ''} onChange={e => update('pat', e.target.value)} data-testid="gh-pat" />
      <div className="grid grid-cols-2 gap-2">
        <input className="field" placeholder="owner" value={cfg.owner} onChange={e => update('owner', e.target.value)} data-testid="gh-owner" />
        <input className="field" placeholder="repo" value={cfg.repo} onChange={e => update('repo', e.target.value)} data-testid="gh-repo" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className="field" placeholder="path" value={cfg.path} onChange={e => update('path', e.target.value)} />
        <input className="field" placeholder="branch" value={cfg.branch} onChange={e => update('branch', e.target.value)} />
      </div>
      <input className="field" placeholder="Passphrase" type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} data-testid="gh-passphrase" />
      <div className="flex gap-2 flex-wrap">
        <button className="btn-secondary flex-1" onClick={saveCfg}>Save config</button>
        <button className="btn-secondary flex-1" onClick={test} disabled={busy}>Test</button>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button className="btn-primary flex-1" onClick={backup} disabled={busy} data-testid="gh-backup-btn">Backup to GitHub</button>
        <button className="btn-secondary flex-1" onClick={restore} disabled={busy} data-testid="gh-restore-btn">Restore</button>
      </div>
    </section>
  );
}
