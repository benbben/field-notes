#!/usr/bin/env node
// Field Notes test runner. `npm test` -> `node tests/run.mjs`.
//
//   node tests/run.mjs                 run everything
//   node tests/run.mjs --only <substr> only test files whose repo-relative path contains <substr>
//   node tests/run.mjs --skip-build    reuse an existing dist/ instead of running `vite build`
//   node tests/run.mjs --unit          unit tests only (no build, no preview server, no e2e)
//   node tests/run.mjs --e2e           e2e tests only (skips the unit group)
//   PORT=4174 node tests/run.mjs       preview-server port (default 4173)
//
// Order: scripts/verify-icons.mjs (if present) -> unit (node --test) -> vite build
//        -> vite preview (child process) -> e2e (node --test, BASE_URL env) -> kill server.
// Exit code is non-zero if any group failed. The preview server is always killed,
// including on failure and SIGINT.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TESTS_DIR, '..');
const VITE = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const PORT = Number(process.env.PORT || 4173);
const BASE_URL = `http://127.0.0.1:${PORT}/`;
const SERVER_READY_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 120_000; // per test(), passed to node --test

// ---------------------------------------------------------------- CLI
const opts = { only: null, skipBuild: false, unit: false, e2e: false };
{
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--only') {
      opts.only = args[++i];
      if (opts.only == null || opts.only.startsWith('--')) die('--only requires a substring argument');
    } else if (a.startsWith('--only=')) {
      opts.only = a.slice('--only='.length);
    } else if (a === '--skip-build') opts.skipBuild = true;
    else if (a === '--unit') opts.unit = true;
    else if (a === '--e2e') opts.e2e = true;
    else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else die(`unknown argument: ${a}`);
  }
  if (opts.unit && opts.e2e) die('--unit and --e2e are mutually exclusive');
}

function usage() {
  console.log('usage: node tests/run.mjs [--only <substr>] [--skip-build] [--unit | --e2e]   (env: PORT)');
}
function die(msg) {
  console.error(`run.mjs: ${msg}`);
  usage();
  process.exit(2);
}

// ---------------------------------------------------------------- helpers
const results = []; // { name, status: 'PASS'|'FAIL'|'SKIPPED', detail }
function record(name, status, detail = '') {
  results.push({ name, status, detail });
}
function banner(text) {
  console.log(`\n==== ${text} ====`);
}

/** Spawn a child with inherited stdio; resolves with the exit code (never rejects on non-zero). */
function run(cmd, args, { cwd = ROOT, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

/** List tests/<kind>/*.test.mjs (sorted), filtered by --only against the repo-relative posix path. */
function listTests(kind) {
  const dir = path.join(TESTS_DIR, kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.test.mjs'))
    .sort()
    .map(f => path.join(dir, f))
    .filter(abs => {
      if (!opts.only) return true;
      const rel = path.relative(ROOT, abs).split(path.sep).join('/');
      return rel.includes(opts.only);
    });
}

function nodeTestArgs(files, { serial = false } = {}) {
  const args = ['--test', '--test-reporter=spec', '--test-reporter-destination=stdout', `--test-timeout=${TEST_TIMEOUT_MS}`];
  if (serial) args.push('--test-concurrency=1');
  return [...args, ...files];
}

// ---------------------------------------------------------------- preview server
let server = null;

function startServer() {
  const env = { ...process.env, VITE_BASE: '/' };
  server = spawn(
    process.execPath,
    [VITE, 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, env, stdio: 'inherit', windowsHide: true }
  );
  server.on('exit', (code, signal) => {
    server.exited = { code, signal };
  });
  server.on('error', (err) => {
    server.exited = { code: 1, signal: null, error: err };
  });
  return server;
}

function stopServer() {
  if (!server || server.exited) return;
  try { server.kill(); } catch { /* already gone */ }
}

async function waitForServer() {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exited) {
      throw new Error(`preview server exited early (code ${server.exited.code}, signal ${server.exited.signal})`);
    }
    try {
      const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`preview server did not respond at ${BASE_URL} within ${SERVER_READY_TIMEOUT_MS} ms`);
}

// Always clean up the server: normal exit, uncaught errors, Ctrl+C.
process.on('exit', stopServer);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(sig, () => {
    console.error(`\nrun.mjs: received ${sig}, stopping preview server`);
    stopServer();
    process.exit(130);
  });
}

// ---------------------------------------------------------------- main
async function main() {
  const runUnit = !opts.e2e;
  const runE2E = !opts.unit;

  // (1) icon verification, if the script exists (it may be added later)
  banner('verify-icons');
  const iconsScript = path.join(ROOT, 'scripts', 'verify-icons.mjs');
  if (existsSync(iconsScript)) {
    const code = await run(process.execPath, [iconsScript]);
    record('verify-icons', code === 0 ? 'PASS' : 'FAIL', code === 0 ? '' : `exit code ${code}`);
  } else {
    console.log('SKIPPED: scripts/verify-icons.mjs not present');
    record('verify-icons', 'SKIPPED', 'scripts/verify-icons.mjs not present');
  }

  // (2) unit tests
  if (runUnit) {
    banner('unit tests');
    const files = listTests('unit');
    if (files.length === 0) {
      console.log('SKIPPED: no unit test files matched');
      record('unit', 'SKIPPED', 'no files matched');
    } else {
      const code = await run(process.execPath, nodeTestArgs(files));
      record('unit', code === 0 ? 'PASS' : 'FAIL', `${files.length} file(s)`);
    }
  } else {
    record('unit', 'SKIPPED', '--e2e');
  }

  // (3..5) build, preview, e2e
  if (runE2E) {
    const files = listTests('e2e');
    if (files.length === 0) {
      banner('e2e tests');
      console.log('SKIPPED: no e2e test files matched (build and preview server skipped too)');
      record('build', 'SKIPPED', 'no e2e files matched');
      record('e2e', 'SKIPPED', 'no files matched');
    } else {
      banner('build');
      let buildOk = true;
      if (opts.skipBuild) {
        if (existsSync(path.join(ROOT, 'dist', 'index.html'))) {
          console.log('--skip-build: reusing existing dist/');
          record('build', 'SKIPPED', '--skip-build');
        } else {
          console.error('--skip-build given but dist/index.html does not exist');
          record('build', 'FAIL', 'dist/index.html missing');
          buildOk = false;
        }
      } else {
        const code = await run(process.execPath, [VITE, 'build'], { env: { ...process.env, VITE_BASE: '/' } });
        record('build', code === 0 ? 'PASS' : 'FAIL', code === 0 ? '' : `exit code ${code}`);
        buildOk = code === 0;
      }

      if (!buildOk) {
        record('e2e', 'SKIPPED', 'build failed');
      } else {
        banner(`preview server on ${BASE_URL}`);
        let serverOk = true;
        try {
          startServer();
          await waitForServer();
          console.log(`preview server ready at ${BASE_URL}`);
        } catch (err) {
          console.error(String(err?.message || err));
          serverOk = false;
        }

        if (!serverOk) {
          record('e2e', 'FAIL', 'preview server did not start');
        } else {
          banner('e2e tests');
          try {
            const code = await run(process.execPath, nodeTestArgs(files, { serial: true }), {
              env: { ...process.env, BASE_URL }
            });
            record('e2e', code === 0 ? 'PASS' : 'FAIL', `${files.length} file(s)`);
          } finally {
            stopServer();
          }
        }
      }
    }
  } else {
    record('build', 'SKIPPED', '--unit');
    record('e2e', 'SKIPPED', '--unit');
  }

  // summary
  banner('summary');
  const width = Math.max(...results.map(r => r.name.length));
  for (const r of results) {
    const detail = r.detail ? `  (${r.detail})` : '';
    console.log(`${r.name.padEnd(width)}  ${r.status}${detail}`);
  }
  const failed = results.filter(r => r.status === 'FAIL');
  console.log(failed.length === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${failed.map(f => f.name).join(', ')})`);
  return failed.length === 0 ? 0 : 1;
}

main()
  .then(code => { stopServer(); process.exitCode = code; })
  .catch(err => {
    console.error(err);
    stopServer();
    process.exitCode = 1;
  });
