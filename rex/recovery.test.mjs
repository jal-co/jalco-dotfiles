import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { RexRecovery } from './recovery.mjs';
import { TaskStore, boundedSummary, cleanText, taskState, writeAgentIdentity } from './tasks.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rex-recovery-'));
  const store = new TaskStore(join(root, 'tasks'));
  const record = { version: 1, id: 'run-a', name: 'fixture', originCwd: root,
    surface: 'session:a/block:a', sessionFile: join(root, 'child.jsonl'), activityFile: join(root, 'activity.json'),
    owner: { pid: 111, birth: 'old' }, identity: { pid: 222, birth: 'agent' },
    logicalId: 'logical-a', generationId: 'generation-a', policyHash: 'hash', persistent: true, taskId: 'task-a' };
  store.write(record);
  const events = []; const ledger = []; const messages = []; const inbox = [];
  const policy = { version: 2, logicalId: record.logicalId, generationId: record.generationId, policyHash: record.policyHash, persistent: true };
  const recovery = new RexRecovery({ store,
    provider: { process: () => ({ foreground: { pid: 222 } }), sessions: new Set(), sendKeys: () => {} },
    worktrees: {}, protocol: { readSubagentSessionPolicy: () => policy, readPersistentTaskEvents: () => events, readPersistentDeliveryLedger: () => ledger,
      appendPersistentDeliveryLedger: (_file, row) => ledger.push(row), writePersistentTaskInbox: (_file, sequence, row) => inbox.push({ sequence, ...row }) },
    activity: { readSubagentActivityFile: () => ({ ok: true, activity: { phase: 'waiting' } }) },
    running: () => new Map(), send: (message) => messages.push(message), notify: () => {}, flags: { recovery: true, overview: true },
    owner: { pid: 333, birth: 'new' }, originCwd: root, birth: (pid) => pid === 222 ? 'agent' : pid === 333 ? 'new' : null });
  return { root, store, record, events, ledger, messages, inbox, recovery, policy };
}

test('claim recovers the same live agent without launching a process', () => {
  const f = fixture();
  assert.equal(f.recovery.claim(f.record).owner.pid, 333);
  assert.equal(f.store.read('run-a').identity.pid, 222);
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

test('follow-up is rejected while busy and sent once to an idle existing agent', () => {
  const f = fixture(); f.recovery.claim(f.record);
  assert.throws(() => f.recovery.control('subagent_send', { name: 'fixture', message: 'next' }), /busy/);
  f.events.push({ type: 'task-done', task: 'task-a', generation: 'generation-a' });
  const result = f.recovery.control('subagent_send', { name: 'fixture', message: 'next' });
  assert.equal(result.status, 'dispatched'); assert.equal(f.inbox.length, 1);
  assert.throws(() => f.recovery.control('subagent_send', { name: 'fixture', message: 'duplicate' }), /busy/);
  f.recovery.close();
});

test('graceful stop stays unconfirmed until both exit sidecar and process exit agree', () => {
  const f = fixture(); f.recovery.claim(f.record);
  assert.equal(f.recovery.control('subagent_stop', { name: 'fixture' }).status, 'stop_requested');
  f.recovery.refresh('run-a'); assert.equal(f.store.read('run-a').stopConfirmed, undefined);
  writeFileSync(`${f.record.sessionFile}.exit`, '{"type":"done"}');
  f.recovery.birth = (pid) => pid === 222 ? null : 'new'; f.recovery.liveness.clear();
  f.recovery.refresh('run-a'); assert.equal(f.store.read('run-a').stopConfirmed, true);
  assert.equal(f.messages.at(-1).customType, 'subagent_stop'); f.recovery.close();
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
