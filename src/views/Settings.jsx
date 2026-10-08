import { useEffect, useRef, useState } from 'react';
import { getMeta, setMeta, META } from '../db/db.js';
import { setPasscode, tryUnlock } from '../lib/auth.js';
import { exportAll, importAll, getBackupCfg, setBackupCfg, onChange } from '../state/store.js';
import { backupToGitHub, ghPing, restoreFromGitHub } from '../lib/backup.js';
import { exportJsonFile } from '../lib/exportFile.js';
import { APP_VERSION } from '../lib/version.js';
import { checkForUpdate, hasPendingUpdate, isUpdateSupported, setDirty } from '../lib/updates.js';

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
    <div className="p-4 space-y-4 pb-8 max-w-md mx-auto" data-testid="settings-view">
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

      <BuildInfo onMsg={setMsg} />
    </div>
  );
}

function ChangePasscode({ onMsg }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  // Typed-but-unsubmitted passcodes defer app updates like any other form.
  useEffect(() => { setDirty('settings-passcode', current !== '' || next !== ''); }, [current, next]);
  useEffect(() => () => setDirty('settings-passcode', false), []);
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

  // Safari only allows navigator.share() synchronously inside the tap, so the
  // export payload is prefetched here and refreshed whenever data changes.
  const payloadRef = useRef(null);
  useEffect(() => {
    let alive = true;
    const load = () => exportAll().then(p => { if (alive) payloadRef.current = p; }).catch(() => {});
    load();
    const off = onChange(load);
    return () => { alive = false; off(); };
  }, []);

  const exportNow = () => {
    const payload = payloadRef.current;
    if (!payload) {
      onMsg('Preparing export — tap again in a moment');
      exportAll().then(p => { payloadRef.current = p; }).catch(() => {});
      return;
    }
    const name = `field-notes-${new Date().toISOString().slice(0,10)}.json`;
    const text = JSON.stringify({ ...payload, exported_at: Date.now() }, null, 2);
    const n = payload.sessions.length;
    let result;
    try {
      result = exportJsonFile(text, name, 'Field Notes export');
    } catch (e) {
      onMsg(`Export failed: ${e.message}`);
      return;
    }
    result.done
      .then(() => onMsg(`Exported ${n} sessions${result.method === 'share' ? '' : ' (download)'}`))
      .catch(e => {
        if (e && e.name === 'AbortError') onMsg('Export cancelled');
        else onMsg(`Export failed: ${e?.message || e}`);
      });
  };

  const onPick = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setImporting(true);
    try {
      const text = await f.text();
      const obj = JSON.parse(text);
      const r = await importAll(obj);
      onMsg(`Imported ${r.sessions} sessions`);
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
          <input type="file" className="hidden" accept=".json,application/json" onChange={onPick} data-testid="import-json-input" />
        </label>
      </div>
    </section>
  );
}

function GitHubBackup({ onMsg }) {
  const EMPTY_CFG = { pat: '', owner: '', repo: '', path: 'field-notes-backup.json', branch: 'main' };
  const [cfg, setCfg] = useState(EMPTY_CFG);
  const [savedCfg, setSavedCfg] = useState(EMPTY_CFG);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getBackupCfg().then(saved => { if (saved) { const c = { pat: '', ...saved }; setCfg(c); setSavedCfg(c); } });
  }, []);

  // Unsaved config edits or a typed passphrase defer app updates (see src/lib/updates.js).
  useEffect(() => {
    const unsaved = passphrase !== '' || JSON.stringify(cfg) !== JSON.stringify(savedCfg);
    setDirty('settings-backup', unsaved);
  }, [cfg, savedCfg, passphrase]);
  useEffect(() => () => setDirty('settings-backup', false), []);

  const update = (k, v) => setCfg(c => ({ ...c, [k]: v }));

  const saveCfg = async () => {
    await setBackupCfg({ ...cfg }); // includes pat
    setSavedCfg({ ...cfg });
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

function BuildInfo({ onMsg }) {
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try {
      if (!isUpdateSupported()) { onMsg('Updates are not available in this browser'); return; }
      onMsg('Checking for update…');
      await checkForUpdate();
      // Give a found update a moment to install before reporting.
      await new Promise(r => setTimeout(r, 1500));
      onMsg(hasPendingUpdate()
        ? 'Update ready — it applies as soon as you leave the form you are editing'
        : 'You have the latest version');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card flex items-center justify-between gap-3" data-testid="build-info">
      <div className="text-xs text-ink-2" data-testid="build-version">Build {APP_VERSION}</div>
      <button className="btn-secondary text-sm whitespace-nowrap" onClick={check} disabled={busy} data-testid="check-update">Check for update</button>
    </section>
  );
}
