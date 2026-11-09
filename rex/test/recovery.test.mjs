import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { RexRecovery } from '../src/recovery.ts';
import { agentIdentityFile, TaskStore, boundedSummary, cleanText, cwdHolders, probeProcess, processBirth, processCommand, taskState, writeAgentIdentity } from '../src/tasks.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rex-recovery-'));
  const store = new TaskStore(join(root, 'tasks'));
  const record = { version: 1, id: 'run-a', name: 'fixture', originCwd: root,
    surface: 'session:a/block:a', sessionFile: join(root, 'child.jsonl'), activityFile: join(root, 'activity.json'),
    owner: { pid: 111, birth: 'old' }, identity: { pid: 222, birth: 'agent' },
    logicalId: 'logical-a', generationId: 'generation-a', policyHash: 'hash', persistent: true, taskId: 'task-a' };
  store.write(record);
  const events = []; const ledger = []; const messages = []; const inbox = []; const closed = []; const scripts = [];
  const policy = { version: 2, logicalId: record.logicalId, generationId: record.generationId, policyHash: record.policyHash, persistent: true };
  const recovery = new RexRecovery({ store,
    provider: { process: () => ({ foreground: { pid: 222 } }), sessions: new Set(), sendKeys: () => {}, json: () => ({ sessions: [{ session_id: 'session:a' }] }),
      closeTab: (surface) => closed.push(surface), inspectSurface: async () => ({ kind: 'present' }), waitForShellReady: async () => {},
      runScript: (surface, command, options) => scripts.push({ surface, command, ...options }) },
    launch: { toolAllowlist: (tools) => tools, extensions: ['/host/subagent-done.ts', '/rex/task.ts'] },
    worktrees: {}, protocol: { readSubagentSessionPolicy: () => policy, readPersistentTaskEvents: () => events, readPersistentDeliveryLedger: () => ledger,
      appendPersistentDeliveryLedger: (_file, row) => ledger.push(row), writePersistentTaskInbox: (_file, sequence, row) => inbox.push({ sequence, ...row }) },
    activity: { readSubagentActivityFile: () => ({ ok: true, activity: { phase: 'waiting' } }) },
    running: () => new Map(), send: (message) => messages.push(message), notify: () => {}, flags: { recovery: true, overview: true },
    owner: { pid: 333, birth: 'new' }, originCwd: root, holders: () => null, birth: (pid) => pid === 222 ? 'agent' : pid === 333 ? 'new' : null });
  return { root, store, record, events, ledger, messages, inbox, recovery, policy, closed, scripts };
}

test('claim recovers the same live agent without launching a process', () => {
  const f = fixture();
  assert.equal(f.recovery.claim(f.record).owner.pid, 333);
  assert.equal(f.store.read('run-a').identity.pid, 222);
  f.recovery.close();
});

test('an agent launched by a wrapper script is verified through the terminal process', () => {
  const f = fixture();
  f.recovery.provider.process = () => ({ foreground: { pid: 100 } });
  f.recovery.parentOf = (pid) => ({ 222: 100 })[pid] ?? 0;
  assert.equal(f.recovery.claim(f.record).owner.pid, 333);
  f.recovery.close();
});

test('an agent outside the terminal process tree is never attached', () => {
  const f = fixture();
  f.recovery.provider.process = () => ({ foreground: { pid: 100 } });
  f.recovery.parentOf = (pid) => ({ 222: 555, 555: 1 })[pid] ?? 0;
  assert.throws(() => f.recovery.claim(f.record), /could not be verified/);
  f.recovery.close();
});

test('a reattached agent is exposed for display until it completes', () => {
  const f = fixture();
  f.recovery.claim(f.record);
  f.recovery.refresh(f.record.id);
  assert.deepEqual(f.recovery.attached().map((row) => [row.name, row.state]), [['fixture', 'idle']]);
  const saved = f.store.read(f.record.id);
  saved.completed = {};
  f.store.write(saved);
  f.recovery.refresh(f.record.id);
  assert.deepEqual(f.recovery.attached(), []);
  f.recovery.close();
});

test('child attestation binds recovery to its original process and refuses overwrite', () => {
  const f = fixture();
  delete f.record.identity; f.store.write(f.record);
  const identity = { version: 1, id: f.record.id, sessionFile: f.record.sessionFile, surface: f.record.surface, pid: 222, birth: 'agent', generationId: f.record.generationId, policyHash: f.record.policyHash };
  writeAgentIdentity(identity);
  writeAgentIdentity(identity);
  assert.throws(() => writeAgentIdentity({ ...identity, pid: 999 }), /different task process/);
  assert.equal(f.recovery.claim(f.record).identity.pid, 222);
});

test('distinct runs can retain identities for the same Pi session without overwriting prior evidence', () => {
  const f = fixture();
  const original = { version: 1, id: f.record.id, sessionFile: f.record.sessionFile, surface: f.record.surface, pid: 222, birth: 'agent', generationId: f.record.generationId, policyHash: f.record.policyHash };
  writeAgentIdentity(original);
  writeAgentIdentity({ ...original, id: 'run-b', pid: 444, birth: 'new-agent' });
  assert.equal(JSON.parse(readFileSync(agentIdentityFile(original.sessionFile, original.id), 'utf8')).pid, 222);
  assert.equal(JSON.parse(readFileSync(agentIdentityFile(original.sessionFile, 'run-b'), 'utf8')).pid, 444);
});

test('legacy pre-fork process attestations remain recoverable', () => {
  const f = fixture(); delete f.record.identity; f.store.write(f.record);
  writeFileSync(`${f.record.sessionFile}.rex-process.json`, JSON.stringify({ version: 1, id: f.record.id, sessionFile: f.record.sessionFile, surface: f.record.surface, pid: 222, birth: 'agent', generationId: f.record.generationId, policyHash: f.record.policyHash }));
  assert.equal(f.recovery.claim(f.record).identity.pid, 222);
  f.recovery.close();
});

test('retained persistent agents still count toward the configured capacity', () => {
  const f = fixture();
  assert.throws(() => f.recovery.assertNew({ name: 'another', persistent: true }, 1), /cap \(1\)/);
  assert.throws(() => f.recovery.assertNew({ name: 'fixture', persistent: true }, 3), /retained agent/);
  f.recovery.assertNew({ name: 'another', persistent: true }, 2);
});

test('live coordinator ownership and mismatched policy block recovery', () => {
  const f = fixture();
  f.recovery.birth = (pid) => pid === 111 ? 'old' : 'agent';
  assert.throws(() => f.recovery.claim(f.record), /live coordinator/);
  f.recovery.birth = (pid) => pid === 111 ? null : 'agent';
  f.policy.policyHash = 'changed';
  assert.throws(() => f.recovery.claim(f.record), /policy changed/);
});

test('PID reuse and unknown identities do not attach or launch replacements', () => {
  const f = fixture();
  f.recovery.birth = (pid) => pid === 222 ? 'another-agent' : null;
  assert.throws(() => f.recovery.claim(f.record), /identity could not be verified/);
  assert.equal(f.messages.length, 0);
});

test('recovered completion is delivered once and acknowledged after message persistence', () => {
  const f = fixture(); f.recovery.claim(f.record);
  f.events.push({ type: 'task-done', task: 'task-a', generation: 'generation-a', at: new Date().toISOString() });
  f.recovery.refresh('run-a'); f.recovery.refresh('run-a');
  assert.equal(f.messages.length, 1); assert.equal(f.ledger.length, 0);
  f.recovery.receipt(f.messages[0]);
  assert.equal(f.ledger[0].outcome, 'delivered');
  f.recovery.refresh('run-a'); assert.equal(f.messages.length, 1);
  f.recovery.close();
});

test('uncertain delivery after a crash is flagged rather than duplicated', () => {
  const f = fixture(); f.recovery.claim(f.record);
  f.events.push({ type: 'task-done', task: 'task-a', generation: 'generation-a', at: new Date().toISOString() });
  f.recovery.refresh('run-a'); f.recovery.inFlight.clear(); f.recovery.refresh('run-a');
  assert.equal(f.messages.length, 1);
  assert.match(f.store.read('run-a').failure, /delivery is uncertain/);
  f.recovery.close();
});

test('a mid-turn specialist queues one follow-up and receives it when the turn ends', () => {
  const f = fixture(); f.recovery.claim(f.record);
  const queued = f.recovery.control('subagent_send', { name: 'fixture', message: 'next' });
  assert.equal(queued.status, 'queued'); assert.equal(f.inbox.length, 0);
  assert.throws(() => f.recovery.control('subagent_send', { name: 'fixture', message: 'third' }), /already has queued follow-up/);
  f.recovery.refresh('run-a'); assert.equal(f.inbox.length, 0);
  f.events.push({ type: 'task-done', task: 'task-a', generation: 'generation-a' });
  f.recovery.refresh('run-a');
  assert.deepEqual(f.inbox.map((row) => [row.task, row.message]), [[queued.task, 'next']]);
  assert.equal(f.store.read('run-a').queued, undefined);
  assert.equal(f.store.read('run-a').taskId, queued.task);
  f.recovery.refresh('run-a'); assert.equal(f.inbox.length, 1);
  f.events.push({ type: 'task-done', task: queued.task, generation: 'generation-a' });
  assert.equal(f.recovery.control('subagent_send', { name: 'fixture', message: 'idle' }).status, 'dispatched');
  assert.equal(f.inbox.length, 2);
  f.recovery.close();
});

test('stopping a specialist discards its queued follow-up', () => {
  const f = fixture(); f.recovery.claim(f.record);
  const queued = f.recovery.control('subagent_send', { name: 'fixture', message: 'next' });
  assert.equal(f.recovery.control('subagent_stop', { name: 'fixture' }).discarded, queued.task);
  f.events.push({ type: 'task-done', task: 'task-a', generation: 'generation-a' });
  f.recovery.refresh('run-a');
  assert.deepEqual(f.inbox.map((row) => row.type), ['stop']);
  f.recovery.close();
});

test('graceful stop stays unconfirmed until both exit sidecar and process exit agree', () => {
  const f = fixture(); f.recovery.claim(f.record);
  assert.equal(f.recovery.control('subagent_stop', { name: 'fixture' }).status, 'stop_requested');
  f.recovery.refresh('run-a'); assert.equal(f.store.read('run-a').stopConfirmed, undefined);
  writeFileSync(`${f.record.sessionFile}.exit`, '{"type":"done"}');
  f.recovery.birth = (pid) => pid === 222 ? null : 'new'; f.recovery.liveness.clear();
  f.recovery.refresh('run-a'); assert.equal(f.store.read('run-a').stopConfirmed, true);
  assert.equal(f.messages.at(-1).customType, 'subagent_stop');
  assert.deepEqual(f.closed, [f.record.surface]); f.recovery.close();
});

test('disabled recovery does not dispatch to retained agents', () => {
  const f = fixture(); f.recovery.flags.recovery = false;
  assert.throws(() => f.recovery.control('subagent_send', { name: 'fixture', message: 'no' }), /not safely attached/);
  assert.equal(f.inbox.length, 0);
});

test('overview sanitizes control codes and task state distinguishes uncertainty', () => {
  assert.equal(cleanText('\u001b[31mhi\n\u202etext'), '[31mhi  text');
  assert.equal(taskState({}, {}, [], [], undefined).state, 'unknown');
  assert.equal(taskState({}, { phase: 'active', toolName: 'bash' }, [], [], true).state, 'working');
});

test('recovery transfers only a matching, verified worktree lease', () => {
  const f = fixture();
  const checkout = { path: join(f.root, 'checkout'), lease: { pid: 111, runId: 'run-a' } };
  f.record.worktree = checkout.path; f.store.write(f.record);
  let verified = false;
  f.recovery.worktrees = { records: () => [checkout], verify: () => { verified = true; }, save: () => {} };
  f.recovery.claim(f.record);
  assert.equal(verified, true); assert.equal(checkout.lease.pid, 333);
  checkout.lease = { pid: 111, runId: 'other-run' };
  assert.throws(() => f.recovery.claim(f.store.read('run-a')), /ownership no longer matches/);
});

test('help requests remain visible until follow-up is dispatched', () => {
  const record = { taskId: 'help-task' };
  const events = [{ task: 'help-task', type: 'help-request', message: 'Choose a base' }, { task: 'help-task', type: 'task-done' }];
  assert.equal(taskState(record, {}, events, [], true).state, 'blocked');
  assert.equal(taskState(record, { phase: 'active' }, events, [{ task: 'next-task', outcome: 'dispatched' }], true).state, 'working');
});

test('bounded summary never reads the full historical transcript or later task output', () => {
  const f = fixture(); mkdirSync(join(f.root, 'logs'));
  writeFileSync(f.record.sessionFile, 'x'.repeat(150000) + '\n' + JSON.stringify({ type: 'message', timestamp: '2026-01-01', message: { role: 'assistant', content: [{ type: 'text', text: 'first' }] } }) + '\n' + JSON.stringify({ type: 'message', timestamp: '2026-02-01', message: { role: 'assistant', content: [{ type: 'text', text: 'later' }] } }) + '\n');
  assert.equal(boundedSummary(f.record.sessionFile, '2026-01-02'), 'first');
  assert.ok(readFileSync(f.record.sessionFile).length > 128000);
});

test('stop retires a crashed agent whose tab is still open and frees its capacity', () => {
  const f = fixture();
  f.record.owner = f.recovery.owner; f.record.worktree = join(f.root, 'checkout'); f.store.write(f.record);
  const checkout = { path: f.record.worktree, surfaceId: f.record.surface, workspaceId: f.record.surface, lease: { pid: 333, birth: 'new', runId: 'run-a' } };
  const saved = [];
  f.recovery.worktrees = { records: () => [checkout], save: (row) => saved.push(structuredClone(row)) };
  const running = new Map([[f.record.id, { ...f.record, persistent: true }]]);
  const retired = [];
  f.recovery.running = () => running;
  f.recovery.retireStopped = (id) => { retired.push(id); running.delete(id); };
  f.recovery.birth = (pid) => pid === 222 ? null : 'new';
  assert.throws(() => f.recovery.assertNew({ name: 'another', persistent: true }, 1), /cap \(1\)/);
  const result = f.recovery.retire({ name: 'fixture' });
  assert.equal(result.status, 'retired');
  assert.match(result.reason, /Process 222 is absent/);
  assert.deepEqual(retired, ['run-a']);
  assert.equal(f.store.read('run-a').stopConfirmed, true);
  assert.equal(f.store.read('run-a').state, 'stopped');
  assert.equal(f.inbox.length, 0);
  assert.equal(checkout.lease, null);
  assert.equal(checkout.surfaceId, undefined);
  assert.deepEqual(f.closed, [f.record.surface]);
  f.recovery.assertNew({ name: 'another', persistent: true }, 1);
  assert.equal(f.recovery.retire({ id: 'logical-a' }), undefined);
  assert.deepEqual(retired, ['run-a']);
});

test('a crashed task that was never reattached can still be retired', () => {
  const f = fixture();
  f.recovery.birth = (pid) => pid === 222 ? null : pid === 333 ? 'new' : null;
  assert.equal(f.recovery.recovered.has('run-a'), false);
  assert.throws(() => f.recovery.control('subagent_stop', { name: 'fixture' }), /has exited .*subagent_stop to retire it/);
  assert.equal(f.recovery.retire({ name: 'fixture' }).status, 'retired');
});

test('retire claims a dead coordinator task when the agent PID was reused', () => {
  const f = fixture();
  f.recovery.birth = (pid) => pid === 222 ? 'reused-pid' : pid === 333 ? 'new' : null;
  const result = f.recovery.retire({ id: 'logical-a' });
  assert.equal(result.status, 'retired');
  assert.match(result.reason, /now belongs to a process started reused-pid/);
  assert.equal(f.store.read('run-a').owner.pid, 333);
  assert.equal(f.store.read('run-a').identity.pid, 222);
});

test('retire never touches live, unattested or unreadable process identities', () => {
  for (const mode of ['alive', 'command', 'unattested', 'unreadable']) {
    const f = fixture();
    if (mode === 'command') {
      f.record.identity.command = 'pi'; f.store.write(f.record);
      f.recovery.command = () => 'pi';
    }
    if (mode === 'unattested') { delete f.record.identity; f.store.write(f.record); }
    if (mode === 'unreadable') f.recovery.birth = () => { throw new Error('process inspection unavailable'); };
    if (mode === 'alive' || mode === 'command') assert.equal(f.recovery.retire({ name: 'fixture' }), undefined, mode);
    else assert.throws(() => f.recovery.retire({ name: 'fixture' }), /liveness cannot be established/, mode);
    assert.equal(f.store.read('run-a').stopConfirmed, undefined);
    assert.equal(f.inbox.length, 0);
    assert.deepEqual(f.closed, []);
  }
});

test('an unattested task is retired only when its tab is gone and nothing runs in its checkout', () => {
  const checkout = mkdtempSync(join(tmpdir(), 'rex-unattested-'));
  const cases = [
    [{ window: 'window:a', holders: () => [] }, /tab is still open/],
    [{ holders: () => [4242] }, /process 4242 is still running in its checkout/],
    [{ holders: () => null }, /identity is unavailable/],
    [{ holders: () => { throw new Error('lsof failed'); } }, /lsof failed/],
    [{ worktree: null, holders: () => [] }, /identity is unavailable/],
    [{ holders: () => [] }, 'retired'],
    [{ worktree: join(checkout, 'gone'), holders: () => { throw new Error('should not inspect a missing checkout'); } }, 'retired'],
  ];
  for (const [{ window, holders, worktree = checkout }, outcome] of cases) {
    const f = fixture();
    delete f.record.identity;
    if (worktree) f.record.worktree = worktree; else delete f.record.worktree;
    f.store.write(f.record);
    f.recovery.provider.windowOf = () => window;
    f.recovery.holders = holders;
    f.recovery.worktrees = { records: () => [], save: () => {} };
    if (outcome === 'retired') {
      const result = f.recovery.retire({ name: 'fixture' });
      assert.equal(result.status, 'retired');
      assert.match(result.reason, /tab is gone and nothing runs in its checkout/);
      assert.equal(f.store.read('run-a').stopConfirmed, true);
    } else {
      assert.throws(() => f.recovery.retire({ name: 'fixture' }), outcome);
      assert.equal(f.store.read('run-a').stopConfirmed, undefined);
    }
  }
});

test('an attestation mismatch is never bypassed by the tab and checkout check', () => {
  const f = fixture();
  delete f.record.identity; f.store.write(f.record);
  writeFileSync(agentIdentityFile(f.record.sessionFile, 'run-a'), JSON.stringify({ version: 1, id: 'run-a', sessionFile: f.record.sessionFile, surface: 'session:other/block:x', generationId: 'generation-a', policyHash: 'hash', pid: 222, birth: 'agent' }));
  f.recovery.provider.windowOf = () => undefined;
  f.recovery.holders = () => [];
  assert.throws(() => f.recovery.retire({ name: 'fixture' }), /attestation does not match/);
});

test('checkout holders come from process working directories, whatever a process calls itself', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rex-cwd-')));
  const table = `p41\nn${root}\np42\nn${root}/packages/app\np43\nn${root}-other\np44\nn/elsewhere\n`;
  assert.deepEqual(cwdHolders(root, () => table), [41, 42]);
  assert.equal(cwdHolders(root, () => ''), null);
  assert.equal(cwdHolders(root, () => undefined), null);
});

test('retire preserves ownership, generation and binding safety checks', () => {
  for (const mode of ['owner', 'policy', 'changed']) {
    const f = fixture();
    let changed = false;
    f.recovery.birth = (pid) => {
      if (mode === 'changed' && pid === 222 && !changed) { changed = true; f.store.write({ ...f.record, surface: 'session:new/block:new' }); }
      if (mode === 'owner' && pid === 111) return 'old';
      return pid === 333 ? 'new' : null;
    };
    if (mode === 'policy') f.policy.policyHash = 'changed';
    assert.throws(() => f.recovery.retire({ name: 'fixture' }), undefined, mode);
    assert.notEqual(f.store.read('run-a').stopConfirmed, true);
    assert.equal(f.inbox.length, 0);
  }
});

test('retire does not depend on Rex terminal or session inventory', () => {
  const f = fixture();
  f.recovery.birth = (pid) => pid === 222 ? null : pid === 333 ? 'new' : null;
  f.recovery.provider.json = () => { throw new Error('Rex is unavailable'); };
  f.recovery.provider.inspectSurface = () => { throw new Error('view.windows is not iterable'); };
  f.recovery.provider.closeTab = () => { throw new Error('Rex is unavailable'); };
  const notes = [];
  f.recovery.notify = (message) => notes.push(message);
  assert.equal(f.recovery.retire({ name: 'fixture' }).status, 'retired');
  assert.match(notes[0], /tab could not be closed/);
});

test('liveness compares start time and command line, treating mismatch or absence as crashed', () => {
  const identity = { pid: 222, birth: 'agent', command: 'pi' };
  const at = (birth, command) => probeProcess(identity, { birth: () => birth, command: () => command }).state;
  assert.equal(at('agent', 'pi'), 'alive');
  assert.equal(at(null, 'pi'), 'crashed');
  assert.equal(at('later', 'pi'), 'crashed');
  assert.equal(at('agent', 'node unrelated.js'), 'crashed');
  assert.equal(at('agent', null), 'crashed');
  assert.equal(probeProcess({ pid: 222 }, { birth: () => 'agent' }).state, 'unknown');
  assert.equal(probeProcess({ pid: 222, birth: 'agent' }, { birth: () => 'agent' }).state, 'alive');
  assert.throws(() => probeProcess(identity, { birth: () => { throw new Error('ps failed'); } }), /ps failed/);
  const self = { pid: process.pid, birth: processBirth(process.pid), command: processCommand(process.pid) };
  assert.equal(probeProcess(self).state, 'alive');
  assert.equal(probeProcess({ ...self, command: `${self.command} --other` }).state, 'crashed');
});

test('a recorded PID now running a different command is not attached', () => {
  const f = fixture();
  f.record.identity.command = 'pi'; f.store.write(f.record);
  f.recovery.command = () => 'node unrelated.js';
  assert.throws(() => f.recovery.claim(f.record), /identity could not be verified/);
  f.recovery.command = () => 'pi';
  assert.equal(f.recovery.claim(f.store.read('run-a')).identity.command, 'pi');
  f.recovery.close();
});

test('follow-ups to a crashed host agent are refused with retire and resume guidance', () => {
  const f = fixture();
  assert.equal(f.recovery.crashed({ name: 'fixture' }), undefined);
  f.recovery.birth = (pid) => pid === 222 ? null : pid === 333 ? 'new' : null;
  assert.match(f.recovery.crashed({ name: 'fixture' }).message, /exited.*subagent_resume with session .*child\.jsonl/);
  f.recovery.command = () => { throw new Error('unused'); };
  f.recovery.birth = () => { throw new Error('ps failed'); };
  assert.equal(f.recovery.crashed({ name: 'fixture' }), undefined);
});

test('a crashed session resumes in its retained tab and worktree with the same identity', async () => {
  const f = fixture();
  const activity = join(f.root, 'artifacts', 'coord', 'subagent-activity', 'run-a.json');
  Object.assign(f.record, { activityFile: activity, model: 'provider/model', thinking: 'high', worktree: join(f.root, 'checkout') });
  f.store.write(f.record);
  writeFileSync(f.record.sessionFile, `${JSON.stringify({ type: 'session', cwd: f.record.worktree })}\n`);
  const identityFile = agentIdentityFile(f.record.sessionFile, 'run-a');
  writeFileSync(identityFile, '{}');
  writeFileSync(`${f.record.sessionFile}.exit`, '{}');
  const checkout = { path: f.record.worktree, lease: { pid: 999, runId: 'run-a' } };
  f.recovery.worktrees = { records: () => [checkout], save: () => {} };
  f.recovery.birth = (pid) => pid === 333 ? 'new' : null;
  const result = await f.recovery.resume({ sessionPath: f.record.sessionFile, message: 'carry on' });
  assert.equal(result.status, 'resumed');
  assert.equal(f.scripts.length, 1);
  const { surface, command, scriptPath } = f.scripts[0];
  assert.equal(surface, f.record.surface);
  assert.ok(scriptPath.startsWith(join(f.root, 'artifacts', 'coord', 'subagent-scripts')));
  for (const part of [`cd '${f.record.worktree}'`, "PI_SUBAGENT_ID='run-a'", 'PI_SUBAGENT_PERSISTENT=1', "PI_SUBAGENT_GENERATION_ID='generation-a'", `PI_SUBAGENT_SURFACE='${f.record.surface}'`,
    `pi --session '${f.record.sessionFile}'`, "-e '/host/subagent-done.ts' -e '/rex/task.ts'", "--model 'provider/model' --thinking 'high'"]) assert.ok(command.includes(part), part);
  const message = /'@([^']+)'/.exec(command)[1];
  assert.equal(readFileSync(message, 'utf8'), 'carry on');
  assert.equal(existsSync(identityFile), false);
  assert.equal(existsSync(`${f.record.sessionFile}.exit`), false);
  assert.equal(readdirSync(f.root).filter((name) => name.includes('.crashed-')).length, 2);
  const saved = f.store.read('run-a');
  assert.equal(saved.identity, undefined);
  assert.equal(saved.owner.pid, 333);
  assert.equal(f.recovery.recovered.has('run-a'), true);
  assert.deepEqual(checkout.lease, { pid: 333, birth: 'new', runId: 'run-a' });
  assert.deepEqual(f.closed, []);
  f.recovery.close();
});

test('a crashed task whose tab was closed resumes in a new tab in its repository session', async () => {
  const f = fixture();
  f.record.worktree = join(f.root, 'checkout');
  f.store.write(f.record);
  writeFileSync(f.record.sessionFile, `${JSON.stringify({ type: 'session', cwd: f.record.worktree })}\n`);
  f.recovery.worktrees = { records: () => [], save: () => {} };
  f.recovery.birth = (pid) => pid === 333 ? 'new' : null;
  const created = [];
  f.recovery.provider.inspectSurface = async () => ({ kind: 'missing' });
  f.recovery.provider.createSurface = (options) => { created.push(options); return 'session:repo/block:new'; };
  const result = await f.recovery.resume({ sessionPath: f.record.sessionFile });
  assert.equal(result.surface, 'session:repo/block:new');
  assert.match(result.reason, /in a reopened tab/);
  assert.deepEqual(created, [{ name: 'fixture', cwd: f.record.worktree }]);
  assert.equal(f.scripts[0].surface, 'session:repo/block:new');
  assert.ok(f.scripts[0].command.includes("PI_SUBAGENT_SURFACE='session:repo/block:new'"));
  assert.equal(f.store.read('run-a').surface, 'session:repo/block:new');
  f.recovery.close();
});

test('resume refuses live, unverifiable, supervised, stopped and unreachable tasks', async () => {
  const cases = {
    alive: [(f) => {}, /still running/],
    unknown: [(f) => { f.recovery.birth = () => { throw new Error('ps failed'); }; }, /liveness cannot be established/],
    supervised: [(f) => { f.recovery.birth = () => null; f.recovery.running = () => new Map([['run-a', {}]]); }, /still supervised/],
    stopped: [(f) => { f.recovery.birth = () => null; f.store.write({ ...f.record, stopConfirmed: true }); }, /was stopped/],
    unreachable: [(f) => { f.recovery.birth = () => null; f.recovery.provider.inspectSurface = async () => ({ kind: 'unavailable', error: 'server down' }); }, /cannot confirm .*server down/],
  };
  for (const [name, [arrange, error]] of Object.entries(cases)) {
    const f = fixture();
    arrange(f);
    await assert.rejects(f.recovery.resume({ sessionPath: f.record.sessionFile }), error, name);
    assert.equal(f.scripts.length, 0, name);
  }
  assert.equal(await fixture().recovery.resume({ sessionPath: '/unrelated.jsonl' }), undefined);
});

test('a confirmed host stop closes the task tab and clears its terminal binding', () => {
  const f = fixture();
  f.record.owner = f.recovery.owner; f.record.worktree = join(f.root, 'checkout'); f.store.write(f.record);
  const checkout = { path: f.record.worktree, surfaceId: f.record.surface, workspaceId: f.record.surface };
  f.recovery.worktrees = { records: () => [checkout], save: () => {} };
  f.recovery.message({ customType: 'subagent_stop', details: { status: 'stopped', facts: { logicalId: 'logical-a' } } });
  assert.deepEqual(f.closed, [f.record.surface]);
  assert.equal(checkout.workspaceId, undefined);
  assert.equal(f.store.read('run-a').stopConfirmed, true);
  f.recovery.close();
});
