# Field Notes tests

Run everything with `npm test` (= `node tests/run.mjs`). Node is the only runtime; tests use the
built-in `node:test` runner, `node:assert/strict`, the `playwright` library (Chromium, headless) and
`fake-indexeddb` + Dexie for Node-side database tests. No `@playwright/test`.

Order: `scripts/verify-icons.mjs` (if present, else SKIPPED) -> `tests/unit/*.test.mjs` -> `vite build`
(base `/`) -> `vite preview --port PORT --strictPort --host 127.0.0.1` (child process, always killed) ->
`tests/e2e/*.test.mjs` with `BASE_URL=http://127.0.0.1:PORT/`. A PASS/FAIL summary per group is printed last.

Flags: `--only <substr>` runs only test files whose repo-relative path contains `<substr>`;
`--skip-build` reuses an existing `dist/`; `--unit` / `--e2e` restrict to one kind.
Env: `PORT` (default 4173) preview port; `E2E_TIMEOUT` (ms, default 15000) Playwright action timeout;
`BASE_URL` is set by the runner (override it to point e2e tests at another server).

Layout: `tests/helpers/browser.mjs` (launch/newPage/gotoApp/setPasscode/unlock/addDose/...),
`tests/helpers/db.mjs` (fake IndexedDB, inline v1 schema, fixtures for migration tests),
`tests/unit/sanity.test.mjs`, `tests/e2e/regression.test.mjs` (v1 regression, one `test()` each).
Selectors are `data-testid` only (plus visible text where no testid exists), never placeholders.
