import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupTask, forceCleanupTask } from '../src/cleanup.ts';

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

const memory = (rows) => {
  const byId = new Map(rows.map((row) => [row.id, structuredClone(row)]));
  return { list: () => [...byId.values()], read: (id) => byId.get(id), write: (row) => byId.set(row.id, row), exclusive: (_id, operation) => operation() };
};
const forced = (overrides = {}) => {
  const calls = [];
  const store = overrides.store ?? memory([{ id: 'run-a', logicalId: 'logical-a', name: 'ds-inputs', stopConfirmed: false }]);
  const records = overrides.records ?? [{ path: '/w/ds-inputs' }];
  const options = {
    store,
    inspect: () => ({ state: 'crashed', reason: 'Process 222 is absent' }),
    stop: async () => { calls.push(['stop']); return { ok: true, text: 'Stop requested.' }; },
    terminate: () => { calls.push(['terminate']); return false; },
    exited: (task) => Boolean(store.read(task.id)?.stopConfirmed),
    detach: (task) => {
      calls.push(['detach']);
      const row = store.read(task.id);
      row.stopConfirmed = true;
      return { status: 'retired', reason: 'Retired after confirmed agent exit: Process 222 is absent' };
    },
    recheck: () => { calls.push(['recheck']); return { state: 'unknown', reason: 'process 4242 is still running in its checkout' }; },
    closeTab: () => undefined,
    checkouts: () => records,
    exists: () => true,
    remove: async (checkout, preserve) => {
      calls.push(['remove', checkout, preserve]);
      records.find((row) => row.path === checkout).removed = true;
      return `Removed ${checkout}. Branch kept.`;
    },
    forget: async (checkout) => { calls.push(['forget', checkout]); records.find((row) => row.path === checkout).removed = true; return `Its checkout ${checkout} was already gone from disk.`; },
    reconcile: () => calls.push(['reconcile']),
    residual: (checkout, text) => calls.push(['residual', checkout, text]),
    timeout: 30, grace: 30, pause: 5,
    ...overrides,
  };
  return { calls, store, records, options };
};

test('force cleanup retires a task whose agent is gone and removes its checkout', async () => {
  const f = forced();
  const result = await cleanupTask({ id: 'logical-a', checkout: '/w/ds-inputs' }, { ...f.options, stop: async () => ({ ok: false, text: 'Liveness unknown.' }) });
  assert.equal(result.ok, false, 'ordinary cleanup stays strict when the stop is refused');
  const done = await forceCleanupTask({ id: 'logical-a', checkout: '/w/ds-inputs' }, f.options);
  assert.equal(done.outcome, 'cleaned');
  assert.match(done.text, /^Force cleaned up ds-inputs\. Retired after confirmed agent exit: Process 222 is absent\. Removed \/w\/ds-inputs\./);
  assert.deepEqual(f.calls, [['detach'], ['remove', '/w/ds-inputs', undefined], ['reconcile']]);
  assert.deepEqual(f.store.read('run-a').forced.kept, []);
});

test('unreadable process evidence retires the record without signalling anything and says so', async () => {
  const f = forced({
    inspect: () => ({ state: 'unknown', reason: 'Process inspection unavailable' }),
    detach: (task) => { f.calls.push(['detach']); f.store.read(task.id).stopConfirmed = true; return { status: 'detached', reason: 'Retired without a confirmed exit: Process inspection unavailable' }; },
  });
  const result = await forceCleanupTask({ id: 'run-a', checkout: '/w/ds-inputs' }, f.options);
  assert.equal(result.outcome, 'partial');
  assert.match(result.text, /^Partly cleaned up ds-inputs\. Retired without a confirmed exit: Process inspection unavailable\. Nothing was signalled\. Removed/);
  assert.equal(f.calls.some(([name]) => ['stop', 'terminate'].includes(name)), false);
  assert.match(f.store.read('run-a').forced.kept[0], /Nothing was signalled/);
});

test('an unrelated live holder keeps the checkout, records the residue and leaves the process alone', async () => {
  const f = forced({ remove: async () => { throw new Error('Live process 4242 holds the checkout'); } });
  const result = await forceCleanupTask({ id: 'run-a', checkout: '/w/ds-inputs' }, f.options);
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'partial');
  assert.match(result.text, /Kept \/w\/ds-inputs: Live process 4242 holds the checkout\./);
  assert.deepEqual(f.calls.at(-1), ['residual', '/w/ds-inputs', 'Kept /w/ds-inputs: Live process 4242 holds the checkout.']);
  assert.equal(f.calls.some(([name]) => name === 'terminate'), false);
  assert.equal(f.records[0].removed, undefined);
  assert.equal(f.store.read('run-a').forced.kept.length, 1);
});

test('a verified live agent is stopped, signalled only through its own identity, and never retired while it runs', async () => {
  const exitsOnSignal = forced({ inspect: () => ({ state: 'alive', reason: 'Process 222 start time and command line match' }) });
  let signalled = false;
  exitsOnSignal.options.terminate = () => { exitsOnSignal.calls.push(['terminate']); signalled = true; return true; };
  exitsOnSignal.options.exited = () => signalled;
  assert.equal((await forceCleanupTask({ id: 'run-a', checkout: '/w/ds-inputs' }, exitsOnSignal.options)).outcome, 'cleaned');
  assert.deepEqual(exitsOnSignal.calls.slice(0, 3), [['stop'], ['terminate'], ['detach']]);
  const unverifiable = forced({ inspect: () => ({ state: 'alive', reason: 'Process 222 start time matches' }), exited: () => false });
  const refused = await forceCleanupTask({ id: 'run-a', checkout: '/w/ds-inputs' }, unverifiable.options);
  assert.equal(refused.outcome, 'refused');
  assert.match(refused.text, /still running as its verified agent process, so nothing was retired or removed\. Stop requested\./);
  assert.deepEqual(unverifiable.calls, [['stop'], ['terminate']]);
  assert.equal(unverifiable.store.read('run-a').stopConfirmed, false);
});

test('another live coordinator, another directory or a supervised agent refuses force cleanup and changes nothing', async () => {
  for (const [overrides, pattern] of [
    [{ inspect: () => ({ state: 'owned', reason: 'Another live coordinator (process 4586) owns ds-inputs' }) }, /^Another live coordinator \(process 4586\) owns ds-inputs\. Nothing was changed\.$/],
    [{ inspect: () => undefined }, /belongs to a coordinator in another directory\. Nothing was changed\./],
    [{
      inspect: () => ({ state: 'unknown', reason: 'Agent identity is unverified', attached: true }),
      stop: async () => ({ ok: false, text: 'Recovered agent process identity is unconfirmed' }),
      detach: () => { throw new Error('ds-inputs is still supervised by this coordinator; nothing was retired'); },
    }, /still supervised .* Nothing was removed\./],
  ]) {
    const f = forced(overrides);
    const result = await forceCleanupTask({ id: 'run-a', checkout: '/w/ds-inputs' }, f.options);
    assert.equal(result.outcome, 'refused');
    assert.match(result.text, pattern);
    assert.equal(f.calls.some(([name]) => ['remove', 'forget', 'residual', 'terminate'].includes(name)), false);
    assert.equal(f.store.read('run-a').forced, undefined);
  }
});

test('a busy tab stays open after a confirmed exit and the result says what runs in it', async () => {
  const f = forced();
  const detach = f.options.detach;
  f.options.detach = (task) => ({ ...detach(task), tab: 'node (process 501) is running in it' });
  const result = await forceCleanupTask({ id: 'run-a', checkout: '/w/ds-inputs' }, f.options);
  assert.equal(result.outcome, 'partial');
  assert.match(result.text, /^Partly cleaned up ds-inputs\. Kept its tab open: node \(process 501\) is running in it\. Retired after confirmed agent exit/);  f.options.closeTab = () => 'node (process 501) is running in it';
  const again = await forceCleanupTask({ id: 'run-a', checkout: '/w/ds-inputs' }, f.options);
  assert.equal(again.text, 'Partly cleaned up ds-inputs. Kept its tab open: node (process 501) is running in it. Its checkout was already removed.');
  f.options.closeTab = () => undefined;
  assert.equal((await forceCleanupTask({ id: 'run-a', checkout: '/w/ds-inputs' }, f.options)).outcome, 'cleaned');
});

test('dirty work keeps the checkout unless preservation was chosen', async () => {
  const dirty = forced({ remove: async (_checkout, preserve) => { if (!preserve) throw new Error('Dirty worktree: 2 changed files, 1 untracked; commit or request preserve explicitly'); return 'Removed. Preservation commit: abc.'; } });
  const kept = await forceCleanupTask({ id: 'run-a', checkout: '/w/ds-inputs' }, dirty.options);
  assert.equal(kept.outcome, 'partial');
  assert.match(kept.text, /Kept \/w\/ds-inputs: Dirty worktree: 2 changed files, 1 untracked/);
  const preserved = await forceCleanupTask({ id: 'run-a', checkout: '/w/ds-inputs', preserve: true }, dirty.options);
  assert.equal(preserved.outcome, 'cleaned');
  assert.match(preserved.text, /Preservation commit: abc\./);
});

test('a missing checkout is forgotten after its logs are archived, and an archive failure keeps the entry', async () => {
  const missing = forced({ store: memory([{ id: 'run-a', name: 'damien', stopConfirmed: true }]), exists: () => false });
  const result = await forceCleanupTask({ id: 'run-a', checkout: '/w/ds-inputs' }, missing.options);
  assert.equal(result.outcome, 'cleaned');
  assert.deepEqual(missing.calls, [['forget', '/w/ds-inputs'], ['reconcile']]);
  const unarchived = forced({ store: memory([{ id: 'run-a', name: 'damien', stopConfirmed: true }]), exists: () => false, forget: async () => { throw new Error('Task session log is missing and the task left no launch sidecar'); } });
  const blocked = await forceCleanupTask({ id: 'run-a', checkout: '/w/ds-inputs' }, unarchived.options);
  assert.equal(blocked.outcome, 'partial');
  assert.match(blocked.text, /Kept \/w\/ds-inputs: Task session log is missing/);
  assert.equal(unarchived.records[0].removed, undefined);
});

test('repeating force cleanup is idempotent and rechecks an unconfirmed exit instead of forgetting it', async () => {
  const f = forced();
  await forceCleanupTask({ id: 'run-a', checkout: '/w/ds-inputs' }, f.options);
  f.calls.length = 0;
  const again = await forceCleanupTask({ id: 'run-a', checkout: '/w/ds-inputs' }, f.options);
  assert.deepEqual(again, { ok: true, outcome: 'cleaned', text: 'Force cleaned up ds-inputs. Its checkout was already removed.' });
  assert.deepEqual(f.calls, [['reconcile']]);
  const detached = forced({ store: memory([{ id: 'run-a', name: 'models-build', stopConfirmed: true, detached: { at: 1 } }]) });
  const still = await forceCleanupTask({ id: 'run-a' }, detached.options);
  assert.equal(still.outcome, 'partial');
  assert.match(still.text, /Its exit is still unconfirmed: process 4242 is still running in its checkout\. Nothing was signalled\./);
  detached.options.recheck = () => ({ state: 'crashed', reason: 'Its Rex tab is gone and nothing runs in its checkout' });
  const confirmed = await forceCleanupTask({ id: 'run-a' }, detached.options);
  assert.equal(confirmed.outcome, 'cleaned', confirmed.text);
  assert.deepEqual(detached.store.read('run-a').forced.kept, []);
});
