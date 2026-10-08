// Spec 13 wiring, at the unit level: installUpdater() hands registerSW an onNeedRefresh
// callback; when it fires with no dirty form, updateSW(true) must be called at once; with a
// dirty form it must wait until the last dirty key is cleared. Also covers onRegisteredSW ->
// registration.update() on launch and checkForUpdate().

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  installUpdater, setDirty, isDirty, hasPendingUpdate, getUpdateState,
  checkForUpdate, isUpdateSupported, _resetForTests,
} from '../../src/lib/updates.js';

function stubRegisterSW() {
  const calls = [];
  let opts = null;
  const updateSW = async (reload) => { calls.push(reload); };
  const registerSW = (o) => { opts = o; return updateSW; };
  return { registerSW, calls, opts: () => opts };
}

describe('updates: onNeedRefresh wiring (spec 13)', () => {
  beforeEach(() => { _resetForTests(); delete globalThis.window; });
  afterEach(() => { _resetForTests(); delete globalThis.window; });

  test('13. no dirty form: onNeedRefresh -> updateSW(true) immediately', async () => {
    const s = stubRegisterSW();
    installUpdater(s.registerSW);
    assert.ok(s.opts(), 'registerSW received options');
    assert.equal(s.opts().immediate, true, 'registers immediately');
    assert.equal(typeof s.opts().onNeedRefresh, 'function');
    assert.equal(typeof s.opts().onRegisteredSW, 'function');

    assert.equal(isDirty(), false);
    s.opts().onNeedRefresh();
    assert.deepEqual(s.calls, [true], 'updateSW(true) called once, right away');
    assert.equal(hasPendingUpdate(), false, 'nothing left pending');
    assert.equal(getUpdateState().applyCount, 1);
  });

  test('13. dirty form: onNeedRefresh is deferred until the last dirty key clears, then updateSW(true)', async () => {
    const s = stubRegisterSW();
    installUpdater(s.registerSW);

    setDirty('new-session', true);
    setDirty('detail-notes', true);
    s.opts().onNeedRefresh();
    assert.deepEqual(s.calls, [], 'not applied while dirty');
    assert.equal(hasPendingUpdate(), true, 'update is pending');
    assert.equal(getUpdateState().updateReady, true);
    assert.equal(getUpdateState().dirty, true);

    setDirty('new-session', false);
    assert.deepEqual(s.calls, [], 'still one dirty form: still deferred');

    setDirty('detail-notes', false);
    assert.deepEqual(s.calls, [true], 'applied exactly once when the last form is left');
    assert.equal(hasPendingUpdate(), false);
    assert.equal(getUpdateState().dirty, false);

    // A later redundant clear must not apply anything again.
    setDirty('detail-notes', false);
    assert.deepEqual(s.calls, [true]);
  });

  test('13. onRegisteredSW stores the registration and triggers a launch check; checkForUpdate() calls registration.update()', async () => {
    const s = stubRegisterSW();
    installUpdater(s.registerSW);
    assert.equal(isUpdateSupported(), false, 'no registration yet');
    assert.equal(await checkForUpdate(), false, 'no registration -> no check performed');

    let updates = 0;
    const registration = { update: async () => { updates += 1; } };
    s.opts().onRegisteredSW('/sw.js', registration);
    assert.equal(isUpdateSupported(), true);
    await new Promise(r => setImmediate(r));
    assert.equal(updates, 1, 'launch check performed once registered');

    assert.equal(await checkForUpdate(), true);
    assert.equal(updates, 2, 'manual check calls registration.update()');

    // update() failures (offline) are swallowed, not thrown.
    registration.update = async () => { throw new Error('offline'); };
    assert.equal(await checkForUpdate(), true);
  });

  test('13. debug handle on window routes simulateUpdateReady through the same apply path', async () => {
    globalThis.window = {};
    const s = stubRegisterSW();
    installUpdater(s.registerSW);
    assert.ok(globalThis.window.__fieldNotes, 'debug handle exposed');
    setDirty('new-session', true);
    globalThis.window.__fieldNotes.updates.simulateUpdateReady();
    assert.deepEqual(s.calls, []);
    setDirty('new-session', false);
    assert.deepEqual(s.calls, [true], 'simulated update applies via the real updateSW');
  });
});
