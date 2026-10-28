import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import taskStatus from '../src/task.ts';
import { agentIdentityFile } from '../src/tasks.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const agent = join(homedir(), '.pi/agent');
const version = readFileSync(join(agent, 'install/current-version'), 'utf8').trim();
const sdk = join(agent, 'install/releases', version, 'node_modules/@earendil-works/pi-coding-agent');
const { loadExtensions } = await import(pathToFileURL(join(sdk, 'dist/core/extensions/loader.js')).href);

async function fixture(context, child = false) {
  const directory = mkdtempSync(join(tmpdir(), 'rex-native-status-'));
  const keys = ['REX_SESSION', 'PI_SUBAGENT_ID', 'PI_SUBAGENT_SESSION', 'PI_SUBAGENT_SURFACE', 'REX_MODULES_CONFIG', 'HERDR_ENV', 'PI_REX_AGENT'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  keys.forEach((key) => delete process.env[key]);
  const config = join(directory, 'modules.json');
  writeFileSync(config, '{"recovery":false,"overview":false}');
  Object.assign(process.env, { REX_SESSION: 'session:native-status', REX_MODULES_CONFIG: config });
  const sessionFile = join(directory, 'child.jsonl');
  if (child) {
    Object.assign(process.env, { PI_SUBAGENT_ID: 'fixture', PI_SUBAGENT_SESSION: sessionFile, PI_SUBAGENT_SURFACE: 'session:native-status/block:fixture', PI_REX_AGENT: '1' });
    writeFileSync(`${sessionFile}.pi-herdr-subagent-policy.json`, JSON.stringify({ generationId: 'generation', policyHash: 'policy' }));
  }
  const handlers = new Map();
  const api = { on(name, handler) {
    if (!handlers.has(name)) handlers.set(name, new Set());
    handlers.get(name).add(handler);
    return () => handlers.get(name).delete(handler);
  } };
  let output = '';
  const original = process.stdout.write;
  process.stdout.write = (value) => { output += value; return true; };
  const ctx = { mode: 'tui' };
  const emit = async (name, event = {}) => {
    for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
  };
  context.after(async () => {
    await emit('session_shutdown');
    process.stdout.write = original;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  await taskStatus(api);
  const reports = () => output.split('\u001b]7501;').slice(1).map((sequence) => Object.fromEntries(sequence.split('\u001b\\')[0].split(':').map((pair) => {
    const offset = pair.indexOf('=');
    return [pair.slice(0, offset), pair.slice(offset + 1)];
  })));
  const last = () => reports().at(-1);
  return { api, handlers, emit, last, reports, directory, sessionFile, config, ctx, output: () => output };
}

test('generic sessions report independently of both flags without child attestation', async (context) => {
  const f = await fixture(context);
  await f.emit('session_start');
  assert.equal(f.last().state, 'idle');
  assert.equal(existsSync(agentIdentityFile(f.sessionFile, 'fixture')), false);
  await f.emit('agent_start');
  assert.equal(f.last().state, 'working');
  await f.emit('agent_end');
  assert.equal(f.last().state, 'working');
  await f.emit('agent_settled', { aborted: false });
  assert.equal(f.last().state, 'done');
  await f.emit('session_shutdown');
  assert.equal(f.last().state, 'done');
  assert.ok(f.reports().every((report) => report.id === 'rex-task'));
  assert.ok(!f.output().includes('\u001b]2;'));
});

test('parallel questions remain blocked until every answer and nested UI prompt finishes', async (context) => {
  const f = await fixture(context);
  await f.emit('session_start'); await f.emit('agent_start');
  await f.emit('tool_execution_start', { toolCallId: 'q1', toolName: 'ask_user_question' });
  await f.emit('tool_execution_start', { toolCallId: 'q2', toolName: 'ask_user_question', parentToolCallId: 'nested' });
  await f.emit('tool_execution_start', { toolCallId: 'b', toolName: 'bash' });
  assert.equal(f.last().state, 'blocked'); assert.equal(f.last().kind, 'question');
  await f.emit('ui_prompt_start', { kind: 'confirm', title: 'private secret' });
  assert.equal(f.last().kind, 'permission');
  await f.emit('tool_execution_end', { toolCallId: 'q1', toolName: 'ask_user_question' });
  await f.emit('ui_prompt_end', { kind: 'confirm' });
  assert.equal(f.last().state, 'blocked');
  await f.emit('tool_execution_end', { toolCallId: 'q2', toolName: 'ask_user_question' });
  assert.equal(f.last().state, 'working');
  await f.emit('tool_execution_end', { toolCallId: 'b', toolName: 'bash' });
  await f.emit('agent_settled', { aborted: false });
  assert.equal(f.last().state, 'done');
  assert.doesNotMatch(f.output(), /private|secret/);
});

test('coordinator help stays blocked until a new task and completion waits for settlement', async (context) => {
  const f = await fixture(context);
  await f.emit('session_start'); await f.emit('agent_start');
  await f.emit('tool_execution_end', { toolName: 'caller_ping', toolCallId: 'help', isError: false });
  await f.emit('tool_execution_start', { toolName: 'bash', toolCallId: 'b' });
  await f.emit('tool_execution_end', { toolName: 'bash', toolCallId: 'b' });
  await f.emit('agent_settled', { aborted: false });
  assert.equal(f.last().state, 'blocked');
  await f.emit('agent_start');
  assert.equal(f.last().state, 'working');
  await f.emit('tool_execution_end', { toolName: 'subagent_done', toolCallId: 'done' });
  assert.equal(f.last().state, 'working');
  await f.emit('agent_settled', { aborted: false });
  assert.equal(f.last().state, 'done');
});

test('provider errors, recovery and aborts do not report false completion', async (context) => {
  const f = await fixture(context);
  await f.emit('session_start'); await f.emit('agent_start');
  await f.emit('message_end', { message: { role: 'assistant', stopReason: 'error', errorMessage: 'private provider details' } });
  await f.emit('agent_settled', { aborted: false });
  assert.equal(f.last().state, 'error');
  await f.emit('agent_start');
  await f.emit('message_end', { message: { role: 'assistant', stopReason: 'error' } });
  await f.emit('message_end', { message: { role: 'assistant', stopReason: 'stop' } });
  await f.emit('agent_settled', { aborted: false });
  assert.equal(f.last().state, 'done');
  await f.emit('agent_start');
  await f.emit('agent_settled', { aborted: true });
  assert.equal(f.last().state, 'idle');
  await f.emit('agent_start');
  await f.emit('message_end', { message: { role: 'assistant', stopReason: 'aborted' } });
  await f.emit('agent_settled', { aborted: false });
  assert.equal(f.last().state, 'idle');
  assert.doesNotMatch(f.output(), /private provider details/);
});

test('scoped shutdown clears pending state and duplicate registration removes old listeners', async (context) => {
  const f = await fixture(context);
  await f.emit('session_start'); await f.emit('agent_start');
  await taskStatus(f.api);
  for (const handlers of f.handlers.values()) assert.equal(handlers.size, 1);
  assert.equal(f.last().state, 'clear'); assert.equal(f.last().id, 'rex-task');
  await f.emit('session_start');
  await f.emit('session_shutdown');
  assert.equal(f.last().state, 'clear');
  assert.ok([...f.handlers.values()].every((handlers) => handlers.size === 0));
});

test('messages are UTF-8 byte capped and sanitized without publishing tool inputs', async (context) => {
  const f = await fixture(context);
  await f.emit('session_start'); await f.emit('agent_start');
  await f.emit('tool_execution_start', { toolCallId: 'long', toolName: '\u001b\u0000\u202e' + '😀'.repeat(3000), args: { token: 'private-token' } });
  const msg = Buffer.from(f.last().msg, 'base64');
  assert.ok(msg.length <= 2048);
  assert.doesNotMatch(msg.toString('utf8'), /[\p{Cc}\p{Cf}\uFFFD]/u);
  assert.ok(Buffer.byteLength(f.output().split('\u001b]7501;').at(-1)) < 4096);
  assert.doesNotMatch(f.output(), /private-token/);
});

test('managed attestation preserves generation, policy and exact session surface validation', async (context) => {
  const f = await fixture(context, true);
  await f.emit('session_start');
  assert.equal(f.last().state, 'idle');
  writeFileSync(f.config, '{"recovery":true,"overview":false}');
  await f.emit('session_start');
  const identity = JSON.parse(readFileSync(agentIdentityFile(f.sessionFile, 'fixture'), 'utf8'));
  assert.equal(identity.policyHash, 'policy'); assert.equal(identity.generationId, 'generation');
  assert.equal(identity.pid, process.pid);
  process.env.PI_SUBAGENT_SURFACE = 'session:other/block:fixture';
  await assert.rejects(f.emit('session_start'), /surface/);
});

test('RPC does not contaminate its JSON stream with terminal status', async (context) => {
  const f = await fixture(context);
  f.ctx.mode = 'rpc';
  await f.emit('session_start'); await f.emit('agent_start'); await f.emit('agent_settled', { aborted: false });
  assert.equal(f.output(), '');
});

test('global entry and coordinator package compose into exactly one reporter with disabled flags', async (context) => {
  const f = await fixture(context);
  const globalEntry = join(root, '../pi/agent/extensions/rex-task.ts');
  const loaded = await loadExtensions([globalEntry, join(root, 'src/index.ts')], root);
  assert.deepEqual(loaded.errors, []);
  const callbacks = (name) => loaded.extensions.flatMap((extension) => extension.handlers.get(name) ?? []);
  assert.equal(callbacks('tool_execution_start').length, 1);
  assert.equal(callbacks('message_end').length, 1);
  const ctx = { mode: 'tui', cwd: f.directory, modelRegistry: { find() {}, getAvailable: () => [], getAll: () => [] }, sessionManager: { getBranch: () => [] }, ui: { setWidget() {}, notify() {}, setStatus() {} } };
  for (const handler of callbacks('session_start')) await handler({}, ctx);
  assert.equal(f.last().state, 'idle');
  for (const handler of callbacks('session_shutdown')) await handler({ reason: 'quit' }, ctx);
});

test('managed launch entries register once and never load coordinator tools', async (context) => {
  const f = await fixture(context, true);
  const loaded = await loadExtensions([join(root, '../pi/agent/extensions/rex-task.ts'), join(root, 'src/index.ts'), join(root, 'src/task.ts')], root);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.flatMap((extension) => extension.handlers.get('tool_execution_start') ?? []).length, 1);
  assert.ok(loaded.extensions.every((extension) => extension.tools.size === 0));
  for (const extension of loaded.extensions) {
    for (const handler of extension.handlers.get('session_start') ?? []) await handler({}, f.ctx);
    for (const handler of extension.handlers.get('session_shutdown') ?? []) await handler({ reason: 'quit' }, f.ctx);
  }
});

test('failed help does not block and final errors survive shutdown', async (context) => {
  const f = await fixture(context);
  await f.emit('session_start'); await f.emit('agent_start');
  await f.emit('tool_execution_end', { toolName: 'caller_ping', toolCallId: 'help', isError: true });
  assert.equal(f.last().state, 'working');
  await f.emit('message_end', { message: { role: 'assistant', stopReason: 'error' } });
  await f.emit('agent_settled', { aborted: false });
  await f.emit('session_shutdown');
  assert.equal(f.last().state, 'error');
});

test('non-Rex sessions do not register native status', async (context) => {
  await fixture(context);
  delete process.env.REX_SESSION;
  let registrations = 0;
  await taskStatus({ on() { registrations++; } });
  assert.equal(registrations, 0);
});
