# Changelog

## Standing rule for schema changes

Never modify an existing `db.version(N)` block. Schema changes add `db.version(N+1)` with an `.upgrade()`. Every schema change ships with a populated-DB migration test.

## v1.1 — 2026-10-08

### Fixed
- Tab bar invisible on iPhone. Safe-area padding is no longer applied to `body`; the app shell is a fixed full-screen column where only `<main>` scrolls and carries the top inset, and the tab bar carries the bottom inset. Insets are exposed as `--sat` / `--sab` CSS variables so tests can simulate them. Tab targets are at least 48 px tall and use inline SVG icons.
- Home-screen icon. `icon-192.png` was a truncated PNG and all icons had transparent rounded corners, which iOS fills with black. Icons are now generated opaque and square by `scripts/make-icons.mjs` (from the compass mark in `favicon.svg`) and checked by `scripts/verify-icons.mjs`, which runs in the test suite and as a build step in the deploy workflow. `index.html` points `apple-touch-icon` at the new 180×180 file and the manifest lists 192, 512 and a 512 maskable icon.
- `tests/` is now committed; `npm test` runs the Node (fake-indexeddb) and Playwright suites.
- SETUP.md warns that deleting the home-screen app deletes its data on iOS before any Remove App step, and explains how to refresh the icon without losing data.

### Changed
- One **Notes** field replaces Context plus the three timed reflections, and the 18 h / 7 d gating is gone. Existing text is merged into Notes on first launch (Dexie schema v2 upgrade) and when importing `field-notes/1` files, including encrypted GitHub restores. Exports now carry `schema: 'field-notes/2'`; both v1 and v2 files import, anything else is rejected with a clear message. The app-level schema version is stored in `meta.schema_version`.
- Notes in a session's detail view autosave 400 ms after typing stops and flush on blur and on Back.
- Session search looks at Notes.
- Updates. The service worker now uses prompt mode. New versions still apply automatically, but never while a form has unsaved edits: an "Update ready" chip shows until you leave the form, then the update applies. The app checks for updates on launch, when it returns to the foreground, every 60 minutes while open, and from the new "Check for update" button in Settings, which also shows the build id (`Build <sha> · <date>`).
- Export uses the Web Share API with a File when available (reliable inside an iOS home-screen app) and falls back to a download link. The payload is prefetched so the share call runs synchronously inside the tap.
- Import accepts `.json` files explicitly.

### Also in this release (small, called out for reviewers)
- Cancel on the New session form returns to the tab you came from instead of jumping to Sessions.
- Editing a session no longer snapshots its doses onto the session row; the v2 upgrade drops any such stale snapshot. Doses were always read from their own table, so nothing visible changes.
- If a record somehow carries both `notes` and legacy text (mixed app versions, hand-edited files), the legacy text is appended after the notes rather than discarded.
- Import rejects malformed files (non-list tables, rows without ids) with a "Malformed Field Notes export" message instead of an internal error.
- The schema-version stamp on open never regresses a newer value and never blocks the app if the write fails; a failed database open is shown on the lock screen instead of an endless "…".
- The update deferral also treats a focused text field anywhere (for example the GitHub backup token or a passcode being changed) as "in use", so no reload happens while typing there.
- Export files also carry `schema_version: 2` next to `schema`; import keys on `schema` only.
- The "Update ready" chip reads "Update ready · applies when you finish". A small local diagnostic handle (`window.__fieldNotes`, no telemetry) exposes the build id and the update state for the test-suite and Safari's Web Inspector.
- SETUP.md troubleshooting steps were lightly reworded around the new warnings, and the crash screen now points to Export instead of clearing website data.

### Added
- 2C-B as a substance, between LSD and Cannabis: HCl powder and HBr powder (mg, default 10), pressed pill (units × claimed mg), and volumetric liquid (mL × mg/mL). Re-dose window 6 days. Cross-tolerance with LSD and psilocybin (longest pending window wins). Interaction notes for 2C-B with MDMA, LSD, psilocybin, cannabis, DMT and Adderall.
- `labelFor(id)` in `src/lib/doses.js` is the single source of substance display names, replacing four duplicated helpers.
- `scripts/make-icons.mjs`, `scripts/verify-icons.mjs`, `src/db/migrations.js`, `src/lib/updates.js`, `src/lib/exportFile.js`, `src/lib/version.js`.

## v1.0

Initial release.
