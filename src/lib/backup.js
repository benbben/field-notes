import { exportAll, importAll } from '../state/store.js';
import { encryptJson, decryptJson } from './crypto.js';

// GitHub Contents API: PUT /repos/{owner}/{repo}/contents/{path}
const GH = 'https://api.github.com';

async function ghHeaders(pat) {
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${pat}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
}

export async function ghPing(cfg) {
  const r = await fetch(`${GH}/repos/${cfg.owner}/${cfg.repo}`, {
    headers: await ghHeaders(cfg.pat)
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.json();
}

async function getFileSha(cfg) {
  const r = await fetch(
    `${GH}/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(cfg.path)}?ref=${encodeURIComponent(cfg.branch || 'main')}`,
    { headers: await ghHeaders(cfg.pat) }
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const j = await r.json();
  return j.sha || null;
}

function utf8B64(s) {
  // Encode UTF-8 string to base64
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64Utf8(b) {
  const bin = atob(b.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export async function backupToGitHub(cfg, passphrase) {
  const data = await exportAll();
  const env = await encryptJson(data, passphrase);
  const body = JSON.stringify(env, null, 2);
  const sha = await getFileSha(cfg);
  const r = await fetch(
    `${GH}/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(cfg.path)}`,
    {
      method: 'PUT',
      headers: await ghHeaders(cfg.pat),
      body: JSON.stringify({
        message: `update backup ${new Date().toISOString().slice(0,10)}`,
        content: utf8B64(body),
        sha: sha || undefined,
        branch: cfg.branch || 'main'
      })
    }
  );
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`GitHub PUT ${r.status}: ${t.slice(0,200)}`);
  }
  return await r.json();
}

export async function restoreFromGitHub(cfg, passphrase) {
  const r = await fetch(
    `${GH}/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(cfg.path)}?ref=${encodeURIComponent(cfg.branch || 'main')}`,
    { headers: await ghHeaders(cfg.pat) }
  );
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const j = await r.json();
  const text = b64Utf8(j.content || '');
  const env = JSON.parse(text);
  const data = await decryptJson(env, passphrase); // throws if wrong passphrase
  await importAll(data);
  return { count: (data.sessions || []).length };
}
