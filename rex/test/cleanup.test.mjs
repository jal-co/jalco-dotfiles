import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupTask } from '../src/cleanup.mjs';

const store = (rows) => ({ list: () => rows });
const deps = (overrides = {}) => {
  const calls = [];
  return {
    calls,
    deps: {
      store: store([{ id: 'run-a', logicalId: 'logical-a', name: 'ds-inputs', stopConfirmed: false }]),
      stop: async (task) => { calls.push(['stop', task.logicalId]); return { ok: true, text: 'Stopped.' }; },
      exited: () => true,
      checkouts: () => [{ path: '/w/ds-inputs' }],
      remove: async (checkout, preserve) => { calls.push(['remove', checkout, preserve]); return 'Removed.'; },
      reconcile: () => calls.push(['reconcile']),
      timeout: 50, pause: 5,
      ...overrides,
    },
  };
};

test('cleanup stops a running agent, waits for it to exit, then removes its checkout', async () => {
  const { calls, deps: options } = deps();
  assert.deepEqual(await cleanupTask({ id: 'logical-a', checkout: '/w/ds-inputs', preserve: true }, options), { ok: true, text: 'Stopped. Removed.' });
  assert.deepEqual(calls, [['stop', 'logical-a'], ['remove', '/w/ds-inputs', true]]);
});

test('an already stopped task goes straight to removal, and a removed checkout only reconciles', async () => {
  const stopped = deps({ store: store([{ id: 'run-a', name: 'x', stopConfirmed: true }]) });
  await cleanupTask({ id: 'run-a', checkout: '/w/ds-inputs' }, stopped.deps);
  assert.deepEqual(stopped.calls, [['remove', '/w/ds-inputs', undefined]]);
  const gone = deps({ store: store([]), checkouts: () => [{ path: '/w/ds-inputs', removed: true }] });
  assert.deepEqual(await cleanupTask({ id: 'run-a', checkout: '/w/ds-inputs' }, gone.deps), { ok: true, text: 'Its checkout was already removed.' });
  assert.deepEqual(gone.calls, [['reconcile']]);
});

test('a refused stop or an agent that never exits leaves the checkout in place', async () => {
  const refused = deps({ stop: async () => ({ ok: false, text: 'Liveness unknown.' }) });
  assert.deepEqual(await cleanupTask({ id: 'run-a', checkout: '/w/ds-inputs' }, refused.deps), { ok: false, text: 'Liveness unknown.' });
  const stuck = deps({ exited: () => false });
  const result = await cleanupTask({ id: 'run-a', checkout: '/w/ds-inputs' }, stuck.deps);
  assert.equal(result.ok, false);
  assert.match(result.text, /ds-inputs has not exited yet/);
  assert.deepEqual(stuck.calls, [['stop', 'logical-a']]);
});
