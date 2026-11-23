import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { claimRemoteEvents, finishRemoteEvent, linkStatus, remoteSnapshot, remoteWaiting, sendCommand, workerConnected, writeOutboxEvent } from '../src/hosts.ts';
import { connectOnce } from '../src/link.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'link.mjs');
const until = async (check, label, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

function environment(context) {
  const directory = mkdtempSync(join(tmpdir(), 'rex-link-'));
  const keys = { REX_HOSTS_ROOT: join(directory, 'hosts'), REX_LINK_ROOT: join(directory, 'link') };
  const previous = Object.fromEntries(Object.keys(keys).map((key) => [key, process.env[key]]));
  Object.assign(process.env, keys);
  context.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  return { directory, ...keys };
}

test('a worker link forwards events, snapshots and command replies, and the primary sees it go offline', async (context) => {
  const env = environment(context);
  let child;
  const transport = () => {
    child = spawn(process.execPath, [script, 'serve', '--host', 'mac'], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env } });
    return child;
  };
  const commands = [];
  const agent = {
    send: async (params) => { commands.push(params); return { ok: true, text: 'Sent a follow-up to fix' }; },
    stop: async () => { throw new Error('no such task'); },
  };
  const tab = { key: 'block:1', tab: 'fix', place: 'platform', message: 'Save button', kind: 'question' };
  const snapshots = { waiting: () => ({ waiting: [tab] }), tasks: () => ({ tasks: [{ id: 't1', name: 'fix', state: 'blocked' }] }), status: () => ({ hostname: 'mac', load: 1, cpus: 8 }) };
  writeOutboxEvent({ customType: 'subagent_result', content: 'fix finished: PR opened' });
  const closed = connectOnce({ brain: 'b1', transport, agent, snapshots });

  await until(() => remoteSnapshot('mac', 'status')?.hostname === 'mac', 'status snapshot');
  assert.equal(workerConnected(), true);
  assert.equal(linkStatus('mac').online, true);
  assert.equal(remoteSnapshot('mac', 'tasks').tasks[0].name, 'fix');
  assert.deepEqual(remoteWaiting(), [{ ...tab, host: 'mac' }]);

  let events = [];
  await until(() => (events = claimRemoteEvents()).length === 1, 'forwarded event');
  assert.equal(events[0].content, 'fix finished: PR opened');
  assert.equal(events[0].repeat, false);
  finishRemoteEvent(events[0]);
  await until(() => readdirSync(join(env.REX_LINK_ROOT, 'outbox')).length === 0, 'acknowledged outbox');
  writeOutboxEvent({ customType: 'subagent_ping', content: 'fix needs help' });
  await until(() => (events = claimRemoteEvents()).length === 1, 'second event');
  assert.equal(events[0].customType, 'subagent_ping');

  const sent = await sendCommand('mac', 'send', { id: 't1', message: 'rebase please' }, { interval: 20 });
  assert.deepEqual(sent, { ok: true, text: 'Sent a follow-up to fix' });
  assert.deepEqual(commands, [{ id: 't1', message: 'rebase please' }]);
  assert.deepEqual(await sendCommand('mac', 'stop', { id: 'x' }, { interval: 20 }), { ok: false, text: 'no such task' });
  await assert.rejects(sendCommand('mac', 'cleanup', {}), /Unsupported remote action cleanup/);

  child.stdin.end();
  await closed;
  await until(() => !linkStatus('mac').online, 'offline link');
  assert.equal(workerConnected(), false);
  assert.match(linkStatus('mac').reason, /mac disconnected/);
  const refused = await sendCommand('mac', 'send', { id: 't1', message: 'hi' });
  assert.equal(refused.offline, true);
  assert.match(refused.text, /nothing was sent/);
  assert.equal(readdirSync(join(env.REX_HOSTS_ROOT, 'mac', 'commands')).length, 0);
  assert.deepEqual(remoteWaiting(), []);
});

test('a command left mid-flight by a dropped link is reported as uncertain, and old commands expire', async (context) => {
  const env = environment(context);
  const commands = join(env.REX_HOSTS_ROOT, 'mac', 'commands');
  mkdirSync(commands, { recursive: true });
  writeFileSync(join(commands, 'lost.claimed'), '{}');
  writeFileSync(join(commands, 'old.json'), JSON.stringify({ id: 'old', action: 'send', params: {}, createdAt: Date.now() - 120_000 }));
  const child = spawn(process.execPath, [script, 'serve', '--host', 'mac'], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env } });
  const output = [];
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  await until(() => existsSync(join(commands, 'old.result.json')), 'expired result');
  child.stdin.end();
  await new Promise((resolve) => child.on('close', resolve));
  const { readJson } = await import('../src/hosts.ts');
  assert.match(readJson(join(commands, 'lost.result.json')).text, /dropped while this ran/);
  assert.match(readJson(join(commands, 'old.result.json')).text, /Expired after 60s/);
  assert.ok(!output.join('').includes('"type":"command"'));
});

test('a connected worker forwards results without a turn; a disconnected one delivers them itself', async (context) => {
  const env = environment(context);
  const { forwardOrSend } = await import('../src/hosts.ts');
  const sent = [];
  const send = (message, options) => sent.push([message.customType, options]);
  forwardOrSend(send, { customType: 'subagent_result', content: 'done' }, { triggerTurn: true, deliverAs: 'steer' }, { connected: true });
  forwardOrSend(send, { customType: 'subagent_result', content: 'done again' }, { triggerTurn: true, deliverAs: 'steer' }, { connected: false });
  assert.deepEqual(sent, [['subagent_result', { triggerTurn: false }], ['subagent_result', { triggerTurn: true, deliverAs: 'steer' }]]);
  assert.equal(readdirSync(join(env.REX_LINK_ROOT, 'outbox')).length, 1);
});

test('the primary coordinator delivers forwarded events once, names their machine and lists remote tasks', async (context) => {
  const env = environment(context);
  const agent = join((await import('node:os')).homedir(), '.pi/agent');
  const { readFileSync } = await import('node:fs');
  const version = readFileSync(join(agent, 'install/current-version'), 'utf8').trim();
  const { loadExtensions } = await import(join(agent, 'install/releases', version, 'node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js'));
  const old = Object.fromEntries(['REX_SESSION', 'HERDR_ENV', 'REX_MODULES_CONFIG', 'REX_HOST_NAME'].map((key) => [key, process.env[key]]));
  context.after(() => {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  Object.assign(process.env, { REX_SESSION: `session:link-${Date.now()}`, REX_MODULES_CONFIG: join(env.directory, 'flags.json'), REX_HOST_NAME: 'b1' });
  delete process.env.HERDR_ENV;
  writeFileSync(process.env.REX_MODULES_CONFIG, '{"recovery":false,"overview":false}');
  const { writeJson } = await import('../src/hosts.ts');
  writeJson(join(env.REX_HOSTS_ROOT, 'mac', 'events', '1-a.json'), { id: '1-a', customType: 'subagent_result', content: 'ui-fix finished' });
  writeJson(join(env.REX_HOSTS_ROOT, 'mac', 'tasks.json'), { at: Date.now(), tasks: [{ id: 't', name: 'ui-fix', state: 'working', branch: 'jal/ui' }] });
  const loaded = await loadExtensions([join(dirname(script), 'index.ts')], env.directory);
  assert.deepEqual(loaded.errors, []);
  const sent = [];
  loaded.runtime.sendMessage = (message, options) => sent.push({ message, options });
  const extension = loaded.extensions[0];
  const ctx = { cwd: env.directory, sessionManager: { getBranch: () => [] }, ui: { setWidget() {}, notify() {}, setStatus() {} } };
  await extension.handlers.get('session_start').at(-1)({}, ctx);
  const remote = sent.filter((entry) => entry.message.customType === 'rex_remote_event');
  assert.equal(remote.length, 1);
  assert.equal(remote[0].message.content, 'From mac (subagent_result): ui-fix finished');
  assert.deepEqual(remote[0].options, { triggerTurn: true, deliverAs: 'steer' });
  assert.ok(existsSync(join(env.REX_HOSTS_ROOT, 'mac', 'events', 'delivered', '1-a.json')));
  const event = { systemPromptOptions: { appendSystemPrompt: '', sections: {} } };
  for (const handler of extension.handlers.get('before_agent_start')) {
    try { await handler(event, ctx); } catch (error) { if (!/reading 'find'/.test(error.message)) throw error; }
  }
  assert.match(event.systemPromptOptions.sections.rex_remote_tasks, /"name":"mac\/ui-fix"/);
  assert.match(event.systemPromptOptions.sections.rex_remote_tasks, /"online":false/);
  assert.equal(event.systemPromptOptions.sections.rex_role, undefined);
  for (const handler of extension.handlers.get('session_shutdown') ?? []) await handler({ reason: 'quit' }, ctx);
});

test('a worker coordinator says once when it takes over from the primary and once when it hands back', async (context) => {
  const env = environment(context);
  const agent = join((await import('node:os')).homedir(), '.pi/agent');
  const { readFileSync } = await import('node:fs');
  const version = readFileSync(join(agent, 'install/current-version'), 'utf8').trim();
  const { loadExtensions } = await import(join(agent, 'install/releases', version, 'node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js'));
  const old = Object.fromEntries(['REX_SESSION', 'HERDR_ENV', 'REX_MODULES_CONFIG', 'REX_HOST_NAME'].map((key) => [key, process.env[key]]));
  context.after(() => {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  Object.assign(process.env, { REX_SESSION: `session:link-${Date.now()}`, REX_MODULES_CONFIG: join(env.directory, 'flags.json'), REX_HOST_NAME: 'mac' });
  delete process.env.HERDR_ENV;
  writeFileSync(process.env.REX_MODULES_CONFIG, '{"recovery":false,"overview":false}');
  const { writeJson } = await import('../src/hosts.ts');
  const state = (connected) => writeJson(join(env.REX_LINK_ROOT, 'state.json'), { brain: 'b1', connected, lastSeen: Date.now() });
  state(true);
  const loaded = await loadExtensions([join(dirname(script), 'index.ts')], env.directory);
  const sent = [];
  loaded.runtime.sendMessage = (message, options) => sent.push({ message, options });
  const extension = loaded.extensions[0];
  const ctx = { cwd: env.directory, sessionManager: { getBranch: () => [] }, ui: { setWidget() {}, notify() {}, setStatus() {} } };
  await extension.handlers.get('session_start').at(-1)({}, ctx);
  const event = { systemPromptOptions: { appendSystemPrompt: '', sections: {} } };
  for (const handler of extension.handlers.get('before_agent_start')) {
    try { await handler(event, ctx); } catch (error) { if (!/reading 'find'/.test(error.message)) throw error; }
  }
  assert.match(event.systemPromptOptions.sections.rex_role, /mac worker for b1/);
  state(false);
  await until(() => sent.some((entry) => entry.message.customType === 'rex_link'), 'takeover notice', 5000);
  state(true);
  await until(() => sent.filter((entry) => entry.message.customType === 'rex_link').length === 2, 'hand-back notice', 5000);
  const [down, up] = sent.filter((entry) => entry.message.customType === 'rex_link');
  assert.match(down.message.content, /b1 is unreachable/);
  assert.equal(down.options.triggerTurn, true);
  assert.match(up.message.content, /b1 is reachable again/);
  assert.equal(up.options.triggerTurn, false);
  for (const handler of extension.handlers.get('session_shutdown') ?? []) await handler({ reason: 'quit' }, ctx);
});

test('a hidden worker coordinator counts as idle only with no live tasks and no pending requests', async (context) => {
  const { workerIdle } = await import('../src/hosts.ts');
  const { isWorker } = await import('../src/remote.mjs');
  const env = environment(context);
  const requests = join(env.directory, 'requests');
  const tasks = [{ originCwd: '/c', stopConfirmed: true }, { originCwd: '/other' }];
  assert.equal(workerIdle({ origin: '/c', tasks, requests }), true);
  assert.equal(workerIdle({ origin: '/c', tasks: [...tasks, { originCwd: '/c' }], requests }), false);
  mkdirSync(requests);
  writeFileSync(join(requests, 'a.result.json'), '{}');
  assert.equal(workerIdle({ origin: '/c', tasks, requests }), true);
  writeFileSync(join(requests, 'b.claimed'), '{}');
  assert.equal(workerIdle({ origin: '/c', tasks, requests }), false);
  const config = { order: ['b1', 'mac'], hosts: { b1: {}, mac: {} } };
  assert.deepEqual([isWorker(config, 'mac'), isWorker(config, 'b1'), isWorker(config, undefined)], [true, false, false]);
});
