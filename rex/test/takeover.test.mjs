import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { RexRecovery } from '../src/recovery.ts';
import { agentIdentityFile, processBirth, TaskStore } from '../src/tasks.ts';
import { infrastructureFor } from '../src/runtime.ts';

const FORMER = { pid: 111, birth: 'old' };
const SELF = { pid: 333, birth: 'new' };
const RIVAL = { pid: 444, birth: 'rival' };

function publishSupport(store, owner, value = {}) {
  mkdirSync(join(store.root, 'coordinators'), { recursive: true });
  writeFileSync(join(store.root, 'coordinators', `${owner.pid}.json`), JSON.stringify({ version: 1, takeover: 1, pid: owner.pid, birth: owner.birth, hosted: [], ...value }));
}

function fixture({ agent = null, extra = {}, legacy = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rex-takeover-'));
  const store = new TaskStore(join(root, 'tasks'));
  const record = { version: 1, id: 'run-a', name: 'fixture', originCwd: root,
    surface: 'session:a/block:a', sessionFile: join(root, 'child.jsonl'), activityFile: join(root, 'activity.json'),
    owner: FORMER, identity: { pid: 222, birth: 'agent', command: 'pi' },
    logicalId: 'logical-a', generationId: 'generation-a', policyHash: 'hash', persistent: true, taskId: 'task-a', state: 'unknown', reason: 'Agent exited; completion is unconfirmed' };
  store.write(record);
  if (!legacy) publishSupport(store, FORMER);
  const births = { 111: 'old', 222: agent, 333: 'new', 444: 'rival', ...extra };
  const events = []; const ledger = []; const messages = []; const inbox = []; const scripts = []; const notes = []; const saved = []; const closed = [];
  const policy = { version: 2, logicalId: record.logicalId, generationId: record.generationId, policyHash: record.policyHash, persistent: true };
  const make = (owner) => new RexRecovery({ store,
    provider: { process: () => ({ foreground: { pid: 222 } }), sessions: new Set(), sendKeys: () => {}, closeTab: (surface) => closed.push(surface),
      inspectSurface: async () => ({ kind: 'present' }), waitForShellReady: async () => {}, runScript: (surface, command) => scripts.push({ surface, command }) },
    launch: { toolAllowlist: (tools) => tools, extensions: [] },
    worktrees: { records: () => [], save: (row) => saved.push(structuredClone(row)), verify: () => ({}) },
    protocol: { readSubagentSessionPolicy: () => policy, readPersistentTaskEvents: () => events, readPersistentDeliveryLedger: () => ledger,
      appendPersistentDeliveryLedger: (_file, row) => ledger.push(row), writePersistentTaskInbox: (_file, sequence, row) => inbox.push({ sequence, ...row }) },
    activity: { readSubagentActivityFile: () => ({ ok: true, activity: { phase: 'waiting' } }) },
    running: () => new Map(), send: (message) => messages.push(message), notify: (note) => notes.push(note), flags: { recovery: true, overview: true },
    owner, originCwd: root, holders: () => null, birth: (pid) => births[pid] ?? null, command: () => 'pi' });
  const self = make(SELF);
  return { root, store, record, births, events, ledger, messages, inbox, scripts, notes, saved, closed, policy, self, make };
}

const owner = (f) => f.store.read('run-a').owner;

test('without a takeover a live coordinator still owns its task for resume, claim, retire and stash', async () => {
  const f = fixture();
  await assert.rejects(f.self.resume({ sessionPath: f.record.sessionFile }), /Another live coordinator \(process 111\) owns fixture; nothing was resumed\. .*\/rex-takeover/);
  assert.throws(() => f.self.claim(f.record), /Another live coordinator owns this task/);
  assert.throws(() => f.self.retire({ id: 'run-a' }), /Another live coordinator owns this task/);
  assert.throws(() => f.self.stash({ id: 'run-a' }), /Another live coordinator \(process 111\) owns fixture; nothing was stashed/);
  assert.deepEqual(owner(f), FORMER);
  assert.equal(f.store.read('run-a').stashed, undefined);
  assert.equal(f.scripts.length, 0);
  f.self.close();
});

test('a confirmed takeover moves only ownership once the agent is proven gone, and resume then launches exactly once', async () => {
  const f = fixture();
  const before = f.store.read('run-a');
  const target = f.self.takeoverTarget({ name: 'fixture' });
  assert.match(f.self.takeoverEvidence({ ...target }).reason, /Process 222 is absent/);
  const result = f.self.takeover(target);
  assert.equal(result.status, 'taken_over');
  assert.deepEqual(result.from, FORMER);
  const after = f.store.read('run-a');
  assert.deepEqual(after.owner, SELF);
  assert.deepEqual(after.handoff.from, FORMER);
  assert.match(after.reason, /^Taken over from coordinator process 111 after its agent exited: Process 222 is absent/);
  for (const key of ['id', 'name', 'surface', 'sessionFile', 'activityFile', 'logicalId', 'generationId', 'policyHash', 'persistent', 'taskId', 'identity']) {
    assert.deepEqual(after[key], before[key], key);
  }
  assert.equal(after.stopConfirmed, undefined);
  assert.equal(f.scripts.length, 0, 'takeover launches nothing');
  assert.equal(f.inbox.length, 0, 'takeover dispatches nothing');
  const resumed = await f.self.resume({ sessionPath: f.record.sessionFile });
  assert.equal(resumed.status, 'resumed');
  assert.equal(f.scripts.length, 1);
  assert.equal(f.scripts[0].surface, before.surface);
  assert.ok(f.scripts[0].command.includes(`PI_SUBAGENT_GENERATION_ID='${before.generationId}'`));
  await assert.rejects(f.self.resume({ sessionPath: f.record.sessionFile }), /liveness cannot be established/);
  assert.throws(() => f.self.takeover(f.self.takeoverTarget({ name: 'fixture' })), /already belongs to this coordinator/);
  assert.equal(f.scripts.length, 1, 'no duplicate launch');
  f.self.close();
});

test('takeover refuses a live, unattested or unverifiable agent and every unsettled task state', () => {
  const cases = {
    alive: [{ agent: 'agent' }, () => {}, /still running \(Process 222 start time and command line match\)/],
    unattested: [{}, (f) => { delete f.record.identity; f.store.write(f.record); }, /no process attestation/],
    unreadable: [{}, (f) => { const births = f.self.birth; f.self.birth = (pid) => { if (pid === 222) throw new Error('ps failed'); return births(pid); }; }, /not proven gone \(Error: ps failed\)/],
    dispatching: [{}, (f) => f.store.write({ ...f.record, dispatching: true }), /dispatch .* may be in flight/],
    stopping: [{}, (f) => f.store.write({ ...f.record, stopRequested: true }), /stop of "fixture" is pending/],
    ordinary: [{}, (f) => f.store.write({ ...f.record, persistent: false }), /not a persistent specialist/],
    retired: [{}, (f) => f.store.write({ ...f.record, stopRequested: true, stopConfirmed: true }), /No retained task matches/],
    ownerExited: [{}, (f) => { f.births[111] = null; }, /has exited, so no takeover is needed/],
    ownerReused: [{}, (f) => { f.births[111] = 'someone-else'; }, /has exited, so no takeover is needed/],
    supervised: [{}, (f) => { f.self.running = () => new Map([['run-a', {}]]); }, /already belongs to this coordinator/],
  };
  for (const [name, [options, arrange, error]] of Object.entries(cases)) {
    const f = fixture(options);
    arrange(f);
    assert.throws(() => f.self.takeover(f.self.takeoverTarget({ name: 'fixture' })), error, name);
    assert.deepEqual(owner(f), FORMER, name);
    assert.equal(f.store.read('run-a').handoff, undefined, name);
    f.self.close();
  }
});

test('takeover refuses policy, attestation, generation or binding drift', () => {
  const cases = {
    generation: [(f) => { f.policy.generationId = 'generation-b'; }, /generation or tool policy changed/],
    policy: [(f) => { f.policy.policyHash = 'other'; }, /generation or tool policy changed/],
    attestation: [(f) => {
      delete f.record.identity; f.store.write(f.record);
      writeFileSync(agentIdentityFile(f.record.sessionFile, f.record.id), JSON.stringify({ version: 1, id: f.record.id, sessionFile: f.record.sessionFile, surface: f.record.surface, pid: 222, birth: 'agent', generationId: 'generation-b', policyHash: f.record.policyHash }));
    }, /attestation does not match/],
  };
  for (const [name, [arrange, error]] of Object.entries(cases)) {
    const f = fixture();
    arrange(f);
    assert.throws(() => f.self.takeover(f.self.takeoverTarget({ name: 'fixture' })), error, name);
    assert.deepEqual(owner(f), FORMER, name);
    f.self.close();
  }
  for (const change of [{ surface: 'session:b/block:b' }, { generationId: 'generation-b' }, { owner: { pid: 111, birth: 'restarted' } }]) {
    const f = fixture();
    const confirmed = f.self.takeoverTarget({ name: 'fixture' });
    f.store.write({ ...f.store.read('run-a'), ...change });
    assert.throws(() => f.self.takeover(confirmed), /changed after the takeover was confirmed/, JSON.stringify(change));
    assert.equal(f.store.read('run-a').handoff, undefined);
    f.self.close();
  }
});

test('two coordinators competing for one task: the lock admits one and the loser is refused on its confirmed snapshot', async () => {
  const f = fixture();
  const rival = f.make(RIVAL);
  const seen = rival.takeoverTarget({ name: 'fixture' });
  const mine = f.self.takeoverTarget({ name: 'fixture' });
  f.store.exclusive('run-a', () => {
    assert.throws(() => rival.takeover(seen), /EEXIST/);
    assert.deepEqual(owner(f), FORMER);
  });
  f.self.takeover(mine);
  assert.throws(() => rival.takeover(seen), /changed after the takeover was confirmed/);
  assert.deepEqual(owner(f), SELF);
  await f.self.resume({ sessionPath: f.record.sessionFile });
  f.self.publish();
  assert.throws(() => rival.takeover(rival.takeoverTarget({ name: 'fixture' })), /no process attestation/);
  f.births[555] = 'resumed';
  writeFileSync(agentIdentityFile(f.record.sessionFile, f.record.id), JSON.stringify({ version: 1, id: f.record.id, sessionFile: f.record.sessionFile, surface: f.record.surface, pid: 555, birth: 'resumed', generationId: f.record.generationId, policyHash: f.record.policyHash }));
  assert.throws(() => rival.takeover(rival.takeoverTarget({ name: 'fixture' })), /still running/);
  assert.deepEqual(owner(f), SELF);
  assert.equal(f.scripts.length, 1);
  rival.close(); f.self.close();
});

test('the former owner is fenced from resume, send, stop, stash, capture, messages, receipts and stale saves', async () => {
  const f = fixture();
  const former = f.make(FORMER);
  former.recovered.add('run-a');
  const stale = f.store.read('run-a');
  f.self.takeover(f.self.takeoverTarget({ name: 'fixture' }));
  await new Promise(setImmediate);
  const handed = f.store.read('run-a');
  await assert.rejects(former.resume({ sessionPath: f.record.sessionFile }), /Another live coordinator \(process 333\)/);
  assert.throws(() => former.control('subagent_send', { id: 'run-a', message: 'hello' }), /identity is unconfirmed/);
  assert.throws(() => former.retire({ id: 'run-a' }), /Another live coordinator owns this task/);
  assert.throws(() => former.stash({ id: 'run-a' }), /process 333.*nothing was stashed/);
  former.unstash('run-a');
  former.refresh('run-a');
  assert.equal(former.commit({ ...stale, reason: 'stale' }), false);
  former.message({ customType: 'subagent_stop', details: { status: 'stopped', facts: { logicalId: 'logical-a' } } });
  former.receipt({ details: { rexReceipt: { id: 'run-a', key: 'run-a/generation-a/task-a/task-done', outcome: 'delivered' }, generationId: 'generation-a', task: 'task-a' } });
  former.running = () => new Map([['run-a', { ...stale, stopState: undefined }]]);
  former.capture();
  assert.ok(f.notes.some((note) => /Another live coordinator \(process 333\) owns fixture; this coordinator no longer saves or controls it/.test(note)));
  for (const name of ['subagent_send', 'subagent_stop', 'subagent_interrupt']) {
    assert.throws(() => former.control(name, { id: 'run-a', message: 'hello' }), /process 333\) owns fixture since a takeover/, name);
  }
  assert.deepEqual(f.store.read('run-a'), handed);
  assert.equal(f.ledger.length, 0);
  assert.equal(f.inbox.length, 0);
  assert.equal(f.scripts.length, 0);
  former.close(); f.self.close();
});

test('a refresh that read the record before the takeover cannot write it back or deliver its result', () => {
  const f = fixture();
  const former = f.make(FORMER);
  former.recovered.add('run-a');
  f.events.push({ type: 'task-done', task: 'task-a', generation: 'generation-a', at: '2026-11-21T00:00:00.000Z' });
  let raced = false;
  former.protocol = { ...former.protocol, readPersistentTaskEvents: () => {
    if (!raced) { raced = true; f.self.takeover(f.self.takeoverTarget({ name: 'fixture' })); }
    return f.events;
  } };
  former.refresh('run-a');
  assert.equal(raced, true);
  const record = f.store.read('run-a');
  assert.deepEqual(record.owner, SELF);
  assert.equal(record.pendingReceipts, undefined);
  assert.match(record.reason, /^Taken over/);
  assert.equal(f.messages.length, 0, 'the former owner delivers nothing');
  former.close(); f.self.close();
});

test('takeover moves the matching managed checkout lease and refuses one held elsewhere', () => {
  const checkoutFor = (f, lease) => {
    const record = { ...f.record, worktree: join(f.root, 'checkout') };
    f.store.write(record);
    const checkout = { key: 'checkout', path: record.worktree, lease };
    f.self.worktrees.records = () => [checkout];
    return checkout;
  };
  const moved = fixture();
  checkoutFor(moved, { ...FORMER, runId: 'run-a' });
  moved.self.takeover(moved.self.takeoverTarget({ name: 'fixture' }));
  assert.deepEqual(moved.saved.map((row) => row.lease), [{ ...SELF, runId: 'run-a' }]);
  moved.self.close();
  const exited = fixture();
  checkoutFor(exited, { pid: 666, birth: 'gone', runId: 'run-a' });
  exited.self.takeover(exited.self.takeoverTarget({ name: 'fixture' }));
  assert.deepEqual(exited.saved.map((row) => row.lease), [{ ...SELF, runId: 'run-a' }]);
  exited.self.close();
  const cases = {
    liveHolder: [(f) => checkoutFor(f, { pid: 555, birth: 'other', runId: 'run-a' }), /Another task or process holds the checkout lease/],
    otherRun: [(f) => checkoutFor(f, { ...FORMER, runId: 'run-b' }), /Another task or process holds the checkout lease/],
    removed: [(f) => { checkoutFor(f, null).removed = true; }, /not one managed worktree/],
    identity: [(f) => { checkoutFor(f, { ...FORMER, runId: 'run-a' }); f.self.worktrees.verify = () => { throw new Error('Registered Git worktree identity changed'); }; }, /identity changed/],
    sharedCheckout: [(f) => { checkoutFor(f, { ...FORMER, runId: 'run-a' }); f.store.write({ ...f.record, id: 'run-b', name: 'other', worktree: join(f.root, 'checkout') }); }, /"other" uses the checkout/],
  };
  for (const [name, [arrange, error]] of Object.entries(cases)) {
    const f = fixture({ extra: { 555: 'other' } });
    arrange(f);
    assert.throws(() => f.self.takeover(f.self.takeoverTarget({ name: 'fixture' })), error, name);
    assert.deepEqual(owner(f), FORMER, name);
    assert.deepEqual(f.saved, [], name);
    f.self.close();
  }
  const stashed = fixture();
  checkoutFor(stashed, null);
  stashed.store.write({ ...stashed.store.read('run-a'), stopRequested: true, stopConfirmed: true, stashed: { at: 1 } });
  assert.equal(stashed.self.takeover(stashed.self.takeoverTarget({ name: 'fixture' })).status, 'taken_over');
  assert.deepEqual(stashed.saved, [], 'a released stash lease stays released until resume');
  assert.ok(stashed.store.read('run-a').stashed);
  stashed.self.close();
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const agent = join(homedir(), '.pi/agent');
const version = readFileSync(join(agent, 'install/current-version'), 'utf8').trim();
const { loadExtensions } = await import(pathToFileURL(join(agent, 'install/releases', version, 'node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js')).href);

test('the registered rex_task_takeover tool and /rex-takeover command require confirmation and hand over to subagent_resume', async (context) => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'rex-takeover-native-'));
  const keys = ['REX_SESSION', 'HERDR_ENV', 'REX_TASK_ROOT', 'REX_REQUEST_ROOT', 'REX_PR_ROOT', 'REX_HISTORY_ROOT', 'REX_WORK_FILE', 'REX_MODULES_CONFIG', 'REX_BIN'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, { REX_SESSION: `session:takeover-${process.pid}`, REX_TASK_ROOT: join(fixtureRoot, 'tasks'), REX_REQUEST_ROOT: join(fixtureRoot, 'requests'),
    REX_PR_ROOT: join(fixtureRoot, 'prs'), REX_HISTORY_ROOT: join(fixtureRoot, 'history'), REX_WORK_FILE: join(fixtureRoot, 'work.json'),
    REX_MODULES_CONFIG: join(fixtureRoot, 'modules.json'), REX_BIN: '/usr/bin/true' });
  delete process.env.HERDR_ENV;
  writeFileSync(process.env.REX_MODULES_CONFIG, '{"recovery":true,"overview":false}');
  const scripts = [];
  infrastructureFor(process.env.REX_SESSION, () => ({
    provider: { isAvailable: () => true, sessions: new Set(), inspectSurface: async () => ({ kind: 'present' }), waitForShellReady: async () => {},
      runScript: (surface, command) => scripts.push({ surface, command }), process: () => ({}), closeTab: () => {}, json: () => ({ sessions: [] }) },
    worktrees: { records: () => [], save: () => {}, verify: () => ({}) },
    cleanupOperations: {}, worktreeOperations: {}, supervision: { close() {} },
  }));
  const sessionFile = join(fixtureRoot, 'child.jsonl');
  writeFileSync(sessionFile, `${JSON.stringify({ type: 'session', cwd: fixtureRoot })}\n`);
  const unsigned = { version: 2, owner: 'public', tools: null, deniedTools: [], persistent: true, logicalId: 'logical-native', generationId: 'generation-native' };
  const policyHash = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
  writeFileSync(`${sessionFile}.pi-herdr-subagent-policy.json`, JSON.stringify({ ...unsigned, policyHash }));
  const other = { pid: process.ppid, birth: processBirth(process.ppid), session: 'session:other-coordinator' };
  const store = new TaskStore();
  store.write({ version: 1, id: 'run-native', name: 'native-fixture', originCwd: fixtureRoot, surface: 'session:native/block:native',
    sessionFile, activityFile: join(fixtureRoot, 'activity.json'), owner: other,
    identity: { pid: process.pid, birth: 'Thu Jan  1 00:00:00 1970', command: 'pi' },
    logicalId: unsigned.logicalId, generationId: unsigned.generationId, policyHash, persistent: true, taskId: 'task-native' });
  const loaded = await loadExtensions([join(root, 'src/index.ts')], fixtureRoot);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  const dialogs = []; const notes = [];
  let answer = false;
  const ctx = { hasUI: true, cwd: fixtureRoot, sessionManager: { getBranch: () => [], getSessionFile: () => join(fixtureRoot, 'coordinator.jsonl') },
    ui: { confirm: async (title, body) => { dialogs.push({ title, body }); return answer; }, notify: (text, level) => notes.push({ text, level }), setWidget() {}, setStatus() {} } };
  context.after(async () => {
    for (const handler of extension.handlers.get('session_shutdown') ?? []) await handler({ reason: 'quit' }, ctx);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  assert.ok(extension.tools.has('rex_task_takeover'));
  assert.ok(extension.commands.has('rex-takeover'));
  await extension.handlers.get('session_start').at(-1)({ reason: 'startup' }, ctx);
  const tool = (name, params) => extension.tools.get(name).definition.execute(name, params, undefined, undefined, ctx);
  await assert.rejects(tool('subagent_resume', { sessionPath: sessionFile }), new RegExp(`Another live coordinator \\(process ${other.pid}\\) owns native-fixture; nothing was resumed`));
  await assert.rejects(tool('rex_task_takeover', { name: 'native-fixture' }), new RegExp(`process ${other.pid} runs Rex code that cannot hand tasks over safely`));
  await extension.commands.get('rex-takeover').handler('native-fixture', ctx);
  assert.equal(notes.at(-1).level, 'error');
  assert.match(notes.at(-1).text, /cannot hand tasks over safely\. Run \/reload in that coordinator once/);
  assert.equal(dialogs.length, 0, 'a legacy owner is refused before any dialog');
  assert.deepEqual(store.read('run-native').owner, other);
  publishSupport(store, other, { hosted: ['run-native'] });
  await assert.rejects(tool('rex_task_takeover', { name: 'native-fixture' }), /still supervises "native-fixture"/);
  publishSupport(store, other);
  await assert.rejects(tool('rex_task_takeover', { name: 'native-fixture' }), /not confirmed\. Nothing changed/);
  assert.equal(dialogs.length, 1);
  assert.equal(dialogs[0].title, 'Take over Rex task?');
  assert.match(dialogs[0].body, new RegExp(`from the coordinator in process ${other.pid} \\(session:other-coordinator\\)`));
  assert.match(dialogs[0].body, /PID \d+ now belongs to a process started .*, not the recorded agent/);
  assert.match(dialogs[0].body, /has published that it runs takeover-aware Rex code and no longer supervises the task/);
  assert.deepEqual(store.read('run-native').owner, other);
  ctx.hasUI = false;
  await assert.rejects(tool('rex_task_takeover', { name: 'native-fixture' }), /not confirmed/);
  assert.equal(dialogs.length, 1, 'no dialog without a UI');
  ctx.hasUI = true;
  answer = true;
  await extension.commands.get('rex-takeover').handler('logical-native', ctx);
  assert.equal(notes.at(-1).level, 'info', JSON.stringify(notes));
  assert.match(notes.at(-1).text, /Task "native-fixture" now belongs to this coordinator\. Taken over from coordinator process \d+ after its agent exited.*Nothing was launched; resume it with subagent_resume/);
  assert.deepEqual(store.read('run-native').owner, { pid: process.pid, birth: processBirth(process.pid), session: process.env.REX_SESSION });
  assert.equal(scripts.length, 0);
  await extension.commands.get('rex-takeover').handler('native-fixture', ctx);
  assert.match(notes.at(-1).text, /already belongs to this coordinator/);
  assert.equal(notes.at(-1).level, 'error');
  const resumed = await tool('subagent_resume', { sessionPath: sessionFile });
  assert.equal(resumed.details.status, 'resumed');
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].surface, 'session:native/block:native');
  await assert.rejects(tool('rex_task_takeover', { name: 'native-fixture' }), /already belongs to this coordinator/);
  assert.equal(scripts.length, 1);
  const published = JSON.parse(readFileSync(join(process.env.REX_TASK_ROOT, 'coordinators', `${process.pid}.json`), 'utf8'));
  assert.deepEqual({ pid: published.pid, birth: published.birth, takeover: published.takeover }, { pid: process.pid, birth: processBirth(process.pid), takeover: 1 });
  for (const handler of extension.handlers.get('session_shutdown') ?? []) await handler({ reason: 'reload' }, ctx);
  assert.equal(existsSync(join(process.env.REX_TASK_ROOT, 'coordinators', `${process.pid}.json`)), false, 'support is withdrawn on reload or shutdown');
});

test('a legacy or unpublished owner fails closed even when its agent is proven gone', () => {
  const cases = {
    legacy: [() => {}, /runs Rex code that cannot hand tasks over safely\. Run \/reload in that coordinator once/],
    otherProcess: [(f) => publishSupport(f.store, { pid: 111, birth: 'earlier-process' }), /cannot hand tasks over safely/],
    oldFormat: [(f) => publishSupport(f.store, FORMER, { version: 0 }), /cannot hand tasks over safely/],
    noHosted: [(f) => publishSupport(f.store, FORMER, { hosted: 'run-a' }), /cannot hand tasks over safely/],
    malformed: [(f) => { publishSupport(f.store, FORMER); writeFileSync(join(f.store.root, 'coordinators', '111.json'), '{'); }, /cannot hand tasks over safely/],
    ownerBirthUnknown: [(f) => { publishSupport(f.store, FORMER); f.store.write({ ...f.record, owner: { pid: 111 } }); }, /cannot hand tasks over safely/],
    stillHosted: [(f) => publishSupport(f.store, FORMER, { hosted: ['run-a'] }), /still supervises "fixture" as a running agent\. Stop it there instead/],
  };
  for (const [name, [arrange, error]] of Object.entries(cases)) {
    const f = fixture({ legacy: true });
    arrange(f);
    assert.throws(() => f.self.takeover(f.self.takeoverTarget({ name: 'fixture' })), error, name);
    assert.equal(f.store.read('run-a').handoff, undefined, name);
    assert.equal(f.store.read('run-a').owner.pid, 111, name);
    f.self.close();
  }
});

test('a dead coordinator needs no published support: normal recovery still resumes its task', async () => {
  const f = fixture({ legacy: true });
  f.births[111] = null;
  assert.throws(() => f.self.takeover(f.self.takeoverTarget({ name: 'fixture' })), /has exited, so no takeover is needed/);
  assert.equal((await f.self.resume({ sessionPath: f.record.sessionFile })).status, 'resumed');
  assert.deepEqual(owner(f), SELF);
  assert.equal(f.scripts.length, 1);
  f.self.close();
});

test('a coordinator publishes its takeover support with its supervised tasks and withdraws it on close', () => {
  const f = fixture({ legacy: true });
  const file = join(f.store.root, 'coordinators', '333.json');
  const running = new Map([['run-z', { id: 'run-z', name: 'z', sessionFile: join(f.root, 'z.jsonl'), activityFile: join(f.root, 'z.json'), surface: 'session:z/block:z' }]]);
  f.self.running = () => running;
  f.self.capture();
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: 1, takeover: 1, pid: 333, birth: 'new', hosted: ['run-z'] });
  running.clear();
  f.self.refresh('run-z');
  f.self.refresh('run-a');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).hosted, []);
  const reloaded = f.make(SELF);
  f.self.close();
  assert.equal(existsSync(file), false);
  reloaded.capture();
  assert.equal(existsSync(file), true);
  reloaded.close();
  assert.equal(existsSync(file), false);
});

test('a refresh that entered as owner cannot close, confirm or signal a task handed over during its result delivery', () => {
  const f = fixture();
  const former = f.make(FORMER);
  former.recovered.add('run-a');
  writeFileSync(`${f.record.sessionFile}.exit`, JSON.stringify({ type: 'done' }));
  f.store.write({ ...f.record, stopRequested: true, stopConfirmed: true, stashed: { at: 1 } });
  f.events.push({ type: 'task-done', task: 'task-a', generation: 'generation-a', at: '2026-11-21T00:00:00.000Z' });
  former.send = (message) => {
    f.messages.push(message);
    f.self.takeover(f.self.takeoverTarget({ name: 'fixture' }));
  };
  former.refresh('run-a');
  assert.deepEqual(owner(f), SELF);
  assert.deepEqual(f.messages.map((message) => message.customType), ['subagent_result']);
  assert.deepEqual(f.closed, [], 'the transferred task tab stays open');
  assert.equal(f.store.read('run-a').stopNotified, undefined);
  assert.match(f.store.read('run-a').reason, /^Taken over/);
  const foreign = f.store.read('run-a');
  assert.equal(former.commit({ ...foreign, reason: 'written by the former owner' }), false);
  assert.match(f.store.read('run-a').reason, /^Taken over/);
  former.close(); f.self.close();
});

test('a refresh that entered as owner cannot close or confirm a stop of a task handed over meanwhile', () => {
  const f = fixture();
  const former = f.make(FORMER);
  former.recovered.add('run-a');
  writeFileSync(`${f.record.sessionFile}.exit`, JSON.stringify({ type: 'done' }));
  f.store.write({ ...f.record, stopRequested: true, stopConfirmed: true, stashed: { at: 1 } });
  former.protocol = { ...former.protocol, readPersistentTaskEvents: () => {
    if (!f.store.read('run-a').handoff) f.self.takeover(f.self.takeoverTarget({ name: 'fixture' }));
    return f.events;
  } };
  former.refresh('run-a');
  assert.deepEqual(owner(f), SELF);
  assert.deepEqual(f.closed, []);
  assert.deepEqual(f.messages, []);
  assert.equal(f.store.read('run-a').stopNotified, undefined);
  former.close(); f.self.close();
});

test('a failed task write puts the moved checkout lease back', () => {
  const f = fixture();
  const lease = { ...FORMER, runId: 'run-a' };
  const checkout = { key: 'checkout', path: join(f.root, 'checkout'), lease };
  f.store.write({ ...f.record, worktree: checkout.path });
  f.self.worktrees.records = () => [checkout];
  const write = f.store.write.bind(f.store);
  f.store.write = (record) => {
    if (record.owner.pid === SELF.pid) throw new Error('disk full');
    write(record);
  };
  assert.throws(() => f.self.takeover(f.self.takeoverTarget({ name: 'fixture' })), /disk full/);
  assert.deepEqual(f.saved.map((row) => row.lease), [{ ...SELF, runId: 'run-a' }, lease]);
  assert.deepEqual(checkout.lease, lease);
  assert.deepEqual(owner(f), FORMER);
  f.self.close();
});
