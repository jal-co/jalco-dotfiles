import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Store, writeJson } from '../src/store.mjs';
import { Manager } from '../src/manager.mjs';
import { Rex, taskLayout } from '../src/rex.mjs';
import { capabilities, commandFor } from '../src/adapters.mjs';
import { programStatus } from '../src/status.mjs';
import { identityAlive, processIdentity } from '../src/process.mjs';
import { createProtocol } from '../src/mcp.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rex-plugins-test-'));
  const store = new Store(join(root, 'state'));
  const calls = [];
  const server = { instance: 'server-instance', host: 'host' };
  const rex = { localServer: () => server, create: (name, layout) => {
    calls.push({ name, layout });
    return { session_id: 'session:fixture', initial_windows: [{ block_ids: ['block:fixture', 'block:status', 'block:details'] }] };
  }, presence: () => 'missing' };
  const manager = new Manager({ store, rex, alive: () => false });
  const launch = (more = {}) => manager.launch({ name: 'fixture', adapter: 'command', argv: ['node', '-e', 'console.log("hello")'], cwd: root, ...more });
  return { root, store, calls, rex, manager, launch };
}

function runtime(f, id, value = {}) {
  writeJson(f.store.file(id, 'runtime'), { id, identity: { pid: 123, birth: 'runner' }, child: { pid: 124, birth: 'child' }, state: 'running', ...value });
}

test('generic launch keeps argv separate and reserves exact cwd and name', () => {
  const f = fixture();
  const row = f.launch({ argv: ['program', '$(touch /tmp/not-executed)', '--quoted value'] });
  assert.equal(row.state, 'starting');
  assert.equal(row.binding.session, 'session:fixture');
  assert.deepEqual(f.store.request(row.id).command.argv, ['program', '$(touch /tmp/not-executed)', '--quoted value']);
  assert.throws(() => f.launch(), /owns this name/);
  assert.equal(f.calls.length, 1);
});

test('launch timeout retains evidence and blocks duplicate writers', () => {
  const f = fixture();
  f.rex.create = () => { throw new Error('timeout'); };
  assert.throws(() => f.launch(), /retained after launch uncertainty/);
  assert.equal(f.manager.list()[0].state, 'unknown');
  assert.throws(() => f.launch(), /owns this name/);
});

test('stop stays requested while runner remains live', () => {
  const f = fixture(); const row = f.launch(); runtime(f, row.id);
  f.manager.alive = () => true;
  assert.equal(f.manager.stop(row.id).state, 'stopping');
  assert.equal(f.manager.status(row.id).state, 'stopping');
  assert.throws(() => f.launch(), /owns this name/);
});

test('stale retirement requires missing terminal and both original processes gone', () => {
  const f = fixture(); const row = f.launch(); runtime(f, row.id);
  f.rex.presence = () => 'present';
  assert.throws(() => f.manager.stop(row.id), /terminal still exists/);
  f.rex.presence = () => { throw new Error('server unavailable'); };
  assert.throws(() => f.manager.stop(row.id), /server unavailable/);
  f.rex.presence = () => 'missing';
  f.manager.alive = (identity) => identity.pid === 124;
  assert.equal(f.manager.status(row.id).state, 'unknown');
  assert.throws(() => f.manager.stop(row.id), /verified live runner/);
  f.manager.alive = () => false;
  assert.equal(f.manager.stop(row.id).state, 'stopped');
  assert.equal(f.manager.stop(row.id).state, 'stopped');
  assert.equal(f.launch().state, 'starting');
});

test('a recorded outcome is not exit evidence for a live runner', () => {
  const f = fixture(); const row = f.launch(); runtime(f, row.id, { state: 'completed' });
  f.manager.alive = () => true;
  assert.equal(f.manager.status(row.id).state, 'running');
  f.manager.alive = (identity) => identity.pid === 124;
  assert.equal(f.manager.status(row.id).state, 'unknown');
  f.manager.alive = () => false;
  assert.equal(f.manager.status(row.id).state, 'completed');
});

test('state paths and operation locks reject unsafe or concurrent requests', () => {
  const f = fixture();
  for (const id of ['../other', 'session:other', 'fixture']) assert.throws(() => f.manager.status(id));
  mkdirSync(join(f.store.root, 'operation.lock'));
  assert.throws(() => f.launch(), /Another operation/);
  assert.equal(f.calls.length, 0);
});

test('validation rejects unknown options, missing executable and mixed checkout requests', () => {
  const f = fixture();
  for (const options of [{ adapter: 'unknown' }, { argv: [] }, { argv: ['x\0y'] }, { dangerous: true }, { cwd: 'relative' }, { worktree: {} }]) assert.throws(() => f.launch(options));
  assert.equal(f.calls.length, 0);
});

test('Pi uses print mode without inheriting another coordinator extension or approval override', () => {
  const command = commandFor({ adapter: 'pi', model: 'provider/model', prompt: '--a prompt; with shell text' }, '/tmp/run');
  assert.ok(command.capture);
  assert.ok(command.argv.includes('--no-extensions'));
  assert.ok(command.argv.includes('--no-mcp'));
  assert.ok(!command.argv.includes('--approve'));
  assert.deepEqual(command.argv.slice(-2), ['--', '--a prompt; with shell text']);
  assert.equal(capabilities.command.followUp, false);
  assert.equal(capabilities.pi.completion, 'process-exit');
});

test('nested task layout launches only argv commands in new retained terminal blocks', () => {
  const layout = taskLayout({ name: 'task', cwd: '/tmp', runner: ['node', 'runner'], view: ['node', 'watch'], details: ['node', 'show'], panels: true });
  assert.equal(layout.split.before.block.options.shell, 'none');
  assert.equal(layout.split.after.split.before.block.label, 'Task status');
  assert.equal(layout.split.before.block.options.exit.on_completion, false);
});

test('targeted presence ignores unrelated sessions and refuses a different server', () => {
  const binding = { server: { instance: 'a', host: 'b' }, session: 'session:task', block: 'block:task' };
  const calls = [];
  const rex = new Rex((args) => {
    calls.push(args);
    if (args[0] === 'whoami') return JSON.stringify({ endpoint: 'unix:///local', instance_id: 'a', host_id: 'b' });
    if (args[2] === 'session.list') return '{"sessions":[{"session_id":"session:unrelated"}]}';
    throw new Error('Unrelated session must not be inspected');
  });
  assert.equal(rex.presence(binding), 'missing');
  assert.equal(calls.length, 2);
  assert.throws(() => rex.presence({ ...binding, server: { instance: 'other', host: 'b' } }), /server changed/);
});

test('OSC 7501 validates bounded messages, nested IDs and kind/progress rules', () => {
  const value = programStatus({ state: 'blocked', id: 'agent/task', kind: 'question', progress: 50, message: 'Choose a base' });
  assert.ok(value.startsWith('\x1b]7501;state=blocked:id=agent/task:app=rex-plugins:'));
  assert.ok(value.endsWith('\x1b\\'));
  assert.ok(value.includes(`msg=${Buffer.from('Choose a base').toString('base64')}`));
  for (const bad of [{ message: 'a\nb' }, { message: '\u202e' }, { message: 'a'.repeat(2049) }, { id: 'a'.repeat(33) }, { id: 'a/'.repeat(9) }, { progress: 101 }, { state: 'done', progress: 10 }, { state: 'working', kind: 'auth' }]) assert.throws(() => programStatus({ state: 'working', ...bad }));
});

test('process birth verification rejects PID reuse and surfaces inspection failures', () => {
  const original = processIdentity(process.pid);
  assert.ok(identityAlive(original));
  assert.equal(identityAlive(original, () => ({ pid: original.pid, birth: 'different' })), false);
  assert.throws(() => identityAlive(original, () => { throw new Error('denied'); }), /denied/);
});

test('MCP initialization, tool errors and adapter capabilities work without Pi', () => {
  const f = fixture(); const handle = createProtocol(f.manager);
  const call = (method, params) => handle({ jsonrpc: '2.0', id: randomUUID(), method, params });
  assert.equal(call('tools/list').error.code, -32000);
  assert.equal(call('initialize', { protocolVersion: '2025-06-18' }).result.protocolVersion, '2025-06-18');
  assert.equal(call('tools/list').result.tools.length, 6);
  assert.equal(call('tools/call', { name: 'rex_agent_status', arguments: { id: '../outside' } }).result.isError, true);
  assert.equal(call('tools/call', { name: 'rex_agent_launch', arguments: { name: 'x', adapter: 'command', argv: ['node'], cwd: f.root, force: true } }).result.isError, true);
  assert.equal(handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
  assert.equal(call('not-real').error.code, -32601);
  assert.equal(handle({ jsonrpc: '2.0', id: {}, method: 'ping' }).error.code, -32600);
  assert.equal(JSON.parse(call('tools/call', { name: 'rex_agent_adapters' }).result.content[0].text).command.followUp, false);
});

test('privacy boundary refuses shared state directories and remote Rex before launch', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rex-private-test-'));
  chmodSync(directory, 0o755);
  assert.throws(() => new Store(directory), /must be private/);
  chmodSync(directory, 0o700);
  const calls = [];
  const rex = new Rex((args) => {
    calls.push(args);
    return '{"endpoint":"https://remote.invalid","instance_id":"remote","host_id":"remote"}';
  });
  const manager = new Manager({ store: new Store(directory), rex });
  assert.throws(() => manager.launch({ name: 'private-fixture', cwd: directory, adapter: 'command', argv: ['node'] }), /local Rex Unix socket/);
  assert.deepEqual(calls, [['whoami', '--json']]);
  assert.deepEqual(manager.list(), []);
});
