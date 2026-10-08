// PWA update coordination.
//
// Policy: updates are automatic but never reload the page while the user is
// mid-entry. A "dirty" form (NewSession with edits, or a Notes textarea with
// unsaved changes) defers the reload; the moment the last dirty form is left
// the pending update is applied. The App shows a small chip while deferred.
//
// Checks happen on launch, when the app returns to the foreground, every
// 60 minutes while open, and on demand from Settings.

import { APP_VERSION } from './version.js';

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

const bus = new EventTarget();
const dirty = new Set();
let pendingApply = null;    // () => Promise|void, set when a new SW is waiting
let registration = null;
let applyCount = 0;
let lastApplyAt = 0;
let intervalId = null;

function emit() { bus.dispatchEvent(new Event('change')); }

export function getUpdateState() {
  return {
    dirty: dirty.size > 0,
    dirtyKeys: Array.from(dirty),
    updateReady: !!pendingApply,
    supported: !!registration,
    applyCount,
    lastApplyAt,
  };
}

export function onUpdateState(fn) {
  bus.addEventListener('change', fn);
  return () => bus.removeEventListener('change', fn);
}

// Mark a form as having unsaved edits (or not). Applies a pending update when
// the last dirty form is cleared.
export function setDirty(key, isDirty) {
  const had = dirty.has(key);
  if (isDirty) dirty.add(key); else dirty.delete(key);
  if (had !== isDirty) {
    emit();
    maybeApply();
  }
}

export function isDirty() { return dirty.size > 0; }
export function hasPendingUpdate() { return !!pendingApply; }
export function isUpdateSupported() { return !!registration; }

// Called when a new service worker is installed and waiting.
export function updateReady(apply) {
  pendingApply = apply;
  emit();
  maybeApply();
}

// Belt and braces for forms that do not track dirtiness themselves (e.g. Settings
// fields): never apply while the user has a text field focused.
function userIsTyping() {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const t = (el.type || 'text').toLowerCase();
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'range', 'color', 'image'].includes(t);
  }
  return el.isContentEditable === true;
}

function maybeApply() {
  if (!pendingApply || dirty.size > 0 || userIsTyping()) return;
  const apply = pendingApply;
  pendingApply = null;
  applyCount += 1;
  lastApplyAt = Date.now();
  emit();
  try {
    const r = apply();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch { /* ignore */ }
}

export function setRegistration(reg) {
  registration = reg || null;
  emit();
}

// Ask the browser to re-check the service worker script. Resolves true if a
// check was performed (not whether an update was found).
export async function checkForUpdate() {
  if (!registration) return false;
  try { await registration.update(); } catch { /* offline, etc. */ }
  return true;
}

function startBackgroundChecks() {
  if (intervalId) return;
  intervalId = setInterval(() => { checkForUpdate(); }, CHECK_INTERVAL_MS);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkForUpdate();
    });
    // A deferred update (user was typing in an untracked field) is retried once
    // focus leaves the field, after any click handler on the new target has run.
    document.addEventListener('focusout', () => { setTimeout(maybeApply, 300); });
  }
}

// Test seam: forget all state (dirty keys, pending apply, registration, timers).
export function _resetForTests() {
  dirty.clear();
  pendingApply = null;
  registration = null;
  applyCount = 0;
  lastApplyAt = 0;
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
}

// Wire up vite-plugin-pwa's registerSW (prompt mode). `registerSW` is the
// function exported by 'virtual:pwa-register'.
export function installUpdater(registerSW) {
  let updateSW = null;
  const apply = () => (updateSW ? updateSW(true) : undefined);
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() { updateReady(apply); },
    onRegisteredSW(_swUrl, reg) {
      if (!reg) return;
      setRegistration(reg);
      startBackgroundChecks();
      // Launch check (the browser also checks on registration; this is explicit and cheap).
      checkForUpdate();
    },
    onRegisterError() { /* keep app usable without SW */ },
  });
  exposeDebugHandle(apply);
  return updateSW;
}

// Small diagnostic handle (no telemetry; local only). Used by the test-suite
// to simulate "update ready" without a real second build, and handy in the
// Safari Web Inspector on a phone.
function exposeDebugHandle(apply) {
  if (typeof window === 'undefined') return;
  window.__fieldNotes = {
    version: APP_VERSION,
    updates: {
      state: getUpdateState,
      simulateUpdateReady: () => updateReady(apply),
      check: checkForUpdate,
    },
  };
}
